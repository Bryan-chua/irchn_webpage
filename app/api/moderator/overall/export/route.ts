import { getDb, temporarilyUnavailable } from '@/lib/db';
import { HOUSES, type HouseCode } from '@/lib/houses';
import { isOverallModerator } from '@/lib/moderator-auth';
import { recordSiteError } from '@/lib/operations';

type ParticipantRow = { house_code: HouseCode; participants: number };
type IssueRow = {
  houseCode: string;
  severity: string;
  eventType: string;
  message: string;
  count: number;
  occurredAt: number;
  lastOccurredAt: number;
  acknowledgedAt: number | null;
  resolvedAt: number | null;
};

function csvValue(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isoTime(value: number | null) {
  return value ? new Date(value).toISOString() : '';
}

export async function GET(request: Request) {
  if (!await isOverallModerator(request)) return Response.json({ error: 'Overall moderator access required.' }, { status: 401 });
  const db = getDb();
  try {
    const [participantRows, issueRows] = await Promise.all([
      db.prepare(`SELECT house_code, COALESCE(SUM(group_size), 0) AS participants
        FROM queue_entries WHERE status = 'entered' GROUP BY house_code`).all<ParticipantRow>(),
      db.prepare(`SELECT house_code AS houseCode, severity, event_type AS eventType,
        message, count, occurred_at AS occurredAt, last_occurred_at AS lastOccurredAt,
        acknowledged_at AS acknowledgedAt, resolved_at AS resolvedAt
        FROM operational_events WHERE category = 'alert'
        ORDER BY last_occurred_at ASC`).all<IssueRow>(),
    ]);
    const participantsByHouse = new Map(participantRows.results.map((row) => [row.house_code, Number(row.participants || 0)]));
    const header = ['record_type', 'house', 'total_participants_entered', 'severity', 'event_type', 'description', 'count', 'first_occurred_at', 'last_occurred_at', 'acknowledged_at', 'resolved_at'];
    const rows: unknown[][] = [header];
    for (const house of HOUSES) {
      rows.push(['participant_summary', house.name, participantsByHouse.get(house.code) || 0, '', '', '', '', '', '', '', '']);
    }
    for (const issue of issueRows.results) {
      const house = HOUSES.find((candidate) => candidate.code === issue.houseCode);
      rows.push([
        'site_issue', house?.name || issue.houseCode, '', issue.severity, issue.eventType,
        issue.message, issue.count, isoTime(issue.occurredAt), isoTime(issue.lastOccurredAt),
        isoTime(issue.acknowledgedAt), isoTime(issue.resolvedAt),
      ]);
    }
    const csv = rows.map((row) => row.map(csvValue).join(',')).join('\r\n');
    const date = new Date().toISOString().slice(0, 10);
    return new Response(`\uFEFF${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="haunted-house-event-report-${date}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    await recordSiteError('overall_csv_export', error);
    return temporarilyUnavailable(error);
  }
}
