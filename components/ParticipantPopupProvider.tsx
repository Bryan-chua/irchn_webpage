'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { usePathname } from 'next/navigation';
import { HOUSES, HOUSE_BY_CODE, type HouseCode } from '@/lib/houses';
import { getParticipantDeviceToken } from '@/lib/participant-device';

type ParticipantContext = {
  guideIsBlocking: boolean;
  setGuideIsBlocking: Dispatch<SetStateAction<boolean>>;
  rcIsBlocking: boolean;
  homeRc: HouseCode | null;
  homeRcOnlyAt: number | null;
  ownRcOnly: boolean;
};
const ParticipantPopupContext = createContext<ParticipantContext | null>(null);

export default function ParticipantPopupProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const participantPage = !pathname?.startsWith('/moderator');
  const [guideIsBlocking, setGuideIsBlocking] = useState(true);
  const [ready, setReady] = useState(false);
  const [homeRc, setHomeRc] = useState<HouseCode | null>(null);
  const [choice, setChoice] = useState('');
  const [homeRcOnlyAt, setHomeRcOnlyAt] = useState<number | null>(null);
  const [ownRcOnly, setOwnRcOnly] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const serverOffset = useRef(0);

  const sync = useCallback(async (selected?: string, signal?: AbortSignal) => {
    const response = await fetch('/api/participant', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken: getParticipantDeviceToken(), ...(selected ? { homeRc: selected } : {}) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    const data = await response.json() as { error?: string; homeRc: HouseCode | null; homeRcOnlyAt: number | null; serverNow: number };
    if (!response.ok) throw new Error(data.error || 'Unable to save your RC. Please try again.');
    serverOffset.current = data.serverNow - Date.now();
    setHomeRc((current) => current || data.homeRc);
    setHomeRcOnlyAt(data.homeRcOnlyAt);
    setOwnRcOnly(data.homeRcOnlyAt !== null && data.serverNow >= data.homeRcOnlyAt);
    setReady(true);
    setError('');
    try {
      if (data.homeRc) localStorage.setItem('night-of-frights-home-rc', data.homeRc);
    } catch {}
  }, []);

  useEffect(() => {
    if (!participantPage) return;
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try { await sync(undefined, controller.signal); }
      catch { if (!controller.signal.aborted) { setReady(true); setError('Unable to check your RC. Check your connection and try again.'); } }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, [participantPage, sync]);

  useEffect(() => {
    if (homeRcOnlyAt === null) return;
    const update = () => setOwnRcOnly(Date.now() + serverOffset.current >= homeRcOnlyAt);
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [homeRcOnlyAt]);

  const rcIsBlocking = participantPage && !homeRc;
  const show = rcIsBlocking && ready && (pathname !== '/' || !guideIsBlocking);
  useEffect(() => {
    if (!show) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, [show]);

  async function save() {
    if (!choice) return;
    setSaving(true);
    try { await sync(choice); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save your RC.'); }
    finally { setSaving(false); }
  }
  const value = useMemo(() => ({ guideIsBlocking, setGuideIsBlocking, rcIsBlocking, homeRc, homeRcOnlyAt, ownRcOnly }), [guideIsBlocking, rcIsBlocking, homeRc, homeRcOnlyAt, ownRcOnly]);
  return <ParticipantPopupContext.Provider value={value}>{children}
    {show && <dialog ref={dialog} className="announcement-dialog rc-dialog" aria-labelledby="rc-title" aria-describedby="rc-description rc-rules" onCancel={(event) => event.preventDefault()}>
      <div className="eyebrow"><span /> Your residential college</div>
      <h2 id="rc-title">Which RC are you from?</h2>
      <p id="rc-description">Choose your group’s home RC. We’ll remember your choice on this browser.</p>
      <p id="rc-rules"><strong>At 9:00 pm, all waiting and skipped tickets for haunted houses outside your home RC will be cancelled. From then on, you can only join your own RC’s queue. Tickets for your own RC will remain valid.</strong></p>
      <label htmlFor="home-rc">Home RC</label>
      <select id="home-rc" value={choice} onChange={(event) => setChoice(event.target.value)} autoFocus><option value="">Select your RC</option>{HOUSES.map((house) => <option key={house.code} value={house.code}>{house.name}</option>)}</select>
      <p>Please check your choice before confirming. Your RC cannot be changed on this browser.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="submit-button" disabled={!choice || saving} onClick={() => void save()}>{saving ? 'Saving…' : choice ? `Confirm ${HOUSE_BY_CODE[choice as HouseCode].name}` : 'Choose your RC'}</button>
    </dialog>}
  </ParticipantPopupContext.Provider>;
}

export function useParticipantPopups() {
  const context = useContext(ParticipantPopupContext);
  if (!context) throw new Error('Participant popups require ParticipantPopupProvider.');
  return context;
}
