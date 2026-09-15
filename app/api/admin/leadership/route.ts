import { requiredPrivilege } from '@/app/server/portal';
import { leadershipRoster } from '@/app/server/leadership';

export async function GET(request: Request) {
  const session = await requiredPrivilege(request, 'leadership.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  return Response.json(leadershipRoster());
}
