import { sameOriginRequest } from '@/app/auth';
import { requiredPrivilege } from '@/app/server/portal';
import { leadershipRouteId } from '@/app/server/leadership';
import { projectDraft, projectsDatabase, studioProjects } from '@/app/server/projects';
type Context = { params: Promise<{ id: string }> };
async function change(request: Request, context: Context, remove: boolean) {
  if (!await requiredPrivilege(request, 'projects.manage')) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  const id = leadershipRouteId((await context.params).id), db = projectsDatabase();
  if (!db.prepare('SELECT id FROM portal_studio_projects WHERE id=?').get(id)) return Response.json({ error: 'Проект не найден' }, { status: 404 });
  if (remove) db.prepare('DELETE FROM portal_studio_projects WHERE id=?').run(id);
  else {
    const draft = projectDraft(await request.json().catch(() => null));
    if (!draft) return Response.json({ error: 'Проверьте поля проекта и ссылку' }, { status: 400 });
    db.prepare('UPDATE portal_studio_projects SET content=? WHERE id=?').run(JSON.stringify(draft), id);
  }
  return Response.json({ projects: studioProjects() });
}
export async function PATCH(request: Request, context: Context) { return change(request, context, false); }
export async function DELETE(request: Request, context: Context) { return change(request, context, true); }
