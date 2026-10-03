# Abandoned Institutions Queue System

A mobile-first queue system for six NUS residential college haunted houses: RVRC, CAPT, Acacia, Tembusu, RC4, and NUSC.

## Agreed event rules

- Each queue ticket represents one group of 1–8 participants.
- A participant may hold one ticket for each haunted house at the same time.
- Each group is expected to take about 4 minutes.
- Estimated wait time is `groups ahead × 4 minutes` and updates as the queue moves.
- There is no participant call or notification feature.
- Station masters verify participants by asking for both the queue number and team nickname.
- QR codes are not used.
- Participants are prompted to screenshot the ticket after joining.
- Team nicknames should not contain real names, phone numbers, email addresses, or other personal information.
- Nicknames are never displayed publicly.

## Participant experience

1. The home page displays all six haunted houses, their queue status, groups waiting, and estimated wait.
2. The participant selects a haunted house.
3. They enter a team nickname and select a group size from 1–8.
4. The system issues a unique queue number such as `RV-0420`.
5. The ticket page shows the queue number, nickname, group size, groups ahead, and estimated wait.
6. The participant is asked to screenshot the page.
7. The live ticket refreshes automatically every 5 seconds.
8. The home-page lookup accepts a queue number and opens its live status.
9. When five or fewer groups remain, the ticket asks the group to move towards the entrance.

Queue numbers are also saved in browser storage as a convenience, but the database remains the source of truth.

## Station master experience

Each station master signs in with their RC and a station-specific access code. They can only manage that RC's queue.

The dashboard provides:

- Current waiting and skipped groups in queue order
- Queue number, private nickname, group size, elapsed waiting time, and status
- Checkbox selection similar to an inbox
- Bulk **Mark as entered** and **Skip** actions
- An entered/cancelled history view
- Live counts for waiting groups, estimated clear time, and total participants waiting
- Controls to open, pause, or close the queue
- Automatic refresh every 4 seconds

Skipped groups no longer count towards other groups' estimated wait. They remain visible so the station master can handle them manually.

## Privacy and retention

The application intentionally does not request real names, phone numbers, emails, NUS IDs, or other direct identifiers. Team nicknames are used only for queue-number verification.

User-provided nicknames should still be handled carefully. Completed records are retained temporarily for operational history and should be deleted after the event or after a short organiser-approved retention period.

## Local development

Requirements: Node.js 22.13 or newer.

1. Copy `.env.example` to `.env.local` and replace every moderator PIN and the session secret.
2. Install dependencies with `npm install`.
3. Start the development site with `npm run dev`.
4. Open `http://localhost:3000`.

## Cloudflare deployment

The production Worker is named `irchn-queue` and uses the APAC D1 database
`irchn-queue-db` through the `DB` binding.

Production URL: `https://irchn-queue.rvrc.workers.dev`

1. Authenticate Wrangler with `npx wrangler login`.
2. Configure `MODERATOR_PINS` and `MODERATOR_SESSION_SECRET` as Worker secrets.
3. Deploy with `npm run deploy`.

The API creates the required tables and house-status rows defensively when it
first accesses a new database.

When no local moderator settings are present, development mode uses `boo2026` for each station. This fallback is disabled in production.

## Configuration

`MODERATOR_PINS` is a comma-separated list in this format:

```text
RV:pin-one,CP:pin-two,AC:pin-three,TM:pin-four,R4:pin-five,NS:pin-six
```

`MODERATOR_SESSION_SECRET` should be a long random value. Never commit production secrets.

The site uses a Cloudflare D1 database through the Sites runtime. Tables and required indexes are created defensively at runtime, and the Drizzle schema is stored in `db/schema.ts`.

## Queue statuses

- **Open:** participants may join.
- **Paused:** new joins are temporarily disabled, while existing tickets remain valid.
- **Closed:** new joins are disabled.
- **Waiting:** active participant ticket.
- **Skipped:** group was unavailable; the station master should handle it manually.
- **Entered:** group entered the haunted house.
- **Cancelled:** ticket is no longer active.

## Before event day

- Set six unique station access codes and a strong session secret.
- Confirm whether each haunted house admits exactly one group every 4 minutes. If capacity differs, update the estimate formula.
- Decide how long skipped groups may return and whether they retain their original position.
- Test all six station logins on the devices that will be used.
- Run a short load rehearsal with participants joining and moderators processing tickets.
- Confirm the record-deletion time with the event organiser.
