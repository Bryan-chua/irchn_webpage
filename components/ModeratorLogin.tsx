'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { HOUSES } from '@/lib/houses';

export default function ModeratorLogin() {
  const [houseCode, setHouseCode] = useState('RV'); const [pin, setPin] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const router = useRouter();
  async function login(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    const response = await fetch('/api/moderator/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ houseCode, pin }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error || 'Unable to sign in.'); setLoading(false); return; }
    router.push(`/moderator/${houseCode.toLowerCase()}`);
  }
  return <main className="moderator-login"><Link className="brand" href="/"><span className="brand-mark">A</span><span>Abandoned Institutions</span></Link><form onSubmit={login}><div className="eyebrow"><span /> Station master access</div><h1>Manage your<br /><em>haunted queue.</em></h1><label htmlFor="station">Your station</label><select id="station" value={houseCode} onChange={(event) => setHouseCode(event.target.value)}>{HOUSES.map((house) => <option value={house.code} key={house.code}>{house.name}</option>)}</select><label htmlFor="pin">Access code</label><input id="pin" type="password" value={pin} onChange={(event) => setPin(event.target.value)} required autoComplete="current-password" />{error && <p className="form-error">{error}</p>}<button className="submit-button" disabled={loading}>{loading ? 'Checking…' : 'Open dashboard'} <span>→</span></button><Link className="back-link" href="/">← Back to participant site</Link></form></main>;
}
