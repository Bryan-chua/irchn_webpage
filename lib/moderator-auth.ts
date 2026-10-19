import { env } from 'cloudflare:workers';
import { isHouseCode, type HouseCode } from './houses';

const COOKIE_NAME = 'nof_moderator';
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
export const OVERALL_MODERATOR = 'OVERALL' as const;
export type ModeratorScope = HouseCode | typeof OVERALL_MODERATOR;

function runtimeValue(name: string): string | undefined {
  const values = env as unknown as Record<string, unknown>;
  return typeof values[name] === 'string' ? values[name] as string : process.env[name];
}

function configuredPins() {
  const raw = runtimeValue('MODERATOR_PINS') || (process.env.NODE_ENV === 'production' ? '' : 'RV:boo2026,CP:boo2026,AC:boo2026,TM:boo2026,R4:boo2026,NS:boo2026');
  return Object.fromEntries(raw.split(',').map((pair) => pair.split(':').map((value) => value.trim())).filter((pair) => pair.length === 2));
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isModeratorScope(value: string): value is ModeratorScope {
  return value === OVERALL_MODERATOR || isHouseCode(value);
}

function sessionSecret() {
  const secret = runtimeValue('MODERATOR_SESSION_SECRET') || (process.env.NODE_ENV === 'production' ? '' : 'local-fright-night-session');
  if (!secret) throw new Error('MODERATOR_SESSION_SECRET is required for moderator sessions.');
  return secret;
}

async function sessionKey() {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(sessionSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function hexBytes(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g) || [], (part) => Number.parseInt(part, 16));
}

export async function verifyPin(houseCode: HouseCode, pin: string) {
  const expected = configuredPins()[houseCode];
  if (!expected) return false;
  const [left, right] = await Promise.all([digest(pin), digest(expected)]);
  return left === right;
}

export async function verifyOverallPin(pin: string) {
  const expected = runtimeValue('OVERALL_MODERATOR_PIN') || (process.env.NODE_ENV === 'production' ? '' : 'bryan2026');
  if (!expected) return false;
  const [left, right] = await Promise.all([digest(pin), digest(expected)]);
  return left === right;
}

export async function sessionCookie(scope: ModeratorScope) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(), new TextEncoder().encode(`${scope}:${expiresAt}`));
  const token = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${scope}.${expiresAt}.${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

export async function moderatorScope(request: Request): Promise<ModeratorScope | null> {
  const cookie = request.headers.get('cookie') || '';
  const raw = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!raw) return null;
  const [scope, expiresText, token, extra] = raw.split('.');
  const expiresAt = Number(expiresText);
  const signature = hexBytes(token || '');
  if (!isModeratorScope(scope) || extra !== undefined || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !signature) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await sessionKey(), signature, new TextEncoder().encode(`${scope}:${expiresAt}`));
    return valid ? scope : null;
  } catch {
    return null;
  }
}

export async function moderatorHouse(request: Request): Promise<HouseCode | null> {
  const scope = await moderatorScope(request);
  return scope && isHouseCode(scope) ? scope : null;
}

export async function isOverallModerator(request: Request) {
  return await moderatorScope(request) === OVERALL_MODERATOR;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}
