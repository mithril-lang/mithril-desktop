# Local SQLite workspace

Desktop reads portable metadata from a main-process SQLite repository and saves edits with a durable outbox. One service synchronizes with the existing owner-scoped D1 API; local acknowledgement and cloud acknowledgement remain separate.

[[src/main/local-workspace.ts#LocalWorkspace]] owns cache, revisions, credential-bound scopes, local receipts, pending operations, conflicts and reconciliation. The database lives under Electron userData/workspace/workspace.sqlite, uses WAL and FULL synchronous commits, and is created with owner-only permissions. Bearers and device paths are not stored in it. [[src/main/local-workspace-runtime.ts#localWorkspace]] binds the singleton to the current API origin, profile and credential fingerprint.

Pages first read the local IPC repository. Initial provisioning requires the existing workspace read/write authorization; a previously checked credential can read and edit its own stored metadata offline. Credential/profile changes fence late replies; remote authorization refusals hide cached data. A signed-out installation cannot access a previous scope. Downloaded metadata is a local replica, not a new execution grant.

The renderer's existing accepted response now means a local SQLite commit for metadata handlers. It does not mean a D1 commit. The shared page hides the inherited Cloud synced header and shows main-owned pending/offline/conflict/acknowledged status. Before the first complete pull, it shows loading instead of an empty record editor. Independent forms retain their drafts and captured revisions; readers observe the same local repository on their existing five/six-second intervals.

D1 remains the remote authority. Reconciliation checks owner and dataset generation before replay, pulls portable records and complete revision-bound repository inventories, overlays pending edits, then replays exact operation IDs. Lost acknowledgements replay the same operation; D1's existing receipt prevents a second history row. Cloud restore/generation changes stop replay and retain the outbox for review. Per-record conflicts retain local and cloud values and stop dependent writes. Explicit keep-local collapses that record's queued intent into a new operation against the remote revision; keep-cloud discards its queued edits. Tombstones synchronize like other records.

Coverage is portable Projects, Tasks, profiles/preferences, Office and repository metadata except Chat. Conversation execution, inference, browser/tool calls, schedules execution, file bytes, capability migration and server-only history reads keep their existing online/consumer-owned transports. The outbox admits no file_set, repository_document wrapper, capability migration or Chat operations. SQL synchronization is logical record/operation replication, not D1 database-file replication. No D1 schema change or Turso dependency is introduced.

## Durable offline editing

Real SQLite reads issue no network requests. Local data and outbox persist across restart; two session readers see the same committed records and receive main-process change notifications.

## Two device synchronization

Independent SQLite databases exchange edits and deletion tombstones through the same cloud authority without sharing a database file.

## Lost acknowledgement replay

A lost cloud reply retains the exact operation ID. Replay obtains the prior receipt, leaving one remote revision and one history event; mismatched ID reuse is refused.

## Conflict retention

Concurrent edits keep both values and preserve later local intent. Dependent operations do not replay until explicit conflict resolution.

## Repository metadata synchronization

Rich Kanban task metadata persists offline and appears in a second device after reconciliation.

Remote inventory reads request at most 50 documents, with a server byte budget and the existing owner/generation/count boundary. Older servers retain their default two-document pages. Local pages retain their existing pagination contract.

## Account and generation fencing

Another credential scope cannot read an account cache. A destructive cloud restore stops pending replay instead of publishing pre-restore edits.

## Revoked authorization

A remote authorization refusal retires offline access and displays a blocked state. It cannot be reclassified as a network outage.

## Atomic local transaction

Invalid local batches leave neither data nor receipts behind. Saved data and the corresponding outbox entry commit in the same SQLite transaction.

## In-flight account change

Sign-out and profile changes fence late pulls and writes before any cache commit or subsequent replay.

## Canonical D1 verification

Optional verification uses the sibling Fund Worker source and actual local D1 with migrations. It checks independent SQLite clients, offline edits, owner isolation, rich metadata and lost-reply history deduplication.

Run npm run test:local-d1 with the sibling mithril-fund checkout available. The default Desktop test runner does not require that external source. This is canonical local D1 verification, not production publication.

## Electron screen verification

Optional native verification opens the actual CloudWorkspace Projects component in two sandboxed Electron windows, renders cached data offline and saves a form edit into SQLite before checking canonical D1 read-back.

Set RUN_ELECTRON_SQLITE_QA=1 and WORKSPACE_QA_OUTPUT to an evidence directory when running test:local-d1. This fixture has synthetic account credentials and test-only IPC, is excluded from installers, and does not replace an installed-client release receipt.

## Physical remote device verification

Optional verification runs the same service on a physical gad host in a constrained disposable Node container, using a private SSH reverse tunnel to the local canonical D1 fixture.

Set RUN_GAD_SQLITE_QA=1 for the bounded test. A Mac edit reaches the remote SQLite file; the remote writes offline, restarts, reconnects and publishes back to Mac. The temporary remote directory and tunnel are removed after the test. Existing host services and production D1 are unchanged.

## Offline application entry

A previously checked, ready main-process cache lets Desktop reopen its workspace without a live account request. Cached access never sets the live account flag or grants execution authority; signed-out, revoked and new caches require normal sign-in.

## Original schedule cached reads

The original Schedules inventory reads its existing local source after the credential-bound cache and both saved account/profile ownership bindings pass. Reads recheck identity after completion; editing and execution retain live authentication.

[[src/main/original-schedule-replication-runtime.ts#runOriginalScheduleScreen]] keeps this readonly path outside the lifecycle synchronization lane. Missing bindings, blocked/revoked caches, another requested profile and symlinked native homes fail closed. It does not adopt a source, upload original files or grant schedule execution.

## Cached shared Schedules inventory

The shared Schedules list uses a validated owner and generation scoped SQLite snapshot, fetched during background synchronization. 

Original source reads keep their existing ownership checks. Schedule edits and execution still use authenticated online transactions; cached lists grant no write authority. A missing initial schedule inventory fails explicitly instead of inventing an empty cloud list.
