'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- Navigation intentionally uses full page loads for reliable mobile access. */

import { FormEvent, useState } from 'react';
import { HOUSE_BY_CODE, type HouseCode } from '@/lib/houses';
import { MINUTES_PER_GROUP } from '@/lib/queue';

export default function JoinClient({ houseCode }: { houseCode: HouseCode }) {
  const house = HOUSE_BY_CODE[houseCode];
  const [nickname, setNickname] = useState('');
  const [groupSize, setGroupSize] = useState(2);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function join(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const response = await fetch('/api/queues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ houseCode, nickname, groupSize }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error || 'Unable to join this queue.'); setLoading(false); return; }
      const saved = JSON.parse(localStorage.getItem('night-of-frights-tickets') || '[]') as string[];
      localStorage.setItem('night-of-frights-tickets', JSON.stringify([...new Set([...saved, data.ticket.queueNumber])]));
      sessionStorage.setItem(`ticket:${data.ticket.queueNumber}`, JSON.stringify(data.ticket));
      window.location.assign(`/queue/${encodeURIComponent(data.ticket.queueNumber)}?new=1`);
    } catch {
      setError('Unable to reach the queue. Check your connection and try again.');
      setLoading(false);
    }
  }

  return <main className="form-page" style={{'--accent': house.accent} as React.CSSProperties}>
    <nav className="nav shell"><a className="brand" href="/"><span className="brand-mark">A</span><span>Abandoned Institutions</span></a><a className="staff-link" href="/">← All houses</a></nav>
    <section className="join-layout shell">
      <div className="join-intro"><div className="eyebrow"><span /> {house.name} haunted house</div><h1>Join the<br /><em>night queue.</em></h1><p>One ticket covers your whole group. Your wait updates automatically as the line moves.</p><div className="join-facts"><span><b>{MINUTES_PER_GROUP}</b> min / group</span><span><b>8</b> pax maximum</span></div></div>
      <form className="join-form" onSubmit={join}>
        <div className="form-number">01 — YOUR GROUP</div>
        <label htmlFor="nickname">Team nickname</label>
        <input id="nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={2} maxLength={30} placeholder="E.g. Spooky Bananas" autoComplete="off" enterKeyHint="done" required />
        <small>Use something your group remembers. Do not enter real names or personal information.</small>
        <label>Number of people</label>
        <div className="pax-grid">{Array.from({ length: 8 }, (_, index) => index + 1).map((size) => <button type="button" className={groupSize === size ? 'selected' : ''} aria-pressed={groupSize === size} aria-label={`${size} ${size === 1 ? 'person' : 'people'}`} onClick={() => setGroupSize(size)} key={size}>{size}</button>)}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="submit-button" disabled={loading}>{loading ? 'Joining queue…' : `Join ${house.name} queue`} <span>→</span></button>
        <p className="privacy-note">Your nickname is only shown to your station master for verification and is not displayed publicly.</p>
      </form>
    </section>
  </main>;
}
