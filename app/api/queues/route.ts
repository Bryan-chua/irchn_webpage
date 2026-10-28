import { getQueueDb, tokenHash, RC_CUTOFF_MESSAGE } from '@/lib/rc-policy';
import { env } from 'cloudflare:workers';
import { publicQueue, temporarilyUnavailable } from '@/lib/db';
import { isHouseCode, MIN_GROUP_SIZE, MAX_GROUP_SIZE } from '@/lib/houses';
import { raiseAlert, recordSiteError } from '@/lib/operations';

type JoinBody = { houseCode?: string; nickname?: string; groupSize?: number; joinKey?: string; deviceToken?: string };
type QueueRow = Record<string, unknown> & {
  groups_ahead: number;
  last_entered_at: number | null;
  first_waiting_at: number | null;
};

type JoinContext = QueueRow & {
  house_status: string;
};

function createQueueNumber(houseCode: string) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return `${houseCode}-${String(values[0] % 10000).padStart(4, '0')}`;
}

function validJoinKey(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function observeJoinRateLimit() {
  try {
    const limiter = (env as unknown as { JOIN_RATE_LIMITER?: RateLimit }).JOIN_RATE_LIMITER;
    if (!limiter) {
      console.warn('JOIN_RATE_LIMITER binding is unavailable; continuing in observation mode.');
      return;
    }
    const { success } = await limiter.limit({ key: 'queue-joins' });
    if (!success) {
      console.warn('Observed join traffic above 2,000 requests per minute.', {
        event: 'join_rate_limit_observed',
        mode: 'observe',
      });
      await raiseAlert({
        eventType: 'join_traffic_high',
        actor: 'system',
        severity: 'warning',
        message: 'Queue join traffic exceeded 2,000 requests in one minute.',
      });
    }
  } catch (error) {
    console.warn('Join rate-limit observation failed; allowing the request.', error);
  }
}

async function existingJoin(db: D1Database, joinKey: string, houseCode: string) {
  return db.prepare(`SELECT q.*, hs.last_entered_at,
    CASE WHEN q.status = 'waiting' THEN (
      SELECT COUNT(*) FROM queue_entries ahead
      WHERE ahead.house_code = q.house_code
        AND ahead.status = 'waiting'
        AND ahead.id < q.id
    ) ELSE 0 END AS groups_ahead,
    CASE WHEN q.status = 'waiting' THEN (
      SELECT MIN(ahead.joined_at) FROM queue_entries ahead
      WHERE ahead.house_code = q.house_code
        AND ahead.status = 'waiting'
        AND ahead.id < q.id
    ) ELSE NULL END AS first_waiting_at
    FROM queue_entries q
    JOIN house_settings hs ON hs.house_code = q.house_code
    WHERE q.join_key = ? AND q.house_code = ?
    LIMIT 1`).bind(joinKey, houseCode).first<QueueRow>();
}

async function existingDeviceJoin(db: D1Database, houseCode: string, deviceTokenHash: string) {
  return db.prepare(`SELECT q.*, hs.last_entered_at,
    CASE WHEN q.status = 'waiting' THEN (
      SELECT COUNT(*) FROM queue_entries ahead
      WHERE ahead.house_code = q.house_code
        AND ahead.status = 'waiting'
        AND ahead.id < q.id
    ) ELSE 0 END AS groups_ahead,
    CASE WHEN q.status = 'waiting' THEN (
      SELECT MIN(ahead.joined_at) FROM queue_entries ahead
      WHERE ahead.house_code = q.house_code
        AND ahead.status = 'waiting'
        AND ahead.id < q.id
    ) ELSE NULL END AS first_waiting_at
    FROM queue_entries q
    JOIN house_settings hs ON hs.house_code = q.house_code
    WHERE q.house_code = ?
      AND q.device_token_hash = ?
      AND q.status IN ('waiting', 'skipped')
    ORDER BY q.id DESC
    LIMIT 1`).bind(houseCode, deviceTokenHash).first<QueueRow>();
}

async function getJoinContext(db: D1Database, joinKey: string, houseCode: string) {
  return db.prepare(`SELECT q.*, hs.status AS house_status, hs.last_entered_at,
    CASE WHEN q.status = 'waiting' THEN (
      SELECT COUNT(*) FROM queue_entries ahead
      WHERE ahead.house_code = q.house_code
        AND ahead.status = 'waiting'
        AND ahead.id < q.id
    ) ELSE 0 END AS groups_ahead,
    CASE WHEN q.status = 'waiting' THEN (
      SELECT MIN(ahead.joined_at) FROM queue_entries ahead
      WHERE ahead.house_code = q.house_code
        AND ahead.status = 'waiting'
        AND ahead.id < q.id
    ) ELSE NULL END AS first_waiting_at
    FROM house_settings hs
    LEFT JOIN queue_entries q ON q.join_key = ? AND q.house_code = hs.house_code
    WHERE hs.house_code = ?
    LIMIT 1`).bind(joinKey, houseCode).first<JoinContext>();
}

function ticketResponse(entry: QueueRow, status = 200, existing = false) {
  const ticket = publicQueue(entry, Number(entry.groups_ahead || 0), entry.last_entered_at, entry.first_waiting_at);
  return Response.json({ ticket: { ...ticket, nickname: entry.nickname }, existing }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request) {
  await observeJoinRateLimit();
  const body = await request.json().catch(() => null) as JoinBody | null;
  const joinKey = typeof body?.joinKey === 'string' ? body.joinKey.trim() : '';
  if (!validJoinKey(joinKey)) {
    return Response.json({ error: 'A valid join request key is required.' }, { status: 400 });
  }
  const deviceToken = typeof body?.deviceToken === 'string' ? body.deviceToken.trim() : '';
  if (!validJoinKey(deviceToken)) {
    return Response.json({ error: 'A valid anonymous device token is required.' }, { status: 400 });
  }

  try {
    const db = await getQueueDb();
    const houseCode = typeof body?.houseCode === 'string' ? body.houseCode.toUpperCase() : '';
    const nickname = typeof body?.nickname === 'string' ? body.nickname.trim().replace(/\s+/g, ' ') : '';
    const groupSize = Number(body?.groupSize);
    const deviceTokenHash = await tokenHash(deviceToken);
    if (!isHouseCode(houseCode)) return Response.json({ error: 'Choose a valid haunted house.' }, { status: 400 });
    if (nickname.length < 2 || nickname.length > 30) return Response.json({ error: 'Use a team nickname between 2 and 30 characters.' }, { status: 400 });
    const minGroupSize = MIN_GROUP_SIZE[houseCode];
    const maxGroupSize = MAX_GROUP_SIZE[houseCode];
    if (!Number.isInteger(groupSize) || groupSize < minGroupSize || groupSize > maxGroupSize) return Response.json({ error: `Group size must be between ${minGroupSize} and ${maxGroupSize} for this house.` }, { status: 400 });

    const profile = await db.prepare('SELECT home_rc AS homeRc FROM participant_devices WHERE device_token_hash = ?').bind(deviceTokenHash).first<{ homeRc: string }>();
    if (!profile) return Response.json({ error: 'Please select your home RC before joining a queue.' }, { status: 400 });
    const policy = await db.prepare('SELECT home_rc_only_at AS cutoff FROM event_settings WHERE id = 1').first<{ cutoff: number | null }>();
    if (policy?.cutoff != null && Date.now() >= policy.cutoff && profile.homeRc !== houseCode) {
      return Response.json({ error: RC_CUTOFF_MESSAGE }, { status: 403 });
    }
    const context = await getJoinContext(db, joinKey, houseCode);
    if (context?.queue_number) return ticketResponse(context);
    const activeDeviceTicket = await existingDeviceJoin(db, houseCode, deviceTokenHash);
    if (activeDeviceTicket) return ticketResponse(activeDeviceTicket, 200, true);
    if (context?.house_status !== 'open') {
      return Response.json({ error: `This queue is currently ${context?.house_status || 'closed'}.` }, { status: 409 });
    }

    for (let attempt = 0; attempt < 8; attempt++) {
      const queueNumber = createQueueNumber(houseCode);
      const joinedAt = Date.now();
      try {
        const result = await db.prepare(`INSERT INTO queue_entries
          (queue_number, join_key, device_token_hash, home_rc, house_code, nickname, group_size, status, joined_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, 'waiting', ?
          WHERE EXISTS (SELECT 1 FROM house_settings WHERE house_code = ? AND status = 'open')
            AND NOT EXISTS (SELECT 1 FROM event_settings WHERE id = 1 AND event_closed_at IS NULL
              AND event_end_at <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))`).bind(queueNumber, joinKey, deviceTokenHash, profile.homeRc, houseCode, nickname, groupSize, joinedAt, houseCode).run();
        if (!result.meta.changes) return Response.json({ error: 'This queue has just closed or paused. Please choose another open queue.' }, { status: 409 });
        const id = Number(result.meta.last_row_id);
        const ahead = await db.prepare(`SELECT COUNT(*) AS count, MIN(joined_at) AS first_waiting_at FROM queue_entries
          WHERE house_code = ? AND status = 'waiting' AND id < ?`).bind(houseCode, id).first<{ count: number; first_waiting_at: number | null }>();
        return ticketResponse({
          queue_number: queueNumber,
          join_key: joinKey,
          house_code: houseCode,
          nickname,
          group_size: groupSize,
          status: 'waiting',
          joined_at: joinedAt,
          groups_ahead: Number(ahead?.count || 0),
          last_entered_at: context.last_entered_at,
          first_waiting_at: Number(ahead?.first_waiting_at) || null,
        }, 201);
      } catch (error) {
        if (String(error).includes('rc_cutoff')) return Response.json({ error: RC_CUTOFF_MESSAGE }, { status: 403 });
        const duplicateJoin = await existingJoin(db, joinKey, houseCode);
        if (duplicateJoin) return ticketResponse(duplicateJoin);
        const duplicateDeviceTicket = await existingDeviceJoin(db, houseCode, deviceTokenHash);
        if (duplicateDeviceTicket) return ticketResponse(duplicateDeviceTicket, 200, true);
        if (String(error).includes('queue_entries.join_key')) {
          return Response.json({ error: 'This join request key was already used for another house. Please try again.' }, { status: 409 });
        }
        if (attempt < 7 && String(error).includes('queue_entries.queue_number')) continue;
        throw error;
      }
    }
    return temporarilyUnavailable(new Error('Could not allocate a unique queue number.'));
  } catch (error) {
    await recordSiteError('queue_join', error);
    return temporarilyUnavailable(error);
  }
}
