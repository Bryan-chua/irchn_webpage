import { getDb, temporarilyUnavailable } from '@/lib/db';
import { HOUSES, type HouseCode } from '@/lib/houses';
import { estimatedClearSeconds } from '@/lib/queue';

type HouseRow = {
  house_code: HouseCode;
  status: string;
  last_entered_at: number | null;
  waiting_count: number;
};

const CACHE_SECONDS = 3;

export async function GET(request: Request) {
  const cacheKey = new Request(new URL('/api/houses?summary=v2', request.url), { method: 'GET' });
  const edgeCache = (caches as unknown as { default: Cache }).default;

  try {
    try {
      const cached = await edgeCache.match(cacheKey);
      if (cached) return new Response(cached.body, cached);
    } catch (error) {
      console.warn('House summary cache read failed; using D1.', error);
    }

    const db = getDb();
    const rows = await db.prepare(`SELECT hs.house_code, hs.status, hs.last_entered_at,
      COUNT(q.id) AS waiting_count
      FROM house_settings hs
      LEFT JOIN queue_entries q ON q.house_code = hs.house_code AND q.status = 'waiting'
      GROUP BY hs.house_code, hs.status, hs.last_entered_at`).all<HouseRow>();
    const rowByCode = new Map(rows.results.map((row) => [row.house_code, row]));
    const houses = HOUSES.map((house) => {
      const row = rowByCode.get(house.code);
      const waitingCount = Number(row?.waiting_count || 0);
      const estimatedSeconds = estimatedClearSeconds(house.code, waitingCount, Number(row?.last_entered_at) || null);
      return {
        ...house,
        status: row?.status || 'closed',
        waitingCount,
        estimatedMinutes: Math.ceil(estimatedSeconds / 60),
      };
    });
    const response = Response.json({ houses }, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    });
    try {
      await edgeCache.put(cacheKey, response.clone());
    } catch (error) {
      console.warn('House summary cache write failed; returning uncached data.', error);
    }
    return response;
  } catch (error) {
    return temporarilyUnavailable(error);
  }
}
