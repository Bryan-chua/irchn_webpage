'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- Navigation intentionally uses full page loads for reliable mobile access. */

import { FormEvent, useState } from 'react';
import { HOUSES } from '@/lib/houses';

const OVERALL_MODERATOR = 'OVERALL';

export default function ModeratorLogin() {
  const [houseCode, setHouseCode] = useState('RV'); const [pin, setPin] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function login(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const response = await fetch('/api/moderator/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ houseCode, pin }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setError(data.error || 'Unable to sign in.'); setLoading(false); return; }
      window.location.assign(houseCode === OVERALL_MODERATOR ? '/moderator/overall' : `/moderator/${houseCode.toLowerCase()}`);
    } catch {
      setError('Unable to reach the station dashboard. Check your connection and try again.');
      setLoading(false);
    }
  }
  return <main className="moderator-login"><a className="brand" href="/"><span className="brand-mark">A</span><span>Abandoned Institutions</span></a><form onSubmit={login}><div className="eyebrow"><span /> Station master access</div><h1>Manage your<br /><em>haunted queue.</em></h1><label htmlFor="station">Your station</label><select id="station" value={houseCode} onChange={(event) => setHouseCode(event.target.value)}>{HOUSES.map((house) => <option value={house.code} key={house.code}>{house.name}</option>)}<option value={OVERALL_MODERATOR}>Bryan — Overall control</option></select><label htmlFor="pin">Access code</label><input id="pin" type="password" value={pin} onChange={(event) => setPin(event.target.value)} required autoComplete="current-password" />{error && <p className="form-error">{error}</p>}<button className="submit-button" disabled={loading}>{loading ? 'Checking…' : 'Open dashboard'} <span>→</span></button><a className="back-link" href="/">← Back to participant site</a></form></main>;
}
