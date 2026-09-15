'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ThemeSwitcher } from '../theme-switcher';
import CabinetIcon from './cabinet-icon';
import { requestKinds, filmingSlotsError, type FilmingBrief } from '../filming-brief';
import RequesterApplicationForm, { clearRequesterDrafts } from './requester-application-form';
import { useDialogFocus } from '../use-dialog-focus';
import { filmingDateBounds } from '../filming-validation';
import './requester-ux.css';
import { participantsError, participantsHint } from '../participants-validation';
import { requestedSpecialistsError } from '../request-specialists';
import { CabinetRules, CabinetContacts } from './cabinet-information';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Status = 'review' | 'clarification' | 'approved' | 'in_progress' | 'completed' | 'rejected' | 'cancelled';
type View = 'overview' | 'new' | 'history' | 'notifications' | 'rules' | 'contacts';
export type Application = {
  revision: number;
  brief: FilmingBrief | null;
  id: number; number: string; organizationName: string; eventTitle: string; eventDate: string; startTime: string; endTime: string;
  location: string; eventDescription: string; requestedEquipment: string; assignedEquipment: string; contactName: string; contactChannel: string;
  customerComment: string; status: Status; closingReason: string; createdAt: string; updatedAt: string;
  specialists: Array<{ id: number; name: string; requestedCount: number; assignedCount: number; assignedNames: string }>;
  attachments: Array<{ id: number; name: string; mimeType: string; size: number }>;
  review: { rating: number; comment: string; createdAt: string; updatedAt: string } | null;
  history: Array<{ fromStatus: Status | null; toStatus: Status; note: string; createdAt: string }>;
};
type Notification = { id: number; application_id: number | null; title: string; body: string; read_at: string | null; created_at: string };
type Organization = { id: number; name: string; type: string; representative_name: string; contact: string };
type WebMcpContext = {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: object;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: unknown) => Promise<unknown>;
  }, options?: { signal?: AbortSignal }) => void | Promise<void>;
};
type WebMcpDocument = Document & { modelContext?: WebMcpContext };

const statusLabels: Record<Status, string> = {
  review: 'На рассмотрении', clarification: 'Требует уточнения', approved: 'Согласована', in_progress: 'В работе', completed: 'Выполнена', rejected: 'Отклонена', cancelled: 'Отменена',
};
const viewTitles: Record<View, { eyebrow: string; title: string }> = {
  overview: { eyebrow: 'Личный кабинет', title: 'Обзор' },
  new: { eyebrow: 'Новая съёмка', title: 'Заявка' },
  history: { eyebrow: 'Все обращения', title: 'История' },
  notifications: { eyebrow: 'Изменения и решения', title: 'Уведомления' },
  rules: { eyebrow: 'Работа со студией', title: 'Правила' },
  contacts: { eyebrow: 'Связь с ГУТВ', title: 'Контакты' },
};

function prettyDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
}
function prettyMoment(value: string) {
  return new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z')).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
}
function fileSize(value: number) { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} КБ` : `${(value / 1024 / 1024).toFixed(1)} МБ`; }

export default function RequesterDashboard({ initialView = 'overview' }: { initialView?: View }) {
  const [view, updateView] = useState<View>(initialView);
  const [menuOpen, setMenuOpen] = useState(false);
  function setView(next: View) {
    updateView(next); setMenuOpen(false);
    window.history.replaceState(null, '', `/cabinet${next === 'rules' || next === 'contacts' ? `/${next}` : next === 'overview' ? '' : `?view=${next}`}`);
    window.scrollTo({ top: 0 });
  }
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [specialties, setSpecialties] = useState<Array<{ id: number; name: string }>>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selected, updateSelected] = useState<Application | null>(null);
  const [draftScope, setDraftScope] = useState('');
  const [editing, setEditing] = useState(false);
  const [dialogBusy, setDialogBusy] = useState<'cancel' | 'review' | 'resubmit' | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [dialogSuccess, setDialogSuccess] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const drawerRef = useRef<HTMLElement>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  function setSelected(application: Application | null) {
    updateSelected(application); setEditing(false); setDialogError(''); setDialogSuccess('');
    setReviewRating(application?.review?.rating || 5); setReviewComment(application?.review?.comment || '');
  }
  function closeDialog() {
    if (dialogBusy) return;
    if (selected?.status === 'completed' && (reviewComment !== (selected.review?.comment || '') || reviewRating !== (selected.review?.rating || 5)) && !window.confirm('Закрыть отзыв без сохранения изменений?')) return;
    setSelected(null);
  }
  useDialogFocus({ open: Boolean(selected), dialogRef: drawerRef, onClose: closeDialog });

  const loadData = useCallback(async () => {
    setError('');
    try {
      const [applicationResponse, notificationResponse] = await Promise.all([
        fetch('/api/applications', { cache: 'no-store' }),
        fetch('/api/notifications', { cache: 'no-store' }),
      ]);
      if (!applicationResponse.ok) throw new Error('Не удалось загрузить кабинет');
      const data = await applicationResponse.json() as { organization: Organization; applications: Application[]; specialties: Array<{ id: number; name: string }>; draftScope: string };
      setOrganization(data.organization);
      setDraftScope(data.draftScope);
      setApplications(data.applications);
      setSpecialties(data.specialties);
      if (notificationResponse.ok) setNotifications((await notificationResponse.json() as { notifications: Notification[] }).notifications);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить кабинет');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const target = params.get('new') === '1' ? 'new' : params.get('view');
      if (target && Object.hasOwn(viewTitles, target)) updateView(target as View);
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    const context = (document as WebMcpDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tool = {
      name: 'create_filming_request',
      title: 'Создать заявку на съёмку',
      description: 'Создаёт реальную заявку ГУТВ от текущего аккаунта факультета или организации без вложений и обновляет кабинет.',
      inputSchema: {
        type: 'object',
        properties: {
          eventTitle: { type: 'string', minLength: 2, maxLength: 160, description: 'Название мероприятия' },
          requestKind: { type: 'string', enum: Object.keys(requestKinds) },
          specialists: { type: 'array', description: `Обязательно для выездной учёбы. Доступные позиции: ${specialties.map(item => `${item.id}: ${item.name}`).join(', ')}`, items: { type: 'object', properties: { id: { type: 'integer' }, requestedCount: { type: 'integer', minimum: 1, maximum: 99 } }, required: ['id', 'requestedCount'], additionalProperties: false } },
          slots: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', properties: { startsAt: { type: 'string', description: 'YYYY-MM-DDTHH:MM, Москва' }, endsAt: { type: 'string' }, location: { type: 'string', minLength: 2, maxLength: 240 } }, required: ['startsAt', 'endsAt', 'location'], additionalProperties: false } },
          eventDescription: { type: 'string', minLength: 10, maxLength: 4000 },
          scenario: { type: 'string', minLength: 10, maxLength: 4000 },
          participants: { type: 'string', minLength: 1, maxLength: 80, description: participantsHint },
          rulesAccepted: { type: 'boolean', const: true, description: 'Подтверждение ознакомления с правилами пользователем' },
          contactName: { type: 'string', minLength: 2, maxLength: 120 },
          contactChannel: { type: 'string', minLength: 3, maxLength: 120 },
        },
        required: ['eventTitle', 'requestKind', 'slots', 'eventDescription', 'scenario', 'participants', 'rulesAccepted', 'contactName', 'contactChannel'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input: unknown) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Передайте поля заявки объектом');
        const value = input as Record<string, unknown>;
        const requiredStrings = ['eventTitle', 'requestKind', 'eventDescription', 'scenario', 'participants', 'contactName', 'contactChannel'] as const;
        for (const field of requiredStrings) if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error(`Поле ${field} обязательно`);
        const participantError = participantsError(value.participants);
        if (participantError) throw new Error(participantError);
        if (value.rulesAccepted !== true) throw new Error('Нужно подтверждение ознакомления с правилами');
        const error = filmingSlotsError(value.slots);
        if (error) throw new Error(error);
        const form = new FormData();
        requiredStrings.forEach((field) => form.set(field, String(value[field])));
        const specialists = value.specialists ?? [];
        const specialistError = requestedSpecialistsError(value.requestKind, specialists, specialties.map(item => item.id));
        if (specialistError) throw new Error(specialistError);
        form.set('specialists', JSON.stringify(specialists));
        form.set('slots', JSON.stringify(value.slots));
        form.set('rulesAccepted', 'true');
        const response = await fetch('/api/applications', { method: 'POST', body: form });
        const result = await response.json() as { error?: string; application?: Application };
        if (!response.ok || !result.application) throw new Error(result.error || 'Не удалось создать заявку');
        await loadData();
        setView('overview');
        setSuccess(`Заявка ${result.application.number} отправлена`);
        return { number: result.application.number, status: statusLabels[result.application.status] };
      },
    };
    try {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch((registrationError) => {
        console.error('WebMCP registration failed', registrationError);
      });
    } catch (registrationError) {
      console.error('WebMCP registration failed', registrationError);
    }
    return () => lifecycle.abort();
  }, [loadData, specialties]);

  const filtered = useMemo(() => applications.filter((item) =>
    (statusFilter === 'all' || item.status === statusFilter)
    && (!query.trim() || `${item.number} ${item.eventTitle} ${item.location}`.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU'))),
  ), [applications, statusFilter, query]);
  const openApplications = applications.filter((item) => !['completed', 'rejected', 'cancelled'].includes(item.status));
  const upcoming = applications.filter((item) => item.eventDate >= filmingDateBounds().min && ['approved', 'in_progress'].includes(item.status)).sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  const unread = notifications.filter((item) => !item.read_at).length;

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Не удалось выйти. Попробуйте ещё раз.');
      if (draftScope) clearRequesterDrafts(draftScope);
      window.location.replace('/');
    } catch { setError('Не удалось выйти. Проверьте подключение и повторите попытку.'); }
  }

  async function openNotifications() {
    setView('notifications');
    if (unread) {
      await fetch('/api/notifications', { method: 'PATCH' });
      setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
    }
  }

  function applicationSaved(application: Application) {
    setSuccess(`Заявка ${application.number} отправлена`);
    setView('overview');
    void loadData();
  }

  async function cancelApplication(application: Application) {
    if (dialogBusy || !window.confirm(`Отменить заявку «${application.eventTitle}»?`)) return;
    setDialogBusy('cancel'); setDialogError(''); setDialogSuccess('');
    try {
      const response = await fetch(`/api/applications/${application.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', revision: application.revision }) });
      const result = await response.json() as { error?: string; application?: Application };
      if (!response.ok || !result.application) throw new Error(result.error || 'Не удалось отменить заявку.');
      updateSelected(result.application); setDialogSuccess('Заявка отменена');
      await loadData();
    } catch (err) { setDialogError(err instanceof TypeError ? 'Нет связи с сервером. Проверьте интернет и повторите отмену.' : err instanceof Error ? err.message : 'Не удалось отменить заявку.'); }
    finally { setDialogBusy(null); }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>, application: Application) {
    event.preventDefault(); if (dialogBusy) return;
    setDialogBusy('review'); setDialogError(''); setDialogSuccess('');
    try {
      const response = await fetch(`/api/applications/${application.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: reviewRating, comment: reviewComment }) });
      const result = await response.json() as { error?: string; application?: Application };
      if (!response.ok || !result.application) throw new Error(result.error || 'Не удалось сохранить отзыв.');
      updateSelected(result.application); setDialogSuccess('Отзыв сохранён');
      await loadData();
    } catch (err) { setDialogError(err instanceof TypeError ? 'Нет связи с сервером. Проверьте интернет и повторите отправку. Текст отзыва сохранён в форме.' : err instanceof Error ? err.message : 'Не удалось сохранить отзыв.'); }
    finally { setDialogBusy(null); }
  }

  const nav: Array<[View, string, string]> = [['overview', 'ОВ', 'Обзор'], ['new', 'ЗЯ', 'Новая заявка'], ['history', 'ИС', 'История'], ['notifications', 'УВ', 'Уведомления'], ['rules', 'ПР', 'Правила'], ['contacts', 'КТ', 'Контакты']];

  return <div className="portal-app requester-app">
    <aside className={`portal-sidebar${menuOpen ? ' menu-open' : ''}`}>
      <Link className="portal-brand" href="/"><span><Image src="/design/gutv-mark.svg" width={58} height={58} alt="ГУТВ" priority /></span><p>Заявки<br />на съёмку</p></Link>
      <button className="cabinet-menu-toggle" type="button" aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menuOpen} aria-controls="cabinet-mobile-menu" onClick={() => setMenuOpen(open => !open)}><CabinetIcon name="menu" /><span>Меню</span></button>
      <div className="portal-mobile-menu" id="cabinet-mobile-menu"><nav id="cabinet-navigation" aria-label="Разделы кабинета">{nav.map(([key, , label]) => <button type="button" className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined} key={key} onClick={() => key === 'notifications' ? void openNotifications() : setView(key)}><span aria-hidden="true"><CabinetIcon name={key} /></span><b>{label}</b>{key === 'notifications' && unread > 0 && <i>{unread}</i>}</button>)}</nav><div className="portal-mobile-account"><span>Тема интерфейса</span><ThemeSwitcher /><button className="portal-logout" type="button" onClick={() => void logout()}>Выйти</button></div></div>
      <div className="portal-sidebar-meta"><span><i /> Кабинет активен</span><p>{organization?.type === 'faculty' ? 'ФАКУЛЬТЕТ' : 'ОРГАНИЗАЦИЯ'}<br />{organization?.name || 'ЗАГРУЗКА'}</p></div>
    </aside>
    <div className="portal-workspace">
      <header className="portal-topbar"><div className="portal-page-title"><span>{viewTitles[view].eyebrow}</span><h1>{viewTitles[view].title}</h1></div><div className="portal-top-actions"><ThemeSwitcher /><div className="portal-user"><small>АККАУНТ</small><b>{organization?.name || 'ГУТВ'}</b></div><button className="portal-logout" type="button" onClick={() => void logout()}>Выйти</button><button className="portal-primary" type="button" onClick={() => setView('new')}><span aria-hidden="true" />Новая заявка</button></div></header>
      <main className="portal-main">
        {error && <div className="portal-alert error" role="alert"><b>ERR</b><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть">×</button></div>}
        {success && <div className="portal-alert success" role="status"><b>OK</b><span>{success}</span><button onClick={() => setSuccess('')} aria-label="Закрыть">×</button></div>}
        {loading ? <div className="portal-loading"><span><i /><i /><i /><i /></span><b>Загружаем кабинет…</b></div> : <div className="portal-view" key={view}>
          {view === 'overview' && <>
            <section className="portal-kpis"><article className="primary"><span>Активные заявки</span><strong>{String(openApplications.length).padStart(2, '0')}</strong><p>{openApplications.length ? 'Работа продолжается' : 'Можно планировать новую съёмку'}</p><button type="button" onClick={() => setView('history')}>Открыть историю →</button></article><article><span>Ближайшие события</span><strong>{String(upcoming.length).padStart(2, '0')}</strong><small>{upcoming[0] ? prettyDate(upcoming[0].eventDate) : 'Нет запланированных'}</small></article><article><span>Выполнено</span><strong>{String(applications.filter((item) => item.status === 'completed').length).padStart(2, '0')}</strong><small>За всё время</small></article><article><span>Новые уведомления</span><strong>{String(unread).padStart(2, '0')}</strong><button type="button" onClick={() => void openNotifications()}>Посмотреть →</button></article></section>
            <section className="portal-dashboard-grid"><article className="portal-panel portal-next"><div className="portal-panel-head"><div><span>CH 02 · БЛИЖАЙШИЕ</span><h2>Съёмки</h2></div><button onClick={() => setView('history')}>Все →</button></div>{upcoming.length ? <div className="portal-event-list">{upcoming.slice(0, 4).map((item) => <button type="button" key={item.id} onClick={() => setSelected(item)}><time><b>{item.eventDate.slice(8, 10)}</b><span>{new Date(`${item.eventDate}T12:00:00`).toLocaleDateString('ru-RU', { month: 'short' })}</span></time><p><strong>{item.eventTitle}</strong><small>{item.startTime} · {item.location}</small></p><em className={`status-${item.status}`}>{statusLabels[item.status]}</em></button>)}</div> : <div className="portal-empty"><span>◌</span><h3>Съёмок пока нет</h3><p>Создайте заявку — она появится здесь после отправки.</p><button type="button" onClick={() => setView('new')}>Оставить заявку</button></div>}</article><article className="portal-panel portal-process"><div className="portal-panel-head"><div><span>CH 03 · ПРОЦЕСС</span><h2>Как идёт работа</h2></div></div><div className="portal-process-list"><div className="active"><i>01</i><span><b>Заявка</b><small>Расскажите о событии</small></span></div><div><i>02</i><span><b>Согласование</b><small>Уточним задачу и условия</small></span></div><div><i>03</i><span><b>Съёмка</b><small>Выполним задачу</small></span></div><div><i>04</i><span><b>Отзыв</b><small>Оцените результат</small></span></div></div></article></section>
          </>}

          {view === 'rules' && <CabinetRules />}
          {view === 'contacts' && <CabinetContacts />}
          {view === 'new' && organization && draftScope && <section className="portal-form-panel filming-request-panel"><div className="portal-form-intro"><h2>Новая заявка</h2><p>Расскажите о задаче, укажите даты и подготовьте план съёмки.</p></div><RequesterApplicationForm key={draftScope} draftScope={draftScope} specialties={specialties} contactName={organization.representative_name} contactChannel={organization.contact} onSaved={applicationSaved} /></section>}

          {view === 'history' && <section className="portal-panel portal-history"><div className="portal-history-tools"><div className="portal-search"><CabinetIcon name="search" /><input maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по заявкам" aria-label="Поиск по заявкам" /></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} aria-label="Фильтр по статусу"><option value="all">Все статусы</option>{Object.entries(statusLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div><div className="portal-table-wrap"><table><thead><tr><th>Номер</th><th>Мероприятие</th><th>Дата и место</th><th>Статус</th><th /></tr></thead><tbody>{filtered.length ? filtered.map((item) => <tr key={item.id} onClick={() => setSelected(item)}><td><code>{item.number}</code></td><td><b>{item.eventTitle}</b><small>Обновлено {prettyMoment(item.updatedAt)}</small></td><td><b>{prettyDate(item.eventDate)}</b><small>{item.startTime}–{item.endTime} · {item.location}</small></td><td><span className={`portal-status status-${item.status}`}>{statusLabels[item.status]}</span></td><td><button type="button" onClick={(event) => { event.stopPropagation(); setSelected(item); }} aria-label={`Открыть ${item.number}`}><CabinetIcon name="arrow" /></button></td></tr>) : <tr><td colSpan={5} className="portal-empty-cell">Заявки не найдены</td></tr>}</tbody></table></div></section>}

          {view === 'notifications' && <section className="portal-panel portal-notifications"><div className="portal-panel-head"><div><span>CH 04 · ЛЕНТА</span><h2>Последние изменения</h2></div><small>{notifications.length} сообщений</small></div>{notifications.length ? <div className="portal-notification-list">{notifications.map((item) => <button type="button" key={item.id} className={!item.read_at ? 'unread' : ''} onClick={() => { const app = applications.find((application) => application.id === item.application_id); if (app) setSelected(app); }}><i /><span><b>{item.title}</b><p>{item.body}</p><small>{prettyMoment(item.created_at)}</small></span><em>→</em></button>)}</div> : <div className="portal-empty"><span>✓</span><h3>Новых сообщений нет</h3><p>Здесь появятся решения и изменения по вашим заявкам.</p></div>}</section>}
        </div>}
      </main>
    </div>

    {selected && <div className="portal-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}><section ref={drawerRef} className="portal-drawer requester-detail" role="dialog" aria-modal="true" aria-labelledby="request-detail-title"><button className="portal-drawer-close" type="button" onClick={closeDialog} disabled={Boolean(dialogBusy)} aria-label="Закрыть"><CabinetIcon name="close" /></button><div className="portal-detail-head"><div><span>{selected.number}</span><h2 id="request-detail-title">{selected.eventTitle}</h2></div><em className={`portal-status status-${selected.status}`}>{statusLabels[selected.status]}</em></div>{dialogError && <div className="portal-alert error requester-dialog-message" role="alert">{dialogError}</div>}{dialogSuccess && <div className="portal-alert success requester-dialog-message" role="status">{dialogSuccess}</div>}{editing && draftScope ? <><button type="button" className="requester-back" disabled={Boolean(dialogBusy)} onClick={() => setEditing(false)}>← К заявке · черновик сохранён</button><RequesterApplicationForm key={`${draftScope}:${selected.id}`} draftScope={draftScope} specialties={specialties} contactName={selected.contactName} contactChannel={selected.contactChannel} application={selected} onReload={updateSelected} onBusyChange={busy => setDialogBusy(busy ? 'resubmit' : null)} onSaved={application => { updateSelected(application); setEditing(false); setDialogSuccess('Уточнение отправлено. Заявка снова на рассмотрении.'); void loadData(); }} /></> : <>{selected.status === 'clarification' && <div className="requester-clarification-action"><p>{selected.closingReason || 'Уточните сведения в заявке и отправьте её на повторное рассмотрение.'}</p><button type="button" className="portal-submit" onClick={() => setEditing(true)}>Внести уточнения</button></div>}<div className="portal-detail-grid">{selected.brief ? <><article className="wide"><span>Что нужно подготовить</span><b>{requestKinds[selected.brief.requestKind]}</b></article>{selected.brief.slots.map((slot, index) => <article className="wide" key={index}><span>Интервал {index + 1} · Москва</span><b>{prettyDate(slot.startsAt.slice(0, 10))}, {slot.startsAt.slice(11)} — {prettyDate(slot.endsAt.slice(0, 10))}, {slot.endsAt.slice(11)}</b><p>{slot.location}</p></article>)}<article className="wide"><span>План мероприятия или сценарий</span><p>{selected.brief.scenario}</p></article><article><span>Количество участников</span><b>{selected.brief.participants}</b></article></> : <><article><span>Дата и время</span><b>{prettyDate(selected.eventDate)}</b><p>{selected.startTime}–{selected.endTime}</p></article><article><span>Место</span><b>{selected.location}</b></article></>}<article className="wide"><span>Обоснование заявки</span><p>{selected.eventDescription}</p></article><article><span>Контакт</span><b>{selected.contactName}</b><p>{selected.contactChannel}</p></article>{selected.specialists.length > 0 && <article className="wide"><span>Запрошенные специалисты</span>{selected.specialists.map(item => <p key={item.id}>{item.name} — {item.requestedCount}</p>)}</article>}{selected.attachments.length > 0 && <article className="wide"><span>Вложения</span><div className="portal-files">{selected.attachments.map((file) => <a href={`/api/attachments/${file.id}`} key={file.id}>{file.name}<small>{fileSize(file.size)}</small></a>)}</div></article>}{selected.closingReason && <article className="wide warning"><span>Комментарий к решению</span><p>{selected.closingReason}</p></article>}</div><div className="portal-timeline"><h3>История статусов</h3>{[...selected.history].reverse().map((item, index) => <div key={`${item.createdAt}-${index}`}><i /><span><b>{statusLabels[item.toStatus]}</b><small>{prettyMoment(item.createdAt)}{item.note ? ` · ${item.note}` : ''}</small></span></div>)}</div>{['review', 'clarification', 'approved'].includes(selected.status) && <button className="portal-cancel" type="button" disabled={Boolean(dialogBusy)} onClick={() => void cancelApplication(selected)}>{dialogBusy === 'cancel' ? 'Отменяем…' : 'Отменить заявку'}</button>}{selected.status === 'completed' && <form className="portal-review" onSubmit={(event) => void submitReview(event, selected)}><div><span>Отзыв о работе</span><h3>{selected.review ? 'Ваш отзыв' : 'Как всё прошло?'}</h3></div><div className="portal-stars" role="radiogroup" aria-label="Оценка">{[1, 2, 3, 4, 5].map((rating) => <button type="button" role="radio" aria-label={`${rating} из 5`} tabIndex={reviewRating === rating ? 0 : -1} disabled={Boolean(dialogBusy)} aria-checked={reviewRating === rating} className={rating <= reviewRating ? 'active' : ''} key={rating} onClick={() => setReviewRating(rating)} onKeyDown={event => { const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0; if (delta || event.key === 'Home' || event.key === 'End') { event.preventDefault(); const next = event.key === 'Home' ? 1 : event.key === 'End' ? 5 : ((rating - 1 + delta + 5) % 5) + 1; setReviewRating(next); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`button[aria-label="${next} из 5"]`)?.focus(); } }}><span aria-hidden="true">★</span></button>)}</div><label htmlFor="requester-review-comment">Комментарий к отзыву</label><textarea id="requester-review-comment" name="comment" maxLength={2000} rows={4} value={reviewComment} onChange={event => setReviewComment(event.target.value)} disabled={Boolean(dialogBusy)} placeholder="Расскажите, что получилось хорошо и что можно улучшить" /><button className="portal-submit" type="submit" disabled={Boolean(dialogBusy)}>{dialogBusy === 'review' ? 'Сохраняем…' : selected.review ? 'Обновить отзыв' : 'Отправить отзыв'}<b aria-hidden="true">→</b></button></form>}</>}</section></div>}
  </div>;
}
