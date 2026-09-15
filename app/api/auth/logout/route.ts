import { NextResponse } from 'next/server';
import { AUTH_COOKIE, publicRequestOrigin, sameOriginRequest, sessionFromRequest } from '@/app/auth';
import { revokeSessionFromToken } from '@/app/server/session-control';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: 'Запрос отклонён' }, { status: 403 });
  const session = await sessionFromRequest(request);
  if (session) await revokeSessionFromToken(session);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: publicRequestOrigin(request).startsWith('https://'),
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return response;
}
