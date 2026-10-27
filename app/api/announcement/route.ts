import { getDb, temporarilyUnavailable } from '@/lib/db';
import { isOverallModerator } from '@/lib/moderator-auth';
import { recordActivity, recordSiteError } from '@/lib/operations';
import { ANNOUNCEMENT_MESSAGE_LIMIT, ANNOUNCEMENT_TITLE_LIMIT, type Announcement } from '@/lib/announcements';

export async function GET() {
  try {
    const announcement = await getDb().prepare(`SELECT version, title, message, published_at AS publishedAt
      FROM announcement WHERE id = 1`).first<Announcement>();
    return Response.json({ announcement }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await recordSiteError('announcement_load', error);
    return temporarilyUnavailable(error);
  }
}

export async function PUT(request: Request) {
  if (!await isOverallModerator(request)) return Response.json({ error: 'Overall moderator access required.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { title?: unknown; message?: unknown } | null;
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!title || title.length > ANNOUNCEMENT_TITLE_LIMIT || !message || message.length > ANNOUNCEMENT_MESSAGE_LIMIT) {
    return Response.json({ error: `Enter a title of 1–${ANNOUNCEMENT_TITLE_LIMIT} characters and a message of 1–${ANNOUNCEMENT_MESSAGE_LIMIT} characters.` }, { status: 400 });
  }
  try {
    const db = getDb();
    const announcement: Announcement = { version: crypto.randomUUID(), title, message, publishedAt: Date.now() };
    await db.prepare(`INSERT INTO announcement (id, version, title, message, published_at)
      VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      version = excluded.version, title = excluded.title, message = excluded.message, published_at = excluded.published_at`)
      .bind(announcement.version, title, message, announcement.publishedAt).run();
    await recordActivity({ eventType: 'announcement_published', actor: 'Bryan', message: `Bryan published an announcement: ${title}` }, db);
    return Response.json({ announcement }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await recordSiteError('announcement_publish', error);
    return temporarilyUnavailable(error);
  }
}

export async function DELETE(request: Request) {
  if (!await isOverallModerator(request)) return Response.json({ error: 'Overall moderator access required.' }, { status: 401 });
  try {
    const db = getDb();
    await db.prepare('DELETE FROM announcement WHERE id = 1').run();
    await recordActivity({ eventType: 'announcement_removed', actor: 'Bryan', message: 'Bryan removed the active announcement.' }, db);
    return Response.json({ announcement: null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await recordSiteError('announcement_remove', error);
    return temporarilyUnavailable(error);
  }
}
