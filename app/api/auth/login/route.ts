import { NextResponse } from 'next/server';
import { AUTH_LIMITS } from '@/app/auth-validation';
import {
  AUTH_COOKIE,
  authConfigurationStatus,
  createSessionToken,
  normalizedUsername,
  publicRequestOrigin,
  sameOriginRequest,
  SESSION_SECONDS,
  verifyManagementCredentials,
  verifyPasswordRecord,
} from '@/app/auth';
import { accountPrivileges } from '@/app/server/access';
import { database } from '@/db/server';
import { accountAccessAllowed, ensureIssuedSession } from '@/app/server/session-control';

export const runtime = 'nodejs';

type AccountRow = {
  id: number;
  username: string;
  password_hash: string;
  role: 'requester' | 'management';
  status: 'pending' | 'active' | 'rejected' | 'blocked';
  organization_id: number | null;
  display_name: string;
  organization_name: string | null;
  organization_status: 'pending' | 'active' | 'rejected' | 'blocked' | null;
};

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: 'Запрос отклонён' }, { status: 403 });
  let username = '';
  let rawUsername = '';
  let password = '';
  try {
    const body = await request.json() as { username?: unknown; password?: unknown };
    rawUsername = typeof body.username === 'string' ? body.username : '';
    username = normalizedUsername(rawUsername);
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    return NextResponse.json({ error: 'Введите логин и пароль' }, { status: 400 });
  }
  if (username.length < AUTH_LIMITS.username.min || username.length > AUTH_LIMITS.username.max || rawUsername.length > AUTH_LIMITS.username.max) return NextResponse.json({ error: 'Логин — от 3 до 60 символов. Русские буквы разрешены' }, { status: 400 });
  if (!password || password.length > AUTH_LIMITS.password.max) return NextResponse.json({ error: 'Введите пароль длиной до 200 символов' }, { status: 400 });

  try {
    let user: { accountId: number; role: 'requester' | 'management'; organizationId: number | null; username: string; displayName: string } | null = null;
    if (await verifyManagementCredentials(username, password)) {
      if (!accountAccessAllowed(0)) return NextResponse.json({ error: 'Аккаунт заблокирован. Свяжитесь с ГУТВ' }, { status: 403 });
      user = { accountId: 0, role: 'management', organizationId: null, username, displayName: 'Руководство ГУТВ' };
    } else {
      const db = database();
      const account = db.prepare(`
        SELECT a.id, a.username, a.password_hash, a.role, a.status, a.organization_id,
          a.display_name, o.name AS organization_name, o.status AS organization_status
        FROM portal_accounts a
        LEFT JOIN portal_organizations o ON o.id = a.organization_id
        WHERE a.username = ? COLLATE NOCASE
      `).get(username) as AccountRow | undefined;
      if (!account || !await verifyPasswordRecord(password, account.password_hash)) {
        return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
      }
      if (account.status === 'pending') return NextResponse.json({ error: 'Регистрация ещё на рассмотрении' }, { status: 403 });
      if (account.status === 'rejected') return NextResponse.json({ error: 'Регистрация отклонена. Свяжитесь с ГУТВ' }, { status: 403 });
      if (account.status === 'blocked') return NextResponse.json({ error: 'Аккаунт заблокирован. Свяжитесь с ГУТВ' }, { status: 403 });
      if (account.role === 'requester' && account.organization_status !== 'active') {
        return NextResponse.json({ error: 'Доступ подразделения временно закрыт' }, { status: 403 });
      }
      if (!accountAccessAllowed(account.id)) return NextResponse.json({ error: 'Аккаунт заблокирован. Свяжитесь с ГУТВ' }, { status: 403 });
      user = {
        accountId: account.id,
        role: account.role,
        organizationId: account.organization_id,
        username: account.username,
        displayName: account.organization_name || account.display_name,
      };
      db.prepare('UPDATE portal_accounts SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(account.id);
    }

    const response = NextResponse.json({ user: { role: accountPrivileges(user.accountId).includes('panel.access') ? 'management' : 'requester', displayName: user.displayName } }, { headers: { 'Cache-Control': 'no-store' } });
    const token = await createSessionToken(user);
    const verified = await (await import('@/app/auth')).verifySessionToken(token);
    if (!verified) throw new Error('Created session could not be verified');
    ensureIssuedSession(token, verified, request);
    response.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      secure: publicRequestOrigin(request).startsWith('https://'),
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_SECONDS,
    });
    return response;
  } catch (error) {
    console.error('GUTV authentication failure', {
      message: error instanceof Error ? error.message : 'Unknown authentication error',
      sources: authConfigurationStatus(),
    });
    return NextResponse.json({ error: 'Вход временно недоступен' }, { status: 503 });
  }
}
