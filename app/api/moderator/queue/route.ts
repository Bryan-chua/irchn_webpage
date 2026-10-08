import { getDb, temporarilyUnavailable } from '@/lib/db';
import { moderatorHouse } from '@/lib/moderator-auth';
import { recordActivity, recordStationPresence, recordSiteError } from '@/lib/operations';

export async function GET(request: Request) {
  const houseCode = await moderatorHouse(request);
  if (!houseCode) return Response.json({ error: 'Authorisation required.' }, { status: 401 });
  const db = getDb();
  try {
    const [setting, eventSetting, active, history] = await Promise.all([
    db.prepare('SELECT status, last_entered_at AS lastEnteredAt FROM house_settings WHERE house_code = ?').bind(houseCode).first<{ status: string; lastEnteredAt: number | null }>(),
    db.prepare('SELECT status, station_controls_locked AS stationControlsLocked FROM event_settings WHERE id = 1').first<{ status: string; stationControlsLocked: number }>(),
    db.prepare(`SELECT id, queue_number AS queueNumber, nickname, group_size AS groupSize,
      status, joined_at AS joinedAt FROM queue_entries
      WHERE house_code = ? AND status IN ('waiting', 'skipped')
      ORDER BY CASE status WHEN 'waiting' THEN 0 ELSE 1 END, joined_at ASC, id ASC`).bind(houseCode).all(),
    db.prepare(`SELECT id, queue_number AS queueNumber, nickname, group_size AS groupSize,
      status, joined_at AS joinedAt, completed_at AS completedAt FROM queue_entries
      WHERE house_code = ? AND status IN ('entered', 'cancelled')
      ORDER BY completed_at DESC LIMIT 40`).bind(houseCode).all(),
    ]);
    try { await recordStationPresence(houseCode, false, db); } catch (error) { console.warn('Could not update station presence.', error); }
    return Response.json({ houseCode, status: setting?.status || 'open', lastEnteredAt: setting?.lastEnteredAt || null, eventStatus: eventSetting?.status || 'open', stationControlsLocked: Boolean(eventSetting?.stationControlsLocked), active: active.results, history: history.results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await recordSiteError('moderator_queue_load', error, houseCode);
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
      const eventSetting = await db.prepare('SELECT station_controls_locked FROM event_settings WHERE id = 1').first<{ station_controls_locked: number }>();
      if (eventSetting?.station_controls_locked) {
        return Response.json({ error: 'House status controls are locked by overall event control.' }, { status: 423 });
      }
      await db.prepare('UPDATE house_settings SET status = ? WHERE house_code = ?').bind(body.queueStatus, houseCode).run();
      await recordActivity({ eventType: 'house_status_changed', houseCode, actor: `station:${houseCode}`, message: `${houseCode} changed its queue status to ${body.queueStatus}.` }, db);
      return Response.json({ ok: true });
    } catch (error) {
      await recordSiteError('moderator_status_update', error, houseCode);
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
    await recordSiteError('moderator_queue_action', error, houseCode);
    return temporarilyUnavailable(error);
  }
}
