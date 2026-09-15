import { sameOriginRequest } from '@/app/auth';
import { requiredPrivilege } from '@/app/server/portal';
import { accessFailure, accessMutation, parseRole } from '@/app/server/access';
import { database } from '@/db/server';

export async function POST(request: Request) {
  const session = await requiredPrivilege(request, 'access.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  try {
    const role = parseRole(await request.json().catch(() => null));
    const id = accessMutation(session.accountId, 'role.create', 0, () => {
      const result = database().prepare('INSERT INTO portal_roles (name,name_key,description,privileges_json) VALUES (?,?,?,?)').run(role.name, role.nameKey, role.description, JSON.stringify(role.privileges));
      const id = Number(result.lastInsertRowid);
      return { before: null, after: { id, ...role }, result: id };
    });
    return Response.json({ id }, { status: 201 });
  } catch (error) { return accessFailure(error); }
}
