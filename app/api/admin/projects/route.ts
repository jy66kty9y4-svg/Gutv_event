import { sameOriginRequest } from '@/app/auth';
import { requiredPrivilege } from '@/app/server/portal';
import { projectDraft, projectsDatabase, studioProjects } from '@/app/server/projects';
export async function GET(request: Request) {
  if (!await requiredPrivilege(request, 'projects.manage')) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  return Response.json({ projects: studioProjects() });
}
export async function POST(request: Request) {
  if (!await requiredPrivilege(request, 'projects.manage')) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const draft = projectDraft(await request.json().catch(() => null));
  if (!draft) return Response.json({ error: 'Проверьте поля проекта и ссылку' }, { status: 400 });
  const db = projectsDatabase();
  db.prepare('INSERT INTO portal_studio_projects (content, sort_order) SELECT ?, COALESCE(MAX(sort_order), 0) + 1 FROM portal_studio_projects').run(JSON.stringify(draft));
  return Response.json({ projects: studioProjects() });
}
