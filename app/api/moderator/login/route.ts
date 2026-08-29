import { isHouseCode } from '@/lib/houses';
import { sessionCookie, verifyPin } from '@/lib/moderator-auth';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { houseCode?: string; pin?: string } | null;
  const houseCode = body?.houseCode?.toUpperCase() || '';
  if (!isHouseCode(houseCode) || !body?.pin || !await verifyPin(houseCode, body.pin)) {
    return Response.json({ error: 'Incorrect station or access code.' }, { status: 401 });
  }
  return Response.json({ houseCode }, { headers: { 'Set-Cookie': await sessionCookie(houseCode) } });
}
