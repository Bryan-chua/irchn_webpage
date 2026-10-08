# Station Master Guide

This guide explains how station masters operate their assigned haunted-house queue in the **Abandoned Institutions Queue System**.

## Before your shift

Have the following ready:

- the event website: [irchn-queue.rvrc.workers.dev](https://irchn-queue.rvrc.workers.dev/);
- the station assigned to you;
- that station's access code; and
- a phone, tablet, or computer with a reliable internet connection.

Each sign-in is limited to one station. The dashboard displays and changes only that haunted house's queue. Do not share the access code with participants.

## 1. Sign in

1. Open the event website.
2. Select **Station master** in the top navigation.
3. Choose your assigned station.
4. Enter its access code.
5. Select **Open dashboard**.

If the station or code is incorrect, the dashboard will not open. Confirm both with the event organiser. A signed-in session lasts up to 12 hours unless you sign out earlier.

## 2. Read the dashboard

The **Current queue** view refreshes automatically every four seconds. Its summary shows:

- **Waiting groups** — groups that still have an active place in line;
- **Estimated clear time** — the approximate time required to admit all waiting groups; and
- **Total pax waiting** — the combined number of participants in waiting groups.

Each queue row shows the queue number, team nickname, group size, elapsed waiting time, and status. Waiting groups appear first in joining order. Skipped groups remain in the current queue below them for follow-up, but do not count towards queue positions, waiting totals, or wait estimates.

Wait estimates use a different planned time for each station:

| Station | Estimated time per group |
| --- | ---: |
| RVRC | 4 minutes |
| CAPT | 5 minutes |
| Acacia | 7 minutes |
| Tembusu | 10 minutes |
| RC4 | 5 minutes |
| NUSC | 5 minutes |

These are estimates. Continue processing the physical line safely even if the displayed time differs from actual operations.

Every successful refresh also saves a private emergency snapshot on the station device. The snapshot contains the current waiting and skipped groups and expires automatically after 24 hours. The dashboard shows when that copy was last saved.

## 3. Set the queue status

Use the **Queue status** controls at the top of the dashboard:

| Status | Effect |
| --- | --- |
| **Open** | Participants can create new tickets for this station. |
| **Paused** | New tickets are temporarily blocked. Existing tickets remain valid and viewable. |
| **Closed** | New tickets are blocked. Existing tickets remain valid and viewable. |

Suggested use:

- Set the queue to **open** when the station is ready to accept groups.
- Set it to **paused** for a temporary operational delay or when the queue needs time to clear.
- Set it to **closed** when the station will not accept more groups, such as at the end of the event.

Changing the queue status does not remove or complete existing tickets.

The overall event moderator may pause or close every house and lock these controls. When locked, the dashboard explains the event-wide status and disables only the three queue-status buttons. You may continue admitting or skipping existing groups. The controls become available again after the overall moderator selects **Open all & unlock**.

## 4. Admit a group

1. Ask the group to show its saved ticket screenshot.
2. Match both the **queue number** and **team nickname** against the dashboard row.
3. Confirm that the group size is reasonable for the displayed ticket.
4. Select the checkbox beside the correct group.
5. Select **Mark as entered**.

The group moves out of **Current queue** and into **Entered history**. Its participant ticket changes to **entered** after the next refresh.

You may select multiple rows and mark them as entered together, but only do this when every selected group has actually been admitted. Use **Select all** only when the same action genuinely applies to every visible waiting and skipped row.

## 5. Skip an unavailable group

If a group is not present when it needs to be admitted:

1. Select the checkbox beside that group.
2. Select **Skip**.

The group remains visible in **Current queue** with a **skipped** status, but it no longer counts as a group ahead of other participants or contributes to wait estimates. Its ticket tells the group to speak to the station master.

If a group was skipped accidentally, select **Undo** on its row to restore it to **waiting**. If a skipped group returns later, verify its queue number and nickname, follow the event organiser's return policy, and select **Mark as entered** only when the group is admitted.

## 6. Review history

Select **Entered history** in the sidebar to view up to the 40 most recent completed records for the station. The table shows each group's queue number, nickname, group size, total time from joining to completion, and final status.

If a group was marked as entered accidentally, select **Undo** on its history row. The group returns to **Current queue** with a **waiting** status, and the queue estimate is recalculated.

History is intended for short-term operational reference. Participant records should be removed after the event according to the organiser's approved retention plan.

## 7. Prepare an emergency backup

Use the **Emergency backup** controls near the top of the dashboard:

- **Download CSV** saves the current queue order, queue numbers, team nicknames, group sizes, statuses, and snapshot time.
- **Print list** creates a paper-friendly checklist with spaces to mark groups entered or skipped and to write processing times or notes.

Download or print a fresh copy before opening the station and periodically during the event. These files contain team nicknames, so keep them with authorised event staff and destroy or delete them after the event.

If live refreshes stop working, the dashboard displays its most recent local snapshot with a prominent timestamp. Offline mode is read-only: do not try to process groups in the dashboard. Use the printed list to record entered or skipped groups, then reconcile those handwritten changes in the live dashboard after service returns. Keep the dashboard tab open during an outage; the local snapshot cannot guarantee that the whole website can be reopened while the server is unavailable.

## End-of-shift checklist

1. Confirm that groups you admitted are marked **entered**.
2. Review any **skipped** groups and hand them over to the next station master if necessary.
3. Set the queue to **paused** during a temporary handover, or **closed** if the station will accept no more groups.
4. Select **Sign out** in the sidebar, especially on a shared device.

Signing out clears the station session and returns the device to the station-master login page.

## Troubleshooting

- **The dashboard returns to the login page:** the session is missing or has expired. Sign in again with the assigned station and access code.
- **The dashboard shows the wrong station:** sign out, then sign in with the correct station. A valid session is automatically directed to its assigned dashboard.
- **The queue is not refreshing:** check the internet connection. The dashboard switches to its timestamped emergency snapshot when one is available and disables all queue actions until a live refresh succeeds.
- **An action fails:** record any urgent changes on the printed list, check the connection, and wait for a live refresh before reconciling them in the dashboard.
- **A participant cannot find a ticket:** ask them to check the queue number against their screenshot. Queue lookup ignores letter case and spaces.
- **A participant's nickname is missing from a reopened ticket:** verify it against their original screenshot and the private nickname shown on your dashboard.
- **A group was marked entered by mistake:** Click the undo button in **Entered history**.
