import { getDb, temporarilyUnavailable } from '@/lib/db';
import { HOUSES, isHouseCode, type HouseCode } from '@/lib/houses';
import { isOverallModerator } from '@/lib/moderator-auth';
import { raiseAlert, recordActivity, recordSiteError, resolveAlert } from '@/lib/operations';
import { estimatedClearSeconds } from '@/lib/queue';

type HouseRow = {
  house_code: HouseCode;
  status: string;
  last_entered_at: number | null;
  waiting_count: number;
  skipped_count: number;
  entered_groups: number;
  entered_participants: number;
};

type EventSetting = {
  status: string;
  stationControlsLocked: number;
  eventEndAt: number | null;
  updatedAt: number;
  updatedBy: string;
};

type PresenceRow = { houseCode: HouseCode; lastSeenAt: number; lastLoginAt: number };
type ActiveAlertRow = { eventType: string; houseCode: string };
const STATION_INACTIVE_MS = 3 * 60 * 1000;
const SKIPPED_GROUP_ALERT_COUNT = 5;

async function syncConditionAlert(active: boolean, details: Parameters<typeof raiseAlert>[0], activeAlerts: Set<string>, db: D1Database) {
  const houseCode = details.houseCode || 'ALL';
  const key = `${details.eventType}:${houseCode}`;
  if (active === activeAlerts.has(key)) return;
  if (active) await raiseAlert(details, db, false);
  else await resolveAlert(details.eventType, houseCode, db);
}

