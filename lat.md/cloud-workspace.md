# Cloud workspace

Desktop and Web should preserve the original Desktop UI through one account-scoped cloud data repository; the current shared cloud screens and native dialogs are transitional.

## Main process boundary

[[src/main/cloud-workspace.ts#CloudWorkspace]] verifies the active secure-store bearer and owner before each fixed Mithril API request; renderer IPC never receives the credential.

Consent lasts in memory for one account and local profile. Replacing a token, disconnecting, switching profiles, authentication expiry or owner mismatch clears consent and notifies the renderer. Offline failures preserve unsent edits in the current renderer window.

Workspace access requires explicit `workspace:read` and `workspace:write` scopes. Existing inference or billing tokens are never upgraded, and the renderer cannot issue tokens. The API retains its existing passkey confirmation before granting sensitive scopes.

## Shared screens

The shared workspace package supplies Discover, Office, Kanban, Projects, Capabilities, Memory, Settings and Profile through one source; Discover, Office and Kanban navigation now mounts this renderer directly in both clients.

The old native records remain available through reviewed import, without scanning or overwriting local files.

Discover projects the official Mithril Registry into safe catalog links. Portable projects, tasks, workrooms, notes, profile and preferences use the owner-scoped workspace API. Actual native runtime views are separately inspected and linked; portable records do not substitute for native Office or tool execution. Capability preferences express intent without installing a plugin or granting device permission.

Cloud entries are deliberately separate from existing local profiles, agent configuration and memory. No automatic filesystem scan, credential upload or permission upload occurs. Explicit selected native preview is described in [[canonical-chat#Canonical Mithril chat#Native runtime views]]. Closing the workspace or app can discard unsent in-memory changes; the UI reports this limitation.

## Release boundary

Package 0.5.0 requires the compatible API to be published before Web and Desktop. The existing D1 JSON tables need no new DDL for richer task records; CI health gates verify the protocol version.

[[mithril-migration#Mithril desktop migration#Desktop release gate]] remains the packaged release gate after explicit publication authorization.

## Four-surface synchronization

Projects, capability preferences and bot definitions use the shared owner-scoped record protocol. Canonical agent goals and run/checkpoint state use the shared session event protocol.

While the shared workspace is active and connected, read-only observation refreshes every five seconds and on focus or network recovery. It never flushes unsent edits; explicit save/reconnect owns writes. Editing retains its captured revision, so remote updates become conflicts instead of replacing a draft.

[[src/main/native-workspace.ts#NativeWorkspace#previewImport]] includes reviewed selected SOUL/USER content and model preference, linked working-folder titles and current toolset preferences. Only opaque IDs and portable authored fields enter the preview. Absolute folder paths, credentials and execution grants are excluded; selected import leaves native files unchanged.

## Canonical catalog

[[src/main/cloud-workspace.ts#CloudWorkspace#catalog]] reads public release-pinned catalog metadata only through api.mithril.fund. Both clients receive the same Mithril and Hermes registry entries, category tabs and cards. No metadata action installs code or grants permissions.

## Cloud-first surfaces

Discover, Office and Kanban use the compiled @mithril/workspace package in both clients.

D1 workspace_records/history/operations own portable data; revisions and operation IDs prevent silent concurrent overwrites and duplicate saves. Read observation runs on focus and every five seconds. Native files, credentials, run history and device permission grants are never implicit imports. An offline window retains queued changes until explicit retry; durable disk outbox is not implemented. Office profiles are cloud definitions; they are not evidence of a running gateway. Rich task status, description, priority, board/project and assignee fields require package 0.5.0 or later.

## Project folder bytes

Selected project folders synchronize through the fixed Mithril API, with private R2 chunks and a D1 revisioned manifest pointer; absolute paths remain device-only.

[[src/main/project-folder-sync.ts#ProjectFolderSync]] scans only the chosen root after a native folder picker and explicit Start automatic sync. Credentials, dependencies, symlinks and unsupported cross-platform paths are excluded. Concurrent edits pause rather than overwrite. Remote removals move bytes to .mithril-sync-trash. A disk journal retains the same operation ID after lost acknowledgements and app restarts, scoped to account and local profile. The first release caps a project at 1 GiB and 10000 files. Browser uploads/downloads use the same manifest and hash protocol; continuous browser filesystem watching is not claimed.

Normal Chat, Memory, Capability, bot profiles, Projects and Settings now enter shared cloud surfaces. Existing local runtime configuration remains behind explicit device actions; native scheduling/gateway execution is not silently migrated to cloud execution. Installer publication still requires Apple notarization.

## Cloud startup

A stored Mithril account opens the shared workspace even when the optional local agent is absent; first-run sign-in no longer leads to a required Hermes installation.

Normal startup retains device settings without starting a legacy SSH tunnel, probing its remote backend or checking its gateway. Local runtime installation is available only from the explicit Device runtime action. Shared Chat verifies account and API scopes before reading sessions; it never reads legacy provider configuration on connect. Models, sessions and workspace data come from Mithril API.

Stopping synchronization invalidates active work before publishing downloaded bytes and serializes journal writes, so an in-flight pass cannot re-enable a stopped folder. A regression test pauses a download, stops sync, and verifies the destination remains absent.

## Shared sidebar history

The API-backed Chat shares Web’s expanded sidebar for cloud sessions and projects. Pins and project membership use owner-scoped API records; legacy device history stays separate. Reading the sidebar never creates sessions or executes tools.

### Read-only cloud sidebar

The shared sidebar reads the checked cloud account and project inventory without importing device history, writing workspace records, or issuing chat operations.

## Cloud sidebar placement

Pins and explicit project membership now use owner-scoped API records shared by both clients, with per-chat revisions and operation receipts.

[[src/main/cloud-workspace.ts#CloudWorkspace#getSidebar]] reads canonical placement without uploading device pins. [[src/main/cloud-workspace.ts#CloudWorkspace#applySidebar]] exposes only the fixed sidebar API through trusted IPC. The shared renderer offers explicit migration of each device pin, retains failed operation IDs for acknowledgement retries, and reports concurrent-edit conflicts. Legacy local pins remain intact; titles and folders never imply project membership.

## Durable pending edits and history pages

Workspace metadata edits are journaled by owner and operation ID in renderer IndexedDB before network writes; reconnect restores the pending edits without sending them automatically.

The compiled shared package validates persisted operations, preserves concurrent window edits and retries ambiguous acknowledgements with their original IDs. Explicit conflict resolution atomically replaces or removes the pending operation. Failed device storage prevents a new network write. Completed native histories can be inspected fifty at a time through [[src/main/native-session-import.ts#NativeSessionImport#previewNativeSessions]], preserving originals and selected-copy consent. This is not bulk filesystem upload, credential migration or schedule execution.

## Cloud schedules

Schedules uses the shared owner-scoped API list and CAS edit protocol. Main-process IPC validates fixed routes and explicit scopes.

No tokens enter the renderer. Cloud execution produces ordinary D1 Chat results; local Cron jobs are retained separately and are never silently enabled in the cloud.

## Unified workspace navigation

Desktop uses the shared Chat sidebar as its primary navigation. Projects, Office, Discover, Kanban and Schedules share one API-backed workspace; device history remains explicitly accessible for migration without uploading it automatically.

The redundant Cloud Workspace navigation entry is removed. Cloud views show the API storage boundary in the footer rather than the unrelated local gateway state. Disconnected authorization failures remain visible and require explicit reconnection, without repeated account-change remounts.
## Security diagnostics

[[src/main/cloud-workspace.ts#CloudWorkspace#getSecurity]] and [[src/main/cloud-workspace.ts#CloudWorkspace#submitSecurity]] expose fixed owner-scoped routes with explicit security read/run scopes. Executor tokens and cloud credentials never enter the renderer.

The shared Security screen selects provisioned targets, retains ambiguous request IDs and displays persistent job receipts. Sandbox receipts never claim production verification.

Device schedule management opens in the same contextual dialog pattern as local history, instead of displaying a second schedule page beneath the cloud list. Existing device Cron jobs remain unchanged.

Browser device login requests inference, billing read, Chat read/write and Workspace read/write with explicit browser approval. Partial grants are refused before credential replacement; existing credentials and native permissions are retained. A passkey is required by the API for workspace scopes.

## Original Desktop UI with cloud storage

Jun's 2026-10-06 direction is one original Desktop UI and one collection per feature, with storage synchronization behind adapters rather than Local, Legacy Device or Cloud Workspace navigation.

The target is documented in `mithril-fund/docs/design/desktop-cloud-repository.md`. Port original components, preserve rich records and full chat timelines, then wire both clients to an account-bound durable repository. SQLite/IndexedDB/folders become working caches; API D1/R2 remains authoritative. Automatic data retries must not replay tools or schedule occurrences.

The preview.21 native-history and schedule dialogs, selected text import and parallel renderer remain implementation gaps. Do not hide those records or call the selected importer automatically as a shortcut. Their removal is gated on lossless read-back and access through the same repository. Runtime permissions and credentials stay in execution adapters.

## Rich repository implementation in progress

The work-in-progress repository preserves nested data and reuses original Kanban/Schedules component bodies. It is not the completed cloud-primary migration and has not been released.

[[src/main/cloud-workspace.ts#CloudWorkspace#repositoryPage]] and [[src/main/cloud-workspace.ts#CloudWorkspace#repositoryApply]] expose fixed, owner-checked rich-document routes. [[src/main/repository-kanban-runtime.ts#kanbanRepositorySeed]] reads supported profile boards without dispatching an agent, switching the selected board or writing SQLite. Paths and live execution locks remain device-only. Each device profile is durably bound to its first authorized migration owner; a different signed-in account cannot silently adopt that source. Shared Kanban seeding retains existing cloud records and tombstones. Native reads reject more than 1000 tasks per board or 20000 rows per relationship table instead of truncating or performing an unbounded scan.

Continuous reconciliation now supports existing Kanban metadata/comments/events. Rich chat synchronization is data-only; mapped cloud records now project into the original Desktop timeline cache, while remote-only session reconstruction is outstanding. Project bytes, cron delivery/executor ownership and remaining original surfaces still gate removal of the existing native dialogs. Keep this distinction from released preview.21 behavior and from the full target above.

### Continuous replica reconciliation (draft)

A three-way journal compares the last synchronized pair with the device and cloud versions.

Workspace views share the same background loop; account/profile changes stop the old loop. Disjoint object fields merge, concurrent array/history changes require an explicit choice, and busy records defer without blocking other records. Native Kanban metadata, appended comments and status events use SQLite CAS and durable receipts. Paths, claims and agent execution authority remain device-owned. This slice does not yet synchronize new native board/task creation or dependency graphs/run history back to SQLite; those writes are deferred. Full chat/file/schedule migration and removal of remaining legacy dialogs are still outstanding.

### Rich history archival (draft)

Desktop now continuously archives native user/assistant messages, reasoning and tool arguments/results into canonical Chat sessions.

The source profile is owner-bound. Fixed trusted IPC starts a background data-only pass; pending operations are atomically journaled before POST and recovered by receipt. Attached bytes use private owner/session R2 chunks, preserving MIME/name/size and content digests. The same Chat component renders these records and attachments on Web/Desktop. Busy sessions defer and conflicts keep native and cloud versions. This slice is not full bidirectional history sync: remote-only session reconstruction, native session deletion reconciliation, conflict resolution and removal of the remaining history/schedule dialogs are still required. No release has been published.

### Cloud history working cache (draft)

The original Desktop timeline now reads a cloud projection layered over the unchanged agent message data.

[[src/main/native-history-cache.ts#replaceNativeHistoryCache]] checks the native snapshot under an immediate SQLite transaction before updating the cache. [[src/main/native-history-cache.ts#mergeNativeHistoryCache]] applies cloud text, reasoning, tool evidence, attachment bytes and tombstones only while the source item matches its saved native baseline. New device edits bypass stale overlays. Cache rows are owner-bound and become invisible on account invalidation; verified attachment bytes are stored in private owner-specific files. Separate native/cloud fingerprints in the durable replication journal prevent pulling a cloud edit and then echoing the old device text back. Data restoration never writes messages/executions or runs an agent. Native item removals become cloud tombstones. Full remote-only session reconstruction, title/deletion migration, conflict resolution and UI separation removal remain unfinished.
