import { getDb, temporarilyUnavailable } from '@/lib/db';
import { moderatorHouse } from '@/lib/moderator-auth';

export async function GET(request: Request) {
  const houseCode = await moderatorHouse(request);
  if (!houseCode) return Response.json({ error: 'Authorisation required.' }, { status: 401 });
  const db = getDb();
  try {
    const [setting, active, history] = await Promise.all([
    db.prepare('SELECT status, last_entered_at AS lastEnteredAt FROM house_settings WHERE house_code = ?').bind(houseCode).first<{ status: string; lastEnteredAt: number | null }>(),
    db.prepare(`SELECT id, queue_number AS queueNumber, nickname, group_size AS groupSize,
      status, joined_at AS joinedAt FROM queue_entries
      WHERE house_code = ? AND status IN ('waiting', 'skipped')
      ORDER BY CASE status WHEN 'waiting' THEN 0 ELSE 1 END, joined_at ASC, id ASC`).bind(houseCode).all(),
    db.prepare(`SELECT id, queue_number AS queueNumber, nickname, group_size AS groupSize,
      status, joined_at AS joinedAt, completed_at AS completedAt FROM queue_entries
      WHERE house_code = ? AND status IN ('entered', 'cancelled')
      ORDER BY completed_at DESC LIMIT 40`).bind(houseCode).all(),
    ]);
    return Response.json({ houseCode, status: setting?.status || 'open', lastEnteredAt: setting?.lastEnteredAt || null, active: active.results, history: history.results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return temporarilyUnavailable(error);
  }
}

export async function PATCH(request: Request) {
  const houseCode = await moderatorHouse(request);
  if (!houseCode) return Response.json({ error: 'Authorisation required.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { ids?: number[]; status?: string; queueStatus?: string } | null;
  const db = getDb();

  if (body?.queueStatus) {
    if (!['open', 'paused', 'closed'].includes(body.queueStatus)) return Response.json({ error: 'Invalid queue status.' }, { status: 400 });
    try {
      await db.prepare('UPDATE house_settings SET status = ? WHERE house_code = ?').bind(body.queueStatus, houseCode).run();
      return Response.json({ ok: true });
    } catch (error) {
      return temporarilyUnavailable(error);
    }
  }

  const ids = Array.isArray(body?.ids) ? body.ids.filter(Number.isInteger).slice(0, 100) : [];
  const status = body?.status;
  if (!ids.length || !status || !['waiting', 'entered', 'skipped', 'cancelled'].includes(status)) {
    return Response.json({ error: 'Choose at least one valid queue entry and action.' }, { status: 400 });
  }
  const completedAt = ['entered', 'cancelled'].includes(status) ? Date.now() : null;
  const statements = ids.map((id) => db.prepare('UPDATE queue_entries SET status = ?, completed_at = ? WHERE id = ? AND house_code = ?').bind(status, completedAt, id, houseCode));
  if (status === 'entered') {
    statements.push(db.prepare('UPDATE house_settings SET last_entered_at = ? WHERE house_code = ?').bind(completedAt, houseCode));
  } else if (status === 'waiting') {
    statements.push(db.prepare(`UPDATE house_settings SET last_entered_at = (
      SELECT MAX(completed_at) FROM queue_entries
      WHERE house_code = ? AND status = 'entered'
    ) WHERE house_code = ?`).bind(houseCode, houseCode));
  }
  try {
    await db.batch(statements);
    return Response.json({ ok: true });
  } catch (error) {
    if (status === 'waiting' && String(error).includes('UNIQUE constraint failed')) {
      return Response.json({ error: 'This group cannot be restored because the same browser already has another active ticket for this house.' }, { status: 409 });
    }
    return temporarilyUnavailable(error);
  }
}
