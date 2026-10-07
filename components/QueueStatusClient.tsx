'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- Navigation intentionally uses full page loads for reliable mobile access. */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { HOUSE_BY_CODE, type HouseCode } from '@/lib/houses';

type Ticket = { queueNumber: string; houseCode: HouseCode; groupSize: number; nickname?: string; status: string; groupsAhead: number; estimatedSeconds: number; estimatedMinutes: number };
type TicketResponse = { ticket?: Ticket; error?: string };

const DEFAULT_REFRESH_MS = 30_000;
const NEAR_FRONT_REFRESH_MS = 15_000;
const MAX_REFRESH_MS = 60_000;

function formatCountdown(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  if (seconds === 0) return 'DUE NOW';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export default function QueueStatusClient({ queueNumber }: { queueNumber: string }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const isNew = useSearchParams().get('new') === '1';
  const isExisting = useSearchParams().get('existing') === '1';

  useEffect(() => {
    const nicknameTimer = setTimeout(() => { try { const saved = JSON.parse(sessionStorage.getItem(`ticket:${queueNumber}`) || 'null') as Ticket | null; if (saved?.nickname) setNickname(saved.nickname); } catch {} }, 0);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    let hasTicket = false;
    let refreshMs = DEFAULT_REFRESH_MS;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/queues/${encodeURIComponent(queueNumber)}`);
        const data = await response.json() as TicketResponse;
        if (!response.ok || !data.ticket) throw new Error(data.error || 'Unable to load this queue.');
        hasTicket = true;
        if (!stopped) { setTicket(data.ticket); setError(''); }
        refreshMs = data.ticket.status === 'waiting' && data.ticket.groupsAhead <= 5
          ? NEAR_FRONT_REFRESH_MS
          : DEFAULT_REFRESH_MS;
        failures = 0;
      } catch (reason) {
        failures += 1;
        if (!stopped && !hasTicket) setError(reason instanceof Error ? reason.message : 'Unable to load this queue.');
      } finally {
        if (!stopped) {
          const backoff = Math.min(MAX_REFRESH_MS, refreshMs * (2 ** failures));
          timer = setTimeout(refresh, backoff * (0.8 + Math.random() * 0.4));
        }
      }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(nicknameTimer); clearTimeout(timer); };
  }, [queueNumber]);

  useEffect(() => {
    const timer = setInterval(() => setTicket((current) => current?.status === 'waiting' && current.estimatedSeconds > 0
      ? { ...current, estimatedSeconds: current.estimatedSeconds - 1, estimatedMinutes: Math.ceil((current.estimatedSeconds - 1) / 60) }
      : current), 1000);
    return () => clearInterval(timer);
  }, []);

  const house = ticket ? HOUSE_BY_CODE[ticket.houseCode] : null;
  return <main className="ticket-page" style={{'--accent': house?.accent || '#ff632e'} as React.CSSProperties}>
    <nav className="nav shell"><a className="brand" href="/"><span className="brand-mark">A</span><span>Abandoned Institutions</span></a><a className="staff-link" href="/">Join another queue</a></nav>
    <section className="ticket-wrap shell">
      {error ? <div className="empty-ticket"><div className="eyebrow"><span /> Queue lookup</div><h2>We couldn’t find that ticket.</h2><p>{error}</p><a className="primary-button" href="/">Return home</a></div> : !ticket ? <p className="loading-copy">Finding your place in the dark…</p> : <>
        {isNew && <div className="screenshot-banner">Screenshot this page now <span>Your queue number and nickname will be checked at the entrance.</span></div>}
        {isExisting && <div className="existing-ticket-banner">You already have an active ticket for this haunted house. <span>We brought you back to it.</span></div>}
        <div className="ticket-card">
          <div className="ticket-header"><div><span>{house?.name} HAUNTED HOUSE</span><h2>{ticket.queueNumber}</h2></div><span className={`ticket-status status-${ticket.status}`}>{ticket.status}</span></div>
          {nickname && <div className="nickname-row"><span>TEAM NICKNAME</span><b>{nickname}</b></div>}
          <div className="ticket-metrics"><div><small>GROUPS AHEAD</small><strong>{ticket.groupsAhead}</strong></div><div><small>ESTIMATED WAIT</small><strong aria-label={`${ticket.estimatedMinutes} minutes estimated`}>{formatCountdown(ticket.estimatedSeconds)}</strong></div><div><small>GROUP SIZE</small><strong>{ticket.groupSize}<i> pax</i></strong></div></div>
          <div className="ticket-message">{ticket.status === 'waiting' ? (ticket.groupsAhead <= 5 ? 'Please make your way towards the entrance.' : 'Your position updates automatically every few seconds.') : ticket.status === 'entered' ? 'Your group has entered the haunted house.' : ticket.status === 'skipped' ? 'Your group was skipped. Please speak to the station master.' : 'This ticket is no longer active.'}</div>
        </div>
        <p className="arrival-note"><b>Be nearby when 5 groups remain.</b> The line may move faster when groups do not show up.</p>
      </>}
    </section>
  </main>;
}
