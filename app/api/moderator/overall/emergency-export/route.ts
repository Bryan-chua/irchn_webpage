import { getDb, temporarilyUnavailable } from '@/lib/db';
import { HOUSES, type HouseCode } from '@/lib/houses';
import { isOverallModerator } from '@/lib/moderator-auth';
import { recordActivity, recordSiteError } from '@/lib/operations';

type ActiveQueueRow = {
  houseCode: HouseCode;
  queueNumber: string;
  nickname: string;
  groupSize: number;
  status: string;
  joinedAt: number;
};

function csvValue(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function singaporeDate(timestamp: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function GET(request: Request) {
  if (!await isOverallModerator(request)) return Response.json({ error: 'Overall moderator access required.' }, { status: 401 });
  const db = getDb();
  try {
    const result = await db.prepare(`SELECT house_code AS houseCode, queue_number AS queueNumber,
      nickname, group_size AS groupSize, status, joined_at AS joinedAt
      FROM queue_entries
      WHERE status IN ('waiting', 'skipped')
      ORDER BY CASE house_code
        WHEN 'RV' THEN 1 WHEN 'CP' THEN 2 WHEN 'AC' THEN 3
        WHEN 'TM' THEN 4 WHEN 'R4' THEN 5 WHEN 'NS' THEN 6 ELSE 7 END,
        CASE status WHEN 'waiting' THEN 0 ELSE 1 END, joined_at ASC, id ASC`).all<ActiveQueueRow>();
    const exportedAt = Date.now();
    const orderByHouse = new Map<HouseCode, number>();
    const header = ['house', 'queue_order', 'queue_number', 'team_nickname', 'pax', 'status', 'joined_at', 'exported_at', 'entered', 'skipped', 'processed_at', 'notes'];
    const rows: unknown[][] = [header];
    for (const entry of result.results) {
      const queueOrder = (orderByHouse.get(entry.houseCode) || 0) + 1;
      orderByHouse.set(entry.houseCode, queueOrder);
      const house = HOUSES.find((candidate) => candidate.code === entry.houseCode);
      rows.push([
        house?.name || entry.houseCode, queueOrder, entry.queueNumber, entry.nickname,
        entry.groupSize, entry.status, new Date(entry.joinedAt).toISOString(),
        new Date(exportedAt).toISOString(), '', '', '', '',
      ]);
    }
    try {
      await recordActivity({
        eventType: 'emergency_queue_exported', actor: 'Bryan',
        message: `Bryan downloaded an emergency backup containing ${result.results.length} active queue entries.`,
      }, db);
    } catch (error) {
      console.warn('Could not record the emergency queue export.', error);
    }
    const csv = rows.map((row) => row.map(csvValue).join(',')).join('\r\n');
    return new Response(`\uFEFF${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="all-house-emergency-queues-${singaporeDate(exportedAt)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    await recordSiteError('overall_emergency_queue_export', error);
    return temporarilyUnavailable(error);
  }
}
