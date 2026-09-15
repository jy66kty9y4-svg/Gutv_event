'use client';

import Image from 'next/image';
import { photoSource } from '../photo-source';
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { LeadershipPerson, LeadershipPosition, LeadershipRoster } from '../leadership-types';
import styles from './leadership-manager.module.css';
import LeadershipPhotoEditor from './leadership-photo-editor';
import { PHOTO_ASPECT_RATIOS } from '../leadership-photo';
import PositionedPhoto from '../positioned-photo';

type Tab = 'positions' | 'people';
type Drawer = { kind: 'position'; position?: LeadershipPosition } | { kind: 'person'; person?: LeadershipPerson } | null;
type PositionDraft = { title: string; personId: number | null };
type PersonDraft = Omit<LeadershipPerson, 'id'>;
const blankPerson: PersonDraft = { name: '', description: '', photoUrl: '', photoPosition: 'center center', photoScale: 1 };

function errorText(value: unknown) { return value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Не удалось сохранить изменения'; }
async function rosterRequest(url: string, init?: RequestInit): Promise<LeadershipRoster> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init?.headers } });
  const data = await response.json().catch(() => null) as LeadershipRoster | { roster?: LeadershipRoster; error?: string } | null;
  if (!response.ok) throw new Error(errorText(data));
  if (data && 'roster' in data && data.roster) return data.roster;
  if (data && 'positions' in data && 'people' in data) return data;
  throw new Error('Сервер вернул неполные данные');
}

