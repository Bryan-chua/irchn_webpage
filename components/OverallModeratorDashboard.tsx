'use client';

/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-location-assign-relative-destination -- Navigation intentionally uses full page loads for reliable mobile access. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HouseCode } from '@/lib/houses';
import type { HomeRcStats } from '@/lib/participant-stats';
import AnnouncementControl from './AnnouncementControl';

type HouseOverview = {
  name: string;
  code: HouseCode;
  accent: string;
  status: string;
  waitingCount: number;
  skippedCount: number;
  enteredGroups: number;
  enteredParticipants: number;
  estimatedMinutes: number;
  isDelayed: boolean;
  projectedClearAt: number | null;
  closingMarginMinutes: number | null;
  lastEnteredAt: number | null;
  lastSeenAt: number | null;
  lastLoginAt: number | null;
  stationInactive: boolean;
};

type OperationalEvent = {
  id: number;
  category: 'alert' | 'activity';
  eventType: string;
  severity: string;
  houseCode: string;
  actor: string;
  message: string;
  count: number;
  occurredAt: number;
  lastOccurredAt: number;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  resolvedAt: number | null;
};

type OverallData = {
  event: { status: string; stationControlsLocked: boolean; eventEndAt: number | null; eventOpenAt: number | null; eventOpenedAt: number | null; eventClosedAt: number | null; homeRcOnlyAt: number | null; updatedAt: number; updatedBy: string };
  houses: HouseOverview[];
  homeRcStats: HomeRcStats[];
  events: OperationalEvent[];
  generatedAt: number;
};

function localDateTimeValue(timestamp: number | null) {
  if (!timestamp) return '';
  const local = new Date(timestamp + 8 * 3600000);
  return local.toISOString().slice(0, 16);
}

function timeLabel(timestamp: number | null) {
  return timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Not available';
}

