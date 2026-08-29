import { clearSessionCookie } from '@/lib/moderator-auth';

export async function POST() {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
