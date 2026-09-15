import { normalizedUsername } from './auth-validation';

export { normalizedUsername } from './auth-validation';

export const AUTH_COOKIE = 'gutv_session';
export const SESSION_SECONDS = 60 * 60 * 12;

export type UserRole = 'requester' | 'management';

export type AuthSession = {
  accountId: number;
  role: UserRole;
  organizationId: number | null;
  username: string;
  displayName: string;
};

export type VerifiedSession = AuthSession & {
  expiresAt: number;
  issuedAt: number;
  sessionId: string | null;
  legacy: boolean;
  token: string;
};

type SessionPayload = AuthSession & { expiresAt: number; issuedAt?: number; sessionId?: string };

const encoder = new TextEncoder();

function authEnvironment() {
  return {
    adminUsername: normalizedUsername(process.env.GUTV_ADMIN_USERNAME || 'studio'),
    passwordRecord: process.env.GUTV_PASSWORD_RECORD,
    sessionSecret: process.env.GUTV_SESSION_SECRET,
  };
}

export function authConfigurationStatus() {
  return {
    passwordConfigured: Boolean(process.env.GUTV_PASSWORD_RECORD),
    sessionConfigured: Boolean(process.env.GUTV_SESSION_SECRET),
  };
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function passwordDigest(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: salt as BufferSource,
    iterations,
  }, key, 256));
}

async function sessionSignature(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    decodeBase64Url(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return encodeBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function createPasswordRecord(password: string) {
  const iterations = 210_000;
  const salt = crypto.getRandomValues(new Uint8Array(18));
  const digest = await passwordDigest(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${encodeBase64Url(salt)}$${encodeBase64Url(digest)}`;
}

export async function verifyPasswordRecord(password: string, record?: string | null) {
  if (!record) return false;
  const [algorithm, iterationsText, saltText, digestText, extra] = record.split('$');
  const iterations = Number(iterationsText);
  if (algorithm !== 'pbkdf2-sha256' || extra || !Number.isInteger(iterations) || iterations < 100_000 || !saltText || !digestText) return false;
  const digest = await passwordDigest(password, decodeBase64Url(saltText), iterations);
  return equalBytes(digest, decodeBase64Url(digestText));
}

export async function verifyManagementCredentials(username: string, password: string) {
  const environment = authEnvironment();
  return normalizedUsername(username) === environment.adminUsername
    && await verifyPasswordRecord(password, environment.passwordRecord);
}

export async function createSessionToken(session: AuthSession) {
  const secret = authEnvironment().sessionSecret;
  if (!secret) throw new Error('Session protection is not configured');
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { ...session, issuedAt, sessionId: crypto.randomUUID(), expiresAt: issuedAt + SESSION_SECONDS };
  const payloadText = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const signedValue = `v3.${payloadText}`;
  return `${signedValue}.${await sessionSignature(signedValue, secret)}`;
}

export async function verifySessionToken(token?: string): Promise<VerifiedSession | null> {
  const secret = authEnvironment().sessionSecret;
  if (!secret || !token) return null;
  const [version, payloadText, suppliedSignature, extra] = token.split('.');
  if ((version !== 'v2' && version !== 'v3') || extra || !payloadText || !suppliedSignature) return null;
  const expectedSignature = await sessionSignature(`${version}.${payloadText}`, secret);
  if (!equalBytes(encoder.encode(suppliedSignature), encoder.encode(expectedSignature))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadText))) as Partial<SessionPayload>;
    if (!Number.isInteger(payload.accountId) || !Number.isInteger(payload.expiresAt) || payload.expiresAt! <= Math.floor(Date.now() / 1000)) return null;
    if (payload.role !== 'requester' && payload.role !== 'management') return null;
    if (payload.organizationId !== null && payload.organizationId !== undefined && !Number.isInteger(payload.organizationId)) return null;
    if (typeof payload.username !== 'string' || typeof payload.displayName !== 'string') return null;
    const legacy = version === 'v2';
    const issuedAt = legacy ? payload.expiresAt! - SESSION_SECONDS : payload.issuedAt;
    if (!Number.isInteger(issuedAt) || issuedAt! <= 0 || issuedAt! > payload.expiresAt!) return null;
    if (!legacy && (typeof payload.sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sessionId))) return null;
    return {
      accountId: payload.accountId!,
      role: payload.role,
      organizationId: payload.organizationId ?? null,
      username: payload.username,
      displayName: payload.displayName,
      expiresAt: payload.expiresAt!,
      issuedAt: issuedAt!,
      sessionId: legacy ? null : payload.sessionId!,
      legacy,
      token,
    };
  } catch {
    return null;
  }
}

export function sessionFromRequest(request: Request) {
  const cookie = request.headers.get('cookie') || '';
  const value = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${AUTH_COOKIE}=`));
  try {
    return verifySessionToken(value ? decodeURIComponent(value.slice(AUTH_COOKIE.length + 1)) : undefined);
  } catch {
    return verifySessionToken(undefined);
  }
}

export function publicRequestOrigin(request: Request) {
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host'))?.split(',')[0]?.trim();
  if ((protocol === 'http' || protocol === 'https') && host) {
    try { return new URL(`${protocol}://${host}`).origin; } catch { /* fall through */ }
  }
  return new URL(request.url).origin;
}

export function sameOriginRequest(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === publicRequestOrigin(request);
}
