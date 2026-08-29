'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { HOUSE_BY_CODE, type HouseCode } from '@/lib/houses';

type Ticket = { queueNumber: string; houseCode: HouseCode; groupSize: number; nickname?: string; status: string; groupsAhead: number; estimatedMinutes: number };

export default function QueueStatusClient({ queueNumber }: { queueNumber: string }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const isNew = useSearchParams().get('new') === '1';

  useEffect(() => {
    const nicknameTimer = setTimeout(() => { try { const saved = JSON.parse(sessionStorage.getItem(`ticket:${queueNumber}`) || 'null') as Ticket | null; if (saved?.nickname) setNickname(saved.nickname); } catch {} }, 0);
    const refresh = () => fetch(`/api/queues/${encodeURIComponent(queueNumber)}`).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setTicket(data.ticket); setError(''); }).catch((reason) => setError(reason.message || 'Unable to load this queue.'));
    refresh(); const timer = setInterval(refresh, 5000); return () => { clearTimeout(nicknameTimer); clearInterval(timer); };
  }, [queueNumber]);

  const house = ticket ? HOUSE_BY_CODE[ticket.houseCode] : null;
  return <main className="ticket-page" style={{'--accent': house?.accent || '#ff632e'} as React.CSSProperties}>
    <nav className="nav shell"><Link className="brand" href="/"><span className="brand-mark">A</span><span>Abandoned Institutions</span></Link><Link className="staff-link" href="/">Join another queue</Link></nav>
    <section className="ticket-wrap shell">
      {error ? <div className="empty-ticket"><div className="eyebrow"><span /> Queue lookup</div><h2>We couldn’t find that ticket.</h2><p>{error}</p><Link className="primary-button" href="/">Return home</Link></div> : !ticket ? <p className="loading-copy">Finding your place in the dark…</p> : <>
        {isNew && <div className="screenshot-banner">Screenshot this page now <span>Your queue number and nickname will be checked at the entrance.</span></div>}
        <div className="ticket-card">
          <div className="ticket-header"><div><span>{house?.name} HAUNTED HOUSE</span><h2>{ticket.queueNumber}</h2></div><span className={`ticket-status status-${ticket.status}`}>{ticket.status}</span></div>
          {nickname && <div className="nickname-row"><span>TEAM NICKNAME</span><b>{nickname}</b></div>}
          <div className="ticket-metrics"><div><small>GROUPS AHEAD</small><strong>{ticket.groupsAhead}</strong></div><div><small>ESTIMATED WAIT</small><strong>{ticket.estimatedMinutes}<i> min</i></strong></div><div><small>GROUP SIZE</small><strong>{ticket.groupSize}<i> pax</i></strong></div></div>
          <div className="ticket-message">{ticket.status === 'waiting' ? (ticket.groupsAhead <= 5 ? 'Please make your way towards the entrance.' : 'Your position updates automatically every few seconds.') : ticket.status === 'entered' ? 'Your group has entered the haunted house.' : ticket.status === 'skipped' ? 'Your group was skipped. Please speak to the station master.' : 'This ticket is no longer active.'}</div>
        </div>
        <p className="arrival-note"><b>Be nearby when 5 groups remain.</b> The line may move faster when groups do not show up.</p>
      </>}
    </section>
  </main>;
}
