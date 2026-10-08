import { getDb } from './db';

type EventDetails = {
  eventType: string;
  houseCode?: string;
  actor?: string;
  message: string;
  severity?: 'info' | 'warning' | 'error';
};

export async function recordActivity(details: EventDetails, db = getDb()) {
  const now = Date.now();
  await db.prepare(`INSERT INTO operational_events
    (category, event_type, severity, house_code, actor, message, count, occurred_at, last_occurred_at)
    VALUES ('activity', ?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(details.eventType, details.severity || 'info', details.houseCode || 'ALL', details.actor || 'system', details.message, now, now)
    .run();
}

export async function raiseAlert(details: EventDetails, db = getDb(), increment = true) {
  const houseCode = details.houseCode || 'ALL';
  const active = await db.prepare(`SELECT id FROM operational_events
    WHERE category = 'alert' AND event_type = ? AND house_code = ? AND resolved_at IS NULL
    LIMIT 1`).bind(details.eventType, houseCode).first<{ id: number }>();
  const now = Date.now();
  if (active) {
    await db.prepare(`UPDATE operational_events
      SET severity = ?, actor = ?, message = ?, last_occurred_at = ?, count = count + ?
      WHERE id = ?`)
      .bind(details.severity || 'warning', details.actor || 'system', details.message, now, increment ? 1 : 0, active.id)
      .run();
    return active.id;
  }
  const result = await db.prepare(`INSERT INTO operational_events
    (category, event_type, severity, house_code, actor, message, count, occurred_at, last_occurred_at)
    VALUES ('alert', ?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(details.eventType, details.severity || 'warning', houseCode, details.actor || 'system', details.message, now, now)
    .run();
  return Number(result.meta.last_row_id);
}

export async function resolveAlert(eventType: string, houseCode = 'ALL', db = getDb()) {
  await db.prepare(`UPDATE operational_events SET resolved_at = ?
    WHERE category = 'alert' AND event_type = ? AND house_code = ? AND resolved_at IS NULL`)
    .bind(Date.now(), eventType, houseCode)
    .run();
}

export async function recordStationPresence(houseCode: string, login = false, db = getDb()) {
  const now = Date.now();
  await db.prepare(`INSERT INTO station_presence (house_code, last_seen_at, last_login_at)
    VALUES (?, ?, ?)
    ON CONFLICT(house_code) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      last_login_at = CASE WHEN ? THEN excluded.last_login_at ELSE station_presence.last_login_at END
    WHERE ? OR station_presence.last_seen_at < excluded.last_seen_at - 30000`)
    .bind(houseCode, now, now, login ? 1 : 0, login ? 1 : 0)
    .run();
}

export async function recordSiteError(source: string, error: unknown, houseCode = 'ALL') {
  try {
    const detail = error instanceof Error ? error.message : String(error);
    await raiseAlert({
      eventType: `site_error:${source}`,
      houseCode,
      actor: 'system',
      severity: 'error',
      message: `${source}: ${detail.slice(0, 400)}`,
    });
  } catch (recordingError) {
    console.error('Could not persist the operational error.', recordingError);
  }
}
