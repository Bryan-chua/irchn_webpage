import { HOUSES } from './houses';

export type HomeRcStats = {
  code: string;
  name: string;
  estimatedParticipants: number;
  admissions: number;
};

type StatsRow = { home_rc: string; estimated_participants: number; admissions: number };

export async function getHomeRcStats(db: D1Database): Promise<HomeRcStats[]> {
  // One anonymous browser represents one group. Its largest recorded group size
  // estimates its participants across repeated visits. Legacy tickets without a
  // device token must each count as a separate group.
  const codes = HOUSES.map((house) => `'${house.code}'`).join(',');
  const rows = await db.prepare(`SELECT home_rc,
    SUM(participant_estimate) AS estimated_participants, SUM(admissions) AS admissions
    FROM (
      SELECT CASE WHEN home_rc IN (${codes}) THEN home_rc ELSE 'UNKNOWN' END AS home_rc,
        COALESCE(NULLIF(device_token_hash, ''), 'legacy-ticket:' || id) AS group_identity,
        MAX(group_size) AS participant_estimate,
        SUM(CASE WHEN status = 'entered' THEN group_size ELSE 0 END) AS admissions
      FROM queue_entries
      GROUP BY CASE WHEN home_rc IN (${codes}) THEN home_rc ELSE 'UNKNOWN' END,
        COALESCE(NULLIF(device_token_hash, ''), 'legacy-ticket:' || id)
    ) GROUP BY home_rc`).all<StatsRow>();
  const byCode = new Map(rows.results.map((row) => [row.home_rc, row]));
  const colleges: { code: string; name: string }[] = HOUSES.map(({ code, name }) => ({ code, name }));
  if (byCode.has('UNKNOWN')) colleges.push({ code: 'UNKNOWN', name: 'Unknown RC' });
  return colleges.map(({ code, name }) => ({
    code, name,
    estimatedParticipants: Number(byCode.get(code)?.estimated_participants || 0),
    admissions: Number(byCode.get(code)?.admissions || 0),
  }));
}
