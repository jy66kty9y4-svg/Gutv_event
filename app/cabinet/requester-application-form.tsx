'use client';

import { type ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { filmingSlotsError, isRequestKind, type FilmingSlot } from '../filming-brief';
import { participantsError, participantsHint } from '../participants-validation';
import { requestedSpecialistsError } from '../request-specialists';
import { needsDeliveryDate } from '../request-deadlines';
import FilmingSlotsFields from '../filming-slots-fields';
import RequestKindFields, { type RequestKindValues } from '../request-kind-fields';
import type { Application } from './requester-dashboard';

type Draft = RequestKindValues & { eventTitle: string; eventDescription: string; scenario: string; participants: string; contactName: string; contactChannel: string; slots: FilmingSlot[]; rulesAccepted: boolean; revision?: number };
type Props = { draftScope: string; specialties: Array<{ id: number; name: string }>; contactName: string; contactChannel: string; application?: Application; onSaved: (application: Application) => void; onReload?: (application: Application) => void; onBusyChange?: (busy: boolean) => void };
const prefix = 'gutv-request-draft:v1:';
export function clearRequesterDrafts(scope: string) {
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(`${prefix}${scope}:`)) sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}
function initialDraft(props: Props): Draft {
  const app = props.application;
  return { eventTitle: app?.eventTitle || '', eventDescription: app?.eventDescription || '', scenario: app?.brief?.scenario || app?.eventDescription || '', participants: app?.brief?.participants || '', contactName: app?.contactName || props.contactName, contactChannel: app?.contactChannel || props.contactChannel,
    requestKind: app?.brief?.requestKind || (app?.specialists.length ? 'trip' : 'event'), deliveryDate: app?.brief?.deliveryDate || '', counts: Object.fromEntries((app?.specialists || []).map(item => [item.id, String(item.requestedCount)])), rulesAccepted: false, revision: app?.revision,
    slots: app?.brief?.slots || (app ? [{ startsAt: `${app.eventDate}T${app.startTime}`, endsAt: `${app.eventDate}T${app.endTime}`, location: app.location }] : [{ startsAt: '', endsAt: '', location: '' }]) };
}
function readDraft(raw: string | null, fallback: Draft): Draft {
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw) as Draft;
    if (!data || !isRequestKind(data.requestKind) || !Array.isArray(data.slots) || !data.slots.length || data.slots.length > 12 || !data.slots.every(slot => slot && ['startsAt', 'endsAt', 'location'].every(key => typeof slot[key as keyof FilmingSlot] === 'string')) || !data.counts || typeof data.counts !== 'object' || Array.isArray(data.counts)) return fallback;
    for (const key of ['eventTitle', 'eventDescription', 'scenario', 'participants', 'contactName', 'contactChannel', 'deliveryDate'] as const) if (typeof data[key] !== 'string') return fallback;
    if (Object.entries(data.counts).some(([id, count]) => !/^\d+$/.test(id) || typeof count !== 'string')) return fallback;
    if (fallback.revision !== undefined && (!Number.isInteger(data.revision) || Number(data.revision) < 1)) return fallback;
    return { ...data, rulesAccepted: data.rulesAccepted === true };
  } catch { return fallback; }
}

