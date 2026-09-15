import { sameOriginRequest } from '@/app/auth';
import { requiredPrivilege } from '@/app/server/portal';
import { AccessError, accessFailure, accessMutation, accessRoles, parseRole } from '@/app/server/access';
import { allPrivileges } from '@/app/access-types';
import { database } from '@/db/server';

async function mutate(request: Request, context: { params: Promise<{ id: string }> }, remove: boolean) {
  const session = await requiredPrivilege(request, 'access.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  try {
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AccessError('Неверная роль');
    const body = await request.json().catch(() => null);
    accessMutation(session.accountId, remove ? 'role.delete' : 'role.update', id, () => {
      const current = accessRoles().find(r => r.id === id);
      if (!current) throw new AccessError('Роль не найдена', 404);
      if (!body || body.revision !== current.revision) throw new AccessError('Роль уже изменена. Обновите данные и повторите', 409);
      if (remove) {
        if (current.administrator) throw new AccessError('Максимальную роль нельзя удалить', 409);
        if (current.memberCount) throw new AccessError('Сначала снимите эту роль со всех пользователей', 409);
        database().prepare('DELETE FROM portal_roles WHERE id = ?').run(id);
        return { before: current, after: null, result: null };
      }
      const role = parseRole(body);
      if (current.administrator && allPrivileges.some(p => !role.privileges.includes(p))) throw new AccessError('Администратор всегда получает все привилегии');
      database().prepare('UPDATE portal_roles SET name = ?, name_key = ?, description = ?, privileges_json = ?, revision = revision + 1 WHERE id = ?').run(role.name, role.nameKey, role.description, JSON.stringify(role.privileges), id);
      return { before: current, after: role, result: null };
    });
    return Response.json({ ok: true });
  } catch (error) { return accessFailure(error); }
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return mutate(request, context, false); }
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { return mutate(request, context, true); }
