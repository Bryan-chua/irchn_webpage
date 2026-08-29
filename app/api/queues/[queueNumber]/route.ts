import { cleanQueueNumber, ensureDatabase, publicQueue } from '@/lib/db';

export async function GET(_request: Request, context: { params: Promise<{ queueNumber: string }> }) {
  const { queueNumber: raw } = await context.params;
  const queueNumber = cleanQueueNumber(decodeURIComponent(raw));
  const db = await ensureDatabase();
  const entry = await db.prepare('SELECT * FROM queue_entries WHERE queue_number = ?').bind(queueNumber).first<Record<string, unknown>>();
  if (!entry) return Response.json({ error: 'Queue number not found. Check your screenshot and try again.' }, { status: 404 });
  let groupsAhead = 0;
  if (entry.status === 'waiting') {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM queue_entries
      WHERE house_code = ? AND status = 'waiting' AND id < ?`).bind(entry.house_code, entry.id).first<{ count: number }>();
    groupsAhead = Number(row?.count || 0);
  }
  return Response.json({ ticket: publicQueue(entry, groupsAhead) }, { headers: { 'Cache-Control': 'no-store' } });
}
