'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { HOUSES } from '@/lib/houses';

type HouseSummary = (typeof HOUSES)[number] & { status: string; waitingCount: number; estimatedMinutes: number };

export default function HomeClient() {
  const [houses, setHouses] = useState<HouseSummary[]>(HOUSES.map((house) => ({ ...house, status: 'open', waitingCount: 0, estimatedMinutes: 0 })));
  const [queueNumber, setQueueNumber] = useState('');
  const router = useRouter();

  useEffect(() => {
    const refresh = () => fetch('/api/houses').then((response) => response.json()).then((data) => data.houses && setHouses(data.houses)).catch(() => undefined);
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  function lookup(event: FormEvent) {
    event.preventDefault();
    const clean = queueNumber.trim().toUpperCase().replace(/\s+/g, '');
    if (clean) router.push(`/queue/${encodeURIComponent(clean)}`);
  }

  return (
    <main>
      <nav className="nav shell"><a className="brand" href="#top"><span className="brand-mark">A</span><span>Abandoned Institutions</span></a><Link className="staff-link" href="/moderator">Station master</Link></nav>
      <section className="hero shell" id="top">
        <div className="eyebrow"><span /> Inter-RC Halloween Night 2026</div><h1>Six houses.<br /><em>One haunted night.</em></h1>
        <p>Pick your haunted house, join the queue, and keep your place while you explore the night.</p>
        <a className="primary-button" href="#houses">Choose a haunted house <span>↓</span></a>
      </section>
      <section className="queue-section" id="houses"><div className="shell">
        <div className="section-heading"><div><div className="eyebrow"><span /> Live queues</div><h2>Where will you enter?</h2></div><p>Wait times update as each group enters.</p></div>
        <div className="house-grid">{houses.map((house, index) => (
          <a className={`house-card ${house.status !== 'open' ? 'house-disabled' : ''}`} href={house.status === 'open' ? `/join/${house.code.toLowerCase()}` : undefined} key={house.code} style={{'--accent': house.accent} as React.CSSProperties} aria-disabled={house.status !== 'open'}>
            <div className="card-top"><span className="house-index">0{index + 1}</span><span className={`open-pill status-${house.status}`}><i /> {house.status}</span></div>
            <div><h3>{house.name}</h3><p>Haunted House</p></div>
            <div className="card-bottom"><span><b>{house.estimatedMinutes}</b> min wait</span><span>{house.waitingCount} {house.waitingCount === 1 ? 'group' : 'groups'} waiting</span><strong>↗</strong></div>
          </a>
        ))}</div>
      </div></section>
      <section className="lookup shell"><div><div className="eyebrow"><span /> Already in line?</div><h2>Find your queue</h2><p>Enter the queue number from your screenshot to see your live position.</p></div>
        <form className="lookup-form" onSubmit={lookup}><label htmlFor="queue-number">QUEUE NUMBER</label><div><input id="queue-number" value={queueNumber} onChange={(event) => setQueueNumber(event.target.value)} placeholder="E.G. RV-0420" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go" required /><button type="submit">Check status →</button></div></form>
      </section>
      <footer className="shell"><span>Abandoned Institutions · Inter-RC Halloween Night 2026</span><span>Keep your queue screenshot handy.</span></footer>
    </main>
  );
}
