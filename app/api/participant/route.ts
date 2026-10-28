import { getDb, temporarilyUnavailable } from '@/lib/db';
import { isHouseCode } from '@/lib/houses';
import { clearOutsideRcTickets, tokenHash, validDeviceToken } from '@/lib/rc-policy';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { deviceToken?: string; homeRc?: string } | null;
  if (!validDeviceToken(body?.deviceToken)) return Response.json({ error: 'A valid device token is required.' }, { status: 400 });
  if (body?.homeRc !== undefined && (typeof body.homeRc !== 'string' || !isHouseCode(body.homeRc))) {
    return Response.json({ error: 'Choose a valid RC.' }, { status: 400 });
  }
  try {
    const db = getDb();
    const hash = await tokenHash(body.deviceToken);
    if (body.homeRc) {
      // The first confirmed RC wins, including simultaneous requests from tabs.
      await db.prepare('INSERT OR IGNORE INTO participant_devices (device_token_hash, home_rc) VALUES (?, ?)').bind(hash, body.homeRc).run();
    }
    const profile = await db.prepare('SELECT home_rc AS homeRc FROM participant_devices WHERE device_token_hash = ?').bind(hash).first<{ homeRc: string }>();
    if (profile) {
      // Link pre-feature tickets only before the cutoff; cancelled tickets stay cancelled.
      await db.prepare(`UPDATE queue_entries SET home_rc = ? WHERE device_token_hash = ? AND home_rc IS NULL
        AND NOT EXISTS (SELECT 1 FROM event_settings WHERE id = 1 AND home_rc_only_at <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))`)
        .bind(profile.homeRc, hash).run();
    }
    await clearOutsideRcTickets(db);
    const policy = await db.prepare('SELECT home_rc_only_at AS homeRcOnlyAt FROM event_settings WHERE id = 1').first<{ homeRcOnlyAt: number | null }>();
    return Response.json({ homeRc: profile?.homeRc || null, homeRcOnlyAt: policy?.homeRcOnlyAt || null, serverNow: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return temporarilyUnavailable(error); }
}
