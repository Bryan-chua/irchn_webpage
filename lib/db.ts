import { env } from 'cloudflare:workers';
import { HOUSES } from './houses';

export type QueueStatus = 'waiting' | 'entered' | 'skipped' | 'cancelled';

export function getDb(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}

export async function ensureDatabase() {
  const db = getDb();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS queue_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_number TEXT NOT NULL UNIQUE,
      house_code TEXT NOT NULL,
      nickname TEXT NOT NULL,
      group_size INTEGER NOT NULL CHECK(group_size BETWEEN 1 AND 8),
      status TEXT NOT NULL DEFAULT 'waiting',
      joined_at INTEGER NOT NULL,
      completed_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS house_settings (
      house_code TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'open'
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_queue_house_status_joined
      ON queue_entries(house_code, status, joined_at)`),
    ...HOUSES.map((house) => db.prepare('INSERT OR IGNORE INTO house_settings (house_code, status) VALUES (?, ?)').bind(house.code, 'open')),
  ]);
  return db;
}

export function cleanQueueNumber(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function publicQueue(entry: Record<string, unknown>, groupsAhead: number) {
  return {
    queueNumber: entry.queue_number,
    houseCode: entry.house_code,
    groupSize: entry.group_size,
    status: entry.status,
    joinedAt: entry.joined_at,
    groupsAhead,
    estimatedMinutes: groupsAhead * 2,
  };
}
