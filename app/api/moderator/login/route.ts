import { env } from 'cloudflare:workers';
import { getDb } from '@/lib/db';
import { isHouseCode } from '@/lib/houses';
import { OVERALL_MODERATOR, sessionCookie, verifyOverallPin, verifyPin, type ModeratorScope } from '@/lib/moderator-auth';
import { raiseAlert, recordStationPresence } from '@/lib/operations';

async function failedLoginAllowed(request: Request, houseCode: string) {
  const clientAddress = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const rawKey = `${houseCode || 'invalid'}:${clientAddress}`;
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
  const attemptKey = Array.from(new Uint8Array(keyBytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  let allowed = true;
  try {
    const result = await getDb().prepare(`INSERT INTO moderator_login_attempts
      (attempt_key, failure_count, window_started_at, last_failed_at)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(attempt_key) DO UPDATE SET
        failure_count = CASE WHEN window_started_at <= ? THEN 1 ELSE failure_count + 1 END,
        window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END,
        last_failed_at = excluded.last_failed_at
      RETURNING failure_count AS failureCount`)
      .bind(attemptKey, now, now, now - 60_000, now - 60_000)
      .first<{ failureCount: number }>();
    allowed = Number(result?.failureCount || 1) <= 3;
  } catch (error) {
    console.warn('Exact moderator login counter failed; using the Cloudflare rate limiter fallback.', error);
    try {
      const limiter = (env as unknown as { MODERATOR_LOGIN_RATE_LIMITER?: RateLimit }).MODERATOR_LOGIN_RATE_LIMITER;
      if (limiter) allowed = (await limiter.limit({ key: rawKey })).success;
    } catch (fallbackError) {
      console.warn('Moderator login rate-limit fallback failed; allowing the attempt.', fallbackError);
    }
  }
  if (!allowed) {
    const alertHouse = isHouseCode(houseCode) ? houseCode : houseCode === OVERALL_MODERATOR ? 'ALL' : 'INVALID';
    console.warn('Moderator login rate limit exceeded.', {
      event: 'moderator_login_rate_limited',
      houseCode: alertHouse,
      occurredAt: now,
    });
    try {
      await raiseAlert({
        eventType: 'moderator_login_rate_limited',
        houseCode: alertHouse,
        actor: 'system',
        severity: 'warning',
        message: `${alertHouse === 'ALL' ? 'Overall control' : alertHouse} exceeded three failed login attempts in one minute.`,
      });
    } catch (error) {
      console.warn('Could not persist the moderator login warning.', error);
    }
  }
  return allowed;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { houseCode?: string; pin?: string } | null;
  const requestedScope = body?.houseCode?.toUpperCase() || '';
  const scope = (requestedScope === OVERALL_MODERATOR || isHouseCode(requestedScope)) ? requestedScope as ModeratorScope : null;
  const valid = scope && body?.pin && (scope === OVERALL_MODERATOR ? await verifyOverallPin(body.pin) : await verifyPin(scope, body.pin));
  if (!valid || !scope) {
    if (!await failedLoginAllowed(request, requestedScope)) {
      return Response.json(
        { error: 'Too many failed login attempts. Wait one minute and try again.' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }
    return Response.json({ error: 'Incorrect station or access code.' }, { status: 401 });
  }
  if (isHouseCode(scope)) {
    try { await recordStationPresence(scope, true); } catch (error) { console.warn('Could not record station login activity.', error); }
  }
  return Response.json({ houseCode: scope }, { headers: { 'Set-Cookie': await sessionCookie(scope) } });
}
