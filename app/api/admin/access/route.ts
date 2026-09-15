import { requiredPrivilege } from '@/app/server/portal';
import { accessRoles, accessUsers } from '@/app/server/access';

export async function GET(request: Request) {
  const session = await requiredPrivilege(request, 'access.manage');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  return Response.json({ roles: accessRoles(), users: accessUsers(), currentAccountId: session.accountId }, { headers: { 'Cache-Control': 'private, no-store' } });
}