export default function RequesterApplicationForm(props: Props) {
  const { application, draftScope, specialties, onSaved, onBusyChange } = props;
  const [sourceApplication, setSourceApplication] = useState(application);
  const availableSpecialties = [...specialties, ...(sourceApplication?.specialists || []).filter(item => !specialties.some(active => active.id === item.id)).map(item => ({ id: item.id, name: `${item.name} (архивная позиция — количество можно только сохранить)` }))];
  const storageKey = `${prefix}${draftScope}:${application?.id || 'new'}`;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(props));
  const current = useRef(draft);
  const [ready, setReady] = useState(false), [version, setVersion] = useState(0);
  const [restored, setRestored] = useState(false);
  const [storageOk, setStorageOk] = useState(true), [saving, setSaving] = useState(false), [attempted, setAttempted] = useState(false);
  const [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const initializedKey = useRef('');
  useEffect(() => {
    if (initializedKey.current === storageKey) return;
    const timer = window.setTimeout(() => {
      let initial = initialDraft(props);
      const kind = new URLSearchParams(window.location.search).get('kind');
      if (!application && isRequestKind(kind)) initial.requestKind = kind;
      try { const loaded = readDraft(sessionStorage.getItem(storageKey), initial); setRestored(loaded !== initial); initial = loaded; } catch { setStorageOk(false); }
      initializedKey.current = storageKey; current.current = initial; setDraft(initial); setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, application, props]);
  function update(patch: Partial<Draft>) {
    const next = { ...current.current, ...patch }; current.current = next; setDraft(next); setError('');
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { setStorageOk(false); }
  }
  async function reloadLatest() {
    if (!application || !window.confirm('Загрузить актуальную заявку? Сохранённые в этой форме правки будут заменены данными сервера.')) return;
    setError('');
    try {
      const response = await fetch('/api/applications', { cache: 'no-store' });
      if (!response.ok) throw new Error('Не удалось обновить заявку. Попробуйте ещё раз.');
      const data = await response.json() as { applications: Application[] };
      const latest = data.applications.find(item => item.id === application.id);
      if (!latest) throw new Error('Заявка недоступна. Закройте редактор и обновите кабинет.');
      if (latest.status !== 'clarification') throw new Error('Статус заявки уже изменился. Закройте редактор и обновите кабинет. Черновик сохранён.');
      const next = initialDraft({ ...props, application: latest });
      current.current = next; setDraft(next); setSourceApplication(latest); setVersion(value => value + 1); setAttempted(false); setConflict(false); setRestored(false); props.onReload?.(latest);
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { setStorageOk(false); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось обновить заявку.'); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    setAttempted(true); setError(''); setConflict(false);
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      const invalid = form.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:invalid,textarea:invalid');
      setError(invalid?.validity.customError ? invalid.validationMessage : 'Проверьте обязательные поля заявки.');
      invalid?.focus(); invalid?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return;
    }
    const value = current.current;
    const specialists = value.requestKind === 'trip' ? Object.entries(value.counts).map(([id, count]) => ({ id: Number(id), requestedCount: Number(count) })) : [];
    const validation = filmingSlotsError(value.slots) || participantsError(value.participants) || requestedSpecialistsError(value.requestKind, specialists, availableSpecialties.map(item => item.id));
    if (validation) { setError(validation); return; }
    const fields = { eventTitle: value.eventTitle, eventDescription: value.eventDescription, scenario: value.scenario, participants: value.participants, contactName: value.contactName, contactChannel: value.contactChannel, requestKind: value.requestKind, deliveryDate: needsDeliveryDate(value.requestKind) ? value.deliveryDate : '', rulesAccepted: value.rulesAccepted, slots: value.slots, specialists };
    setSaving(true); onBusyChange?.(true);
    try {
      const body = new FormData();
      Object.entries(fields).forEach(([key, field]) => body.set(key, typeof field === 'object' ? JSON.stringify(field) : String(field)));
      const response = await fetch(application ? `/api/applications/${application.id}` : '/api/applications', application ? { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resubmit', revision: value.revision, ...fields }) } : { method: 'POST', body });
      const result = await response.json() as { error?: string; application?: Application };
      if (!response.ok || !result.application) { setConflict(response.status === 409); throw new Error(result.error || 'Не удалось отправить заявку. Попробуйте ещё раз.'); }
      try { sessionStorage.removeItem(storageKey); } catch { /* Submission succeeded even if storage is disabled. */ }
      onSaved(result.application);
    } catch (err) { setError(err instanceof TypeError ? 'Нет связи с сервером. Проверьте интернет и повторите отправку. Черновик сохранён.' : err instanceof Error ? err.message : 'Не удалось отправить заявку. Черновик сохранён.'); }
    finally { setSaving(false); onBusyChange?.(false); }
  }
  if (!ready) return <p role="status">Загружаем форму…</p>;
  function changeText(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) { update({ [event.target.name]: event.target.value }); }
  const text = (key: 'eventTitle' | 'eventDescription' | 'scenario' | 'participants' | 'contactName' | 'contactChannel') => ({ name: key, value: draft[key] });
  return <form ref={formRef} key={version} className={`portal-request-form requester-edit-form${attempted ? ' is-validated' : ''}`} onSubmit={submit} noValidate>
    <p className="requester-draft-note" role="status">{restored && 'Восстановлен предыдущий черновик. '}{storageOk ? 'Черновик сохраняется в этой вкладке — можно перейти в другой раздел и вернуться.' : 'В этой вкладке недоступно сохранение черновика. Скопируйте введённый текст перед обновлением страницы.'}</p>
    {sourceApplication?.closingReason && <div className="portal-alert"><span><b>Что нужно уточнить</b><br />{sourceApplication.closingReason}</span></div>}
    {sourceApplication && !sourceApplication.brief && <p className="portal-field-help">Заявка создана по прежней форме. Дополните план, число участников и подтвердите правила. Номер заявки и вложения сохранятся.</p>}
    <fieldset disabled={saving}><legend>Что нужно подготовить?</legend><RequestKindFields specialties={availableSpecialties} initialValues={draft} onValuesChange={update} />
      <div className="portal-form-grid filming-title-fields"><label className="wide"><span>Название мероприятия или проекта <em>*</em></span><input {...text('eventTitle')} onChange={changeText} minLength={2} maxLength={160} placeholder="Например, День первокурсника" required /><small>До 160 символов</small></label><label className="wide"><span>Обоснование заявки <em>*</em></span><textarea {...text('eventDescription')} onChange={changeText} minLength={10} maxLength={4000} rows={4} placeholder="Для чего нужна съёмка и какой результат вы хотите получить" required /><small>От 10 до 4000 символов</small></label></div>
    </fieldset>
    <fieldset disabled={saving}><legend>Даты и места съёмки</legend><FilmingSlotsFields initialSlots={draft.slots} onSlotsChange={slots => update({ slots })} /></fieldset>
    <fieldset disabled={saving}><legend>План и материалы</legend><div className="portal-form-grid"><label className="wide"><span>План мероприятия или сценарий ролика <em>*</em></span><textarea {...text('scenario')} onChange={changeText} minLength={10} maxLength={4000} rows={6} placeholder="Например: 10:00 — открытие, 10:30 — выступления, 12:00 — интервью. Укажите ключевые эпизоды и пожелания к съёмке." required /><small>От 10 до 4000 символов</small></label><label className="wide"><span>Количество участников <em>*</em></span><input {...text('participants')} onChange={changeText} maxLength={80} placeholder="Например, 5–10 человек" required aria-describedby="requester-participants-hint" ref={input => { if (input) input.setCustomValidity(participantsError(input.value) || ''); }} /><small id="requester-participants-hint">{participantsHint}</small></label></div></fieldset>
    <fieldset disabled={saving}><legend>Контактные данные</legend><div className="portal-form-grid"><label><span>Контактное лицо <em>*</em></span><input {...text('contactName')} onChange={changeText} autoComplete="name" minLength={2} maxLength={120} required /><small>До 120 символов</small></label><label><span>Телефон или Telegram <em>*</em></span><input {...text('contactChannel')} onChange={changeText} minLength={3} maxLength={120} required /><small>До 120 символов</small></label></div></fieldset>
    <label className="filming-rules-consent"><input type="checkbox" name="rulesAccepted" value="true" checked={draft.rulesAccepted} onChange={event => update({ rulesAccepted: event.target.checked })} required disabled={saving} /><span>Я ознакомился с <a href="/cabinet/rules" target="_blank" rel="noreferrer">правилами подачи заявок</a>, сроками и горизонтальным форматом съёмки.</span></label>
    <div className="requester-form-feedback">{error && <p className="portal-alert error" role="alert">{error}</p>}{conflict && <button type="button" className="portal-logout" onClick={() => void reloadLatest()}>Загрузить актуальную версию</button>}</div>
    <div className="portal-form-submit requester-submit"><p id="portal-form-feedback">{application ? 'Уточнение вернётся на рассмотрение с прежним номером заявки.' : 'После отправки заявка появится в истории со статусом «На рассмотрении».'}</p><button className="portal-submit" type="submit" aria-describedby="portal-form-feedback" disabled={saving}>{saving ? 'Отправляем…' : application ? 'Отправить уточнение' : 'Отправить заявку'}<b aria-hidden="true">→</b></button></div>
  </form>;
}
