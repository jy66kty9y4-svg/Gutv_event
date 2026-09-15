import { sameOriginRequest } from '@/app/auth';
import { requiredPrivilege } from '@/app/server/portal';
import { projectsDatabase, studioProjects } from '@/app/server/projects';
export async function PUT(request: Request) {
  if (!await requiredPrivilege(request, 'projects.manage')) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const body = await request.json().catch(() => null), current = studioProjects(), ids: unknown = body?.ids;
  if (!Array.isArray(ids) || Object.keys(body).length !== 1 || ids.length !== current.length || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || !current.some(p => p.id === id))) return Response.json({ error: 'Некорректный порядок' }, { status: 400 });
  const db = projectsDatabase(); db.exec('BEGIN IMMEDIATE');
  try { const update = db.prepare('UPDATE portal_studio_projects SET sort_order=? WHERE id=?'); ids.forEach((id, i) => update.run(i + 1, id)); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
  return Response.json({ projects: studioProjects() });
}
