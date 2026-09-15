import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifySessionToken } from '@/app/auth';
import { validateStatefulSession } from '@/app/server/session-control';

const publicPaths = new Set([
  '/', '/directions', '/materials', '/studio', '/login', '/register', '/api/auth/login', '/api/auth/logout', '/api/auth/register', '/api/auth/session',
  '/api/vk/callback',
  '/favicon.svg', '/gutv-logo.png', '/og.png',
]);

function redirectToEntry(request: NextRequest) {
  const entry = new URL('/', request.url);
  entry.searchParams.set('auth', 'login');
  entry.searchParams.set('returnTo', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(entry);
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith('/api/internal/orbitpanel/')) {
    if (request.headers.get('host') !== 'gutv-portal-control:3000') return new NextResponse(null, { status: 404 });
    return NextResponse.next();
  }
  if (publicPaths.has(path) || path.startsWith('/api/leadership/photos/') || path.startsWith('/_next/') || /\.[a-zA-Z0-9]+$/.test(path)) return NextResponse.next();

  const tokenSession = await verifySessionToken(request.cookies.get(AUTH_COOKIE)?.value);
  const session = tokenSession ? await validateStatefulSession(tokenSession, request) : null;
  if (!session) {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Требуется вход' }, { status: 401 });
    return redirectToEntry(request);
  }

  const managementOnly = path.startsWith('/management') || path.startsWith('/api/admin');
  if (managementOnly && session.role !== 'management') {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    return NextResponse.redirect(new URL('/cabinet', request.url));
  }

  if (path.startsWith('/cabinet') && session.role === 'management' && !session.organizationId) {
    return NextResponse.redirect(new URL('/management', request.url));
  }

  return NextResponse.next();
}

export const config = { matcher: ['/:path*'] };
