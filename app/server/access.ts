import { database } from '@/db/server';
import { allPrivileges, type AccessRole, type AccessUser, type Privilege } from '@/app/access-types';

type RoleRow = { id: number; name: string; description: string; administrator: number; privileges_json: string; revision: number };
export function accountPrivileges(accountId: number): Privilege[] {
  if (accountId === 0) return [...allPrivileges];
  const rows = database().prepare('SELECT r.* FROM portal_roles r JOIN portal_user_roles u ON u.role_id = r.id WHERE u.account_id = ?').all(accountId) as RoleRow[];
  if (rows.some(r => r.administrator)) return [...allPrivileges];
  const selected = new Set(rows.flatMap(r => JSON.parse(r.privileges_json) as string[]));
  return allPrivileges.filter(p => selected.has(p));
}
export function hasPrivilege(session: { privileges: Privilege[] }, privilege: Privilege) {
  return session.privileges.includes('panel.access') && session.privileges.includes(privilege);
}
export function accessRoles(): AccessRole[] {
  return (database().prepare('SELECT * FROM portal_roles ORDER BY administrator DESC, id').all() as RoleRow[]).map(r => ({
    id: r.id, name: r.name, description: r.description, administrator: Boolean(r.administrator), revision: r.revision,
    privileges: r.administrator ? [...allPrivileges] : JSON.parse(r.privileges_json),
    memberCount: Number((database().prepare('SELECT COUNT(*) AS n FROM portal_user_roles WHERE role_id = ?').get(r.id) as { n: number }).n) + (r.administrator ? 1 : 0),
  }));
}
export function accessUsers(): AccessUser[] {
  const db = database();
  const administrator = accessRoles().find(r => r.administrator)!;
  const rows = db.prepare(`SELECT a.id,a.username,a.display_name,a.status,o.name AS organization_name,
      COALESCE(v.revision,1) AS revision FROM portal_accounts a LEFT JOIN portal_organizations o ON o.id = a.organization_id
      LEFT JOIN portal_user_role_versions v ON v.account_id = a.id WHERE a.hidden_at IS NULL ORDER BY a.display_name,a.id`).all() as Array<{ id: number; username: string; display_name: string; status: string; organization_name: string | null; revision: number }>;
  return [{ id: 0, username: (process.env.GUTV_ADMIN_USERNAME || 'studio').trim(), displayName: 'Основной администратор', organizationName: null, status: 'active', protected: true, roleIds: [administrator.id], revision: 1 }, ...rows.map(r => ({
    id: r.id, username: r.username, displayName: r.display_name, organizationName: r.organization_name, status: r.status,
    protected: false, revision: r.revision,
    roleIds: (db.prepare('SELECT role_id FROM portal_user_roles WHERE account_id = ? ORDER BY role_id').all(r.id) as Array<{ role_id: number }>).map(v => v.role_id),
  }))];
}
export class AccessError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function parseRole(body: unknown) {
  if (!body || typeof body !== 'object') throw new AccessError('Проверьте настройки роли');
  const input = body as Record<string, unknown>;
  if (typeof input.name !== 'string' || input.name.length > 80
    || input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 500)) {
    throw new AccessError('Название: 2–80 символов, описание: до 500');
  }
  const name = typeof input.name === 'string' ? input.name.normalize('NFKC').trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (name.length < 2 || name.length > 80 || description.length > 500) throw new AccessError('Название: 2–80 символов, описание: до 500');
  if (!Array.isArray(input.privileges) || input.privileges.some(p => !allPrivileges.includes(p as Privilege))) throw new AccessError('Неизвестная привилегия');
  const selected = allPrivileges.filter(p => (input.privileges as unknown[]).includes(p));
  // Section permissions can be configured while panel access is switched off.
  return { name, nameKey: name.toLocaleLowerCase('ru-RU'), description, privileges: selected };
}
export function accessMutation<T>(actor: number, action: string, target: number, change: () => { before: unknown; after: unknown; result: T }): T {
  const db = database(); db.exec('BEGIN IMMEDIATE');
  try {
    const value = change();
    db.prepare('INSERT INTO portal_access_audit (actor_id,action,target_id,before_json,after_json) VALUES (?,?,?,?,?)').run(actor, action, target, JSON.stringify(value.before), JSON.stringify(value.after));
    db.exec('COMMIT'); return value.result;
  } catch (error) {
    db.exec('ROLLBACK');
    if (error instanceof Error && /UNIQUE constraint/.test(error.message)) throw new AccessError('Роль с таким названием уже существует', 409);
    throw error;
  }
}
export function accessFailure(error: unknown) {
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
  console.error('Access settings update failed');
  return Response.json({ error: 'Не удалось сохранить настройки доступа' }, { status: 500 });
}
