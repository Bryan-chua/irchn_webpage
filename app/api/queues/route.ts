import { ensureDatabase, publicQueue } from '@/lib/db';
import { isHouseCode } from '@/lib/houses';

function createQueueNumber(houseCode: string) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return `${houseCode}-${String(values[0] % 10000).padStart(4, '0')}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { houseCode?: string; nickname?: string; groupSize?: number } | null;
  const houseCode = body?.houseCode?.toUpperCase() || '';
  const nickname = body?.nickname?.trim().replace(/\s+/g, ' ') || '';
  const groupSize = Number(body?.groupSize);
  if (!isHouseCode(houseCode)) return Response.json({ error: 'Choose a valid haunted house.' }, { status: 400 });
  if (nickname.length < 2 || nickname.length > 30) return Response.json({ error: 'Use a team nickname between 2 and 30 characters.' }, { status: 400 });
  if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 8) return Response.json({ error: 'Group size must be between 1 and 8.' }, { status: 400 });

  const db = await ensureDatabase();
  const setting = await db.prepare('SELECT status FROM house_settings WHERE house_code = ?').bind(houseCode).first<{ status: string }>();
  if (setting?.status !== 'open') return Response.json({ error: `This queue is currently ${setting?.status || 'closed'}.` }, { status: 409 });

  for (let attempt = 0; attempt < 8; attempt++) {
    const queueNumber = createQueueNumber(houseCode);
    try {
      const result = await db.prepare(`INSERT INTO queue_entries
        (queue_number, house_code, nickname, group_size, status, joined_at)
        VALUES (?, ?, ?, ?, 'waiting', ?)`).bind(queueNumber, houseCode, nickname, groupSize, Date.now()).run();
      const id = Number(result.meta.last_row_id);
      const ahead = await db.prepare(`SELECT COUNT(*) AS count FROM queue_entries
        WHERE house_code = ? AND status = 'waiting' AND id < ?`).bind(houseCode, id).first<{ count: number }>();
      const ticket = publicQueue({ queue_number: queueNumber, house_code: houseCode, group_size: groupSize, status: 'waiting', joined_at: Date.now() }, Number(ahead?.count || 0));
      return Response.json({ ticket: { ...ticket, nickname } }, { status: 201 });
    } catch (error) {
      if (attempt === 7) throw error;
    }
  }
  return Response.json({ error: 'Could not create a unique queue number.' }, { status: 500 });
}