export async function GET(request: Request) {
  if (!await isOverallModerator(request)) return Response.json({ error: 'Overall moderator access required.' }, { status: 401 });
  const db = getDb();
  try {
    const [setting, rows, presenceRows, activeAlertRows] = await Promise.all([
      db.prepare(`SELECT status, station_controls_locked AS stationControlsLocked,
        event_end_at AS eventEndAt, updated_at AS updatedAt, updated_by AS updatedBy
        FROM event_settings WHERE id = 1`).first<EventSetting>(),
      db.prepare(`SELECT hs.house_code, hs.status, hs.last_entered_at,
        SUM(CASE WHEN q.status = 'waiting' THEN 1 ELSE 0 END) AS waiting_count,
        SUM(CASE WHEN q.status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count,
        SUM(CASE WHEN q.status = 'entered' THEN 1 ELSE 0 END) AS entered_groups,
        SUM(CASE WHEN q.status = 'entered' THEN q.group_size ELSE 0 END) AS entered_participants
        FROM house_settings hs
        LEFT JOIN queue_entries q ON q.house_code = hs.house_code
        GROUP BY hs.house_code, hs.status, hs.last_entered_at`).all<HouseRow>(),
      db.prepare(`SELECT house_code AS houseCode, last_seen_at AS lastSeenAt,
        last_login_at AS lastLoginAt FROM station_presence`).all<PresenceRow>(),
      db.prepare(`SELECT event_type AS eventType, house_code AS houseCode FROM operational_events
        WHERE category = 'alert' AND resolved_at IS NULL
          AND event_type IN ('queue_significantly_delayed', 'skipped_groups_high')`).all<ActiveAlertRow>(),
    ]);
    const now = Date.now();
    const currentSetting = setting || { status: 'open', stationControlsLocked: 0, eventEndAt: null, updatedAt: 0, updatedBy: 'system' };
    const rowByCode = new Map(rows.results.map((row) => [row.house_code, row]));
    const presenceByCode = new Map(presenceRows.results.map((presence) => [presence.houseCode, presence]));
    const activeConditionAlerts = new Set(activeAlertRows.results.map((alert) => `${alert.eventType}:${alert.houseCode}`));
    const houses = HOUSES.map((house) => {
      const row = rowByCode.get(house.code);
      const presence = presenceByCode.get(house.code);
      const waitingCount = Number(row?.waiting_count || 0);
      const skippedCount = Number(row?.skipped_count || 0);
      const estimatedSeconds = estimatedClearSeconds(house.code, waitingCount, Number(row?.last_entered_at) || null, now);
      const isDelayed = waitingCount > 0 && estimatedSeconds === 0;
      const projectedClearAt = isDelayed ? null : waitingCount > 0 ? now + estimatedSeconds * 1000 : now;
      const closingMarginMinutes = currentSetting.eventEndAt && projectedClearAt
        ? Math.floor((currentSetting.eventEndAt - projectedClearAt) / 60000)
        : null;
      const stationActivityBaseline = presence?.lastSeenAt || currentSetting.updatedAt || now;
      return {
        ...house,
        status: row?.status || 'closed',
        waitingCount,
        skippedCount,
        enteredGroups: Number(row?.entered_groups || 0),
        enteredParticipants: Number(row?.entered_participants || 0),
        estimatedMinutes: Math.ceil(estimatedSeconds / 60),
        isDelayed,
        projectedClearAt,
        closingMarginMinutes,
        lastEnteredAt: Number(row?.last_entered_at) || null,
        lastSeenAt: presence?.lastSeenAt || null,
        lastLoginAt: presence?.lastLoginAt || null,
        stationInactive: currentSetting.status === 'open' && now - stationActivityBaseline > STATION_INACTIVE_MS,
      };
    });

    await Promise.all(houses.flatMap((house) => [
      syncConditionAlert(house.isDelayed, {
        eventType: 'queue_significantly_delayed', houseCode: house.code, severity: 'warning',
        message: `${house.name} still has ${house.waitingCount} waiting ${house.waitingCount === 1 ? 'group' : 'groups'} after its projected clear time.`,
      }, activeConditionAlerts, db),
      syncConditionAlert(house.skippedCount >= SKIPPED_GROUP_ALERT_COUNT, {
        eventType: 'skipped_groups_high', houseCode: house.code, severity: 'warning',
        message: `${house.name} has ${house.skippedCount} skipped groups requiring attention.`,
      }, activeConditionAlerts, db),
    ]));

    const events = await db.prepare(`SELECT id, category, event_type AS eventType, severity,
      house_code AS houseCode, actor, message, count, occurred_at AS occurredAt,
      last_occurred_at AS lastOccurredAt, acknowledged_at AS acknowledgedAt,
      acknowledged_by AS acknowledgedBy, resolved_at AS resolvedAt
      FROM operational_events ORDER BY last_occurred_at DESC LIMIT 120`).all();
    return Response.json({
      event: {
        status: currentSetting.status,
        stationControlsLocked: Boolean(currentSetting.stationControlsLocked),
        eventEndAt: currentSetting.eventEndAt,
        updatedAt: currentSetting.updatedAt,
        updatedBy: currentSetting.updatedBy,
      },
      houses,
      events: events.results,
      generatedAt: now,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await recordSiteError('overall_dashboard_load', error);
    return temporarilyUnavailable(error);
  }
}

export async function PATCH(request: Request) {
  if (!await isOverallModerator(request)) return Response.json({ error: 'Overall moderator access required.' }, { status: 401 });
  const body = await request.json().catch(() => null) as {
    globalStatus?: string;
    houseCode?: string;
    houseStatus?: string;
    eventEndAt?: number | null;
    acknowledgeEventId?: number;
  } | null;
  const db = getDb();
  const now = Date.now();
  try {
    if (body?.globalStatus) {
      if (!['open', 'paused', 'closed'].includes(body.globalStatus)) return Response.json({ error: 'Invalid global event status.' }, { status: 400 });
      const locked = body.globalStatus !== 'open';
      await db.batch([
        db.prepare(`INSERT INTO event_settings (id, status, station_controls_locked, updated_at, updated_by)
          VALUES (1, ?, ?, ?, 'Bryan')
          ON CONFLICT(id) DO UPDATE SET status = excluded.status,
            station_controls_locked = excluded.station_controls_locked,
            updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
          .bind(body.globalStatus, locked ? 1 : 0, now),
        db.prepare('UPDATE house_settings SET status = ?').bind(body.globalStatus),
      ]);
      await recordActivity({
        eventType: 'global_status_changed', actor: 'Bryan',
        message: `Bryan changed every house to ${body.globalStatus} and ${locked ? 'locked' : 'unlocked'} station status controls.`,
      }, db);
      return Response.json({ ok: true });
    }

    if (body?.houseCode || body?.houseStatus) {
      const houseCode = body.houseCode?.toUpperCase() || '';
      if (!isHouseCode(houseCode) || !body.houseStatus || !['open', 'paused', 'closed'].includes(body.houseStatus)) {
        return Response.json({ error: 'Choose a valid house and status.' }, { status: 400 });
      }
      const setting = await db.prepare('SELECT station_controls_locked FROM event_settings WHERE id = 1').first<{ station_controls_locked: number }>();
      if (setting?.station_controls_locked) return Response.json({ error: 'Open and unlock the event before changing an individual house.' }, { status: 423 });
      await db.prepare('UPDATE house_settings SET status = ? WHERE house_code = ?').bind(body.houseStatus, houseCode).run();
      await recordActivity({ eventType: 'house_status_changed', houseCode, actor: 'Bryan', message: `Bryan changed ${houseCode} to ${body.houseStatus}.` }, db);
      return Response.json({ ok: true });
    }

    if (Object.prototype.hasOwnProperty.call(body || {}, 'eventEndAt')) {
      const eventEndAt = body?.eventEndAt === null ? null : Number(body?.eventEndAt);
      if (eventEndAt !== null && (!Number.isFinite(eventEndAt) || eventEndAt < now - 24 * 60 * 60 * 1000)) {
        return Response.json({ error: 'Choose a valid event closing time.' }, { status: 400 });
      }
      await db.prepare(`INSERT INTO event_settings (id, status, station_controls_locked, event_end_at, updated_at, updated_by)
        VALUES (1, 'open', false, ?, ?, 'Bryan')
        ON CONFLICT(id) DO UPDATE SET event_end_at = excluded.event_end_at,
          updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .bind(eventEndAt, now).run();
      await recordActivity({ eventType: 'event_closing_time_changed', actor: 'Bryan', message: eventEndAt ? `Bryan set the event closing time to ${new Date(eventEndAt).toISOString()}.` : 'Bryan cleared the event closing time.' }, db);
      return Response.json({ ok: true });
    }

    if (Number.isInteger(body?.acknowledgeEventId)) {
      const result = await db.prepare(`UPDATE operational_events
        SET acknowledged_at = ?, acknowledged_by = 'Bryan' WHERE id = ? AND category = 'alert'`)
        .bind(now, body?.acknowledgeEventId).run();
      if (!result.meta.changes) return Response.json({ error: 'Alert not found.' }, { status: 404 });
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'Choose an overall dashboard action.' }, { status: 400 });
  } catch (error) {
    await recordSiteError('overall_dashboard_action', error);
    return temporarilyUnavailable(error);
  }
}
