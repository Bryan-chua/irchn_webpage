'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- Navigation intentionally uses full page loads for reliable mobile access. */

import { FormEvent, useEffect, useRef, useState } from 'react';
import { HOUSE_BY_CODE, type HouseCode } from '@/lib/houses';
import { minutesPerGroup } from '@/lib/queue';

const DEVICE_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function JoinClient({ houseCode }: { houseCode: HouseCode }) {
  const house = HOUSE_BY_CODE[houseCode];
  const [nickname, setNickname] = useState('');
  const [groupSize, setGroupSize] = useState(2);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(true);
  const joinKey = useRef<string | null>(null);
  const deviceToken = useRef<string | null>(null);

  function getDeviceToken() {
    if (deviceToken.current) return deviceToken.current;
    const storageKey = 'night-of-frights-device-id';
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && DEVICE_TOKEN_PATTERN.test(saved)) { deviceToken.current = saved; return saved; }
      const created = crypto.randomUUID();
      localStorage.setItem(storageKey, created);
      deviceToken.current = created;
      return created;
    } catch {
      deviceToken.current = crypto.randomUUID();
      return deviceToken.current;
    }
  }

  useEffect(() => {
    let stopped = false;
    const findExisting = async () => {
      getDeviceToken();
      try {
        const saved = JSON.parse(localStorage.getItem('night-of-frights-tickets') || '[]') as unknown;
        const queueNumbers = Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string').slice(-24) : [];
        const tickets = await Promise.all(queueNumbers.map(async (queueNumber) => {
          try {
            const response = await fetch(`/api/queues/${encodeURIComponent(queueNumber)}`);
            if (!response.ok) return null;
            const data = await response.json() as { ticket?: { queueNumber: string; houseCode: HouseCode; status: string } };
            return data.ticket || null;
          } catch { return null; }
        }));
        const existing = tickets.find((ticket) => ticket?.houseCode === houseCode && ['waiting', 'skipped'].includes(ticket.status));
        if (!stopped && existing) { window.location.replace(`/queue/${encodeURIComponent(existing.queueNumber)}?existing=1`); return; }
      } catch {}
      if (!stopped) setCheckingExisting(false);
    };
    void findExisting();
    return () => { stopped = true; };
  }, [houseCode]);

  async function join(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      joinKey.current ||= crypto.randomUUID();
      let ticket: ({ queueNumber: string; nickname?: string } & Record<string, unknown>) | undefined;
      let existingTicket = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch('/api/queues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ houseCode, nickname, groupSize, joinKey: joinKey.current, deviceToken: getDeviceToken() }) });
          const data = await response.json() as { error?: string; existing?: boolean; ticket?: typeof ticket };
          if (response.ok && data.ticket) {
            ticket = data.ticket;
            existingTicket = Boolean(data.existing);
            break;
          }
          if (response.status !== 503 || attempt === 2) {
            setError(data.error || 'Unable to join this queue.'); setLoading(false); return;
          }
        } catch {
          if (attempt === 2) throw new Error('Unable to reach the queue.');
        }
        await new Promise((resolve) => setTimeout(resolve, (1000 * (2 ** attempt)) + Math.random() * 500));
      }
      if (!ticket) throw new Error('The queue returned an incomplete ticket.');
      try {
        const stored = JSON.parse(localStorage.getItem('night-of-frights-tickets') || '[]') as unknown;
        const saved = Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : [];
        localStorage.setItem('night-of-frights-tickets', JSON.stringify([...new Set([...saved, ticket.queueNumber])]));
      } catch {}
      try { sessionStorage.setItem(`ticket:${ticket.queueNumber}`, JSON.stringify(ticket)); } catch {}
      window.location.assign(`/queue/${encodeURIComponent(ticket.queueNumber)}?${existingTicket ? 'existing=1' : 'new=1'}`);
    } catch {
      setError('Unable to reach the queue. Check your connection and try again.');
      setLoading(false);
    }
  }

  return <main className="form-page" style={{'--accent': house.accent} as React.CSSProperties}>
    <nav className="nav shell"><a className="brand" href="/"><span className="brand-mark">A</span><span>Abandoned Institutions</span></a><a className="staff-link" href="/">← All houses</a></nav>
    <section className="join-layout shell">
      <div className="join-intro"><div className="eyebrow"><span /> {house.name} haunted house</div><h1>Join the<br /><em>night queue.</em></h1><p>One ticket covers your whole group. Your wait updates automatically as the line moves.</p><div className="join-facts"><span><b>{minutesPerGroup(houseCode)}</b> min / group</span><span><b>8</b> pax maximum</span></div></div>
      <form className="join-form" onSubmit={join}>
        <div className="form-number">01 — YOUR GROUP</div>
        <label htmlFor="nickname">Team nickname</label>
        <input id="nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={2} maxLength={30} placeholder="E.g. Spooky Bananas" autoComplete="off" enterKeyHint="done" required />
        <small>Use something your group remembers. Do not enter real names or personal information.</small>
        <label>Number of people</label>
        <div className="pax-grid">{Array.from({ length: 8 }, (_, index) => index + 1).map((size) => <button type="button" className={groupSize === size ? 'selected' : ''} aria-pressed={groupSize === size} aria-label={`${size} ${size === 1 ? 'person' : 'people'}`} onClick={() => setGroupSize(size)} key={size}>{size}</button>)}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="submit-button" disabled={loading || checkingExisting}>{checkingExisting ? 'Checking existing tickets…' : loading ? 'Joining queue…' : `Join ${house.name} queue`} <span>→</span></button>
        <p className="privacy-note">Your nickname is only shown to your station master for verification and is not displayed publicly.</p>
      </form>
    </section>
  </main>;
}
