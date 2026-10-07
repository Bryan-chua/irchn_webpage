# Abandoned Institutions Queue System

A mobile-first virtual queue for **Inter-RC Halloween Night 2026**, covering six NUS residential college haunted houses: **RVRC, CAPT, Acacia, Tembusu, RC4, and NUSC**.

**Live site:** [irchn-queue.rvrc.workers.dev](https://irchn-queue.rvrc.workers.dev/)

# Moderator Pin

RV:135791
CAPT:135792
ACACIA:135793
TEMBUSU:135794
RC4:135795
NUSC:135796

## Features

### Participant experience

- View all six haunted houses from one mobile-friendly home page.
- See each house's live queue status, number of waiting groups, and estimated wait time.
- Join any open queue with a memorable team nickname and a group size of 1–8 people.
- Receive a unique queue number, such as `RV-0420`, for the whole group.
- See a live ticket with the house, queue number, group size, groups ahead, estimated wait, and ticket status.
- Automatically refresh house summaries and tickets every 5 seconds.
- Look up an existing ticket from the home page using its queue number.
- Receive a reminder to move towards the entrance when five or fewer groups remain.
- See clear ticket messages when a group is waiting, entered, skipped, or no longer active.
- Get an immediate prompt to screenshot a newly issued ticket for entrance verification.
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
- Sign out and clear the station session.

### Operational and privacy features

- No participant accounts, real names, phone numbers, email addresses, or NUS IDs are requested.
- Queue numbers are normalized for case and whitespace during lookup.
- New joins are rejected while a queue is paused or closed; existing tickets remain viewable.
- Queue numbers are generated with cryptographically secure randomness and protected by a database uniqueness constraint.
- Moderator sessions use station-scoped, HTTP-only, same-site cookies derived from a server secret. Production cookies are also secure-only and expire after 12 hours.
- API responses containing live queue data use `Cache-Control: no-store`.
- Required D1 tables, indexes, and house settings are created defensively at runtime.
- Open Graph and Twitter metadata provide a share preview for the event site.

## Event rules and queue behaviour

- One ticket represents one group of 1–8 participants.
- A participant may hold one active ticket for each haunted house at the same time.
- Each group is estimated to take 4 minutes.
- A ticket's estimated wait is `groups ahead × 4 minutes`.
- A house card's estimated wait is `waiting groups × 4 minutes`.
- There is no participant notification or call feature; groups must keep checking their live ticket.
- Station masters verify groups using both the queue number and team nickname.
- QR codes are not used.
- Participants should screenshot their ticket immediately after joining.
- Team nicknames must not include real names, phone numbers, email addresses, or other personal information.
- Skipped groups do not count towards queue positions or estimated waits. They remain visible to station masters for manual handling.

Queue numbers and a random anonymous device token are saved in local browser storage. The server stores only a one-way hash of the token and uses it to prevent the same browser from holding multiple active tickets for one house. The database remains the source of truth, and the nickname is kept only in session storage for display on the browser that created the ticket.

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
| `npm run db:generate` | Generate Drizzle migrations from the schema. |
| `npm run deploy` | Build and deploy the Cloudflare Worker. |

## Configuration

`MODERATOR_PINS` is a comma-separated mapping of house codes to access codes:

```text
RV:pin-one,CP:pin-two,AC:pin-three,TM:pin-four,R4:pin-five,NS:pin-six
```

`MODERATOR_SESSION_SECRET` must be a long random value. Never commit production secrets.

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

2. Configure `MODERATOR_PINS` and `MODERATOR_SESSION_SECRET` as Worker secrets.
3. Deploy:

   ```bash
   npm run deploy
   ```

The application initializes missing tables, indexes, and house-status records the first time it accesses a new database. The Drizzle schema is stored in `db/schema.ts`, with generated migrations in `drizzle/`.

## Privacy and retention

The application deliberately avoids collecting direct participant identifiers. Team nicknames exist only to verify a group against its queue number and must still be handled carefully.

Completed records are retained temporarily for operational history. Organisers should delete them after the event or after a short, approved retention period.

## Before event day

- Set six unique station access codes and a strong session secret.
- Confirm whether every haunted house admits exactly one group every 4 minutes; update `MINUTES_PER_GROUP` if the estimate changes.
- Decide how long skipped groups may return and whether they retain their original position.
- Test participant joining, ticket lookup, and all six station logins on the devices that will be used.
- Verify the **Pineapple** safe-word procedure with event staff.
- Run a short load rehearsal with participants joining while station masters process groups.
- Confirm the completed-record deletion time with the event organiser.
