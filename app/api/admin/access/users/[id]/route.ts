import { AUTH_LIMITS } from '@/app/auth-validation';
import { createPasswordRecord, sameOriginRequest } from '@/app/auth';
import { requiredPrivilege } from '@/app/server/portal';
import { AccessError, accessFailure, accessMutation, accessUsers, accessRoles } from '@/app/server/access';
import { terminateUserSessions } from '@/app/server/session-control';
import { database } from '@/db/server';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requiredPrivilege(request, 'access.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  try {
    const id = Number((await context.params).id);
    if (id === 0) throw new AccessError('Основной администратор всегда сохраняет полный доступ', 409);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AccessError('Неверный пользователь');
    const body = await request.json().catch(() => null);
    if (body?.action === 'password') {
      const password = typeof body.password === 'string' ? body.password : '';
      if (password.length < AUTH_LIMITS.password.min || password.length > AUTH_LIMITS.password.max) throw new AccessError('Пароль — от 8 до 200 символов');
      const hash = await createPasswordRecord(password);
      accessMutation(session.accountId, 'user.password', id, () => {
        const current = accessUsers().find(u => u.id === id);
        if (!current) throw new AccessError('Пользователь не найден', 404);
        const db = database();
        db.prepare('UPDATE portal_accounts SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, id);
        terminateUserSessions(id);
        return { before: { reset: false }, after: { reset: true }, result: null };
      });
      return Response.json({ ok: true });
    }
    if (body?.action === 'hide') {
      accessMutation(session.accountId, 'user.hide', id, () => {
        const current = accessUsers().find(u => u.id === id);
        if (!current) throw new AccessError('Пользователь не найден', 404);
        if (current.status !== 'blocked') throw new AccessError('Скрывать можно только заблокированные аккаунты', 409);
        const db = database();
        const account = db.prepare('SELECT organization_id FROM portal_accounts WHERE id = ?').get(id) as { organization_id: number | null } | undefined;
        db.prepare('UPDATE portal_accounts SET hidden_at = COALESCE(hidden_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
        if (account?.organization_id) db.prepare('UPDATE portal_organizations SET hidden_at = COALESCE(hidden_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?').run(account.organization_id, 'blocked');
        terminateUserSessions(id);
        return { before: current, after: { hidden: true }, result: null };
      });
      return Response.json({ ok: true });
    }
    if (!body || !Array.isArray(body.roleIds) || body.roleIds.length > 100 || body.roleIds.some((value: unknown) => !Number.isSafeInteger(value) || Number(value) <= 0)) throw new AccessError('Проверьте список ролей');
    const roleIds = [...new Set<number>(body.roleIds)].sort((a, b) => a - b);
    accessMutation(session.accountId, 'user.roles', id, () => {
      const current = accessUsers().find(u => u.id === id);
      if (!current) throw new AccessError('Пользователь не найден', 404);
      if (body.revision !== current.revision) throw new AccessError('Роли пользователя уже изменены. Обновите данные и повторите', 409);
      const roles = accessRoles();
      if (roleIds.some(value => !roles.some(r => r.id === value))) throw new AccessError('Одна из ролей больше не существует', 409);
      const db = database();
      db.prepare('DELETE FROM portal_user_roles WHERE account_id = ?').run(id);
      roleIds.forEach(role => db.prepare('INSERT INTO portal_user_roles (account_id,role_id) VALUES (?,?)').run(id, role));
      db.prepare('INSERT INTO portal_user_role_versions (account_id,revision) VALUES (?,2) ON CONFLICT(account_id) DO UPDATE SET revision = revision + 1').run(id);
      return { before: current.roleIds, after: roleIds, result: null };
    });
    return Response.json({ ok: true });
  } catch (error) { return accessFailure(error); }
}
