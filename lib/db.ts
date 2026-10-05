import { env } from 'cloudflare:workers';
import type { HouseCode } from './houses';
import { estimatedWaitSeconds } from './queue';

export type QueueStatus = 'waiting' | 'entered' | 'skipped' | 'cancelled';

export function getDb(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}

export function cleanQueueNumber(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function publicQueue(entry: Record<string, unknown>, groupsAhead: number, lastEnteredAt?: number | null) {
  const estimatedSeconds = entry.status === 'waiting'
    ? estimatedWaitSeconds(entry.house_code as HouseCode, groupsAhead, lastEnteredAt)
    : 0;
  return {
    queueNumber: entry.queue_number,
    houseCode: entry.house_code,
    groupSize: entry.group_size,
    status: entry.status,
    joinedAt: entry.joined_at,
    groupsAhead,
    estimatedSeconds,
    estimatedMinutes: Math.ceil(estimatedSeconds / 60),
  };
}

export function temporarilyUnavailable(error: unknown) {
  console.error('Queue database request failed.', error);
  return Response.json(
    { error: 'The queue is temporarily busy. Please try again shortly.' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' } },
  );
}
