import { sameOriginRequest } from '@/app/auth';
import { requiredSession } from '@/app/server/portal';
import { database } from '@/db/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await requiredSession(request, 'requester');
  if (!session?.organizationId) return Response.json({ error: 'Требуется вход' }, { status: 401 });
  const notifications = database().prepare(`
    SELECT id, application_id, title, body, read_at, created_at
    FROM portal_notifications WHERE organization_id = ?
    ORDER BY id DESC LIMIT 100
  `).all(session.organizationId);
  return Response.json({ notifications });
}

export async function PATCH(request: Request) {
  const session = await requiredSession(request, 'requester');
  if (!session?.organizationId) return Response.json({ error: 'Требуется вход' }, { status: 401 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  database().prepare(`
    UPDATE portal_notifications SET read_at = CURRENT_TIMESTAMP
    WHERE organization_id = ? AND read_at IS NULL
  `).run(session.organizationId);
  return Response.json({ ok: true });
}
