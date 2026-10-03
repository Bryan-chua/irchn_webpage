import { ensureDatabase } from '@/lib/db';
import { HOUSES } from '@/lib/houses';
import { MINUTES_PER_GROUP } from '@/lib/queue';

export async function GET() {
  const db = await ensureDatabase();
  const summaries = await Promise.all(HOUSES.map(async (house) => {
    const row = await db.prepare(`SELECT hs.status,
      COUNT(q.id) AS waiting_count,
      MIN(q.queue_number) AS first_number
      FROM house_settings hs
      LEFT JOIN queue_entries q ON q.house_code = hs.house_code AND q.status = 'waiting'
      WHERE hs.house_code = ? GROUP BY hs.house_code, hs.status`).bind(house.code).first<Record<string, unknown>>();
    const waitingCount = Number(row?.waiting_count || 0);
    return { ...house, status: row?.status || 'open', waitingCount, estimatedMinutes: waitingCount * MINUTES_PER_GROUP, currentlyServing: row?.first_number || null };
  }));
  return Response.json({ houses: summaries }, { headers: { 'Cache-Control': 'no-store' } });
}
