'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { Announcement } from '@/lib/announcements';
import { useParticipantPopups } from './ParticipantPopupProvider';

const DISMISSED_KEY = 'night-of-frights-announcement-dismissed';
const REFRESH_MS = 10_000;
const MAX_REFRESH_MS = 60_000;
let dismissedVersion: string | null = null;

export default function AnnouncementPopup() {
  const pathname = usePathname();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const participantPage = !pathname?.startsWith('/moderator');
  const { guideIsBlocking, rcIsBlocking } = useParticipantPopups();
  const canShow = participantPage && !rcIsBlocking && (pathname !== '/' || !guideIsBlocking);

  useEffect(() => {
    if (!participantPage) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let inFlight = false;

    async function load() {
      if (controller.signal.aborted || document.hidden || inFlight) return;
      inFlight = true;
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      controller.signal.addEventListener('abort', abortRequest, { once: true });
      const timeout = setTimeout(abortRequest, REFRESH_MS);
      try {
        const response = await fetch('/api/announcement', { cache: 'no-store', signal: requestController.signal });
        if (!response.ok) throw new Error('Unable to refresh announcement.');
        const { announcement: active } = await response.json() as { announcement: Announcement | null };
        let dismissed = dismissedVersion;
        try { dismissed = localStorage.getItem(DISMISSED_KEY) || dismissed; } catch {}
        if (!controller.signal.aborted) {
          const next = active && active.version !== dismissed ? active : null;
          // Keep an open popup stable when polling returns the same version.
          setAnnouncement((current) => current?.version === next?.version ? current : next);
        }
        failures = 0;
      } catch {
        failures += 1;
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', abortRequest);
        inFlight = false;
        if (!controller.signal.aborted && !document.hidden) {
          timer = setTimeout(load, Math.min(MAX_REFRESH_MS, REFRESH_MS * (2 ** failures)));
        }
      }
    }

    function resume() {
      clearTimeout(timer);
      if (!document.hidden) void load();
    }

    function syncDismissal(event: StorageEvent) {
      if (event.key !== DISMISSED_KEY) return;
      dismissedVersion = event.newValue;
      setAnnouncement((current) => current?.version === event.newValue ? null : current);
    }

    void load();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('storage', syncDismissal);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('storage', syncDismissal);
    };
  }, [pathname, participantPage]);

  useEffect(() => {
    if (!announcement || !canShow) return;
    const element = dialog.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [announcement, canShow]);

  function dismiss() {
    if (!announcement) return;
    dismissedVersion = announcement.version;
    try { localStorage.setItem(DISMISSED_KEY, announcement.version); } catch {}
    setAnnouncement(null);
  }

  if (!announcement || !canShow) return null;
  return <dialog ref={dialog} className="announcement-dialog" aria-labelledby="announcement-title" aria-describedby="announcement-message" onCancel={(event) => { event.preventDefault(); dismiss(); }}>
    <div className="eyebrow"><span /> Event announcement</div>
    <h2 id="announcement-title">{announcement.title}</h2>
    <p id="announcement-message" className="announcement-message">{announcement.message}</p>
    <button type="button" className="submit-button" onClick={dismiss} autoFocus>Got it <span aria-hidden="true">✓</span></button>
  </dialog>;
}
