import { requiredSession } from '@/app/server/portal';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await requiredSession(request);
  if (!session) return Response.json({ user: null }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ user: { role: session.role, displayName: session.displayName } }, { headers: { 'Cache-Control': 'no-store' } });
}
