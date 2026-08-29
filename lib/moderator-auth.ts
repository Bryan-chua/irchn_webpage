import { env } from 'cloudflare:workers';
import { isHouseCode, type HouseCode } from './houses';

const COOKIE_NAME = 'nof_moderator';

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

async function tokenFor(houseCode: HouseCode) {
  const secret = runtimeValue('MODERATOR_SESSION_SECRET') || (process.env.NODE_ENV === 'production' ? '' : 'local-fright-night-session');
  return digest(`${houseCode}:${secret}`);
}

export async function verifyPin(houseCode: HouseCode, pin: string) {
  const expected = configuredPins()[houseCode];
  if (!expected) return false;
  const [left, right] = await Promise.all([digest(pin), digest(expected)]);
  return left === right;
}

export async function sessionCookie(houseCode: HouseCode) {
  const token = await tokenFor(houseCode);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${houseCode}.${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`;
}

export async function moderatorHouse(request: Request): Promise<HouseCode | null> {
  const cookie = request.headers.get('cookie') || '';
  const raw = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!raw) return null;
  const [houseCode, token] = raw.split('.');
  if (!isHouseCode(houseCode) || !token) return null;
  return token === await tokenFor(houseCode) ? houseCode : null;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}
