'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- Navigation intentionally uses full page loads for reliable mobile access. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import InfoDrawer from '@/components/InfoDrawer';
import stationMasterGuide from '@/docs/stationmaster.md?raw';
import { HOUSE_BY_CODE, type HouseCode } from '@/lib/houses';
import { estimatedClearSeconds } from '@/lib/queue';

type Entry = { id: number; queueNumber: string; nickname: string; groupSize: number; status: string; joinedAt: number; completedAt?: number };
type QueueData = { houseCode: HouseCode; status: string; lastEnteredAt: number | null; active: Entry[]; history: Entry[] };

export default function ModeratorDashboard({ expectedHouse }: { expectedHouse: HouseCode }) {
  const [data, setData] = useState<QueueData | null>(null); const [selected, setSelected] = useState<number[]>([]); const [tab, setTab] = useState<'active' | 'history'>('active'); const [error, setError] = useState(''); const [now, setNow] = useState(() => Date.now());
  const house = HOUSE_BY_CODE[expectedHouse];
  const load = useCallback(async () => { try { const response = await fetch('/api/moderator/queue'); if (response.status === 401) { window.location.replace('/moderator'); return; } const result = await response.json() as QueueData & { error?: string }; if (!response.ok) throw new Error(result.error || 'Unable to refresh the queue.'); if (result.houseCode !== expectedHouse) { window.location.replace(`/moderator/${result.houseCode.toLowerCase()}`); return; } setData(result); setError(''); } catch { setError('Unable to refresh the queue. Check your connection.'); } }, [expectedHouse]);
  useEffect(() => { const kickoff = setTimeout(load, 0); const timer = setInterval(() => { setNow(Date.now()); void load(); }, 4000); return () => { clearTimeout(kickoff); clearInterval(timer); }; }, [load]);
  const waiting = useMemo(() => data?.active.filter((entry) => entry.status === 'waiting') || [], [data]);
  const clearMinutes = Math.ceil(estimatedClearSeconds(expectedHouse, waiting.length, data?.lastEnteredAt, now) / 60);
  async function update(payload: object) { setError(''); try { const response = await fetch('/api/moderator/queue', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!response.ok) { const result = await response.json() as { error?: string }; setError(result.error || 'Action failed.'); return; } setSelected([]); await load(); } catch { setError('Action failed. Check your connection and try again.'); } }
  async function undo(entry: Entry) { await update({ ids: [entry.id], status: 'waiting' }); }
  async function logout() { try { await fetch('/api/moderator/logout', { method: 'POST' }); } finally { window.location.assign('/moderator'); } }
  function toggle(id: number) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  const entries = tab === 'active' ? data?.active || [] : data?.history || [];
  return <main className="dashboard" style={{'--accent': house.accent} as React.CSSProperties}>
    <aside className="dash-sidebar"><a className="brand" href="/"><span className="brand-mark">A</span><span>Abandoned Institutions</span></a><nav><button className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>⌁ <span>Current queue</span><b>{waiting.length}</b></button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>✓ <span>Entered history</span></button></nav><div className="station-card"><small>YOUR STATION</small><b>{house.name}</b><span><i /> {data?.status || 'loading'}</span></div><button className="logout-button" onClick={logout}>Sign out</button></aside>
    <section className="dash-main"><header><div><div className="eyebrow"><span /> {house.name} station</div><h1>{tab === 'active' ? 'Current queue' : 'Entered history'}</h1></div><div className="dash-header-actions"><InfoDrawer label="Open station master guide" markdown={stationMasterGuide} title="Station master guide" variant="dashboard" /><div className="queue-controls"><label>QUEUE STATUS</label><div>{(['open','paused','closed'] as const).map((status) => <button className={data?.status === status ? 'selected' : ''} key={status} onClick={() => update({ queueStatus: status })}>{status}</button>)}</div></div></div></header>
      <div className="dash-stats"><div><small>WAITING GROUPS</small><strong>{waiting.length}</strong></div><div><small>ESTIMATED CLEAR TIME</small><strong>{clearMinutes}<i> min</i></strong></div><div><small>TOTAL PAX WAITING</small><strong>{waiting.reduce((total, entry) => total + entry.groupSize, 0)}</strong></div></div>
      {error && <p className="form-error">{error}</p>}
      {tab === 'active' && <div className="bulk-bar"><label><input type="checkbox" checked={entries.length > 0 && selected.length === entries.length} onChange={(event) => setSelected(event.target.checked ? entries.map((entry) => entry.id) : [])} /> Select all</label><span>{selected.length} selected</span><button disabled={!selected.length} onClick={() => update({ ids: selected, status: 'skipped' })}>Skip</button><button className="enter-button" disabled={!selected.length} onClick={() => update({ ids: selected, status: 'entered' })}>✓ Mark as entered</button></div>}
      <div className={`queue-table ${tab}-table`}><div className="queue-row queue-head">{tab === 'active' && <span></span>}<span>QUEUE NO.</span><span>TEAM NICKNAME</span><span>PAX</span><span>{tab === 'active' ? 'WAITING' : 'COMPLETED'}</span><span>STATUS</span></div>
        {entries.map((entry) => <div className={`queue-row ${entry.status}`} key={entry.id}>{tab === 'active' && <input className="entry-select" aria-label={`Select ${entry.queueNumber}`} type="checkbox" checked={selected.includes(entry.id)} onChange={() => toggle(entry.id)} />}<b className="entry-queue">{entry.queueNumber}</b><strong className="entry-nickname">{entry.nickname}</strong><span className="entry-pax">{entry.groupSize}</span><span className="entry-time">{Math.max(0, Math.floor(((tab === 'active' ? now : entry.completedAt || now) - entry.joinedAt) / 60000))} min</span><div className="row-actions"><span className="row-status">{entry.status}</span>{(entry.status === 'skipped' || entry.status === 'entered') && <button className="undo-button" type="button" aria-label={`Undo ${entry.status} status for ${entry.queueNumber}`} onClick={() => void undo(entry)}>Undo</button>}</div></div>)}
        {!entries.length && <div className="empty-row">{tab === 'active' ? 'No groups are waiting in the dark.' : 'No completed groups yet.'}</div>}
      </div>
      {tab === 'history' && entries.length > 0 && <p className="history-note">Completed entries are kept temporarily for operational records and should be deleted after the event.</p>}
    </section>
  </main>;
}
