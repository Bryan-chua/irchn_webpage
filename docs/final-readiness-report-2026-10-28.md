# Final event readiness report — 28 October 2026

Live site: https://irchn-queue.rvrc.workers.dev/

Deployed Worker version: `d7a92f68-e1b1-45fe-98b4-f476e47d88e5`.

Final live API verification: **28 Oct 2026, 04:17:48 PM SGT**. This report distinguishes observed production behaviour from local regression coverage and untested situations.

## Readiness outcome

**37 live checks passed**, supported by **26 passing local regression tests**, lint, TypeScript checks and a successful production build. No unresolved application failures were found in the tested flows. All confirmed test data has been removed.

The saved event timings are active and preserved:

| Action | Singapore time | Current state |
| --- | --- | --- |
| Open all six houses and unlock station controls | **6:00 pm** | Scheduled; has not fired |
| Switch to home-RC-only queues | **9:00 pm** | Scheduled |
| Close all six queues and lock station controls | **11:00 pm** | Scheduled; has not fired |

The system is currently **closed and locked**, with **zero tickets**, empty histories and zero RC participation/admission statistics. There is no active test announcement.

## Important finding and implementation

The previous Event closing time setting supported capacity estimates but did not close queues automatically. This was identified before testing; Bryan explicitly approved adding automatic closing.

Automatic closing is now deployed. It runs through the same background scheduler as opening, closes all six queues, locks station status controls and records one audit event. Queue requests also apply due schedules. Closure and its audit record are atomic; repeated background/request checks do not repeat the action. Closing takes priority if both deadlines have passed.

Ticket creation now checks the house status and an unapplied closing deadline atomically at insertion. This protects against a request reading Open just before a manual closure, pause or scheduled closing boundary.

Closing stops **new joins**. Existing valid tickets remain viewable and can still be processed by station staff; closing does not cancel them. Outside-RC cancellation remains the separate 9 pm rule.

## Scheduled opening and closing: actual production test

A temporary opening was scheduled for **28 Oct 2026, 04:09:00 PM SGT**, followed by closing one minute later at **28 Oct 2026, 04:10:00 PM SGT**. During this window, the test client made **no participant, station or overall-dashboard API requests**. It observed the state through direct database reads only. The browser test tab was closed beforehand.

- All six houses opened and station controls unlocked automatically.
- The recorded opening occurred **4.232 seconds** after its selected time.
- All six houses then closed and station controls locked automatically.
- The recorded closing occurred **2.808 seconds** after its selected time.
- Exactly one opening audit and one closing audit were recorded for these schedules.
- Existing waiting tickets remained valid and publicly viewable after closing.
- Every station received **423 Locked** when trying to reopen after the scheduled close.
- A fresh join after closing received **409 Conflict**.
- An intentional overall manual override after automatic closing was respected, rather than immediately overwritten by the next scheduler check.

This verifies that the actions do not depend on keeping our dashboard or participant page open. The public site was live, so traffic from other visitors cannot be excluded. Background checks run every minute, and queue requests provide a fallback; the observed delays are measurements, not a timing SLA.

## Manual controls and homepage reflection

Every house was tested individually and under global control:

- Global Open opens all six queues and unlocks station status controls.
- Global Pause and Close update the public statuses, block new joins and lock station status controls.
- Existing tickets remain viewable through pauses and closures.
- Each station can pause, close and reopen its own house while unlocked; other houses retain their statuses.
- A station cannot change another station’s tickets or use overall controls.
- Opening schedules can be saved, rescheduled and cleared. Global manual controls cancel a pending opening schedule.

In the actual live Chrome browser, the same participant homepage initially showed **six Open cards and six join links**. After closing through overall control, it changed automatically to **six Closed/disabled cards and zero join links**, without reloading. There were no browser console errors during this check.

Local tests additionally cover tab return, focus, reconnection, back navigation, hung-request timeout/retry, no overlapping polls, unmount cleanup and Closed labels taking priority over Residents only. House cards poll about every four seconds while visible; shared edge caching lasts up to three seconds, while browser caching is disabled. Return-to-tab checks bypass that shared cache.