export default function LeadershipManager() {
  const [tab, setTab] = useState<Tab>('positions');
  const [roster, setRoster] = useState<LeadershipRoster | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [positionDraft, setPositionDraft] = useState<PositionDraft>({ title: '', personId: null });
  const [personDraft, setPersonDraft] = useState<PersonDraft>(blankPerson);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const drawerRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const positions = useMemo(() => [...(roster?.positions || [])].sort((a, b) => a.sortOrder - b.sortOrder), [roster]);
  const people = roster?.people || [];
  const personFor = (id: number | null) => people.find((person) => person.id === id) || null;
  const rolesFor = (id: number) => positions.filter((position) => position.personId === id).map((position) => position.title);

  function apply(next: LeadershipRoster, message = '') { setRoster(next); if (message) setNotice(message); }
  async function run(action: () => Promise<LeadershipRoster>, message: string) {
    if (busy) return null;
    setBusy(true); setError(''); setNotice('');
    try { const next = await action(); apply(next, message); return next; }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить изменения'); return null; }
    finally { setBusy(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void run(() => rosterRequest('/api/admin/leadership'), ''); }, 0); return () => window.clearTimeout(timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!drawer) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    function keys(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); setDrawer(null); return; }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), select:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', keys);
    return () => { window.clearTimeout(timer); document.body.style.overflow = overflow; window.removeEventListener('keydown', keys); previous?.focus(); };
  }, [drawer, busy]);

  function openPosition(position?: LeadershipPosition) { setError(''); setConfirmDelete(false); setPositionDraft(position ? { title: position.title, personId: position.personId } : { title: '', personId: null }); setDrawer({ kind: 'position', position }); }
  function openPerson(person?: LeadershipPerson) { setError(''); setConfirmDelete(false); setPhoto(null); setPhotoPreview(''); setPersonDraft(person ? { name: person.name, description: person.description, photoUrl: person.photoUrl, photoPosition: person.photoPosition, photoScale: person.photoScale ?? 1 } : blankPerson); setDrawer({ kind: 'person', person }); }
  function closeDrawer() { if (!busy) { setConfirmDelete(false); setDrawer(null); } }
  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) { setError('Выберите JPEG, PNG или WebP до 5 МБ'); event.target.value = ''; return; }
    setPhoto(file); if (file) setPersonDraft((current) => ({ ...current, photoPosition: 'center center', photoScale: 1 })); if (!file) { setPhotoPreview(''); return; }
    const reader = new FileReader(); reader.onload = () => setPhotoPreview(typeof reader.result === 'string' ? reader.result : ''); reader.readAsDataURL(file);
  }
  function clearPhoto() { setPhoto(null); setPhotoPreview(''); setPersonDraft((current) => ({ ...current, photoUrl: '' })); if (fileRef.current) fileRef.current.value = ''; }
  async function uploadPhoto() {
    if (!photo) return personDraft.photoUrl;
    const form = new FormData(); form.append('file', photo);
    const response = await fetch('/api/admin/leadership/photos', { method: 'POST', body: form });
    const data = await response.json().catch(() => null) as { photoUrl?: string; error?: string } | null;
    if (!response.ok || !data?.photoUrl) throw new Error(errorText(data));
    return data.photoUrl;
  }
  async function savePosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const current = drawer?.kind === 'position' ? drawer.position : undefined;
    const title = positionDraft.title.trim(); if (!title) return;
    const next = await run(() => rosterRequest(current ? `/api/admin/leadership/positions/${current.id}` : '/api/admin/leadership/positions', { method: current ? 'PATCH' : 'POST', body: JSON.stringify({ title, personId: positionDraft.personId }) }), current ? 'Должность обновлена' : 'Должность добавлена');
    if (next) { setConfirmDelete(false); setDrawer(null); }
  }
  async function savePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const current = drawer?.kind === 'person' ? drawer.person : undefined;
    const next = await run(async () => rosterRequest(current ? `/api/admin/leadership/people/${current.id}` : '/api/admin/leadership/people', { method: current ? 'PATCH' : 'POST', body: JSON.stringify({ ...personDraft, name: personDraft.name.trim(), photoUrl: await uploadPhoto() }) }), current ? 'Карточка обновлена' : 'Человек добавлен');
    if (next) { setPhoto(null); setPhotoPreview(''); setConfirmDelete(false); if (fileRef.current) fileRef.current.value = ''; setDrawer(null); }
  }
  async function removePosition() { const current = drawer?.kind === 'position' ? drawer.position : undefined; if (!current) return; const next = await run(() => rosterRequest(`/api/admin/leadership/positions/${current.id}`, { method: 'DELETE' }), 'Должность удалена'); if (next) { setConfirmDelete(false); setDrawer(null); } }
  async function removePerson() { const current = drawer?.kind === 'person' ? drawer.person : undefined; if (!current) return; const next = await run(() => rosterRequest(`/api/admin/leadership/people/${current.id}`, { method: 'DELETE' }), 'Человек удалён; должности оставлены пустыми'); if (next) { setConfirmDelete(false); setDrawer(null); } }
  async function move(position: LeadershipPosition, direction: -1 | 1) { const index = positions.findIndex((item) => item.id === position.id); const nextIndex = index + direction; if (nextIndex < 0 || nextIndex >= positions.length) return; const ids = positions.map((item) => item.id); [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]]; await run(() => rosterRequest('/api/admin/leadership/order', { method: 'PUT', body: JSON.stringify({ ids }) }), 'Порядок обновлён'); }

  const editingPosition = drawer?.kind === 'position' ? drawer.position : undefined;
  const editingPerson = drawer?.kind === 'person' ? drawer.person : undefined;
  return <section className={styles.manager} aria-labelledby="leadership-title">
    <header className={styles.header}><div><h2 id="leadership-title" className={styles.srOnly}>Руководящий состав</h2><p>Роли и карточки, которые видят посетители страницы студии.</p></div>{tab === 'positions' ? <button className={styles.primary} type="button" onClick={() => openPosition()} disabled={busy}>Добавить должность</button> : <button className={styles.primary} type="button" onClick={() => openPerson()} disabled={busy}>Добавить человека</button>}</header>
    <div className={styles.tabs} role="tablist" aria-label="Настройка состава"><button role="tab" aria-selected={tab === 'positions'} className={tab === 'positions' ? styles.activeTab : ''} onClick={() => setTab('positions')}>Должности и порядок <span>{positions.length}</span></button><button role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? styles.activeTab : ''} onClick={() => setTab('people')}>Люди <span>{people.length}</span></button></div>
    {error && !drawer && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    {!roster ? <div className={styles.loading}>Загружаем состав…</div> : tab === 'positions' ? <section className={styles.positionPanel} aria-label="Должности"><div className={styles.positionHead}><span>№</span><span>Должность</span><span>Назначен</span><span className="sr-only">Действия</span></div>{positions.map((position, index) => { const person = personFor(position.personId); return <article className={styles.positionRow} key={position.id}><b>{String(index + 1).padStart(2, '0')}</b><strong>{position.title}</strong><span className={styles.assignee}>{person ? <>{person.photoUrl ? <Image src={photoSource(person.photoUrl)} alt="" width={30} height={30} unoptimized /> : <i className={styles.avatar}>{person.name.slice(0, 1)}</i>}<span>{person.name}</span></> : 'Не назначен'}</span><span className={styles.rowActions}><button type="button" onClick={() => void move(position, -1)} disabled={busy || index === 0} aria-label={`Поднять ${position.title}`}>↑</button><button type="button" onClick={() => void move(position, 1)} disabled={busy || index === positions.length - 1} aria-label={`Опустить ${position.title}`}>↓</button><button type="button" onClick={() => openPosition(position)} disabled={busy} aria-label={`Изменить ${position.title}`}>Изменить</button></span></article>; })}{!positions.length && <p className={styles.empty}>Должностей пока нет. Добавьте первую.</p>}</section> : <section className={styles.peopleGrid} aria-label="Люди">{people.map((person) => <article className={styles.personCard} key={person.id}><div className={styles.portrait} style={{ aspectRatio: PHOTO_ASPECT_RATIOS.leadership }}>{person.photoUrl ? <PositionedPhoto photo={person} alt={person.name} aspectRatio={PHOTO_ASPECT_RATIOS.leadership} className={styles.positionedPhoto} /> : <span>{person.name.slice(0, 1)}</span>}</div><div><h3>{person.name}</h3><p>{rolesFor(person.id).join(' · ') || 'Без должности'}</p><button type="button" onClick={() => openPerson(person)} disabled={busy} aria-label={`Изменить карточку ${person.name}`}>Изменить</button></div></article>)}{!people.length && <p className={styles.empty}>Людей пока нет. Добавьте первую карточку.</p>}</section>}
    {drawer && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}><aside className={styles.drawer} ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="leadership-drawer-title"><header><div><span>{drawer.kind === 'position' ? 'ДОЛЖНОСТЬ' : 'КАРТОЧКА ЧЕЛОВЕКА'}</span><h2 id="leadership-drawer-title">{drawer.kind === 'position' ? editingPosition ? 'Изменить должность' : 'Новая должность' : editingPerson ? 'Изменить человека' : 'Новый человек'}</h2></div><button type="button" onClick={closeDrawer} disabled={busy} aria-label="Закрыть">×</button></header>{error && <p className={styles.error} role="alert">{error}</p>}{drawer.kind === 'position' ? <form onSubmit={savePosition}><main><label><span>Название</span><input ref={firstFieldRef} value={positionDraft.title} onChange={(event) => setPositionDraft((current) => ({ ...current, title: event.target.value }))} minLength={2} maxLength={100} required disabled={busy} /></label><label><span>Назначить человека</span><select value={positionDraft.personId ?? ''} onChange={(event) => setPositionDraft((current) => ({ ...current, personId: event.target.value ? Number(event.target.value) : null }))} disabled={busy}><option value="">Не назначен</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></main><footer>{confirmDelete ? <><p className={styles.confirmText}>Удалить эту должность? Карточки людей сохранятся.</p><span className={styles.confirmActions}><button type="button" onClick={() => void removePosition()} className={styles.destructive} disabled={busy}>Да, удалить</button><button type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>Отмена</button></span></> : <><button className={styles.primary} type="submit" disabled={busy || !positionDraft.title.trim()}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>{editingPosition && <button className={styles.destructive} type="button" onClick={() => setConfirmDelete(true)} disabled={busy}>Удалить должность</button>}</>}</footer></form> : <form onSubmit={savePerson}><main><div className={styles.photoEditor}><div className={styles.largePortrait} style={{ aspectRatio: PHOTO_ASPECT_RATIOS.leadership }}>{photoPreview || personDraft.photoUrl ? <PositionedPhoto photo={{ ...personDraft, photoUrl: photoPreview || personDraft.photoUrl }} alt="Предпросмотр" aspectRatio={PHOTO_ASPECT_RATIOS.leadership} className={styles.positionedPhoto} /> : <span>Фото</span>}</div><div><input ref={fileRef} className={styles.hiddenFile} type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} disabled={busy} tabIndex={-1} /><button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>Выбрать файл</button><small>{photo ? photo.name : 'JPEG, PNG или WebP до 5 МБ'}</small>{(photoPreview || personDraft.photoUrl) && <button className={styles.linkButton} type="button" onClick={clearPhoto} disabled={busy}>Убрать фото</button>}</div></div><label><span>Имя</span><input ref={firstFieldRef} value={personDraft.name} onChange={(event) => setPersonDraft((current) => ({ ...current, name: event.target.value }))} minLength={2} maxLength={120} required disabled={busy} /></label><label><span>Описание <small>необязательно</small></span><textarea value={personDraft.description} onChange={(event) => setPersonDraft((current) => ({ ...current, description: event.target.value }))} maxLength={600} rows={5} disabled={busy} /></label>{(photoPreview || personDraft.photoUrl) && <LeadershipPhotoEditor key={photoPreview || personDraft.photoUrl} src={photoPreview || personDraft.photoUrl} name={personDraft.name} description={personDraft.description} roles={editingPerson ? rolesFor(editingPerson.id) : []} roleIndices={editingPerson ? positions.flatMap((position, index) => position.personId === editingPerson.id ? [index] : []) : []} photoPosition={personDraft.photoPosition} photoScale={personDraft.photoScale} disabled={busy} onChange={(placement) => setPersonDraft((current) => ({ ...current, ...placement }))} />}</main><footer>{confirmDelete ? <><p className={styles.confirmText}>Удалить этого человека? Связанные должности станут незаполненными.</p><span className={styles.confirmActions}><button type="button" onClick={() => void removePerson()} className={styles.destructive} disabled={busy}>Да, удалить</button><button type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>Отмена</button></span></> : <><button className={styles.primary} type="submit" disabled={busy || !personDraft.name.trim()}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>{editingPerson && <button className={styles.destructive} type="button" onClick={() => setConfirmDelete(true)} disabled={busy}>Удалить человека</button>}</>}</footer></form>}</aside></div>}
  </section>;
}
