import { cookies } from 'next/headers';
import { AUTH_COOKIE, verifySessionToken } from '../auth';
import { validateStatefulSession } from './session-control';
import type { PublicSessionUser } from '../public-session';
export async function publicSession(): Promise<PublicSessionUser | null> {
  const tokenSession = await verifySessionToken((await cookies()).get(AUTH_COOKIE)?.value);
  const session = tokenSession ? await validateStatefulSession(tokenSession) : null;
  if (!session) return null;
  return { role: session.role, displayName: session.displayName };
}
