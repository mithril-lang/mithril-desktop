# Kanban board tab

The Kanban tab ([[src/renderer/src/screens/Kanban/Kanban.tsx]]) is a JIRA-style board for the hermes-agent multi-agent task queue, presented as "JIRA for AI agents": named agent profiles pick up cards, run them, and hand off through the durable `~/.hermes/kanban.db`.

It is a **thin client over the `hermes kanban` CLI** — every read and mutation shells out through [[src/main/kanban.ts]] (local exec, or SSH-tunnelled via `sshRunKanban` when in tunnel mode). Plain remote HTTP mode is unsupported and shows a "switch modes" notice. The renderer holds no domain logic; it renders board state and routes actions to the CLI.

## Statuses and columns

The board renders the agent's canonical statuses, kept in sync with the agent's `kanban_db.VALID_STATUSES` and the dashboard plugin's `BOARD_COLUMNS`. Mis-syncing here silently mis-buckets cards into To-do.

The `COLUMNS` constant lists eight always-visible lanes in canonical order — `triage, todo, scheduled, ready, running, blocked, review, done` — each with a fixed status `tone` that drives a colored header dot and lane accent. A ninth `archived` lane is appended only when the "show archived" toggle is on; `STATUS_TONE` maps any status to its tone for surfaces outside the column loop (the detail drawer). A task whose status is none of the rendered columns falls back to the To-do lane.

## Actions

Cards expose status-appropriate actions, each calling a `hermes kanban` verb via the preload bridge. Header actions are dispatch, new task, new board, and the board switcher.

Card actions are specify (triage), mark-done (ready), reclaim (running), unblock (blocked), block (todo/ready), and archive (any).

Drag-drop moves route through `dragAction(from, to)`, which maps a target column to the single `hermes kanban` verb that effects it: `done`→complete, `blocked`→block, `ready`→unblock|reclaim|promote (by source), `scheduled`→schedule, `archived`→archive ([[src/main/kanban.ts#promoteTask]], [[src/main/kanban.ts#scheduleTask]]). The web dashboard can move a card to *any* column because it writes the status field directly in `kanban.db`; the desktop only has CLI verbs, so `todo`, `triage`, and `review` have no verb to set them and are not drop targets. `dragAction` returning a verb is also the drag-validity gate (`isValidDragTransition`).

In-place editing of a live card's title/body/priority is unavailable — the CLI `edit` verb only backfills a result on already-`done` tasks.

## Shared workspace task edits

The shared panel edits actual local board task metadata through an atomic SQLite revision check. It never dispatches workers, invokes plugin hooks, grants device access or uploads native files.

[[src/main/native-kanban-store.ts#NativeKanbanStore]] reads the existing current board with a 1000-task bound and no schema initialization. Under SQLite `BEGIN IMMEDIATE`, it compares the full original rows before editing title/body/priority on an unclaimed task. Native event append and edit commit together. Full archive and other lifecycle actions remain in the native Kanban screen. Running, claimed, archived, nonportable and incompatible-schema tasks cannot be edited here.

[[src/main/native-workspace.ts#NativeWorkspace]] binds opaque board/task identifiers and revisions to the signed-in account, selected profile, token actor and connection epoch. Native paths and claim data remain in the main process. Named boards retain Hermes's existing shared-local-profile behavior; cross-device cloud notes are separate records.

The pinned dashboard has plugin Kanban REST routes, but they do not provide this atomic revision contract. Web writes remain unavailable pending an authenticated fixed-store helper, compatible native schema and an explicit sandbox board durability plan. Existing profile archives do not persist the global Kanban root; no storage configuration is changed by this candidate.

[[src/main/native-kanban-store.test.ts]] exercises real temporary SQLite files, concurrent stale revisions, claimed-task refusal, lifecycle preservation without dispatch, event-failure rollback and unsafe storage. No real user database, native worker or paid sandbox is exercised.

[[src/main/native-kanban-boundary.test.ts]] verifies opaque native task projections, owner and revision rejection, excluded device content, and identity changes while loading board metadata. A board switch while obtaining the SQLite writer lock conflicts before mutation.

## Refresh model

The board stays current without a live event stream, using three refresh triggers instead.

A 6-second poll (`POLL_INTERVAL_MS`) runs while the tab is visible, a `focus` / `visibilitychange` listener refetches whenever the user returns to the app, and every mutation handler calls `loadAll(true)` so a UI action reflects immediately rather than waiting for the next tick.

## Detail drawer

Clicking a card opens a right-docked issue drawer (`kanban-detail-drawer`) fed by `kanbanGetTask` ([[src/main/kanban.ts#getTask]]).

It shows status, assignee, body, latest run summary, result, the read-only comment thread, and the recent event timeline. It is presentation-only; mutations stay on the card actions.

## Claw3D HQ virtual board

A read-only "HQ (Claw3D)" board appears in the switcher when SSH tunnel mode can read the remote task-store JSON ([[src/main/kanban.ts#listClaw3dHqTasks]]).

It is a renderer-only mirror — selecting it routes reads to the remote store, hides all mutation affordances, and never calls the backend board-switch RPC.
