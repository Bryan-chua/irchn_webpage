# Abandoned Institutions Queue System

A mobile-first virtual queue for **Inter-RC Halloween Night 2026**, covering six NUS residential college haunted houses: **RVRC, CAPT, Acacia, Tembusu, RC4, and NUSC**.

**Live site:** [irchn-queue.rvrc.workers.dev](https://irchn-queue.rvrc.workers.dev/)

## Features

### Participant experience

- View all six haunted houses from one mobile-friendly home page.
- Select a home RC in a popup after the first-visit guide and before announcements. The choice is remembered in the browser and tied to the anonymous device token on the server.
- See each house's live queue status, number of waiting groups, and estimated wait time. House cards refresh about every four seconds while visible, and immediately when returning to the tab or reconnecting. Return-to-tab checks bypass the shared cache.
- Join any open queue with a memorable team nickname and a group size of 1–8 people, 4–8 people for Tembusu, or 1–5 people for RC4.
- Receive a unique queue number, such as `RV-0420`, for the whole group.
- See a live ticket with the house, queue number, group size, groups ahead, estimated wait, and ticket status.
- Automatically refresh house summaries and live tickets, including after entry so a station master's undo appears without reloading. Returning to the ticket tab triggers an immediate refresh.
- Look up an existing ticket from the home page using its queue number.
- Receive a reminder to move towards the entrance when five or fewer groups remain.
- See clear ticket messages when a group is waiting, entered, skipped, or no longer active.
- Get an immediate prompt to screenshot a newly issued ticket for entrance verification.
- See a one-time popup after joining that explains how to check the ticket again and when to head to the entrance.
- Join queues for multiple haunted houses at the same time, subject to the event rules below.
- View the event safe word, **Pineapple**, and instructions for using it during the experience.

Team nicknames are visible only to the participant who just joined and the station master. Public ticket lookups never return the nickname.

### Station master experience

- Sign in to a station-specific dashboard using the haunted house and its access code.
- Manage only the queue associated with the signed-in station.
- View waiting and skipped groups in queue order, including queue number, private nickname, group size, status, and elapsed wait.
- Select individual groups or the entire visible queue.
- Bulk mark selected groups as **entered** or **skipped**.
- Keep skipped groups visible for manual follow-up without counting them in other groups' wait estimates.
- Review the 40 most recently entered or cancelled records in the history view.
- Monitor live totals for waiting groups, estimated clear time, and participants waiting.
- Change the station queue between **open**, **paused**, and **closed**.
- Refresh queue data automatically every 4 seconds.
- Keep a rolling, 24-hour emergency snapshot of the active queue on the signed-in station device.
- Fall back to a clearly timestamped, read-only local snapshot if live refreshes fail.
- Download a CSV backup or print an emergency checklist containing the current waiting and skipped groups.
- Sign out and clear the station session.

### Overall moderator experience

- Sign in through **Bryan — Overall control** with a separate overall-moderator PIN.
- Publish or remove a participant announcement popup. Publishing replaces the active announcement; each new announcement is shown once per browser after dismissal.
- Open participant pages check for announcements every 10 seconds while visible, with retries backing off to 60 seconds on failure. Returning to a tab or reconnecting triggers an immediate check. On the homepage, the first-visit info tip and participant guide take priority.
- Open and unlock all houses, or pause/close all houses while locking station status controls.
- Set, change or clear a one-time **scheduled opening** in Singapore time. It automatically opens all six queues and unlocks station status controls without the dashboard staying open. Manual global open/pause/close cancels a pending opening.
- Control individual house statuses while the event is unlocked.
- Set or clear a separate **Home RC only** cutoff in Singapore time. At the cutoff, outside-RC waiting and skipped tickets (including tickets without a selected RC) are cancelled, and new outside-RC joins are blocked. Own-RC tickets remain valid. Clearing or postponing the cutoff does not restore cancelled tickets.
- Set an automatic event closing time in Singapore time. All six queues close and station status controls lock at that time; existing tickets remain viewable. The same closing time supports capacity projections.
- Review and acknowledge persistent operational alerts without deleting their history.
- Review an audit log of global and station status changes and security warnings.
- View estimated participants and total haunted-house admissions by home RC in the overall dashboard.
- Export an anonymous CSV containing entered-participant totals per haunted house, home-RC statistics, and recorded site issues.
- Download a separate all-house emergency CSV containing every current waiting and skipped group.

### Operational and privacy features

- No participant accounts, real names, phone numbers, email addresses, or NUS IDs are requested.
- Queue numbers are normalized for case and whitespace during lookup.
- New joins are rejected while a queue is paused or closed; existing tickets remain viewable.
- Queue numbers are generated with cryptographically secure randomness and protected by a database uniqueness constraint.
- Moderator sessions use station-scoped, HTTP-only, same-site cookies derived from a server secret. Production cookies are also secure-only and expire after 12 hours.
- Individual tickets and moderator queue responses use `Cache-Control: no-store`; public house summaries use a three-second shared edge cache while disabling browser caching.
- D1 tables, indexes, and event-control records are managed through versioned migrations.
- Open Graph and Twitter metadata provide a share preview for the event site.

## Event rules and queue behaviour

- One ticket represents one group of 1–8 participants, except Tembusu, which allows 4–8 participants, and RC4, which allows 1–5 participants.
- A participant may hold one active ticket for each haunted house at the same time.
- Per-group estimates are configured by house in `lib/queue.ts`.
- A ticket's estimated wait is based on its waiting groups ahead and the house's configured duration.
- A house card's estimated clear time is based on all waiting groups and the house's configured duration.
- Before a house records its first entry, estimates use the earliest waiting group's join time as the countdown anchor. After a group is marked entered, estimates use that recorded entry time.
- Public wait estimates show approximate whole minutes; an overdue queue shows "Delayed", a ticket at the front shows "Up next", and an empty queue shows "No wait".
- There is no push notification or call feature; groups must keep checking their live ticket. The popup appears only after joining, while the site is open.
- Station masters verify groups using both the queue number and team nickname.
- QR codes are not used.
- Participants should screenshot their ticket immediately after joining.
- Team nicknames must not include real names, phone numbers, email addresses, or other personal information.
- Skipped groups do not count towards queue positions or estimated waits. They remain visible to station masters for manual handling.
- Queue order follows the database ticket sequence, not request timestamps, so simultaneous joins have the same order on participant tickets, station dashboards, and emergency backups. Undo restores a ticket to its original position.

Queue numbers, the selected home RC, and a random anonymous device token are saved in local browser storage. The first confirmed RC is also stored against the hashed device token on the server and cannot be changed on that browser. This is a self-declared RC, not proof of residency; clearing browser storage or using another device creates a new anonymous identity. The server stores only a one-way hash of the token and uses it to prevent the same browser from holding multiple active tickets for one house. The database remains the source of truth, and the nickname is kept only in session storage for display on the browser that created the ticket.

The home-RC-only cutoff is enforced on the server and by database write guards, including station attempts to restore or admit an ineligible ticket. Queue requests cancel expired tickets before reading positions, station queues, or emergency backups; existing participant and dashboard polling performs this automatically without the overall dashboard staying open. With no traffic, cancellation is applied on the next queue request. Older tickets can acquire the browser’s selected RC before the cutoff. Cancelled ticket pages explain the cutoff reason.

### Home-RC event statistics

Everyone on a ticket is assumed to belong to its selected home RC. **Estimated participants** counts each anonymous browser’s group once across all houses, using the largest group size recorded on any of its tickets. Waiting, skipped, entered and cancelled tickets all contribute to this registration estimate. **Haunted-house admissions** sums group sizes on currently entered tickets; each visit counts again, and Undo removes that visit from admissions. RC selection alone does not count until a ticket is issued.

These are group-based estimates, not verified individual attendance. Changing browsers or clearing browser storage can count a group again; changing group membership cannot be tracked. Legacy tickets without a device token count separately, and tickets without a valid RC appear under **Unknown RC**. Dashboard and event CSV use the same calculation. CSV rows with `record_type=home_rc_summary` populate `home_rc`, `estimated_participants` and `haunted_house_admissions`; existing house-summary and site-issue rows remain available. Export the report before deleting ticket records, because the statistics are derived from those records.

## Status reference

### House statuses

- **Open:** participants may join the queue.
- **Paused:** new joins are temporarily disabled, while existing tickets remain valid.
- **Closed:** new joins are disabled, while existing tickets remain valid.

### Ticket statuses

- **Waiting:** the group has an active place in line.
- **Skipped:** the group was unavailable and should speak to the station master.
- **Entered:** the group has entered the haunted house.
- **Cancelled:** the ticket is no longer active.

## Tech stack

- Next.js 16 and React 19
- TypeScript
- vinext and Vite
- Cloudflare Workers
- Cloudflare D1 with Drizzle ORM
- Tailwind CSS 4 tooling with the application's global stylesheet

## Local development

Requirements: **Node.js 22.13 or newer**.

1. Copy `.env.example` to `.env.local`.
2. Replace every sample moderator PIN and the session secret.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`.

When moderator settings are absent in local development, every station uses `boo2026`. This fallback is disabled in production.

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local vinext development server. |
| `npm run build` | Create the production build. |
| `npm run start` | Run the built application locally. |
| `npm run lint` | Run ESLint. |
| `npm run test:regression` | Check queue ordering, backups, undo refresh, polling, RC persistence and cutoff enforcement against local fixtures. |
| `npm run db:generate` | Generate Drizzle migrations from the schema. |
| `npm run deploy` | Build and deploy the Cloudflare Worker. |

## Configuration

`MODERATOR_PINS` is a comma-separated mapping of house codes to access codes:

```text
RV:pin-one,CP:pin-two,AC:pin-three,TM:pin-four,R4:pin-five,NS:pin-six
```

`MODERATOR_SESSION_SECRET` must be a long random value. Never commit production secrets.

`OVERALL_MODERATOR_PIN` is the separate access code for **Bryan — Overall control**. Local development falls back to `bryan2026`; production has no fallback.

House codes are:

| House | Code |
| --- | --- |
| RVRC | `RV` |
| CAPT | `CP` |
| Acacia | `AC` |
| Tembusu | `TM` |
| RC4 | `R4` |
| NUSC | `NS` |

## Cloudflare deployment

The production Worker is named `irchn-queue`. It uses the APAC D1 database `irchn-queue-db` through the `DB` binding.

1. Authenticate Wrangler:

   ```bash
   npx wrangler login
   ```

2. Configure `MODERATOR_PINS`, `OVERALL_MODERATOR_PIN`, and `MODERATOR_SESSION_SECRET` as Worker secrets.
3. Deploy:

   ```bash
   npm run deploy
   ```

The deploy command applies versioned D1 migrations before publishing the Worker. `worker.ts` preserves the vinext request handler and adds a Cloudflare Cron Trigger that checks for scheduled opening and closing every minute. Queue requests also apply due schedules. Opening or closing all houses and recording the action happen atomically, once, so subsequent manual overall controls can override an action that has already fired. Opening times must be in the future and before the configured closing time; an overdue opening is not applied after closing. Changing the closing time rearms automatic closing; clearing it disables automatic closing without reopening houses. Selecting a past closing time applies it immediately. New joins check house status and an unapplied closing deadline atomically when the ticket is inserted. The Drizzle schema is stored in `db/schema.ts`, with generated migrations in `drizzle/`.

## Privacy and retention

The application deliberately avoids collecting direct participant identifiers. Team nicknames exist only to verify a group against its queue number and must still be handled carefully.

Completed records are retained temporarily for operational history. Organisers should delete them after the event or after a short, approved retention period.

## Before event day

- Set six unique station access codes, a separate overall-moderator PIN, and a strong session secret.
- Confirm each house's configured time per group in `MINUTES_PER_GROUP`.
- Sign in as Bryan, set the event closing time and optional home-RC-only cutoff (Singapore time), then use **Close all & lock**. If desired, set a scheduled opening afterwards. Using manual global controls again cancels that schedule.
- Have every station load its dashboard and download or print an initial emergency queue backup; refresh the download periodically during the event.
- Decide how long skipped groups may return and whether they retain their original position.
- Test participant joining, ticket lookup, and all six station logins on the devices that will be used.
- Verify the **Pineapple** safe-word procedure with event staff.
- Run a short load rehearsal with participants joining while station masters process groups.
- Confirm the completed-record deletion time with the event organiser.
