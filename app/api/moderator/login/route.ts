import { env } from 'cloudflare:workers';
import { isHouseCode } from '@/lib/houses';
import { sessionCookie, verifyPin } from '@/lib/moderator-auth';

async function failedLoginAllowed(request: Request, houseCode: string) {
  try {
    const limiter = (env as unknown as { MODERATOR_LOGIN_RATE_LIMITER?: RateLimit }).MODERATOR_LOGIN_RATE_LIMITER;
    if (!limiter) {
      console.warn('MODERATOR_LOGIN_RATE_LIMITER binding is unavailable; allowing the login attempt.');
      return true;
    }
    const clientAddress = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
    const { success } = await limiter.limit({ key: `${houseCode || 'invalid'}:${clientAddress}` });
    if (!success) {
      console.warn('Moderator login rate limit exceeded.', {
        event: 'moderator_login_rate_limited',
        houseCode: isHouseCode(houseCode) ? houseCode : 'invalid',
        occurredAt: Date.now(),
      });
    }
    return success;
  } catch (error) {
    console.warn('Moderator login rate-limit check failed; allowing the attempt.', error);
    return true;
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { houseCode?: string; pin?: string } | null;
  const houseCode = body?.houseCode?.toUpperCase() || '';
  if (!isHouseCode(houseCode) || !body?.pin || !await verifyPin(houseCode, body.pin)) {
    if (!await failedLoginAllowed(request, houseCode)) {
      return Response.json(
        { error: 'Too many failed login attempts. Wait one minute and try again.' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }
    return Response.json({ error: 'Incorrect station or access code.' }, { status: 401 });
  }
  return Response.json({ houseCode }, { headers: { 'Set-Cookie': await sessionCookie(houseCode) } });
}