function relativeTime(timestamp: number | null, now: number) {
  if (!timestamp) return 'Never active';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function OverallModeratorDashboard() {
  const [data, setData] = useState<OverallData | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [closingTime, setClosingTime] = useState('');
  const closingTimeDirty = useRef(false);
  const [rcCutoff, setRcCutoff] = useState('');
  const rcCutoffDirty = useRef(false);
  const [openingTime, setOpeningTime] = useState('');
  const openingTimeDirty = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/moderator/overall');
      if (response.status === 401) { window.location.replace('/moderator'); return; }
      const result = await response.json() as OverallData & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Unable to load overall event control.');
      setData(result);
      if (!openingTimeDirty.current) setOpeningTime(result.event.eventOpenAt ? new Date(result.event.eventOpenAt + 8 * 3600000).toISOString().slice(0, 16) : '');
      if (!rcCutoffDirty.current) setRcCutoff(result.event.homeRcOnlyAt ? new Date(result.event.homeRcOnlyAt + 8 * 3600000).toISOString().slice(0, 16) : '');
      if (!closingTimeDirty.current) setClosingTime(localDateTimeValue(result.event.eventEndAt));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to refresh overall event control.');
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(load, 0);
    const timer = setInterval(load, 10_000);
    return () => { clearTimeout(kickoff); clearInterval(timer); };
  }, [load]);

  async function update(payload: object, action: string) {
    setPending(action); setError('');
    try {
      const response = await fetch('/api/moderator/overall', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Overall dashboard action failed.');
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Overall dashboard action failed.');
      return false;
    } finally {
      setPending('');
    }
  }

  async function changeGlobalStatus(status: 'open' | 'paused' | 'closed') {
    if (status !== 'open') {
      const action = status === 'paused' ? 'pause every queue and lock station controls' : 'close every queue and lock station controls';
      if (!window.confirm(`Are you sure you want to ${action}?`)) return;
    }
    await update({ globalStatus: status }, `global:${status}`);
  }

  async function saveClosingTime() {
    const eventEndAt = closingTime ? new Date(`${closingTime}:00+08:00`).getTime() : null;
    await update({ eventEndAt }, 'closing-time');
    closingTimeDirty.current = false;
  }

  async function saveOpeningTime(clear = false) {
    const eventOpenAt = clear ? null : new Date(`${openingTime}:00+08:00`).getTime();
    if (eventOpenAt !== null && !Number.isFinite(eventOpenAt)) { setError('Choose a valid opening time.'); return; }
    if (await update({ eventOpenAt }, 'opening-time')) {
      openingTimeDirty.current = false;
      if (clear) setOpeningTime('');
    }
  }

  async function logout() {
    try { await fetch('/api/moderator/logout', { method: 'POST' }); }
    finally { window.location.assign('/moderator'); }
  }

  const now = data?.generatedAt || 0;
  const alerts = data?.events.filter((event) => event.category === 'alert') || [];
  const activeAlerts = alerts.filter((event) => !event.resolvedAt && !event.acknowledgedAt);
  const activity = data?.events.filter((event) => event.category === 'activity' || event.eventType === 'moderator_login_rate_limited') || [];
  const totalWaiting = data?.houses.reduce((total, house) => total + house.waitingCount, 0) || 0;
  const totalEntered = data?.houses.reduce((total, house) => total + house.enteredParticipants, 0) || 0;

  return <main className="overall-dashboard">
    <nav className="overall-nav"><a className="brand" href="/"><span className="brand-mark">A</span><span>Abandoned Institutions</span></a><div><a className="overall-export emergency" href="/api/moderator/overall/emergency-export">Emergency queues</a><a className="overall-export" href="/api/moderator/overall/export">Event report</a><button onClick={logout}>Sign out</button></div></nav>
    <div className="overall-shell">
      <header className="overall-heading"><div><div className="eyebrow"><span /> Bryan — overall control</div><h1>Event command.</h1></div><div className={`overall-live status-${data?.event.status || 'loading'}`}><i /> {data?.event.status || 'loading'}</div></header>
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="overall-control-panel">
        <div><small>EVENT CONTROL</small><h2>All haunted houses</h2><p>{data?.event.stationControlsLocked ? 'Station status controls are locked.' : 'Station masters may control their own house.'}</p></div>
        <div className="overall-global-actions">
          <button className={data?.event.status === 'open' ? 'selected' : ''} disabled={Boolean(pending)} onClick={() => void changeGlobalStatus('open')}>Open all & unlock</button>
          <button className={data?.event.status === 'paused' ? 'selected warning' : 'warning'} disabled={Boolean(pending)} onClick={() => void changeGlobalStatus('paused')}>Pause all & lock</button>
          <button className={data?.event.status === 'closed' ? 'selected danger' : 'danger'} disabled={Boolean(pending)} onClick={() => void changeGlobalStatus('closed')}>Close all & lock</button>
        </div>
        <div className="closing-time-control"><label htmlFor="event-closing-time">EVENT CLOSING TIME (SINGAPORE TIME)</label><div><input id="event-closing-time" type="datetime-local" value={closingTime} onChange={(event) => { closingTimeDirty.current = true; setClosingTime(event.target.value); }} /><button disabled={Boolean(pending)} onClick={() => void saveClosingTime()}>Save</button></div><p>{data?.event.eventClosedAt ? `Closed automatically at ${new Date(data.event.eventClosedAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' })} SGT.` : data?.event.eventEndAt ? 'Automatically closes all six queues and locks station controls at this time. Existing tickets remain viewable.' : 'No automatic closing time is set.'}</p></div>
      </section>

      <section className="overall-control-panel rc-cutoff-control">
        <div><small>SCHEDULED OPENING</small><h2>Open all houses automatically</h2><p>At this time, all six queues will open and station status controls will unlock. The schedule runs once. Manual global open, pause or close controls cancel a pending opening.</p><p>{!data?.event.eventOpenAt ? 'No opening time is scheduled.' : data.event.eventOpenedAt ? `Opened automatically at ${new Date(data.event.eventOpenedAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' })} SGT.` : data.event.eventEndAt && data.generatedAt >= data.event.eventEndAt ? 'This opening schedule has expired. Choose a new opening time.' : `Scheduled for ${new Date(data.event.eventOpenAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' })} SGT.`}</p></div>
        <div className="closing-time-control"><label htmlFor="event-opening-time">OPEN ALL HOUSES AT (SINGAPORE TIME)</label><div><input id="event-opening-time" type="datetime-local" value={openingTime} onChange={(event) => { openingTimeDirty.current = true; setOpeningTime(event.target.value); }} /><button disabled={Boolean(pending) || !data || !openingTime} onClick={() => void saveOpeningTime()}>Save opening</button></div><button disabled={Boolean(pending) || !data?.event.eventOpenAt} onClick={() => void saveOpeningTime(true)}>Clear opening</button></div>
      </section>

      <section className="overall-control-panel rc-cutoff-control">
        <div><small>PARTICIPANT ACCESS</small><h2>Home RC only</h2><p>At the cutoff, cancel all waiting and skipped tickets outside the group’s home RC and block new outside-RC joins. Tickets without a selected RC are also cancelled. Own-RC tickets stay valid.</p><p>{data?.event.homeRcOnlyAt ? `Cutoff: ${new Date(data.event.homeRcOnlyAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' })} SGT${data.generatedAt >= data.event.homeRcOnlyAt ? ' — active' : ' — scheduled'}` : 'No cutoff is set.'} Clearing or moving the cutoff will not restore cancelled tickets.</p></div>
        <div className="closing-time-control"><label htmlFor="rc-cutoff">HOME-RC-ONLY CUTOFF (SINGAPORE TIME)</label><div><input id="rc-cutoff" type="datetime-local" value={rcCutoff} onChange={(event) => { rcCutoffDirty.current = true; setRcCutoff(event.target.value); }} /><button disabled={Boolean(pending) || !data || !rcCutoff} onClick={() => {
          const homeRcOnlyAt = new Date(`${rcCutoff}:00+08:00`).getTime();
          if (!Number.isFinite(homeRcOnlyAt)) { setError('Choose a valid cutoff time.'); return; }
          void update({ homeRcOnlyAt }, 'rc-cutoff').then(() => { rcCutoffDirty.current = false; });
        }}>Save cutoff</button></div><button disabled={Boolean(pending) || !data?.event.homeRcOnlyAt} onClick={() => { setRcCutoff(''); void update({ homeRcOnlyAt: null }, 'rc-cutoff-clear').then(() => { rcCutoffDirty.current = false; }); }}>Clear cutoff</button></div>
      </section>

      <AnnouncementControl />

      <section className="overall-stats"><div><small>WAITING GROUPS</small><strong>{totalWaiting}</strong></div><div><small>PARTICIPANTS ENTERED</small><strong>{totalEntered}</strong></div><div><small>ACTIVE ALERTS</small><strong>{activeAlerts.length}</strong></div></section>

      <section className="overall-section" id="home-rc-stats" aria-labelledby="home-rc-stats-title">
        <div className="overall-section-title"><div><small>EVENT REPORT</small><h2 id="home-rc-stats-title">Participants by home RC</h2></div><a className="overall-export" href="/api/moderator/overall/export">Download event report</a></div>
        <p className="rc-stats-explanation">Estimated participants counts each browser’s group once across all houses, using its largest recorded group size. All group members are counted as belonging to the selected RC. Haunted-house admissions counts every entered visit, including repeat visits.</p>
        <div className="rc-stats-table-wrap"><table className="rc-stats-table"><caption className="sr-only">Estimated participants and haunted-house admissions by home residential college</caption><thead><tr><th scope="col">Home RC</th><th scope="col">Estimated participants</th><th scope="col">Haunted-house admissions</th></tr></thead><tbody>{data?.homeRcStats.map((rc) => <tr key={rc.code}><th scope="row">{rc.name}</th><td>{rc.estimatedParticipants}</td><td>{rc.admissions}</td></tr>)}</tbody><tfoot><tr><th scope="row">Total</th><td>{data?.homeRcStats.reduce((sum, rc) => sum + rc.estimatedParticipants, 0) ?? '—'}</td><td>{data?.homeRcStats.reduce((sum, rc) => sum + rc.admissions, 0) ?? '—'}</td></tr></tfoot></table></div>
        <p className="rc-stats-explanation">The participant estimate includes groups with waiting, skipped or cancelled tickets. Separate browsers or cleared browser storage can count the same group again. It is an estimate of groups that registered, rather than a verified headcount. Export the report before deleting ticket records.</p>
      </section>

      <section className="overall-section" id="houses"><div className="overall-section-title"><div><small>ALL-HOUSE OVERVIEW</small><h2>Queue health</h2></div><span>Updated {timeLabel(data?.generatedAt || null)}</span></div>
        <div className="overall-house-grid">{data?.houses.map((house) => <article className={`overall-house-card ${house.isDelayed ? 'delayed' : ''}`} style={{ '--accent': house.accent } as React.CSSProperties} key={house.code}>
          <header><div><small>{house.code}</small><h3>{house.name}</h3></div><span className={`open-pill status-${house.status}`}><i /> {house.status}</span></header>
          <div className="overall-house-metrics"><div><small>EST. CLEAR</small><strong>{house.waitingCount === 0 ? 'No wait' : house.isDelayed ? 'Delayed' : `${house.estimatedMinutes} min`}</strong></div><div><small>WAITING</small><strong>{house.waitingCount}</strong></div><div><small>SKIPPED</small><strong>{house.skippedCount}</strong></div></div>
          <p className={house.isDelayed || (house.closingMarginMinutes !== null && house.closingMarginMinutes < 0) ? 'capacity-late' : ''}>{house.isDelayed ? 'Clear time unavailable — this queue is behind its estimate.' : data?.event.eventEndAt ? house.waitingCount === 0 ? 'Queue is clear.' : `${timeLabel(house.projectedClearAt)} · ${Math.abs(house.closingMarginMinutes || 0)} min ${house.closingMarginMinutes !== null && house.closingMarginMinutes < 0 ? 'after' : 'before'} closing` : 'Set an event closing time for capacity projection.'}</p>
          <div className="station-presence"><i className={house.stationInactive ? 'inactive' : ''} /> Station {relativeTime(house.lastSeenAt, now)}</div>
          <div className="house-status-actions">{(['open', 'paused', 'closed'] as const).map((status) => <button className={house.status === status ? 'selected' : ''} disabled={Boolean(pending) || Boolean(data.event.stationControlsLocked)} onClick={() => void update({ houseCode: house.code, houseStatus: status }, `house:${house.code}:${status}`)} key={status}>{status}</button>)}</div>
        </article>)}</div>
      </section>

      <section className="overall-section" id="alerts"><div className="overall-section-title"><div><small>ALERTS</small><h2>Needs attention</h2></div><span>{activeAlerts.length} unacknowledged</span></div>
        <div className="overall-event-list">{alerts.map((event) => <article className={`overall-event-row severity-${event.severity} ${event.acknowledgedAt ? 'acknowledged' : ''} ${event.resolvedAt ? 'resolved' : ''}`} key={event.id}><div><span>{event.houseCode}</span><b>{event.message}</b><small>{new Date(event.lastOccurredAt).toLocaleString()} · occurred {event.count} {event.count === 1 ? 'time' : 'times'}</small></div><div>{event.resolvedAt ? <em>Resolved</em> : event.acknowledgedAt ? <em>Acknowledged</em> : <button disabled={Boolean(pending)} onClick={() => void update({ acknowledgeEventId: event.id }, `ack:${event.id}`)}>Acknowledge</button>}</div></article>)}{!alerts.length && <p className="overall-empty">No operational alerts have been recorded.</p>}</div>
      </section>

      <section className="overall-section" id="activity"><div className="overall-section-title"><div><small>ACTIVITY LOG</small><h2>Recent control history</h2></div></div>
        <div className="overall-event-list">{activity.map((event) => <article className="overall-event-row activity" key={`${event.category}-${event.id}`}><div><span>{event.actor}</span><b>{event.message}</b><small>{new Date(event.lastOccurredAt).toLocaleString()}</small></div></article>)}{!activity.length && <p className="overall-empty">No control activity has been recorded.</p>}</div>
      </section>
    </div>
  </main>;
}
