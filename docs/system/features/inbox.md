---
description: Global PR inbox — GitHub notification sync, PR timeline events, priority bucketing, read/done/snooze state, unread badge, and keyboard-driven triage.
order: 18
---

# Inbox

The Inbox is one global list of pull requests that need the viewer's attention. It spans every workspace and shows one row per PR. Each row carries the PR's recent events (review requested, mentioned, approved, CI failed, and so on), an unread flag, and a bucket: `priority` or `other`. A header button shows the count of unread priority items. The `g` then `i` chord opens the Inbox tab.

## Architecture

Two sources feed the Inbox. Both write through the store in `web/src/server/inbox/store.ts`.

- **GitHub notifications.** `startNotificationsPoller` (`web/src/server/inbox/notifications-poller.ts`) starts from `web/server.ts` and runs `runNotificationsCycle` on a self-scheduling timer. It reads `/notifications` through `fetchNotifications` (`web/src/server/github/notifications.ts`). For each pull-request thread, `syncThread` (`inbox-sync.ts`) loads the PR timeline with `fetchPrTimeline` (`web/src/server/github/timeline.ts`), maps it to events, and stores them.
- **PR poll.** The PR poller records `ci_failed`, `ci_passed` and `auto_fix_attention` events through `recordPrInboxEvents` and `refreshPrFacts` (`pr-events.ts`). The CI event rules are in FR-PRMON-220.

An event row has a `sourceKey`. The `inbox_events.sourceKey` unique index drops an event that is already stored, so a restart or a repeated cycle does not create duplicates.

## Buckets

`computeBucket` (`bucket.ts`) returns `priority` when at least one fact holds: a review is requested from the viewer and not given, the viewer is mentioned, or an own PR has changes requested, failing CI, an auto-fix attention reason, or approval with passing CI. Otherwise the bucket is `other`. `bucketFactsForPr` derives the facts from a `prs` row. `buildFacts` in `inbox-sync.ts` derives them from the timeline when no `prs` row exists. An unread `mentioned` event keeps the item in `priority` until the user reads the item.

## State

| State | Set by | Effect |
|---|---|---|
| unread | new event, `markUnread`, a woken snooze | counted in the badge when the item is in `priority` and not snoozed or done |
| done | `markDone` | hidden from lists; a new event brings the item back; deleted 30 days after (`pruneDone`) |
| snoozed | `snooze` | hidden until `snoozedUntil`, unless a wake event arrives (see FR-INBOX-100) |

Local state changes write back to GitHub: read uses `PATCH /notifications/threads/{id}` and done uses `DELETE` on the same path. A failed write-back is logged and never fails the local change.

## Notification sync

The first cycle asks for unread threads only. Later cycles send `since` and `If-Modified-Since`. A `304` response ends the cycle with no work. The poll interval follows `X-Poll-Interval` and never goes below 60 seconds. The cycle ignores non-PR threads and the `ci_activity` reason. The cycle also skips a thread whose `updated_at` it already synced. The cycle moves `since` forward only when every thread synced.

## Review requests and auto review

WHEN the sync stores a new `review_requested` event for a PR in a workspace repo, it starts an auto review. The contract is FR-PRMON-300 and FR-PRMON-301 in `pr-monitoring.md`. The agent risk badge on each row is FR-PRMON-302.

## User interface

The Inbox page (`web/src/components/inbox/inbox-page.tsx`) shows a Priority tab and an All tab, a workspace filter, a text filter, and a preview pane. Keys are `j` / `k` to move, `Enter` to open the review page, `u` to toggle read, `Alt+u` to mark all read in the tab, `e` or `Backspace` for done, `h` to snooze, `o` to open on GitHub, `/` to filter, and `?` for help. A row that stays selected is marked read after a short dwell time. `Enter` opens the in-app review page (see `pr-review.md`).

The PRs tab shows `outstanding / total` per scope and a global toast for attention events. Those contracts are FR-PRMON-200 and FR-PRMON-210.

## Out of scope

