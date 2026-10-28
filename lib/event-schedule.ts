// Called by the background cron and queue requests. A conditional UPDATE plus
// the database trigger opens all houses and records the action atomically once.
export async function applyScheduledOpening(db: D1Database, now = Date.now()) {
  await db.prepare(`UPDATE event_settings SET status = 'open', station_controls_locked = 0,
    event_opened_at = ?, updated_at = ?, updated_by = 'system'
    WHERE id = 1 AND event_open_at IS NOT NULL AND event_opened_at IS NULL
      AND event_open_at <= ? AND (event_end_at IS NULL OR event_end_at > ?)`)
    .bind(now, now, now, now).run();
}

export async function applyScheduledClosing(db: D1Database, now = Date.now()) {
  await db.prepare(`UPDATE event_settings SET status = 'closed', station_controls_locked = 1,
    event_closed_at = ?, updated_at = ?, updated_by = 'system'
    WHERE id = 1 AND event_end_at IS NOT NULL AND event_closed_at IS NULL
      AND event_end_at <= ?`).bind(now, now, now).run();
}

export async function applyEventSchedule(db: D1Database, now = Date.now()) {
  // Closing wins when both deadlines have passed. Opening also checks the end
  // time, so a delayed request can never open an event that has already ended.
  await applyScheduledClosing(db, now);
  await applyScheduledOpening(db, now);
}