## Joins across the actual closing deadline

An additional **36 controlled joins** were sent in waves across all six houses before and after a short closing deadline:

- **11** were accepted before the deadline.
- **25** were rejected as the deadline passed or after it.
- No issued ticket had a join timestamp at or after closing.
- Every request sent after the deadline was rejected.
- All six houses ended Closed, with station controls locked.

Local regression tests also force a closure, pause or newly elapsed closing deadline between the status read and ticket insert. Each case returns 409 and creates no ticket.

## Load-test results

The broader suite issued **1,200 load tickets**, 200 per house, plus functional fixtures. It made **3,035 HTTP requests** with **zero server errors and zero network errors**. Expected validation/authentication rejections were asserted as correct behaviour.

| Phase | Load tickets | Concurrent workers | Duration | Tickets/second | Server/network errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 600 | 10 | 45.59 s | 13.16 | 0 |
| 2 | 600 | 40 | 21.07 s | 28.47 | 0 |

Measured join latency:

| Percentile | Latency |
| --- | ---: |
| Median | 445 ms |
| 95th | 1966 ms |
| 99th | 2176 ms |
| Maximum | 2570 ms |

There were no duplicate load-ticket numbers. Public ticket positions, station ordering, overall counts and emergency exports agreed. Bulk processing and restoration of 100 groups per station worked on the loaded queues.

All **600 outside-RC load tickets** were cancelled at the temporary RC cutoff, while all **600 own-RC load tickets** stayed active. New outside-RC joins and attempted restoration were rejected; own-RC joining continued. Cancelled tickets were excluded from fresh emergency exports.

## Event-report statistics

The live dashboard and CSV agreed throughout the tests. Checks covered:

- One estimated group count per anonymous browser across multiple houses.
- The largest recorded group size used as that browser’s participant estimate.
- Each entered visit counted in haunted-house admissions.
- Undo removing an admission without losing the registration estimate.
- Registration estimates surviving cutoff cancellations.
- Totals remaining consistent under the 1,200-ticket load.
- Anonymous exports without team nicknames or device hashes.

The estimates still depend on the assumption that one browser represents one group and everyone in that group belongs to its selected RC. Separate browsers or cleared browser storage can count a group again. Export the event report before deleting real ticket records.

## Complete live-check matrix

| Area | Check | Result |
| --- | --- | --- |
| General live API/load | all seven moderator logins and secure scoped cookies | Pass |
| General live API/load | public pages, all join pages and share assets respond | Pass |
| General live API/load | authentication and station isolation | Pass |
| General live API/load | global close/pause locks station controls and rejects new joins | Pass |
| General live API/load | profile validation, persistence, fixed RC and required profile on joins | Pass |
| General live API/load | group limits, first ticket, nickname privacy and normalized lookup at all six houses | Pass |
| General live API/load | all six houses: global closing and pausing update public status, block joins, lock controls and preserve tickets | Pass |
| General live API/load | all six stations: individual pause and close only affect their own house and reopening accepts joins | Pass |
| General live API/load | opening schedule saves, reschedules and clears; manual global controls cancel it | Pass |
| General live API/load | concurrent retries issue one ticket per browser/house and support multiple houses | Pass |
| General live API/load | every station: bulk enter/skip, Undo, original order, estimates and history | Pass |
| General live API/load | cross-station ticket mutation is rejected | Pass |
| General live API/load | individual house pause/close preserves tickets and blocks joins | Pass |
| General live API/load | closing-time capacity projection and validation | Pass |
| General live API/load | announcements publish, replace, public read, validate and remove | Pass |
| General live API/load | CSV exports: entered totals, anonymous report, emergency ordering and formula escaping | Pass |
| General live API/load | failed-login rate limit, operational alert, acknowledgement and audit history | Pass |
| General live API/load | home-RC statistics deduplicate repeat visits, use the largest group and match the CSV | Pass |
| General live API/load | 1,200 load tickets have unique numbers, correct totals and consistent positions | Pass |
| General live API/load | home-RC statistics stay accurate with 1,200 load tickets | Pass |
| General live API/load | loaded queues support 100-ticket bulk processing and restoration | Pass |
| General live API/load | live scheduled cutoff clears outside RCs and rejects joins/undo while own RCs continue | Pass |
| General live API/load | RC registration estimates survive cutoff cancellations and continue to match exports | Pass |
| General live API/load | fresh emergency CSV excludes all cutoff-cancelled tickets | Pass |
| General live API/load | logout expires the moderator cookie | Pass |
| Timed opening/closing | closing time can be cleared and reset without reopening queues | Pass |
| Timed opening/closing | invalid closing times and station access are rejected | Pass |
| Timed opening/closing | Background opening and closing fire once without website requests from the test client | Pass |
| Timed opening/closing | public state and every station reflect automatic closing and locked controls | Pass |
| Timed opening/closing | automatic closing retains existing tickets and blocks fresh joins | Pass |
| Timed opening/closing | intentional manual override after scheduled closing is respected | Pass |
| Closing-boundary joins | Concurrent join waves across all six houses accept before closing and reject after it | Pass |
| Closing-boundary joins | No issued ticket is timestamped at or after closing | Pass |
| Closing-boundary joins | All six houses close and station controls lock during the join burst | Pass |
| Live browser | Live homepage renders six open cards with six join links | Pass |
| Live browser | Same homepage updates to six closed and disabled cards with zero join links without a reload | Pass |
| Live browser | Live browser console has no errors during the status change | Pass |

