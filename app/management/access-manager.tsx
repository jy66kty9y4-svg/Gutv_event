'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { privileges, type AccessRole, type AccessSnapshot, type AccessUser, type Privilege } from '@/app/access-types';
import styles from './access-manager.module.css';

const statusLabels: Record<string, string> = { active: 'Активен', pending: 'Ожидает подтверждения', rejected: 'Регистрация отклонена', blocked: 'Заблокирован' };
type RoleDraft = { id?: number; name: string; description: string; administrator: boolean; privileges: Privilege[]; revision?: number; memberCount?: number };
const emptyRole: RoleDraft = { name: '', description: '', administrator: false, privileges: [] };

export default function AccessManager({ onChange }: { onChange: () => Promise<void> }) {
  const [data, setData] = useState<AccessSnapshot | null>(null);
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [user, setUser] = useState<AccessUser | null>(null);
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const response = await fetch('/api/admin/access', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось загрузить права');
    setData(result);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch(e => setError(e.message)); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function save(path: string, method: string, body: unknown, success: string) {
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/admin/access/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось сохранить');
      setDraft(null); setUser(null); setMessage(success);
      await onChange();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить'); }
    finally { setSaving(false); }
  }
  function editRole(role: AccessRole) { setDraft({ ...role, privileges: [...role.privileges] }); setError(''); setMessage(''); }
  function editUser(value: AccessUser) { setUser(value); setRoleIds([...value.roleIds]); setNewPassword(''); setError(''); setMessage(''); }
  function saveRole(event: FormEvent) {
    event.preventDefault();
    if (draft) void save(draft.id ? `roles/${draft.id}` : 'roles', draft.id ? 'PATCH' : 'POST', draft, 'Роль сохранена. Права пользователей обновлены.');
  }
  function togglePrivilege(id: Privilege) {
    if (!draft) return;
    setDraft({ ...draft, privileges: draft.privileges.includes(id) ? draft.privileges.filter(p => p !== id) : [...draft.privileges, id] });
  }
  function generatePassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    setNewPassword(Array.from(bytes, byte => alphabet[byte % alphabet.length]).join(''));
  }
  async function resetPassword() {
    if (!user || saving) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/admin/access/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'password', password: newPassword }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось сменить пароль');
      setMessage('Пароль изменён. Старые сессии закрыты.');
      await onChange();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сменить пароль'); }
    finally { setSaving(false); }
  }
  async function hideBlockedUser() {
    if (!user || saving || !window.confirm(`Скрыть заблокированный аккаунт «${user.displayName}»?`)) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/admin/access/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'hide' }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось скрыть аккаунт');
      setUser(null); setMessage('Аккаунт скрыт.');
      await onChange();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось скрыть аккаунт'); }
    finally { setSaving(false); }
  }
  const selectedRoles = data?.roles.filter(r => roleIds.includes(r.id)) || [];
  const effectivePrivileges = privileges.filter(p => selectedRoles.some(r => r.privileges.includes(p.id)));
  const panelEnabled = effectivePrivileges.some(p => p.id === 'panel.access');

  return <section className={`portal-panel ${styles.root}`} aria-label="Роли и доступ">
    <div className="portal-panel-head"><div><span>Настройки доступа</span><h2>Роли и пользователи</h2></div><button type="button" disabled={saving} onClick={() => { setDraft(null); setUser(null); setError(''); void load().catch(e => setError(e.message)); }}>Обновить</button></div>
    <p className={styles.intro}>Назначайте пользователям роли и выбирайте доступные действия. Права нескольких ролей суммируются. Изменения действуют сразу.</p>
    <div className={styles.tabs} role="group" aria-label="Настройки доступа"><button aria-pressed={tab === 'users'} onClick={() => setTab('users')}>Пользователи <small>{data?.users.length ?? '—'}</small></button><button aria-pressed={tab === 'roles'} onClick={() => setTab('roles')}>Роли <small>{data?.roles.length ?? '—'}</small></button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status">{message}</p>}
    {!data ? <p>Загрузка настроек…</p> : tab === 'roles' ? <div className={styles.layout}>
      <div className={styles.list}><button className={styles.primary} disabled={saving} onClick={() => { setDraft({ ...emptyRole, privileges: [] }); setError(''); setMessage(''); }}>+ Создать роль</button>{data.roles.map(role => <button className={styles.item} aria-pressed={draft?.id === role.id} key={role.id} disabled={saving} onClick={() => editRole(role)}><strong>{role.name}</strong><span>{role.administrator ? 'Максимальный доступ' : `${role.privileges.length} из ${privileges.length} привилегий`} · {role.memberCount} пользователей</span></button>)}</div>
      {draft ? <form className={styles.editor} onSubmit={saveRole}><h3>{draft.id ? 'Настройки роли' : 'Новая роль'}</h3><label>Название роли<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} minLength={2} maxLength={80} required disabled={saving} /></label><label>Описание<textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} maxLength={500} rows={2} disabled={saving} /></label>
        {draft.administrator && <p className={styles.notice}>Максимальная роль всегда включает все текущие и будущие привилегии. Название и описание можно изменить.</p>}
        <fieldset disabled={saving || draft.administrator}><legend>Доступные привилегии</legend>{privileges.map(p => <label className={styles.check} key={p.id}><input type="checkbox" checked={draft.privileges.includes(p.id)} onChange={() => togglePrivilege(p.id)} /><span><strong>{p.name}</strong><small>{p.description}</small></span></label>)}</fieldset>
        {!draft.privileges.includes('panel.access') && <p className={styles.notice}>Вход в панель выключен для этой роли. Выбранные действия доступны, только если другая роль разрешает вход.</p>}
        {draft.privileges.includes('access.manage') && !draft.administrator && <p className={styles.notice}>Управление правами позволяет назначать администраторов, в том числе самому себе. Выдавайте эту привилегию только доверенным пользователям.</p>}
        <div className={styles.actions}><button className={styles.primary} disabled={saving} type="submit">{saving ? 'Сохраняем…' : 'Сохранить роль'}</button><button type="button" disabled={saving} onClick={() => setDraft(null)}>Отмена</button>{draft.id && !draft.administrator && <button className={styles.danger} type="button" disabled={saving || Boolean(draft.memberCount)} title={draft.memberCount ? 'Сначала снимите роль со всех пользователей' : 'Удалить неиспользуемую роль'} onClick={() => void save(`roles/${draft.id}`, 'DELETE', { revision: draft.revision }, 'Роль удалена')}>Удалить роль</button>}</div>
        {Boolean(draft.memberCount) && !draft.administrator && <small>Удалить роль можно после снятия со всех пользователей.</small>}
      </form> : <div className={styles.placeholder}>Выберите роль, чтобы изменить название и привилегии.</div>}
    </div> : <div className={styles.layout}>
      <div className={styles.list}><label className={styles.search}>Поиск пользователя<input value={query} onChange={e => setQuery(e.target.value)} maxLength={200} placeholder="Имя, логин или организация" /></label>{data.users.filter(u => `${u.displayName} ${u.username} ${u.organizationName || ''}`.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU'))).map(value => <button className={styles.item} aria-pressed={user?.id === value.id} key={value.id} disabled={saving} onClick={() => editUser(value)}><strong>{value.displayName}</strong><span>{value.username} · {statusLabels[value.status]}</span><small>{data.roles.filter(r => value.roleIds.includes(r.id)).map(r => r.name).join(', ') || 'Роли не назначены'}</small></button>)}</div>
      {user ? <form className={styles.editor} onSubmit={event => { event.preventDefault(); void save(`users/${user.id}`, 'PATCH', { roleIds, revision: user.revision }, 'Роли пользователя сохранены'); }}><h3>{user.displayName}</h3><p>{user.username}{user.organizationName ? ` · ${user.organizationName}` : ''}</p>
        {user.protected ? <p className={styles.notice}>Основной администратор всегда имеет максимальную роль. Этот доступ нельзя снять.</p> : <p>Выберите одну или несколько ролей. Без ролей сохраняется обычный доступ к заявкам своей организации.</p>}
        <fieldset disabled={saving || user.protected}><legend>Назначенные роли</legend>{data.roles.map(role => <label className={styles.check} key={role.id}><input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => setRoleIds(roleIds.includes(role.id) ? roleIds.filter(id => id !== role.id) : [...roleIds, role.id])} /><span><strong>{role.name}</strong><small>{role.administrator ? 'Все привилегии, включая назначение администраторов' : role.description || 'Настраиваемая роль'}</small></span></label>)}</fieldset>
        {!user.protected && <div className={styles.passwordBox}><strong>Новый пароль</strong><div><input type="text" value={newPassword} minLength={8} maxLength={200} onChange={event => setNewPassword(event.target.value)} placeholder="Введите или сгенерируйте пароль" disabled={saving} /><button type="button" disabled={saving} onClick={generatePassword}>Сгенерировать</button><button type="button" disabled={saving || newPassword.length < 8} onClick={() => void resetPassword()}>Сменить пароль</button></div></div>}
        <div className={styles.effective}><strong>Итоговый доступ</strong><p>{panelEnabled ? 'Панель руководства доступна' : 'Панель руководства недоступна'}</p>{panelEnabled && <ul>{effectivePrivileges.filter(p => p.id !== 'panel.access').map(p => <li key={p.id}>{p.name}</li>)}</ul>}</div>
        {user.status !== 'active' && <p className={styles.notice}>Назначение ролей не меняет статус регистрации или блокировку аккаунта.</p>}
        {!user.protected && <div className={styles.actions}><button className={styles.primary} disabled={saving} type="submit">{saving ? 'Сохраняем…' : 'Сохранить роли пользователя'}</button>{user.status === 'blocked' && <button className={styles.danger} disabled={saving} type="button" onClick={() => void hideBlockedUser()}>Скрыть аккаунт</button>}<button disabled={saving} type="button" onClick={() => setUser(null)}>Отмена</button></div>}
      </form> : <div className={styles.placeholder}>Выберите пользователя, чтобы назначить роли. Новые пользователи появляются здесь после регистрации на сайте.</div>}
    </div>}
  </section>;
}