- Non-PR notification subjects (issues, discussions, releases).
- Notification reasons other than review request, mention, team mention and assignment get the generic `commented` event when the timeline has no event.

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-INBOX-010 | WHEN `computeBucket` is called, the system SHALL return `priority` if at least one of these facts holds: `reviewRequestedNotGiven`, `mentioned`, `myPrChangesRequested`, `myPrCiFailing`, `myPrAutoFixAttention`, `myPrApprovedCiPassing`; otherwise it SHALL return `other`. |
| FR-INBOX-020 | WHEN a new event arrives for a snoozed item, the system SHALL wake the item only if the item bucket is `priority` and the event kind is one of `review_requested`, `mentioned`, `changes_requested`, `approved`, `ci_failed`, `ci_passed` or `auto_fix_attention`. |
| FR-INBOX-030 | WHEN `isSnoozeDue` is called, the system SHALL treat a snooze as due only when `snoozedUntil` is set and is equal to or earlier than the current time. |
| FR-INBOX-040 | WHEN `bucketFactsForPr` derives facts from a `prs` row, the system SHALL set `reviewRequestedNotGiven` only for a PR that the viewer did not author and that lists the viewer in `reviewRequests` (login compared without case), SHALL set the four own-PR facts only for a PR that the viewer authored, and SHALL set `myPrApprovedCiPassing` only when the review decision is `APPROVED` and CI is `passing`. |
| FR-INBOX-050 | WHEN a PR gets an attention reason that has a known label, the system SHALL record one `auto_fix_attention` event with that label as summary, deduplicated by repository, number, head SHA and reason; IF the reason is empty or unknown, THEN the system SHALL record no event. |
| FR-INBOX-060 | WHEN the PR poller records inbox events for a PR, the system SHALL create or update the inbox item for that PR with the bucket derived from the PR facts and SHALL add each event once; IF there are no events, THEN the system SHALL NOT create an item; WHEN PR facts refresh, the system SHALL update the bucket of an existing item only and SHALL NOT create an item. |
| FR-INBOX-070 | The system SHALL keep one inbox item for each `(repoFullName, prNumber)`; WHEN `upsertItem` creates an item, the item SHALL be unread in the `other` bucket unless facts are given; WHEN an update omits an optional field, the system SHALL keep the stored value; the system SHALL broadcast `INBOX_CHANGE` only on create and on a bucket change. |
| FR-INBOX-080 | WHEN facts are given to `upsertItem` or `addEvent`, the system SHALL recompute the bucket from the facts and SHALL keep the bucket at `priority` while the item has a `mentioned` event newer than its last read time; WHEN no facts are given, the system SHALL keep the stored bucket. |
| FR-INBOX-090 | WHEN `addEvent` receives an event with a new `sourceKey`, the system SHALL store the event, mark the item unread, set the latest reason to the event kind, bring back a done item, and never move `lastEventAt` backwards; IF the `sourceKey` is known, THEN the system SHALL ignore the event; IF the item does not exist, THEN the system SHALL throw an error that names the item id. |
| FR-INBOX-100 | WHILE an item is snoozed, WHEN `addEvent` stores an event that satisfies FR-INBOX-020, the system SHALL clear the snooze; WHEN the event does not satisfy it, the system SHALL keep the snooze and still mark the item unread. |
| FR-INBOX-110 | WHEN an event is stored, the system SHALL broadcast `INBOX_CHANGE` with the item id and the new count of unread priority items. |
| FR-INBOX-120 | WHEN an item is marked read or unread, the system SHALL set the unread flag and the last read time; WHEN `markAllRead` runs with a filter, the system SHALL mark read only the unread items that the filter shows (snoozed and done items stay unread) and SHALL broadcast only when at least one item changed. |
| FR-INBOX-130 | WHEN `markDone` runs, the system SHALL set `doneAt`, mark the item read and clear its snooze; WHEN `snooze` runs, the system SHALL hide the item from lists unless `includeSnoozed` is set. |
| FR-INBOX-140 | WHEN `wakeDueSnoozes` runs, the system SHALL clear the snooze and mark unread only the items whose snooze is due, and SHALL broadcast only when at least one item woke. |
| FR-INBOX-150 | WHEN `pruneDone` runs, the system SHALL delete the items that have been done for more than 30 days, together with their events. |
| FR-INBOX-160 | WHEN `listItems` runs, the system SHALL hide done items, SHALL apply the tab (`priority` or `all`) and workspace filters, and SHALL sort unread items first and then the newest event first. |
| FR-INBOX-170 | WHEN `getInboxCounts` runs, the system SHALL count the unread, non-snoozed, non-done items in the `priority` bucket, in total and per workspace. |
| FR-INBOX-180 | WHEN `fetchNotifications` runs for the first time, the system SHALL request unread threads only; WHEN a `since` value is given, the system SHALL send it with `If-Modified-Since` and return the `X-Poll-Interval` value; WHEN GitHub answers `304`, the system SHALL return `not_modified`; the system SHALL follow pagination links. |
| FR-INBOX-190 | WHEN an item is marked read or done and has a GitHub thread, the system SHALL send `PATCH` or `DELETE` to `/notifications/threads/{id}`; IF the request fails, THEN the system SHALL log one error with secrets redacted and SHALL resolve without error. |
| FR-INBOX-200 | WHEN `mentionsViewer` checks a text, the system SHALL match `@login` for the viewer login only as a whole word, without regard to case, and SHALL treat characters in the login as literal text. |
| FR-INBOX-210 | WHEN the system maps timeline nodes, it SHALL turn each review into one event by state (`approved`, `changes_requested`, a located `commented`, `reviewed`, or a dismissed `reviewed`), and each issue comment into `commented`; IF the body mentions the viewer, THEN the event kind SHALL be `mentioned`. |
| FR-INBOX-220 | WHEN the system maps timeline nodes, it SHALL keep a review request only when the requested reviewer is the viewer, SHALL keep an assignment only when the assignee is the viewer, and SHALL map merged, closed, reopened and force-push nodes to events. |
| FR-INBOX-230 | WHEN the timeline holds commits, the system SHALL group the commits of each author other than the viewer into one `pushed` event with the commit count, keyed by the latest commit. |
| FR-INBOX-240 | WHEN the system maps timeline nodes, it SHALL skip events that the viewer authored and SHALL skip null nodes. |
| FR-INBOX-250 | WHEN `fetchPrTimeline` runs, the system SHALL send one GraphQL query and return the PR title, state, review decision, author, whether the viewer is a requested reviewer, and the mapped events; IF the PR does not exist, THEN the system SHALL return null. |
| FR-INBOX-260 | WHEN a notification cycle reads a pull-request thread, the system SHALL store an inbox item with the timeline events and the derived bucket; the system SHALL drop threads of other subject types and threads with the reason `ci_activity`. |
| FR-INBOX-270 | WHEN GitHub answers `304`, the system SHALL do no thread work; the system SHALL skip a thread whose `updated_at` it already synced; after a restart the system SHALL NOT duplicate stored events. |
| FR-INBOX-280 | WHEN GitHub sends `X-Poll-Interval`, the system SHALL use it as the next poll delay but never less than 60 seconds; WHEN GitHub answers `304`, the system SHALL keep the previous interval. |
| FR-INBOX-290 | IF the timeline of a thread has no events or cannot be loaded, THEN the system SHALL store one event that is derived from the notification reason (`review_requested`, `mentioned` for mention and team mention, `assigned`, otherwise `commented`), keyed by thread id and `updated_at`. |
| FR-INBOX-300 | WHEN a thread is synced for a PR the viewer authored and no `prs` row exists, the system SHALL derive the own-PR facts from the timeline state and review decision. |
| FR-INBOX-310 | WHEN GitHub shows a thread as read after the last stored event of an unread item, the system SHALL mark the item read. |
| FR-INBOX-320 | IF GitHub is unavailable or the viewer is unknown, THEN the notification cycle SHALL do no GitHub work and SHALL still wake due snoozes and prune done items. |
| FR-INBOX-340 | WHEN `inbox.list` runs, the system SHALL return for each item the latest event and up to 20 recent events, newest first; the `priority` tab SHALL return only `priority` items. |
| FR-INBOX-345 | WHEN `inbox.list` or `inbox.counts` runs, the system SHALL wake due snoozes first. |
| FR-INBOX-350 | WHEN `inbox.markRead` or `inbox.markUnread` runs, the system SHALL change the local state; WHEN the item has a GitHub thread and the call is `markRead`, the system SHALL also send the write-back; IF the item is unknown, THEN the system SHALL fail with `NOT_FOUND`; IF the write-back fails, THEN the local state SHALL stay. |
| FR-INBOX-360 | WHEN `inbox.markAllRead` runs, the system SHALL mark the visible items read and SHALL write back only the unread items that have a GitHub thread. |
| FR-INBOX-370 | WHEN `inbox.markDone` runs, the system SHALL hide the item and send `DELETE` for its GitHub thread. |
| FR-INBOX-380 | WHEN `inbox.snooze` runs, the system SHALL hide the item until `includeSnoozed` is set; IF the date is not a valid date-time, THEN the system SHALL reject the call. |
| FR-INBOX-390 | WHEN `inbox.list` runs, the system SHALL return for each item the slug of the project whose agent session worked on the PR head branch in the item repo, or null when there is no such session or the item is outside every workspace repo. |
| FR-INBOX-400 | WHEN the user presses `g` and then `i` within 1000 ms with no modifier key, the system SHALL fire the open-Inbox action; any other key SHALL reset the chord, a second `g` SHALL re-arm it, and modifier combos and non-character keys SHALL be ignored. |
| FR-INBOX-410 | The header Inbox button SHALL show the unread priority count as an exact number up to 99 and as `99+` above, and SHALL show no badge at zero. |
| FR-INBOX-420 | WHILE the Inbox page is active and no text field has focus, the system SHALL map `j`, `ArrowDown`, `k`, `ArrowUp`, `Enter`, `u`, `e`, `Backspace`, `h`, `o`, `/` and `?` to their actions, `Alt+u` (by physical key) to mark all read, and SHALL ignore Ctrl or Meta combos and other Alt combos. |
| FR-INBOX-430 | The snooze menu SHALL offer one hour from now, tomorrow at 09:00 local time, and the next Monday at 09:00 local time (the following week when today is Monday); a custom snooze SHALL be accepted only when it is a valid future date-time. |
| FR-INBOX-440 | The Inbox display options (`showSnoozed`, `unreadFirst`) SHALL default to hidden snoozed items and unread first, SHALL be read per field from browser storage, and SHALL fall back to the defaults for a bad value or invalid JSON. |
| FR-INBOX-450 | The Inbox list SHALL sort by newest event, with unread items first when the option is on, SHALL filter by title or repository without regard to case, and SHALL keep the selection on the row that takes the place of a removed row. |
| FR-INBOX-460 | WHEN an event summary is empty or holds a raw event kind, the system SHALL show a human sentence built from the event kind and actor (`alice approved`); for system events or events without actor it SHALL show the capitalised verb; a human summary SHALL stay as stored; an avatar SHALL show only for human actors. |

## Sources

No prior knowledge found.
