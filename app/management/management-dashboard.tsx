'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AccessManager from './access-manager';
import type { Privilege } from '@/app/access-types';
import { filmingDateBounds } from '@/app/filming-validation';
import { requestKinds, readFilmingSlots, type FilmingBrief } from '@/app/filming-brief';
import RequestRuleNotice from './request-rule-notice';
import ParticipantsField from '../participants-field';
import { participantsError } from '../participants-validation';
import FilmingSlotsFields from '@/app/filming-slots-fields';
import ProjectsManager from './projects-manager';
import LeadershipManager from './leadership-manager';
import { ThemeSwitcher } from '../theme-switcher';
import ManagementIcon from './management-icons';
import CabinetIcon from '../cabinet/cabinet-icon';
import { useDialogFocus } from '../use-dialog-focus';
import './management-ui.css';

type Status = 'review' | 'clarification' | 'approved' | 'in_progress' | 'completed' | 'rejected' | 'cancelled';
type View = 'access' | 'overview' | 'applications' | 'organizations' | 'specialties' | 'leadership' | 'projects';
type Application = {
  brief: FilmingBrief | null;
  id: number; revision: number; number: string; organizationName: string; eventTitle: string; eventDate: string; startTime: string; endTime: string; location: string;
  eventDescription: string; requestedEquipment: string; assignedEquipment: string; contactName: string; contactChannel: string; customerComment: string;
  internalComment: string; status: Status; closingReason: string; createdAt: string; updatedAt: string; hiddenAt: string | null;
  specialists: Array<{ id: number; name: string; requestedCount: number; assignedCount: number; assignedNames: string }>;
  attachments: Array<{ id: number; name: string; mimeType: string; size: number }>;
  review: { rating: number; comment: string; createdAt: string; updatedAt: string } | null;
  history: Array<{ fromStatus: Status | null; toStatus: Status; note: string; createdAt: string }>;
};
type Organization = { id: number; account_id: number; type: 'faculty' | 'organization'; name: string; representative_name: string; contact: string; telegram_chat_id: string | null; status: 'pending' | 'active' | 'rejected' | 'blocked'; decision_note: string; created_at: string; username: string; last_login_at: string | null };
type Specialty = { id: number; name: string; active: number; sort_order: number };
type Stats = { reviewApplications: number; pendingOrganizations: number; openApplications: number; upcomingApplications: number; completedApplications: number; averageRating: number | null };

const statusLabels: Record<Status, string> = { review: 'На рассмотрении', clarification: 'Требует уточнения', approved: 'Согласована', in_progress: 'В работе', completed: 'Выполнена', rejected: 'Отклонена', cancelled: 'Отменена' };
const organizationStatusLabels: Record<Organization['status'], string> = { pending: 'Ожидает решения', active: 'Активен', rejected: 'Отклонён', blocked: 'Заблокирован' };
const viewTitles: Record<View, { eyebrow: string; title: string }> = { access: { eyebrow: 'Пользователи и привилегии', title: 'Роли и доступ' }, projects: { eyebrow: 'Публичные карточки', title: 'Наши проекты' }, overview: { eyebrow: 'Центр управления', title: 'Обзор' }, applications: { eyebrow: 'Все подразделения', title: 'Заявки' }, organizations: { eyebrow: 'Доступ к порталу', title: 'Организации' }, specialties: { eyebrow: 'Состав съёмочной группы', title: 'Специалисты' }, leadership: { eyebrow: 'Публичный состав', title: 'Руководящий состав' } };
const transitions: Record<Status, Status[]> = { review: ['review', 'clarification', 'approved', 'rejected', 'cancelled'], clarification: ['clarification', 'review', 'approved', 'rejected', 'cancelled'], approved: ['approved', 'in_progress', 'clarification', 'rejected', 'cancelled'], in_progress: ['in_progress', 'completed', 'clarification', 'cancelled'], completed: ['completed'], rejected: ['rejected', 'review'], cancelled: ['cancelled', 'review'] };

function operationError(error: unknown, fallback: string) {
  return error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError) ? error.message : `${fallback}. Проверьте соединение и повторите попытку.`;
}

function prettyDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }); }
function prettyMoment(value: string) { return new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z')).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }); }

export default function ManagementDashboard() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [requestedView, updateView] = useState<View>('overview');
  const [privileges, setPrivileges] = useState<Privilege[]>([]);
  const [displayName, setDisplayName] = useState('Руководство ГУТВ');
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const can = (permission: Privilege) => privileges.includes('panel.access') && privileges.includes(permission);
  const viewPermissions: Partial<Record<View, Privilege>> = { applications: 'applications.manage', organizations: 'organizations.manage', specialties: 'specialties.manage', leadership: 'leadership.manage', projects: 'projects.manage', access: 'access.manage' };
  const view = !viewPermissions[requestedView] || can(viewPermissions[requestedView]!) ? requestedView : 'overview';
  const drawerRef = useRef<HTMLElement>(null);
  function setView(next: View) { setMenuOpen(false); updateView(next); window.history.replaceState(null, '', `#${next}`); }
  useEffect(() => {
    const sync = () => {
      const current = window.location.hash.slice(1);
      if (Object.prototype.hasOwnProperty.call(viewTitles, current)) updateView(current as View);
    };
    const timer = window.setTimeout(sync, 0);
    window.addEventListener('hashchange', sync);
    return () => { window.clearTimeout(timer); window.removeEventListener('hashchange', sync); };
  }, []);
  const [applications, setApplications] = useState<Application[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [stats, setStats] = useState<Stats>({ reviewApplications: 0, pendingOrganizations: 0, openApplications: 0, upcomingApplications: 0, completedApplications: 0, averageRating: null });
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [applicationDecision, setApplicationDecision] = useState<Status>('review');
  const [applicationTab, setApplicationTab] = useState<'active' | 'hidden'>('active');
  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);
  const [organizationDecision, setOrganizationDecision] = useState<Organization['status']>('pending');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [applicationConflict, setApplicationConflict] = useState(false);
  const draftForm = useRef<HTMLFormElement | null>(null);
  const initialDraft = useRef('');
  const draftValue = (form: HTMLFormElement) => JSON.stringify(Array.from(new FormData(form).entries()));
  const attachDraftForm = useCallback((form: HTMLFormElement | null) => {
    draftForm.current = form;
    initialDraft.current = form ? JSON.stringify(Array.from(new FormData(form).entries())) : '';
  }, []);
  function hasUnsavedChanges() {
    return Boolean(draftForm.current && draftValue(draftForm.current) !== initialDraft.current);
  }
  function closeDrawer() {
    if (saving || (hasUnsavedChanges() && !window.confirm('Закрыть форму без сохранения изменений?'))) return;
    setSelectedApplication(null); setSelectedOrganization(null); setApplicationConflict(false); setError('');
  }
  useDialogFocus({ open: Boolean(selectedApplication || selectedOrganization), dialogRef: drawerRef, onClose: closeDrawer });
  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (saving || (draftForm.current && JSON.stringify(Array.from(new FormData(draftForm.current).entries())) !== initialDraft.current)) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [saving]);

  async function loadData(quiet = false) {
    if (!quiet) setError('');
    try {
      const response = await fetch('/api/admin/dashboard', { cache: 'no-store' });
      const data = await response.json() as { error?: string; applications: Application[]; organizations: Organization[]; specialties: Specialty[]; stats: Stats; privileges: Privilege[]; displayName: string; organizationId: number | null };
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setPrivileges([]); setApplications([]); setOrganizations([]); setSpecialties([]); setSelectedApplication(null); setSelectedOrganization(null); window.location.replace('/'); }
        throw new Error(data.error || 'Не удалось загрузить данные');
      }
      setPrivileges(data.privileges); setDisplayName(data.displayName); setOrganizationId(data.organizationId);
      if (!data.privileges.includes('applications.manage')) setSelectedApplication(null);
      if (!data.privileges.includes('organizations.manage')) setSelectedOrganization(null);
      setApplications(data.applications); setOrganizations(data.organizations); setSpecialties(data.specialties); setStats(data.stats);
    } catch (loadError) { if (!quiet) setError(operationError(loadError, 'Не удалось загрузить данные')); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    const refresh = () => { if (document.visibilityState === 'visible') void loadData(true); };
    const refreshTimer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearTimeout(timer); window.clearInterval(refreshTimer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  const filteredApplications = useMemo(() => applications.filter((item) => (applicationTab === 'hidden' ? item.hiddenAt : !item.hiddenAt) && (statusFilter === 'all' || item.status === statusFilter) && (!query.trim() || `${item.number} ${item.eventTitle} ${item.organizationName} ${item.location}`.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU')))), [applications, applicationTab, statusFilter, query]);
  const filmingBounds = filmingDateBounds();
  const pendingOrganizations = organizations.filter((item) => item.status === 'pending');
  const activeQueue = applications.filter((item) => !item.hiddenAt && item.eventDate >= filmingBounds.min && ['approved', 'in_progress'].includes(item.status)).sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  async function logout() {
    if (saving || (hasUnsavedChanges() && !window.confirm('Выйти без сохранения изменений?'))) return;
    setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Не удалось выйти. Повторите попытку.');
      initialDraft.current = draftForm.current ? draftValue(draftForm.current) : '';
      window.location.replace('/');
    } catch { setError('Не удалось выйти. Проверьте соединение и повторите попытку.'); }
  }

  async function reloadApplication() {
    if (!selectedApplication || saving) return;
    if (hasUnsavedChanges() && !window.confirm('Загрузить актуальную версию заявки? Несохранённые правки в этой форме будут заменены.')) return;
    setSaving(true);
    try {
      const response = await fetch('/api/admin/dashboard', { cache: 'no-store' });
      const data = await response.json() as { error?: string; applications: Application[] };
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить актуальную версию');
      const latest = data.applications.find(item => item.id === selectedApplication.id);
      if (!latest) throw new Error('Заявка недоступна. Обновите список заявок.');
      setApplications(data.applications); setApplicationDecision(latest.status); setSelectedApplication(latest); setApplicationConflict(false); setError('');
    } catch (loadError) { setError(operationError(loadError, 'Не удалось загрузить актуальную версию')); }
    finally { setSaving(false); }
  }

  async function saveApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedApplication || saving) return;
    const form = new FormData(event.currentTarget);
    if (selectedApplication.brief) {
      const participantError = participantsError(form.get('participants'));
      if (participantError) { setError(participantError); return; }
    }
    const specialists = selectedApplication.specialists.map((item) => ({ id: item.id, requestedCount: Number(form.get(`requested-${item.id}`)), assignedCount: Number(form.get(`assigned-${item.id}`)), assignedNames: String(form.get(`names-${item.id}`) || '') }));
    const body: Record<string, unknown> = Object.fromEntries(form.entries());
    body.acceptRuleException = form.get('acceptRuleException') === 'true';
    if (selectedApplication.brief) {
      body.slots = readFilmingSlots(form);
      delete body.slotStart; delete body.slotEnd; delete body.slotLocation;
    }
    delete body.specialistFields;
    Object.keys(body).filter((key) => key.startsWith('requested-') || key.startsWith('assigned-') || key.startsWith('names-')).forEach((key) => delete body[key]);
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/admin/applications/${selectedApplication.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, specialists, revision: selectedApplication.revision }) });
      const result = await response.json() as { error?: string; code?: string; application?: Application };
      if (response.status === 409 && result.code === 'revision_conflict') setApplicationConflict(true);
      if (!response.ok || !result.application) throw new Error(result.error || 'Не удалось сохранить заявку');
      setApplications((items) => items.map((item) => item.id === result.application!.id ? result.application! : item));
      setSelectedApplication(null); setApplicationConflict(false); setView('applications');
      setSuccess(`Заявка ${result.application.number} обновлена`); await loadData();
    } catch (saveError) { setError(operationError(saveError, 'Не удалось сохранить заявку')); }
    finally { setSaving(false); }
  }

  function openApplication(application: Application) {
    setError(''); setSuccess(''); setApplicationConflict(false);
    setApplicationDecision(application.status); setSelectedApplication(application);
  }

  async function toggleApplicationHidden(application: Application) {
    if (saving) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const action = application.hiddenAt ? 'restore' : 'hide';
      const response = await fetch(`/api/admin/applications/${application.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, revision: application.revision }) });
      const result = await response.json() as { error?: string; application?: Application };
      if (!response.ok || !result.application) throw new Error(result.error || 'Не удалось изменить видимость заявки');
      setSelectedApplication(null);
      setSuccess(action === 'hide' ? `Заявка ${application.number} скрыта` : `Заявка ${application.number} возвращена`);
      await loadData();
    } catch (saveError) { setError(operationError(saveError, 'Не удалось изменить видимость заявки')); }
    finally { setSaving(false); }
  }

  function openOrganization(organization: Organization, decision = organization.status) {
    setError(''); setSuccess('');
    setOrganizationDecision(decision); setSelectedOrganization(organization);
  }

  async function saveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedOrganization || saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/admin/organizations/${selectedOrganization.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: form.get('status'), decisionNote: form.get('decisionNote'), telegramChatId: form.get('telegramChatId') }) });
      const result = await response.json() as { error?: string; organization?: Organization };
      if (!response.ok || !result.organization) throw new Error(result.error || 'Не удалось сохранить аккаунт');
      initialDraft.current = draftForm.current ? draftValue(draftForm.current) : '';
      setOrganizationDecision(result.organization.status); setSelectedOrganization(result.organization); setSuccess(`Аккаунт «${result.organization.name}» обновлён`); await loadData();
    } catch (saveError) { setError(operationError(saveError, 'Не удалось сохранить аккаунт')); }
    finally { setSaving(false); }
  }

  async function quickApprove(organization: Organization) {
    if (saving) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const response = await fetch(`/api/admin/organizations/${organization.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Не удалось подтвердить аккаунт');
      setSuccess(`Аккаунт «${organization.name}» подтверждён`); await loadData();
    } catch (saveError) { setError(operationError(saveError, 'Не удалось подтвердить аккаунт')); }
    finally { setSaving(false); }
  }

  async function hideOrganization(organization: Organization) {
    if (saving || !window.confirm(`Скрыть заблокированный аккаунт «${organization.name}»?`)) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const response = await fetch(`/api/admin/access/users/${organization.account_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'hide' }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Не удалось скрыть аккаунт');
      setSelectedOrganization(null); setSuccess(`Аккаунт «${organization.name}» скрыт`); await loadData();
    } catch (saveError) { setError(operationError(saveError, 'Не удалось скрыть аккаунт')); }
    finally { setSaving(false); }
  }

  async function addSpecialty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') || '');
    setSaving(true); setError(''); setSuccess('');
    try {
      const response = await fetch('/api/admin/specialties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Не удалось добавить специальность');
      form.reset(); setSuccess('Специальность добавлена'); await loadData();
    } catch (saveError) { setError(operationError(saveError, 'Не удалось добавить специальность')); }
    finally { setSaving(false); }
  }

  async function toggleSpecialty(item: Specialty) {
    if (saving) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const response = await fetch(`/api/admin/specialties/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !item.active }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Не удалось изменить специальность');
      setSuccess(item.active ? 'Специальность перенесена в архив' : 'Специальность возвращена');
      await loadData();
    } catch (saveError) { setError(operationError(saveError, 'Не удалось изменить специальность')); }
    finally { setSaving(false); }
  }

  const nav: Array<[View, string, string]> = [['overview', 'ОВ', 'Обзор'], ['applications', 'ЗЯ', 'Заявки'], ['organizations', 'ОР', 'Организации'], ['specialties', 'СП', 'Специалисты'], ['leadership', 'РС', 'Руководящий состав'], ['projects', 'ПР', 'Наши проекты'], ['access', 'ПР', 'Роли и доступ']];
  return <div className="portal-app management-app">
    <aside className={`portal-sidebar${menuOpen ? ' menu-open' : ''}`}>
      <Link className="portal-brand" href="/" aria-label="ГУТВ — на сайт"><span><Image src="/design/gutv-mark.svg" width={40} height={40} alt="" priority /></span><p><b>ГУТВ</b><small>Управление студией</small></p></Link>
      <button className="cabinet-menu-toggle" type="button" aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menuOpen} aria-controls="management-mobile-menu" onClick={() => setMenuOpen(open => !open)}><CabinetIcon name="menu" /><span>Меню</span></button>
      <div className="management-nav-caption">Рабочее пространство</div>
      <div className="portal-mobile-menu" id="management-mobile-menu"><nav aria-label="Разделы управления">{nav.filter(([key]) => !viewPermissions[key] || can(viewPermissions[key]!)).map(([key, , label]) => <button type="button" className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined} aria-label={label} key={key} onClick={() => setView(key)}><span className="management-nav-icon"><ManagementIcon name={key} /></span><b data-short-label={key === 'access' ? 'Доступ' : key === 'projects' ? 'Проекты' : key === 'leadership' ? 'Состав' : key === 'specialties' ? 'Команда' : label}>{label}</b>{key === 'applications' && stats.reviewApplications > 0 && <i aria-label={`На рассмотрении: ${stats.reviewApplications}`}>{stats.reviewApplications}</i>}{key === 'organizations' && stats.pendingOrganizations > 0 && <i aria-label={`Ожидают подтверждения: ${stats.pendingOrganizations}`}>{stats.pendingOrganizations}</i>}</button>)}</nav><div className="portal-mobile-account"><span>Тема интерфейса</span><ThemeSwitcher /><button className="portal-logout" type="button" onClick={() => void logout()}>Выйти</button>{organizationId && <Link href="/cabinet">Мои заявки</Link>}<Link href="/studio">На сайт</Link></div></div>
      <div className="portal-sidebar-meta"><span className="management-account-avatar">ГУ</span><div><b>{displayName}</b><small>Управление и доступ</small></div></div>
    </aside>
    <div className="portal-workspace"><header className="portal-topbar"><div className="portal-page-title"><span>{viewTitles[view].eyebrow}</span><h1>{viewTitles[view].title}</h1></div><div className="portal-top-actions"><ThemeSwitcher /><>{organizationId && <Link className="management-site-link management-cabinet-link" href="/cabinet">Мои заявки</Link>}</><Link className="management-site-link" href="/studio">На сайт<ManagementIcon name="external" /></Link><button className="portal-logout" type="button" aria-label="Выйти" title="Выйти" onClick={() => void logout()}><ManagementIcon name="logout" /></button></div></header>
      <main className="portal-main">{error && !selectedApplication && !selectedOrganization && <div className="portal-alert error" role="alert"><b>ERR</b><span>{error}</span><button onClick={() => setError('')}>×</button></div>}{success && <div className="portal-alert success" role="status"><b>OK</b><span>{success}</span><button onClick={() => setSuccess('')}>×</button></div>}{loading ? <div className="portal-loading"><span><i /><i /><i /><i /></span><b>Синхронизация…</b></div> : <div className="portal-view" key={view}>
        {view === 'overview' && <>{!can('applications.manage') && !can('organizations.manage') && <section className="portal-panel"><div className="portal-panel-head"><div><span>Ваше рабочее пространство</span><h2>Добро пожаловать, {displayName}</h2></div></div><p>Открывайте доступные разделы в меню. Набор возможностей определяется назначенными вам ролями.</p></section>}<section className="portal-kpis management-kpis">{can('applications.manage') && <article className="primary"><span>Заявки в работе</span><strong>{stats.openApplications}</strong><p>Требуют внимания команды</p><button onClick={() => setView('applications')}>Открыть очередь →</button></article>}{can('applications.manage') && <article><span>Ближайшие события</span><strong>{stats.upcomingApplications}</strong><small>Согласованные и активные</small></article>}{can('organizations.manage') && <article><span>Новые аккаунты</span><strong>{stats.pendingOrganizations}</strong><button onClick={() => setView('organizations')}>Проверить →</button></article>}{can('applications.manage') && <article><span>Оценка работы</span><strong>{stats.averageRating ? `${stats.averageRating}` : '—'}</strong><small>{stats.averageRating ? 'из 5 по отзывам' : 'Отзывов пока нет'}</small></article>}</section><section className="portal-dashboard-grid">{can('applications.manage') && <article className="portal-panel portal-next"><div className="portal-panel-head"><div><span>Съёмки и события</span><h2>Ближайшие заявки</h2></div><button onClick={() => setView('applications')}>Все →</button></div>{activeQueue.length ? <div className="portal-event-list">{activeQueue.slice(0, 6).map((item) => <button type="button" key={item.id} onClick={() => openApplication(item)}><time><b>{item.eventDate.slice(8, 10)}</b><span>{new Date(`${item.eventDate}T12:00:00`).toLocaleDateString('ru-RU', { month: 'short' })}</span></time><p><strong>{item.eventTitle}</strong><small>{item.organizationName} · {item.startTime}</small></p><em className={`status-${item.status}`}>{statusLabels[item.status]}</em></button>)}</div> : <div className="portal-empty"><span><ManagementIcon name="check" /></span><h3>Съёмок пока нет</h3><p>Здесь появятся ближайшие согласованные заявки.</p></div>}</article>}{can('organizations.manage') && <article className="portal-panel portal-process"><div className="portal-panel-head"><div><span>Доступ к студии</span><h2>Новые аккаунты</h2></div></div>{pendingOrganizations.length ? <div className="management-registration-list">{pendingOrganizations.slice(0, 5).map((item) => <div key={item.id}><span><b>{item.name}</b><small>{item.representative_name} · {item.contact}</small></span><button disabled={saving} onClick={() => void quickApprove(item)}>Подтвердить</button><button className="management-reject" onClick={() => openOrganization(item, 'rejected')}>Отклонить</button><button onClick={() => openOrganization(item)}>Открыть</button></div>)}</div> : <div className="portal-empty compact"><span><ManagementIcon name="check" /></span><h3>Все проверено</h3><p>Новых регистраций нет.</p></div>}</article>}</section></>}
        {view === 'applications' && <section className="portal-panel portal-history"><div className="management-list-tabs" role="group" aria-label="Видимость заявок"><button type="button" aria-pressed={applicationTab === 'active'} onClick={() => setApplicationTab('active')}>Активные <small>{applications.filter(item => !item.hiddenAt).length}</small></button><button type="button" aria-pressed={applicationTab === 'hidden'} onClick={() => setApplicationTab('hidden')}>Скрытые <small>{applications.filter(item => item.hiddenAt).length}</small></button></div><div className="portal-history-tools"><div className="portal-search"><span><ManagementIcon name="search" /></span><input maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Поиск заявок" placeholder="Номер, событие или организация" /></div><select aria-label="Фильтр по статусу" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Все статусы</option>{Object.entries(statusLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div><div className="portal-table-wrap"><table><thead><tr><th>Номер</th><th>Заказчик / мероприятие</th><th>Дата и место</th><th>Статус</th><th /></tr></thead><tbody>{filteredApplications.length ? filteredApplications.map((item) => <tr key={item.id} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') openApplication(item); }} onClick={() => openApplication(item)}><td><code>{item.number}</code></td><td><b>{item.eventTitle}</b><small>{item.organizationName}</small></td><td><b>{prettyDate(item.eventDate)}</b><small>{item.startTime}–{item.endTime} · {item.location}</small></td><td><span className={`portal-status status-${item.status}`}>{statusLabels[item.status]}</span></td><td><button type="button" aria-label={`Открыть заявку ${item.number}`} onClick={(event) => { event.stopPropagation(); openApplication(item); }}><ManagementIcon name="arrow" /></button></td></tr>) : <tr><td colSpan={5} className="portal-empty-cell">Заявки не найдены</td></tr>}</tbody></table></div></section>}
        {view === 'organizations' && <section className="portal-panel management-organizations"><div className="portal-panel-head"><div><span>Заказчики</span><h2>Факультеты и организации</h2></div><small>{organizations.length} аккаунтов</small></div><div className="management-org-list">{!organizations.length && <div className="portal-empty compact"><span><ManagementIcon name="organizations" /></span><h3>Организаций пока нет</h3><p>Здесь появятся факультеты и команды, которые зарегистрируются на сайте.</p></div>}{organizations.map((item) => <article key={item.id}><div><span>{item.type === 'faculty' ? 'ФАКУЛЬТЕТ' : 'ОРГАНИЗАЦИЯ'}</span><h3>{item.name}</h3><p>{item.representative_name} · {item.contact}</p></div><div><em className={`org-${item.status}`}>{organizationStatusLabels[item.status]}</em><small>Логин: {item.username}</small></div><div className="management-org-actions">{item.status === 'pending' && <><button className="management-approve" disabled={saving} onClick={() => void quickApprove(item)}>Подтвердить</button><button className="management-reject" onClick={() => openOrganization(item, 'rejected')}>Отклонить</button></>}{item.status === 'blocked' && <button className="management-reject" disabled={saving} onClick={() => void hideOrganization(item)}>Скрыть</button>}<button className="management-open" onClick={() => openOrganization(item)}>Настроить →</button></div></article>)}</div></section>}
        {view === 'specialties' && <section className="portal-panel management-specialties"><div className="portal-panel-head"><div><span>Команда на съёмке</span><h2>Специалисты</h2></div></div><form className="management-add-specialty" onSubmit={addSpecialty}><label><span>Новая специальность</span><input name="name" maxLength={80} placeholder="Например, ассистент оператора" required /></label><button type="submit" disabled={saving}>Добавить</button></form><div className="management-specialty-list">{specialties.map((item, index) => <div className={!item.active ? 'archived' : ''} key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><b>{item.name}</b><small>{item.active ? 'Доступен в форме заявки' : 'Архив'}</small><button type="button" disabled={saving} onClick={() => void toggleSpecialty(item)}>{item.active ? 'В архив' : 'Вернуть'}</button></div>)}</div></section>}
        {view === 'leadership' && <LeadershipManager />}
        {view === 'projects' && <ProjectsManager />}
        {view === 'access' && <AccessManager onChange={loadData} />}
      </div>}</main>
    </div>

    {selectedApplication && <div className="portal-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}><section ref={drawerRef} tabIndex={-1} className="portal-drawer management-drawer" role="dialog" aria-modal="true" aria-busy={saving} aria-labelledby="management-application-title"><button className="portal-drawer-close" aria-label="Закрыть заявку" disabled={saving} onClick={closeDrawer}><ManagementIcon name="close" /></button><div className="portal-detail-head"><div><span>{selectedApplication.number} · {selectedApplication.organizationName}</span><h2 id="management-application-title">{selectedApplication.eventTitle}</h2></div><em className={`portal-status status-${selectedApplication.status}`}>{statusLabels[selectedApplication.status]}</em></div>{error && <div className="portal-alert error" role="alert">{error}{applicationConflict && <div className="management-conflict-actions"><p>Ваши правки остаются в форме. Загрузка актуальной версии заменит их после подтверждения.</p><button type="button" disabled={saving} onClick={() => void reloadApplication()}>Загрузить актуальную версию</button></div>}</div>}<form ref={attachDraftForm} className="management-request-form" key={`${selectedApplication.id}-${selectedApplication.revision}`} onSubmit={saveApplication}><fieldset className="management-decision"><legend>Решение по заявке</legend><RequestRuleNotice brief={selectedApplication.brief} submittedAt={selectedApplication.createdAt} initialStatus={selectedApplication.status} /><div className="portal-form-grid"><label><span>Статус</span><select name="status" value={applicationDecision} onChange={(event) => setApplicationDecision(event.target.value as Status)}>{transitions[selectedApplication.status].map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}</select></label><label><span>{applicationDecision === 'clarification' ? 'Что нужно уточнить *' : ['rejected', 'cancelled'].includes(applicationDecision) ? 'Причина отмены / отклонения *' : 'Комментарий для заказчика'}</span><input name="closingReason" maxLength={500} required={applicationDecision === 'clarification' || (['rejected', 'cancelled'].includes(applicationDecision) && applicationDecision !== selectedApplication.status)} defaultValue={selectedApplication.closingReason} placeholder={applicationDecision === 'clarification' ? 'Какие сведения нужно дополнить?' : 'Комментарий к решению'} /></label>{!selectedApplication.brief && <label className="wide"><span>Комментарий заказчика</span><textarea name="customerComment" maxLength={2000} rows={2} defaultValue={selectedApplication.customerComment} /></label>}<label className="wide"><span>Служебный комментарий</span><textarea name="internalComment" maxLength={3000} rows={2} defaultValue={selectedApplication.internalComment} placeholder="Виден только руководству ГУТВ" /></label></div></fieldset><fieldset><legend>Событие и контакт</legend><div className="portal-form-grid"><label className="wide"><span>Название</span><input name="eventTitle" maxLength={160} defaultValue={selectedApplication.eventTitle} required /></label>{!selectedApplication.brief && <><label><span>Дата</span><input name="eventDate" type="date" min={selectedApplication.eventDate < filmingBounds.min ? selectedApplication.eventDate : filmingBounds.min} max={selectedApplication.eventDate > filmingBounds.max ? selectedApplication.eventDate : filmingBounds.max} defaultValue={selectedApplication.eventDate} required /><small>Новая дата — в ближайшие 6 месяцев, по Москве.</small></label><label><span>Место</span><input name="location" maxLength={240} defaultValue={selectedApplication.location} required /></label><label><span>Начало</span><input name="startTime" type="time" defaultValue={selectedApplication.startTime} required /></label><label><span>Окончание</span><input name="endTime" type="time" defaultValue={selectedApplication.endTime} required /></label></>}<label className="wide"><span>Суть мероприятия</span><textarea name="eventDescription" maxLength={4000} rows={4} defaultValue={selectedApplication.eventDescription} required /></label><label><span>Контактное лицо</span><input name="contactName" maxLength={120} defaultValue={selectedApplication.contactName} required /></label><label><span>Телефон или Telegram</span><input name="contactChannel" maxLength={120} defaultValue={selectedApplication.contactChannel} required /></label></div></fieldset>{selectedApplication.brief && <><fieldset><legend>Тип заявки</legend><label className="portal-stack-label"><span>Что нужно подготовить?</span><select name="requestKind" defaultValue={selectedApplication.brief.requestKind}>{Object.entries(requestKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></fieldset><fieldset><legend>Даты и места съёмки</legend><FilmingSlotsFields initialSlots={selectedApplication.brief.slots} allowHistorical /></fieldset><fieldset><legend>План и материалы</legend><div className="portal-form-grid"><label className="wide"><span>План мероприятия или сценарий</span><textarea name="scenario" minLength={10} maxLength={4000} rows={6} defaultValue={selectedApplication.brief.scenario} required /></label><ParticipantsField defaultValue={selectedApplication.brief.participants} /></div><p className="portal-field-help">Правила подтверждены: {prettyMoment(selectedApplication.brief.rulesAcceptedAt)}</p></fieldset></>}{(!selectedApplication.brief || selectedApplication.specialists.length > 0) && <fieldset><legend>{selectedApplication.brief ? 'Специалисты для выездной учёбы' : 'Команда и техника'}</legend><div className="management-assignment-list">{selectedApplication.specialists.map((item) => <div key={item.id}><b>{item.name}</b><label><span>Запрошено</span><input name={`requested-${item.id}`} type="number" min="1" max="99" defaultValue={item.requestedCount} /></label><label><span>Назначено</span><input name={`assigned-${item.id}`} type="number" min="0" max="99" defaultValue={item.assignedCount} /></label><label className="names"><span>Кто назначен</span><input name={`names-${item.id}`} maxLength={500} defaultValue={item.assignedNames} placeholder="Имена через запятую" /></label></div>)}</div>{!selectedApplication.brief && <><label className="portal-stack-label"><span>Запрошенное оборудование</span><textarea name="requestedEquipment" maxLength={2000} rows={3} defaultValue={selectedApplication.requestedEquipment} required /></label><label className="portal-stack-label"><span>Согласованное оборудование</span><textarea name="assignedEquipment" maxLength={2000} rows={3} defaultValue={selectedApplication.assignedEquipment} /></label></>}</fieldset>}{selectedApplication.attachments.length > 0 && <div className="portal-files management-files">{selectedApplication.attachments.map((file) => <a href={`/api/attachments/${file.id}`} key={file.id}>{file.name}<small>Скачать</small></a>)}</div>}{selectedApplication.review && <div className="management-review"><span>ОТЗЫВ · {selectedApplication.review.rating}/5</span><p>{selectedApplication.review.comment || 'Без комментария'}</p></div>}<div className="management-drawer-actions"><button className="management-drawer-cancel" type="button" disabled={saving} onClick={closeDrawer}>Закрыть</button><button className="management-drawer-cancel" type="button" disabled={saving} onClick={() => void toggleApplicationHidden(selectedApplication)}>{selectedApplication.hiddenAt ? 'Вернуть из скрытых' : 'Скрыть заявку'}</button><button className="portal-submit" type="submit" disabled={saving || applicationConflict}>{saving ? 'Сохраняем…' : 'Сохранить изменения'}<ManagementIcon name="arrow" /></button></div></form></section></div>}

    {selectedOrganization && <div className="portal-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}><section ref={drawerRef} tabIndex={-1} className="portal-drawer organization-drawer" role="dialog" aria-modal="true" aria-busy={saving} aria-labelledby="management-organization-title"><button className="portal-drawer-close" aria-label="Закрыть организацию" disabled={saving} onClick={closeDrawer}><ManagementIcon name="close" /></button><div className="portal-detail-head"><div><span>{selectedOrganization.type === 'faculty' ? 'ФАКУЛЬТЕТ' : 'ОРГАНИЗАЦИЯ'} · ID {selectedOrganization.id}</span><h2 id="management-organization-title">{selectedOrganization.name}</h2></div><em className={`org-${selectedOrganization.status}`}>{organizationStatusLabels[selectedOrganization.status]}</em></div><div className="organization-info"><span><small>Представитель</small><b>{selectedOrganization.representative_name}</b></span><span><small>Контакт</small><b>{selectedOrganization.contact}</b></span><span><small>Логин</small><b>{selectedOrganization.username}</b></span><span><small>Последний вход</small><b>{selectedOrganization.last_login_at ? prettyMoment(selectedOrganization.last_login_at) : 'Ещё не входили'}</b></span></div>{error && <div className="portal-alert error" role="alert">{error}</div>}<form ref={attachDraftForm} className="organization-form" key={`${selectedOrganization.id}-${selectedOrganization.status}`} onSubmit={saveOrganization}><label><span>Статус аккаунта</span><select name="status" value={organizationDecision} onChange={(event) => setOrganizationDecision(event.target.value as Organization['status'])}>{Object.entries(organizationStatusLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label><span>Telegram chat ID <small>необязательно</small></span><input name="telegramChatId" maxLength={80} defaultValue={selectedOrganization.telegram_chat_id || ''} placeholder="Например, -100…" /></label><label><span>{organizationDecision === 'rejected' ? 'Причина отклонения регистрации' : organizationDecision === 'blocked' ? 'Причина блокировки' : 'Комментарий к решению'}{['rejected', 'blocked'].includes(organizationDecision) && ' *'}</span><textarea name="decisionNote" maxLength={500} rows={4} required={['rejected', 'blocked'].includes(organizationDecision)} placeholder="Комментарий получит представитель организации" defaultValue={selectedOrganization.decision_note} /><small>До 500 символов. Для отклонения или блокировки причина обязательна.</small></label><div className="management-drawer-actions"><button className="management-drawer-cancel" type="button" disabled={saving} onClick={closeDrawer}>Закрыть</button>{selectedOrganization.status === 'blocked' && <button className="management-drawer-cancel" type="button" disabled={saving} onClick={() => void hideOrganization(selectedOrganization)}>Скрыть аккаунт</button>}<button className="portal-submit" type="submit" disabled={saving}>{saving ? 'Сохраняем…' : organizationDecision === 'rejected' && selectedOrganization.status === 'pending' ? 'Отклонить регистрацию' : 'Сохранить аккаунт'}<ManagementIcon name="arrow" /></button></div></form></section></div>}
  </div>;
}
