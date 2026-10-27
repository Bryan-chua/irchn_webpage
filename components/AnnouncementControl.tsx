'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ANNOUNCEMENT_MESSAGE_LIMIT, ANNOUNCEMENT_TITLE_LIMIT, type Announcement } from '@/lib/announcements';

export default function AnnouncementControl() {
  const [active, setActive] = useState<Announcement | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/announcement', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load the active announcement. Refresh to try again.');
        const result = await response.json() as { announcement: Announcement | null };
        setActive(result.announcement);
        setLoading(false);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load announcement.');
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function save(method: 'PUT' | 'DELETE') {
    setPending(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/announcement', {
        method,
        ...(method === 'PUT' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, message }) } : {}),
      });
      const result = await response.json() as { announcement: Announcement | null; error?: string };
      if (!response.ok) throw new Error(result.error || 'Unable to update announcement.');
      setActive(result.announcement);
      setNotice(method === 'PUT' ? 'Announcement published. Participants with the site open will usually see it within 10 seconds, after dismissing the info popup or closing the guide.' : 'Announcement removed.');
      if (method === 'PUT') { setTitle(''); setMessage(''); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update announcement.');
    } finally { setPending(false); }
  }

  function publish(event: FormEvent) {
    event.preventDefault();
    void save('PUT');
  }

  return <section className="overall-section announcement-control">
    <div className="overall-section-title"><div><small>PARTICIPANT ANNOUNCEMENT</small><h2>Send an update</h2></div></div>
    <p>Publish a popup for participants, including those already on the website. It usually appears within 10 seconds, after the info popup or guide is dismissed. Each new announcement appears again, even if they dismissed the previous one.</p>
    {active && <article className="announcement-preview"><small>ACTIVE ANNOUNCEMENT</small><h3>{active.title}</h3><p className="announcement-message">{active.message}</p><small>Published {new Date(active.publishedAt).toLocaleString()}</small><button type="button" disabled={pending} onClick={() => void save('DELETE')}>Remove announcement</button></article>}
    {loading && !error && <p>Loading announcement…</p>}
    {!loading && !active && <p className="overall-empty">No active announcement.</p>}
    <form onSubmit={publish} className="announcement-form">
      <label htmlFor="announcement-heading">Title</label>
      <input id="announcement-heading" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={ANNOUNCEMENT_TITLE_LIMIT} placeholder="E.g. Event update" required disabled={pending || loading} />
      <label htmlFor="announcement-body">Message</label>
      <textarea id="announcement-body" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={ANNOUNCEMENT_MESSAGE_LIMIT} rows={5} placeholder="What should participants know?" required disabled={pending || loading} />
      <small>{message.length}/{ANNOUNCEMENT_MESSAGE_LIMIT} characters · Publishing replaces the active announcement.</small>
      <button type="submit" disabled={pending || loading || !title.trim() || !message.trim()}>{pending ? 'Saving…' : active ? 'Publish replacement' : 'Publish announcement'}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
