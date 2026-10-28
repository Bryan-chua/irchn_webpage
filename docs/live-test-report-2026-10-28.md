# Live event readiness test — 28 October 2026

Deployed site: https://irchn-queue.rvrc.workers.dev/

Final deployed Worker version: `06bdef15-64e8-4a65-a2f1-f0a4a1044282`.

API and load run: 28 Oct 2026, 10:57:55 AM SGT to 28 Oct 2026, 10:59:20 AM SGT. Final cleanup verified at 28 Oct 2026, 11:12:20 AM SGT.

## Results

- 19 live API acceptance checks passed.
- 1,200 load-test tickets created: 200 at each haunted house.
- 2,863 HTTP requests in the automated run; no network errors or HTTP 5xx responses. Expected validation/authentication rejections were checked separately and passed.
- Phase 1: 600 tickets with 10 concurrent workers, 25.40 seconds, 23.62 tickets/second.
- Phase 2: 600 tickets with 40 concurrent workers, 13.65 seconds, 43.95 tickets/second.
- Join latency: median 351 ms; 95th percentile 630 ms; 99th percentile 775 ms; maximum 952 ms.
- The live scheduled RC cutoff removed all 600 outside-RC load tickets and retained all 600 own-RC load tickets. New outside-RC joins and restoration were rejected; own-RC joins continued.
- No duplicate queue numbers. Public positions, station order, counts and backups agreed under load.

## Problem found and fixed

The station dashboard allowed selecting more than 100 groups, while its API silently limited a request to 100 IDs. Reproduced live: selecting and skipping 103 groups skipped only 100, leaving 3 waiting.

The dashboard now processes every selected group in batches of 100, filters already-skipped groups from Skip actions, and retains unprocessed selections if a later batch fails. The API explicitly rejects oversized requests. Deployed the fix and verified live that all 103 selected groups were entered successfully with no groups left active. Confirmed that the final deployed client contains the Skip fix and that oversized API requests return 400.

Ten local regression tests now pass, including large selections, partial failure, mixed Skip selections, station offline snapshot fallback, reconnect recovery and 24-hour snapshot expiry. Lint, type checking and production builds passed.

## Live API coverage

| Feature | Result |
| --- | --- |
| all seven moderator logins and secure scoped cookies | Pass |
| public pages, all join pages and share assets respond | Pass |
| authentication and station isolation | Pass |
| global close/pause locks station controls and rejects new joins | Pass |
| profile validation, persistence, fixed RC and required profile on joins | Pass |
| group limits, first ticket, nickname privacy and normalized lookup at all six houses | Pass |
| concurrent retries issue one ticket per browser/house and support multiple houses | Pass |
| every station: bulk enter/skip, Undo, original order, estimates and history | Pass |
| cross-station ticket mutation is rejected | Pass |
| individual house pause/close preserves tickets and blocks joins | Pass |
| closing-time capacity projection and validation | Pass |
| announcements publish, replace, public read, validate and remove | Pass |
| CSV exports: entered totals, anonymous report, emergency ordering and formula escaping | Pass |
| failed-login rate limit, operational alert, acknowledgement and audit history | Pass |
| 1,200 load tickets have unique numbers, correct totals and consistent positions | Pass |
| loaded queues support 100-ticket bulk processing and restoration | Pass |
| live scheduled cutoff clears outside RCs and rejects joins/undo while own RCs continue | Pass |
| fresh emergency CSV excludes all cutoff-cancelled tickets | Pass |
| logout expires the moderator cookie | Pass |

## Browser checks

Verified the saved RC popup and persistence after reload, safe-word help, participant guide, announcement appearance and dismissal after reload, joining through the live form, the new-ticket reminder, screenshot prompt, private nickname display, queue estimates and front-of-queue guidance. The participant ticket updated from waiting to entered without a page reload. The loaded station dashboard rendered over 100 groups without console errors; bulk processing and the 40-entry history limit worked.

At a 390 × 844 viewport, the participant ticket fit without horizontal overflow. Browser console checks on the ticket and loaded station dashboard showed no errors.

Limitations: physical printing and a real browser network disconnect/reconnect were not verified. Native computer-control permission was unavailable for the latter, so station offline recovery was checked using automated simulated-network regression tests. The station CSV export API passed; the browser download completion signal timed out, so the browser's completed download was not independently confirmed. This bounded, single-client-region load test does not establish a maximum supported capacity or reproduce every participant device/network.

## Final live state

Verified through the remote database, all six station APIs, the overall dashboard API and the public API:

- Total tickets in the database: **0**.
- Active tickets: **0**.
- Waiting, skipped and entered totals: **0 at every house**; histories empty.
- All six houses: **closed**.
- Overall event: **closed**, station status controls **locked**; attempts to reopen from every station returned 423.
- Last-entry timing anchors cleared.
- Device profiles created by the automated load test and test failed-login counters removed. Other saved RC preferences were preserved.
- Test announcement removed; no active announcement.
- Test cutoff cleared. **Set tonight's desired home-RC-only time in overall control before opening the event.**
- Original event closing time preserved: **28 Oct 2026, 11:00:00 PM SGT**.
- No unresolved, unacknowledged operational alerts in the final dashboard response.
- Deleted test ticket lookup returns 404; the all-house emergency export contains only its header.

Audit history was retained. Credentials and session cookies are excluded from this report and repository.
