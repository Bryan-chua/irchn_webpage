'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { HOUSE_BY_CODE, type HouseCode } from '@/lib/houses';

export default function JoinClient({ houseCode }: { houseCode: HouseCode }) {
  const house = HOUSE_BY_CODE[houseCode];
  const [nickname, setNickname] = useState('');
  const [groupSize, setGroupSize] = useState(2);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function join(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    const response = await fetch('/api/queues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ houseCode, nickname, groupSize }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error || 'Unable to join this queue.'); setLoading(false); return; }
    try {
      const saved = JSON.parse(localStorage.getItem('night-of-frights-tickets') || '[]') as string[];
      localStorage.setItem('night-of-frights-tickets', JSON.stringify([...new Set([...saved, data.ticket.queueNumber])]));
      sessionStorage.setItem(`ticket:${data.ticket.queueNumber}`, JSON.stringify(data.ticket));
    } catch {}
    router.push(`/queue/${encodeURIComponent(data.ticket.queueNumber)}?new=1`);
  }

  return <main className="form-page" style={{'--accent': house.accent} as React.CSSProperties}>
    <nav className="nav shell"><Link className="brand" href="/"><span className="brand-mark">A</span><span>Abandoned Institutions</span></Link><Link className="staff-link" href="/">← All houses</Link></nav>
    <section className="join-layout shell">
      <div className="join-intro"><div className="eyebrow"><span /> {house.name} haunted house</div><h1>Join the<br /><em>night queue.</em></h1><p>One ticket covers your whole group. Your wait updates automatically as the line moves.</p><div className="join-facts"><span><b>2</b> min / group</span><span><b>8</b> pax maximum</span></div></div>
      <form className="join-form" onSubmit={join}>
        <div className="form-number">01 — YOUR GROUP</div>
        <label htmlFor="nickname">Team nickname</label>
        <input id="nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={2} maxLength={30} placeholder="E.g. Spooky Bananas" autoComplete="off" required />
        <small>Use something your group remembers. Do not enter real names or personal information.</small>
        <label>Number of people</label>
        <div className="pax-grid">{Array.from({ length: 8 }, (_, index) => index + 1).map((size) => <button type="button" className={groupSize === size ? 'selected' : ''} onClick={() => setGroupSize(size)} key={size}>{size}</button>)}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="submit-button" disabled={loading}>{loading ? 'Joining queue…' : `Join ${house.name} queue`} <span>→</span></button>
        <p className="privacy-note">Your nickname is only shown to your station master for verification and is not displayed publicly.</p>
      </form>
    </section>
  </main>;
}
