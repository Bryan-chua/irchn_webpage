'use client';

/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-location-assign-relative-destination -- Navigation intentionally uses full page loads for reliable mobile access. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import InfoDrawer from '@/components/InfoDrawer';
import stationMasterGuide from '@/docs/stationmaster.md?raw';
import { HOUSE_BY_CODE, type HouseCode } from '@/lib/houses';
import { estimatedClearSeconds } from '@/lib/queue';

type Entry = { id: number; queueNumber: string; nickname: string; groupSize: number; status: string; joinedAt: number; completedAt?: number };
type QueueData = { houseCode: HouseCode; status: string; lastEnteredAt: number | null; eventStatus: string; stationControlsLocked: boolean; active: Entry[]; history: Entry[] };
type QueueSnapshot = Omit<QueueData, 'history'> & { savedAt: number };

const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function snapshotStorageKey(houseCode: HouseCode) {
  return `irchn:station-queue-snapshot:${houseCode}`;
}

function readSnapshot(houseCode: HouseCode): QueueSnapshot | null {
  try {
    const raw = window.localStorage.getItem(snapshotStorageKey(houseCode));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as QueueSnapshot;
    if (snapshot.houseCode !== houseCode || !Array.isArray(snapshot.active) || !Number.isFinite(snapshot.savedAt)) return null;
    if (Date.now() - snapshot.savedAt > SNAPSHOT_MAX_AGE_MS) {
      window.localStorage.removeItem(snapshotStorageKey(houseCode));
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function saveSnapshot(data: QueueData, savedAt: number) {
  try {
    const snapshot: QueueSnapshot = {
      houseCode: data.houseCode,
      status: data.status,
      lastEnteredAt: data.lastEnteredAt,
      eventStatus: data.eventStatus,
      stationControlsLocked: data.stationControlsLocked,
      active: data.active,
      savedAt,
    };
    window.localStorage.setItem(snapshotStorageKey(data.houseCode), JSON.stringify(snapshot));
  } catch (error) {
    console.warn('Could not save the local emergency queue snapshot.', error);
  }
}

function csvValue(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function snapshotLabel(timestamp: number | null) {
  return timestamp ? new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'not available';
}

function localFileTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export default function ModeratorDashboard({ expectedHouse }: { expectedHouse: HouseCode }) {
  const [data, setData] = useState<QueueData | null>(null); const [selected, setSelected] = useState<number[]>([]); const [tab, setTab] = useState<'active' | 'history'>('active'); const [error, setError] = useState(''); const [now, setNow] = useState(() => Date.now()); const [snapshotAt, setSnapshotAt] = useState<number | null>(null); const [usingOfflineSnapshot, setUsingOfflineSnapshot] = useState(false);
  const house = HOUSE_BY_CODE[expectedHouse];
  const load = useCallback(async () => { try { const response = await fetch('/api/moderator/queue'); if (response.status === 401) { window.location.replace('/moderator'); return; } const result = await response.json() as QueueData & { error?: string }; if (!response.ok) throw new Error(result.error || 'Unable to refresh the queue.'); if (result.houseCode !== expectedHouse) { window.location.replace(`/moderator/${result.houseCode.toLowerCase()}`); return; } const savedAt = Date.now(); setData(result); setSnapshotAt(savedAt); setUsingOfflineSnapshot(false); setError(''); saveSnapshot(result, savedAt); } catch { const snapshot = readSnapshot(expectedHouse); if (snapshot) { const { savedAt, ...snapshotData } = snapshot; setData({ ...snapshotData, history: [] }); setSnapshotAt(savedAt); setTab('active'); } setSelected([]); setUsingOfflineSnapshot(true); setError(snapshot ? '' : 'Unable to refresh the queue, and no recent emergency snapshot is available on this device.'); } }, [expectedHouse]);
  useEffect(() => { const kickoff = setTimeout(load, 0); const timer = setInterval(() => { setNow(Date.now()); void load(); }, 4000); const reconnect = () => void load(); window.addEventListener('online', reconnect); return () => { clearTimeout(kickoff); clearInterval(timer); window.removeEventListener('online', reconnect); }; }, [load]);
  const waiting = useMemo(() => data?.active.filter((entry) => entry.status === 'waiting') || [], [data]);
  const clearMinutes = Math.ceil(estimatedClearSeconds(expectedHouse, waiting.length, data?.lastEnteredAt, now) / 60);
  async function update(payload: object) { if (usingOfflineSnapshot) { setError('Offline snapshots are read-only. Record changes on the printed list until the live queue returns.'); return; } setError(''); try { const response = await fetch('/api/moderator/queue', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!response.ok) { const result = await response.json() as { error?: string }; setError(result.error || 'Action failed.'); return; } setSelected([]); await load(); } catch { setUsingOfflineSnapshot(true); setSelected([]); setError('Action failed. The queue is now read-only until a live refresh succeeds.'); } }
  async function undo(entry: Entry) { await update({ ids: [entry.id], status: 'waiting' }); }
  async function logout() { try { await fetch('/api/moderator/logout', { method: 'POST' }); } finally { window.location.assign('/moderator'); } }
  function toggle(id: number) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  function downloadBackup() {
    if (!data || !snapshotAt) return;
    const header = ['house', 'queue_order', 'queue_number', 'team_nickname', 'pax', 'status', 'joined_at', 'snapshot_at', 'entered', 'skipped', 'processed_at', 'notes'];
    const rows: unknown[][] = [header, ...data.active.map((entry, index) => [house.name, index + 1, entry.queueNumber, entry.nickname, entry.groupSize, entry.status, new Date(entry.joinedAt).toISOString(), new Date(snapshotAt).toISOString(), '', '', '', ''])];
    const csv = `\uFEFF${rows.map((row) => row.map(csvValue).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${expectedHouse.toLowerCase()}-queue-backup-${localFileTimestamp(snapshotAt)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  const entries = tab === 'active' ? data?.active || [] : data?.history || [];
  return <main className="dashboard" style={{'--accent': house.accent} as React.CSSProperties}>
    <aside className="dash-sidebar"><a className="brand" href="/"><span className="brand-mark">A</span><span>Abandoned Institutions</span></a><nav><button className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>⌁ <span>Current queue</span><b>{waiting.length}</b></button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>✓ <span>Entered history</span></button></nav><div className="station-card"><small>YOUR STATION</small><b>{house.name}</b><span><i /> {data?.status || 'loading'}</span></div><button className="logout-button" onClick={logout}>Sign out</button></aside>
    <section className="dash-main"><header><div><div className="eyebrow"><span /> {house.name} station</div><h1>{tab === 'active' ? 'Current queue' : 'Entered history'}</h1></div><div className="dash-header-actions"><InfoDrawer label="Open station master guide" markdown={stationMasterGuide} title="Station master guide" variant="dashboard" /><div className="queue-backup-actions"><label>EMERGENCY BACKUP</label><div><button disabled={!data || !snapshotAt} onClick={downloadBackup}>Download CSV</button><button disabled={!data || !snapshotAt} onClick={() => window.print()}>Print list</button></div><small>Saved {snapshotAt ? new Date(snapshotAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—'}</small></div><div className="queue-controls"><label>QUEUE STATUS</label><div>{(['open','paused','closed'] as const).map((status) => <button className={data?.status === status ? 'selected' : ''} disabled={usingOfflineSnapshot || data?.stationControlsLocked} key={status} onClick={() => update({ queueStatus: status })}>{status}</button>)}</div></div></div></header>
      {usingOfflineSnapshot && data && <div className="offline-backup-notice" role="alert"><b>Offline emergency copy — read only.</b><span>Last live update: {snapshotLabel(snapshotAt)}. Do not use the buttons to process groups; mark changes on the printed list until the live queue returns.</span></div>}
      {data?.stationControlsLocked && <div className="global-lock-notice" role="status"><b>Event control is {data.eventStatus}.</b> Bryan has locked house status controls. {!usingOfflineSnapshot && 'Queue actions remain available.'}</div>}
      <div className="dash-stats"><div><small>WAITING GROUPS</small><strong>{waiting.length}</strong></div><div><small>ESTIMATED CLEAR TIME</small><strong>{clearMinutes}<i> min</i></strong></div><div><small>TOTAL PAX WAITING</small><strong>{waiting.reduce((total, entry) => total + entry.groupSize, 0)}</strong></div></div>
      {error && <p className="form-error">{error}</p>}
      {tab === 'active' && <div className="bulk-bar"><label><input type="checkbox" disabled={usingOfflineSnapshot} checked={entries.length > 0 && selected.length === entries.length} onChange={(event) => setSelected(event.target.checked ? entries.map((entry) => entry.id) : [])} /> Select all</label><span>{selected.length} selected</span><button disabled={usingOfflineSnapshot || !selected.length} onClick={() => update({ ids: selected, status: 'skipped' })}>Skip</button><button className="enter-button" disabled={usingOfflineSnapshot || !selected.length} onClick={() => update({ ids: selected, status: 'entered' })}>✓ Mark as entered</button></div>}
      <div className={`queue-table ${tab}-table`}><div className="queue-row queue-head">{tab === 'active' && <span></span>}<span>QUEUE NO.</span><span>TEAM NICKNAME</span><span>PAX</span><span>{tab === 'active' ? 'WAITING' : 'COMPLETED'}</span><span>STATUS</span></div>
        {entries.map((entry) => <div className={`queue-row ${entry.status}`} key={entry.id}>{tab === 'active' && <input className="entry-select" aria-label={`Select ${entry.queueNumber}`} type="checkbox" disabled={usingOfflineSnapshot} checked={selected.includes(entry.id)} onChange={() => toggle(entry.id)} />}<b className="entry-queue">{entry.queueNumber}</b><strong className="entry-nickname">{entry.nickname}</strong><span className="entry-pax">{entry.groupSize}</span><span className="entry-time">{Math.max(0, Math.floor(((tab === 'active' ? now : entry.completedAt || now) - entry.joinedAt) / 60000))} min</span><div className="row-actions"><span className="row-status">{entry.status}</span>{(entry.status === 'skipped' || entry.status === 'entered') && <button className="undo-button" disabled={usingOfflineSnapshot} type="button" aria-label={`Undo ${entry.status} status for ${entry.queueNumber}`} onClick={() => void undo(entry)}>Undo</button>}</div></div>)}
        {!entries.length && <div className="empty-row">{tab === 'active' ? 'No groups are waiting in the dark.' : 'No completed groups yet.'}</div>}
      </div>
      {tab === 'history' && entries.length > 0 && <p className="history-note">Completed entries are kept temporarily for operational records and should be deleted after the event.</p>}
      <section className="emergency-print-sheet" aria-hidden="true"><header><small>EMERGENCY QUEUE BACKUP</small><h1>{house.name} current queue</h1><p>Snapshot: {snapshotLabel(snapshotAt)} · This is a read-only emergency copy.</p></header><table><thead><tr><th>#</th><th>Queue</th><th>Team nickname</th><th>Pax</th><th>Status</th><th>Entered</th><th>Skipped</th><th>Time / notes</th></tr></thead><tbody>{data?.active.map((entry, index) => <tr key={`print-${entry.id}`}><td>{index + 1}</td><td><b>{entry.queueNumber}</b></td><td>{entry.nickname}</td><td>{entry.groupSize}</td><td>{entry.status}</td><td className="check-cell">□</td><td className="check-cell">□</td><td></td></tr>)}</tbody></table><footer>After service returns, reconcile handwritten changes in the live station dashboard. Destroy this list after the event.</footer></section>
    </section>
  </main>;
}
