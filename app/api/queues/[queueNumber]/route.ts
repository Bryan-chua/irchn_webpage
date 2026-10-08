import { cleanQueueNumber, getDb, publicQueue, temporarilyUnavailable } from '@/lib/db';
import { recordSiteError } from '@/lib/operations';

type QueueRow = Record<string, unknown> & {
  groups_ahead: number;
  last_entered_at: number | null;
};

export async function GET(_request: Request, context: { params: Promise<{ queueNumber: string }> }) {
  const { queueNumber: raw } = await context.params;
  const queueNumber = cleanQueueNumber(decodeURIComponent(raw));

  try {
    const db = getDb();
    const entry = await db.prepare(`SELECT q.*, hs.last_entered_at,
      CASE WHEN q.status = 'waiting' THEN (
        SELECT COUNT(*) FROM queue_entries ahead
        WHERE ahead.house_code = q.house_code
          AND ahead.status = 'waiting'
          AND ahead.id < q.id
      ) ELSE 0 END AS groups_ahead
      FROM queue_entries q
      JOIN house_settings hs ON hs.house_code = q.house_code
      WHERE q.queue_number = ?
      LIMIT 1`).bind(queueNumber).first<QueueRow>();
    if (!entry) {
      return Response.json(
        { error: 'Queue number not found. Check your screenshot and try again.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json(
      { ticket: publicQueue(entry, Number(entry.groups_ahead || 0), entry.last_entered_at) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    await recordSiteError('ticket_status', error);
    return temporarilyUnavailable(error);
  }
}