## Cleanup and preservation

All **1,250 ticket records** found before cleanup matched the exact anonymous device hashes created by this test. No non-test ticket records were found or removed.

Cleanup used those recorded hashes to remove only owned test tickets and profiles. The active test announcement was removed using its exact version and publication identity. Known test-entry timing anchors were reset only where their values still matched the observed test timestamps and the house’s queue was empty.

The final database and APIs verified:

- Zero queue entries and zero waiting/skipped/entered totals at all houses.
- Six zero-valued RC summary rows in the report CSV.
- All six houses Closed and overall station status controls locked.
- The original 6 pm opening, 9 pm RC cutoff and 11 pm closing restored, with scheduled actions not yet marked as executed.
- All **28 original RC profiles** preserved, plus **10 new profiles from other browsers**. None of the test device hashes remained.
- No active announcement, no unacknowledged/unresolved alerts in the final dashboard response, and a removed test ticket returning 404.

Automatic approval review rejected a broad snapshot restoration because it could overwrite legitimate changes made while testing. The cleanup was narrowed accordingly. Audit history, station activity and login-attempt records were retained rather than erased or replaced. The opening time was restored through the normal API only after confirming there was no conflicting schedule.

## Event-day operation

1. Refresh the overall and station dashboards once to load the latest controls. Older participant tabs also need one reload to obtain the latest homepage polling code; server-side join restrictions apply regardless.
2. Before 6 pm, check that the overall dashboard still shows the scheduled 6 pm opening. **Manual global Open/Pause/Close cancels a pending opening**; if you use one, save the opening time again when required.
3. At 6 pm, the queues open automatically and stations can manage their own houses. At 9 pm, outside-RC waiting/skipped tickets are cancelled and outside-RC joins stop. At 11 pm, all new queue joining stops automatically.
4. Keep station dashboards connected and download/print queue backups periodically. Export the event report before deleting the event’s real ticket records.

Manual overall control remains available. Changing a closing time rearms that schedule; clearing it disables automatic closing without reopening queues. An overall manual reopening after closing has fired is an intentional override.

## Test limits

This was a bounded, single-client-region load test, not a maximum-capacity benchmark or an hours-long soak test. It does not reproduce every participant phone, browser or mobile network. Physical printing and a real browser network disconnect/reconnect were not exercised in this run; automated tests cover station offline snapshots, recovery and expiry. No successful test can guarantee the absence of all future network or platform failures.
