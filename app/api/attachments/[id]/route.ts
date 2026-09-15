import { hasPrivilege } from '@/app/server/access';
import { requiredSession } from '@/app/server/portal';
import { loadAttachment } from '@/app/server/uploads';
import { database } from '@/db/server';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requiredSession(request);
  if (!session) return Response.json({ error: 'Требуется вход' }, { status: 401 });
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'Файл не найден' }, { status: 404 });
  const row = database().prepare(`
    SELECT pa.original_name, pa.stored_name, pa.mime_type, a.organization_id
    FROM portal_attachments pa JOIN portal_applications a ON a.id = pa.application_id
    WHERE pa.id = ?
  `).get(id) as { original_name: string; stored_name: string; mime_type: string; organization_id: number } | undefined;
  if (!row || (!hasPrivilege(session, 'applications.manage') && row.organization_id !== session.organizationId)) {
    return Response.json({ error: 'Файл не найден' }, { status: 404 });
  }
  try {
    const file = await loadAttachment(row.stored_name);
    const safeName = row.original_name.replace(/["\r\n]/g, '_');
    return new Response(file, {
      headers: {
        'Content-Type': row.mime_type,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'Файл недоступен' }, { status: 404 });
  }
}
