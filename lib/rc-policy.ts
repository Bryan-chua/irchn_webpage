import { getDb } from './db';
import { applyEventSchedule } from './event-schedule';

export const RC_CUTOFF_MESSAGE = 'Queues are now reserved for each RC’s own residents. You can only join your own RC’s haunted house.';

export function validDeviceToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function tokenHash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Run before queue reads and actions so positions, backups and station actions all
// see the same expired tickets. SQL triggers also guard writes at the boundary.
export async function clearOutsideRcTickets(db = getDb()) {
  await db.prepare(`UPDATE queue_entries SET status = 'cancelled',
    completed_at = (SELECT home_rc_only_at FROM event_settings WHERE id = 1),
    cancellation_reason = 'rc_cutoff'
    WHERE status IN ('waiting', 'skipped') AND (home_rc IS NULL OR home_rc <> house_code)
      AND EXISTS (SELECT 1 FROM event_settings WHERE id = 1
        AND home_rc_only_at IS NOT NULL AND home_rc_only_at <= ?)`).bind(Date.now()).run();
}

export async function getQueueDb() {
  const db = getDb();
  await applyEventSchedule(db);
  await clearOutsideRcTickets(db);
  return db;
}
