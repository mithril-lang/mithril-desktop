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

### Agency contact templates

Workspace 0.6.25-agency.1 adds fourteen contact templates across eleven agency solutions to the original shared Bot profiles screen. Selecting a template fills a draft; explicit Save retains owner-scoped synchronization.

Desktop preview.36 pins the tarball built from Fund main `ed3698c1990715cf147d35ae4b5a54c92961eb30`, SHA256 `eb8095215b95d9321e49c7b692e6bc3f4a6ffcfc4cfb912e81b292727764763f`. The Registry catalog is pinned to `99b65915095b2d765aa0a595cd24db5224694527`. Instructions distinguish local JSON evaluation from planned video, traffic, financial and maritime modules. Templates grant no credentials, official identity or executor authority. Native installer publication and configured bot replies require separate receipts.


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

API Chat uses the original shared sidebar for cloud sessions, projects and checked unarchived source rows. Pins and project membership use owner-scoped API records. Reading the sidebar never creates sessions or executes tools.

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

### Remote-only history working copies (draft)

Completed cloud-only sessions now reconstruct into a private account-bound working copy without requiring an installed native Agent.

[[src/main/native-history-sync.ts#NativeHistorySync]] reads all bounded pages at one session revision, rejects missing/changed events and rechecks account identity before caching. Native source read failures are reported and retained while independent cloud reads continue; no source is adopted or deleted. The shared event projection preserves archived IDs/tombstones, completed reply text and inert tool evidence; raw events remain available alongside the projection. Older API tool checkpoints contain no arguments, so this change does not invent them.

[[src/main/remote-history-store.ts#remoteHistoryStore]] stores SQLite working copies under private hashed owner/profile names in app data. [[src/main/native-history-cache.ts#replaceRemoteSessionCache]] preserves previous history on metadata deletion, rejects stale/inconsistent revisions and never modifies Agent session/message/execution tables. Verified attachment bytes use the existing account-bound cache path. Restart reopens the same copy; account changes close handles and invalidate access.

Unchanged acknowledged revisions skip event/attachment downloads. Reconstruction counts are separate from data-write counts. The current cache refuses over 20000 events, 50 MiB of event data, or 50 MiB of attachment bytes instead of publishing a partial history; the original API records remain unchanged.

Original sidebar/timeline selection, continuation, title/deletion CAS and conflict actions still need these working copies wired into their adapters before the remaining device-history dialog can be removed. This is a verified data foundation, not completed UI unification, publication or installed-device evidence.

### Original Markdown rendering

The original Desktop Markdown component is shared with Web; a display-only normalization restores structurally unambiguous tables whose source lost newlines.

Stored replies remain unchanged. The shared workspace normalizer restores both spaced and compact double-pipe row seams, validated against a separator and consistent column counts. Ordinary GFM, fenced examples, inline code with pipes and ambiguous columns remain untouched. Desktop and Web keep the original renderer.

### Original Memory component extraction (draft)

The original Memory and Persona components now live in the shared workspace package.

Desktop wrappers inject native APIs and translations; Electron globals are absent from shared component bodies. Capacity cards, entries, profile and providers retain their original controls. Original Memory/Soul CSS and scoped rules preserve the layout.

Load failures have a retry in the original screen. Provider credential/configuration errors are visible instead of reporting Saved, and stale responses are ignored after an API/profile change. Persona autosave retains failed edits, serializes saves, and passes the observed content to cloud adapters for compare-and-swap. Native credentials still use the native execution port; they are never repository fields.

The default Memory route now mounts these original components using per-profile raw MEMORY.md, USER.md and SOUL.md records. Existing portable cloud notes appear in the same entry editor with stable IDs and their original title/scope/project metadata retained. The current stripped-down cloud Settings/Memory/Capability screens and remaining split navigation still require replacement. No production release is implied by this extraction.

### Memory file reconciliation (draft)

Fixed known Memory files synchronize through the shared three-way journal while original UI components remain the editor.

[[src/main/memory-replica-files.ts#memoryReplicaSnapshot]] reads fixed owner-bound profile files and configured capacities. The all-profile inventory now invokes this reader for each validated original profile and claims only successful profile record IDs; unavailable collections report warnings and cannot delete unrelated data. Credentials, configuration values, installation metadata and device paths are excluded from canonical bodies.

[[src/main/memory-replica-files.ts#applyMemoryReplica]] uses the original Memory lock inodes, no-follow reads, source CAS, atomic file writes and durable operation receipts. Repeating a completed receipt never rewrites newer native contents; interrupted writes recover from their recorded before/after state. Tombstones preserve recoverable cloud bodies and deletion markers. Differing configured capacities defer pending shared Settings integration. Original Persona writes now use the same locks and observed text checks rather than an unlocked write.

Web uses the same default Memory body and cloud records. Runtime provider credentials remain native execution ports; Web credential writes fail visibly. Clean Persona editors observe remote changes, while dirty drafts and entry bases remain frozen. This draft has no deployed or installed-release evidence; full original Settings/Capability, schedule execution ownership, remote-only chat history and remaining navigation unification still require work.

### Original Capability components (draft)

The original Tools, MCP editor and Skills browser now share one component body across platform consumers.

[[src/renderer/src/screens/Tools/Tools.tsx#Tools]] and [[src/renderer/src/screens/Skills/Skills.tsx#Skills]] wrap workspace DesktopCapability/DesktopSkills. [[src/renderer/src/screens/Tools/useCapabilityPorts.tsx#useCapabilityPorts]] injects native IPC, existing translations, Markdown/media policy, confirmation and notifications. Shared components contain no Electron bridge access; their original tabs, toolset icons, MCP visual/JSON editor and skill details remain intact.

Failed toolset changes do not falsely change the displayed enabled state. Skill storage failures exit loading and allow retry; load/detail epochs discard stale profile/API responses. Shared CSS and English/Japanese dictionaries support browser consumers. The default cloud route now mounts these original tabs against canonical per-profile descriptors and existing portable preferences. Native source snapshots preserve full skill bodies; env/auth values and skill filesystem paths are excluded. Reads never test or install tools. Editors hold captured revisions, offline saves retain durable operations, and tombstones require explicit restoration. All original Settings section bodies are shared; remaining browser runtime ports and global preference observers still require integration.

[[src/main/repository-kanban-runtime.ts#nativeCapabilitySnapshot]] binds the selected local profile to the signed-in owner, checks config size/encoding/consistency and reads installed skills in strict mode. Known credential-bearing descriptors and device command paths are retained locally with a visible warning. [[src/main/repository-kanban-runtime.ts#nativeReplicaSnapshot]] includes Capability source versions in three-way reconciliation. Cloud-to-native configuration application remains deferred unless the source already matches; safe writeback and secret references are required before claiming full bidirectional Capability synchronization. No production or installed-release proof is implied.

### Original Settings modal and general panes (draft)

Original modal navigation and general preference components now share one renderer body while platform ports own effects.

[[src/renderer/src/components/settings/SettingsModal.tsx#SettingsModal]] wraps the shared nine-section modal while retaining the existing native SettingsDataContext and remaining panes. Appearance, Language, Notifications and Privacy wrappers inject providers, GPU and analytics APIs into shared components. Native theme/font registries re-export shared choices. The existing AppModal and Toggle paths also re-export the shared original bodies for every native consumer. Original CSS remains compatible; the shared package also exports the modal/preference styles and all theme palettes for browser consumers.

The default cloud Settings route remains unfinished pending the other pane adapters and canonical preference synchronization. No native setting has been silently imported or cloud value falsely applied by this extraction.

### Data About Community and Logs shared bodies (draft)

Original data actions, update cards, links and log viewer now share UI bodies with platform-owned effects.

[[src/renderer/src/components/settings/DataPane.tsx#DataPane]], [[src/renderer/src/components/settings/AboutPane.tsx#AboutPane]], [[src/renderer/src/components/settings/CommunityPane.tsx#CommunityPane]] and [[src/renderer/src/components/settings/LogsPane.tsx#LogsPane]] inject existing SettingsDataContext and IPC into shared original components. About passes the selected profile into ConfigHealth. Explicit backup/import/migration and update buttons retain their existing handlers; none of these operations is invoked by rendering shared bodies.

Log reads discard older selected-file/scope responses and expose errors with retry; diagnostic dump failures no longer leave their running flag stuck. Connection remains the sole native Settings body, and canonical cloud preferences/default Settings routing are still unfinished. No deployment or installer claim follows from these tests.

### Original Connection and SSH target controls (draft)

All nine Settings bodies share original UI with consumer-owned connection and execution effects.

[[src/renderer/src/components/settings/ConnectionPane.tsx#ConnectionPane]] injects the existing SettingsDataContext, key generation and network writes into the shared named-connection editor. [[src/renderer/src/components/settings/SshDockerTargetSection.tsx#SshDockerTargetSection]] injects native inspection/provision APIs into the same target selector used by Settings and Welcome. Late results from a changed SSH host cannot select or persist a container for the current host; container selection retains the inspected list. Inspection and provisioning remain explicit actions.

Runtime credentials, host/key paths and transports remain device execution configuration. Default cloud Settings routing and canonical preferences/native cache reconciliation are still required; these components do not constitute complete synchronization or browser-native SSH support.

### Acknowledged appearance and language observation (draft)

Confirmed account preferences apply through original presentation providers on initial load and refresh.

The shared workspace observes one live preferences record and delivers its acknowledged revision once per identity. Pending preferences edits suppress automatic application, and multiple legacy preference records remain visible for review instead of being selected by timestamps. Desktop [[src/renderer/src/screens/CloudWorkspace/CloudWorkspace.tsx#CloudWorkspace]] supplies the original Theme/I18n providers; Web uses its locale/theme providers. Observation does not queue writes or execute agents.

This closes the existing read-side appearance/language gap. Full original preference fields, automatic provider-to-cloud writes, canonical record selection and default shared Settings routing remain required.

### Canonical presentation settings and default modal (draft)

The default repository Settings route mounts the original modal and four general panes with acknowledged cloud preference effects.

An account-scoped rich `preferences/presentation` document stores original theme/font IDs, locale, rounded corners, completion sound, spellcheck choices and analytics consent. Portable preference records retain their existing IDs and schema. One legacy record contributes values on the first explicit edit; multiple records require review. Opening Settings never seeds data or restores tombstones.

Observed revisions and durable operation receipts preserve offline edits and concurrent versions. Providers apply only acknowledged values. Preference refresh retries storage operations without executing agents, installations or schedules; identity cleanup stops the old synchronizer. [[src/renderer/src/screens/CloudWorkspace/CloudWorkspace.tsx#CloudWorkspace]] supplies original Theme, Font, ChatPreferences, I18n and analytics consumers, plus native GPU/dictionary availability.

The five remaining default cloud Settings section adapters, automatic upload from the separate original native global Settings modal and full native cache reconciliation remain required. Browser notification/spellcheck effects also remain unfinished. Unit, route and build checks are draft source evidence; API/Web publication and installed-client verification remain separate release gates.

### Default Desktop Settings runtime panes (draft)

All nine original Settings panes now mount in the normal Desktop cloud Settings modal with state retained across tabs.

[[src/renderer/src/components/settings/SettingsModal.tsx#NativeSettingsProvider]] supplies the original SettingsDataContext once for the whole modal; [[src/renderer/src/components/settings/SettingsModal.tsx#NativeSettingsPane]] dispatches the same original bodies used by the global modal. [[src/renderer/src/screens/CloudWorkspace/CloudWorkspace.tsx#CloudWorkspace]] supplies those ports to the shared shell for Connection, Data, About/Updates, Community and Logs, while general preference controls use canonical cloud settings. The provider is keyed by the selected profile and mounts only when Settings opens.

The normal Cmd/Ctrl+, shortcut now navigates to this same Settings route as the sidebar. It no longer opens a competing global preference store. Explicit native execution setup dialogs remain reachable until their data and runtime adapters are complete.

Backups/imports, updates, connection tests and links retain existing explicit native handlers. Opening or switching panes does not replay those actions. Runtime credentials stay outside presentation documents. Tests cover native backup result retention and explicit profile ownership; browser default-route fixtures cover consumer state retention across general/runtime tabs. Web’s five runtime pane adapters and native provider-to-cloud uploads remain unfinished. Source checks are not installed-client or publication evidence.

### Capability configuration writeback (draft)

Cloud toolset and public MCP changes now write back to the original selected-profile configuration through the replica adapter.

[[src/main/capability-config-replica.ts#planCapabilityConfig]] preserves unrelated YAML, other platform lists, future toolset keys, native auth/env values and unchanged unknown server fields. Existing MCP enabled-state changes retain credentials; redirecting credential-bearing descriptors, changing credential references, unsupported YAML, skill-file changes and aggregate Capability tombstones defer for review. Public MCP add/edit/remove is data-only and never runs a CLI, tests a server or installs dependencies.

[[src/main/capability-config-replica.ts#applyCapabilityConfigReplica]] compares the observed repository version and captured raw config digest, then uses a fixed isolated interpreter, no-follow directory access, an advisory config lock, atomic replacement and recoverable local receipts. Completed retries do not overwrite newer native edits; interrupted receipts finish only from recorded before/after contents. Receipt names are excluded by the existing secret-file path filter, and their private native backups never enter repository bodies.

The native dispatcher rechecks identity after loading the interpreter and adapter; public snapshots do not expose raw config or its digest. Read-back tests use the original MCP/toolset parsers. Full Skills/resource reconciliation, secret references, aggregate tombstone restoration and lock interoperability with external or older config writers remain required. Build/unit evidence is not installed-client or live synchronization verification.

### Capability resource storage (draft)

Original Skills require their relative scripts, assets and references in addition to SKILL.md.

A separate owner-scoped Capability resource namespace in the Mithril API uses the existing private R2 binding without inventing Projects or changing legacy Capability v1 bodies.

The shared manifest retains original relative directories and executable attributes, rejects credential paths and file/directory collisions, and verifies byte digests and limits. The main-process [[src/main/cloud-workspace.ts#CloudWorkspace]] exposes the typed resource transport; bearer credentials remain in main, owner changes fail closed, and observing bytes never installs or runs them. Deleted Capability documents retain recovery reads but refuse new uploads.

The POSIX native replica now captures original directories and uploads immutable resources before publishing a pointer through repository CAS. POSIX file application now uses recoverable transactions. Windows capture, original Skill installation and anchor bootstrap remain unfinished. This namespace remains unpublished.

### Original Skill directory capture (draft)

Skills now contribute a separate resource pointer to the existing native replication journal while preserving original Capability v1 descriptors.

The main process uses a fixed isolated interpreter only to capture file data through no-follow directory descriptors. Original relative names, binary assets, scripts, references and executable flags survive capture; credential and dependency paths are excluded. Source metadata is checked before and after reads and a second directory traversal rejects changes. Unsafe or unsupported sources are retained rather than publishing partial manifests. Private temporary chunks are removed after each attempt.

Immutable chunks and their manifest are uploaded through the fixed account-checked Mithril API before the resource pointer enters the durable repository outbox. Verified existing manifests avoid repeated uploads; identity checks surround each network step. API pointer edits require an existing owned manifest and use the existing repository CAS and receipts. This path stores data and never installs or executes a Skill.

Verified native downloads and POSIX file transactions are implemented; original Skill installation and anchor bootstrap remain unfinished. Descriptor capture currently supports POSIX; Windows capture fails closed until an equivalent safe directory-handle implementation exists. Resource publication also requires the canonical Capability anchor to exist. Large legacy inline Capability bodies and this bootstrap need a versioned resource-backed adapter before full synchronization and release.

### Verified Skill resource download (draft)

Cloud Skill bytes are verified in private staging before any future native file application.

The main-only downloader validates the owned pointer and canonical manifest digest, downloads each immutable chunk once, and checks both chunk sizes/digests and full-file sizes and canonical chunk-list fingerprints. Identity guards surround requests and finish verification. Failures remove private staging and never touch original Skill files. The returned staging reader rechecks disk bytes. Verified bytes now feed POSIX file transactions and the original shared Skills reader; this helper grants no install or execution authority.

### Skill resource file transactions (draft)

Native Skill resource pointers now apply to original directories through recoverable data-only file transactions.

A main-only fixed POSIX transaction locks private per-profile state, compares the original tree with the captured source, checks that parent directory descriptors remain attached to their original paths, and verifies cached chunks before source mutations. Atomic per-file replacements retain original paths, binary bytes and executable flags; deletions and replacements keep private backups. Credentials and other excluded files stay untouched. Durable pending/completed receipts support stable operation replay and interrupted before/after recovery. Intervening edits produce conflicts; incomplete transactions block both resource and inline Capability source reads so partial trees cannot be published. Recovery-only snapshot keys let the common engine replay the exact retained journal operation without claiming source completeness.

A completed receipt returns its original result without overwriting later native edits. Account checks surround download/application and source binding remains unchanged. Directory replacement refuses removal of untracked contents. Older native writers do not yet participate in this private advisory lock; cross-writer interruption and conflict UX still need integration. Windows file application and aggregate pointer tombstones remain deferred; original Skill installation and resource-backed bootstrap remain unfinished.

### Original Skills resource adapter (draft)

The original Skills component now reads full Markdown and original directory identities from cloud resource pointers.

The shared adapter validates manifests and bytes before display. Path-specific removal uploads an immutable replacement manifest and publishes its pointer with repository CAS; duplicate display names cannot select a different directory. Scripts and assets survive unchanged for remaining Skills. Native renderer requests use [[src/main/capability-resource-ipc.ts#registerCapabilityResourceIPC]] with trusted sender checks, bounded arguments and main-owned owner-bound API transport. Credentials remain in main. No install or execution occurs during reads or synchronization.

Original Skill installation, large legacy anchor bootstrap, Windows reconciliation and interoperability with older native writers remain unfinished. These source changes are unpublished.

### Resource-backed configuration anchors (draft)

Capability v2 keeps public configuration separate from original Skill files so large or duplicate-name Skills do not block initial configuration synchronization.

The native source emits toolset and public MCP descriptors with `skillStorage: resources` and an empty inline list. Original files remain untouched and are captured through the existing owner-bound resource pointer path. The shared validator still accepts strict v1 bodies; initial seeding never replaces an existing cloud document. A v2 anchor without a pointer displays a synchronization error rather than an empty installed list. Populated v1 records use the history-preserving migration below; unmatched original content remains in the original inline presentation.

### Retained repository history (draft)

Original bodies remain readable through owner-scoped repository history, including Skill text and source metadata retained before migration.

The fixed main-process transport and trusted preload IPC expose at most two documents per page. An exclusive revision cursor avoids shifted pages during concurrent edits; Chat also requires chat:read. Client validation and account generation checks reject foreign, malformed or stopped-owner replies without modifying caches or executing work. Populated v1 migration now uses retained history, verified original resources and joint D1 admission.

### Automatic original Capability migration (draft)

Acknowledged original Skill bytes and directory metadata allow automatic Capability v1-to-v2 migration while retaining full source history.

The background reconciler prepares migration before native configuration writeback. Both configuration and Skill pointer revisions travel in the durable operation through existing trusted IPC; the API repeats the content proof and D1 admits both versions atomically. Generic writes cannot bypass migration admission. Lost acknowledgements retain the same operation ID, even after the pointer changes. Initial replica conflicts settle without execution when both copies become identical. Original inline Skills remain available until the resource transition is acknowledged; binary assets and duplicate directory identities remain in retained manifests.

## Canonical Desktop sidebar component

The original Desktop history list and context menu now live in the shared package. Desktop imports the canonical bodies and styles; its wrapper supplies IPC, translations and error reporting.

The component retains original grouping, pin disclosures, pagination, inline rename rollback, project selection and delete confirmation. Extracting presentation does not change its storage authority. Connecting this body to the owner-scoped cloud sidebar and merging remaining native rows is still required before removing the history dialog.

## Original cloud sidebar and retained metadata

API-backed Chat now uses the original shared Desktop history list and menu. Cloud snapshots bypass native caches and device pins; project membership uses API IDs and names.

The owner-scoped browser journal retains placement and rename/delete/restore operation IDs before writes. Reload restores metadata without replay; explicit reconnect checks receipts using the same IDs. Conflicts retain their CAS operation until explicit atomic replacement or discard. The journal rejects execution requests. Native orphan rows and working-copy continuation still need wiring before removing the separate history dialog.

## Connection state and Markdown code spans

Shared repository screens keep an explicit connection state until the account is verified, rather than substituting a portable-record editor. Table restoration pairs actual inline code delimiters before validating compact row seams.

Settings, Memory, Capability, Kanban and Discover retain their canonical Desktop route through slow or failed authentication. Reconnect is explicit; connection rendering does not mutate records or invoke tools. Multiple code spans in table values no longer misclassify a row seam as code. Source transcript text remains unchanged.

## Unified source inventory in the original sidebar

An owner-bound read-only IPC inventory adds unarchived source conversations to the canonical sidebar. Cloud records supersede matching IDs, including deleted records, while original source selection uses its original history handler.

Inventory reads do not bind a previously unowned profile, capture attachments, import records, or start inference. Unknown/different-owner sources remain reachable through the existing source-access dialog until migration and metadata action routing are complete. Source-row metadata/pin/project actions are disabled during that transition; cloud rows retain their API CAS actions. A closing shared context menu relinquishes key capture immediately, so inline rename can process Escape while the exit animation finishes.

Cloud storage readiness is independent of model inventory. A provider failure keeps verified history readable; sending/creating execution still requires an available model. This prevents a model outage from hiding synchronized or original source conversations.

## Original chat title reconciliation

History replication records independent native/cloud title baselines. One-sided changes synchronize through existing non-executing rename operations or transactional native writeback; simultaneous edits remain a durable conflict.

Native-to-cloud renames retain their operation ID before sending and recover receipts after restart. A newer source edit is never acknowledged by an older receipt. Cloud-to-native writeback compares the exact captured nullable title, preserves all source rows on schema/uniqueness conflicts, and records user title provenance where supported. The existing synchronization disclosure compares both titles and provides explicit choices. Each choice revalidates the exact pair, cloud revision and owner/profile before native CAS or a durable API rename; changed conflicts require fresh review. Model/deletion reconciliation and non-title operation conflicts remain unfinished.

## Native Kanban dependency writeback

Existing task dependencies now reconcile with the cloud document under the task's SQLite CAS and writer transaction. Graph rows and original metadata are retained; unrelated edges remain untouched.

The adapter validates endpoint IDs, duplicate edges, parent/child projections and cycles across the current board. Missing endpoints and ready/scheduled/running or claimed tasks defer until their working copies are safe. Graph edits do not promote tasks, dispatch agents or replay run history. Task metadata, relationship changes and durable receipts commit together; a database failure or SQLite value coercion rolls all of them back. Read-back returns the exact resulting source graph and fingerprint. New board creation, full historical task reconstruction and run writeback remain unfinished.

## Original Agent schema and new task working copies

The installed Agent uses task_links, not the older task_dependencies fixture. Reconciliation now selects the single supported graph store and restores cloud-created inactive tasks into existing boards with stable cloud IDs and retained receipts.

The checked-in schema fixture contains only upstream DDL and its MIT attribution; no user records. Populated attachment tables now publish through the guarded native byte capture; readers without that adapter still refuse incomplete projections. Board-wide relationship snapshots support up to 100000 rows, preserving more than 20000 total events without truncation; individual documents still enforce their JSON limits. Required native fields use existing schema defaults, unsupported fields defer, and value coercion rolls back. Ready/scheduled/running tasks, history-bearing reconstruction, board creation, Windows attachment writeback and installed qualification remain unfinished.

The task and run projections also exclude device claims, process IDs/fingerprints, heartbeats and current-run pointers. Native SQL updates never write these fields from cloud records. Source-version hashes still cover the complete raw rows, so execution changes invalidate stale metadata writes.


## Original Kanban attachment capture (draft)

Original registered task files now produce private, verified chunk captures for the task repository. The original attachment metadata and SQLite rows remain intact; device paths are omitted from the cloud projection.

The fixed board/task attachment directory is opened with no-follow directory descriptors. Only selected SQLite rows are read, without executing files or scanning unrelated directories. Missing, escaped, symlinked, changed, wrong-sized and unsupported-schema files retain the whole source. Unassigned relationship/attachment rows refuse a complete snapshot rather than silently disappearing. Immutable capture bytes upload to the owner/task-specific API before the repository snapshot is exposed. Account checks surround requests, confirmed chunks are deduplicated, and failures do not publish partial task metadata. Source fingerprints cover raw attachment rows plus their content fingerprints.

Existing task metadata can reconcile while its attachments remain unchanged. SQLite CAS returns a fingerprint matching a fresh file-aware source snapshot, durable receipts recover retries before source-file reads even if a later file disappears, and an attachment change during an edit rolls back the update. Cloud attachment changes now use [[cloud-workspace#Native Kanban attachment writeback (draft)]]; readers without that adapter still defer. Windows and custom attachment roots require adapters; original data and routes remain reachable.

This draft uses shared workspace 0.6.11, including the current main Code/Kuro and security changes, and reserves Desktop preview.28. Neither this draft package nor these new task routes have a production or installer publication receipt.

## Kanban attachment downloads (draft)

The original shared Kanban detail drawer lists registered files and explicitly saves verified bytes through browser/Electron consumer adapters. Reading or selecting a task never fetches or executes its attachments.

[[src/main/task-attachment-ipc.ts#registerTaskAttachmentIPC]] exposes owner-pinned chunk reads, metadata checks and bounded staging writes after trusted-sender validation. Main retains credentials and rejects stale accounts during requests. The shared repository adapter validates retained task/attachment identities, canonical chunk pointers and complete file hashes before saving. Account switches, deletion, attachment replacement or board changes during a read cancel the save. Both Chromium consumers use an octet-stream Blob download, never a HTML preview or native path navigation.

This adds explicit download reachability to the same original drawer. Original-directory restoration now uses the native writeback adapter. Replacement controls, Windows capture and installed attachment behavior still require implementation or live qualification. Draft artifact 0.6.13 and Desktop preview.28 are unpublished.


## Kanban attachment editing (draft)

Original task details now accept selected files and remove reviewed attachment references through the same Web/Desktop component. Original metadata and history remain intact, and the cloud repository remains authoritative.

Selected files are staged in bounded verified chunks before their metadata enters the durable repository outbox. The operation preserves original attachment IDs and complete task history. Owner switches, task changes, outstanding edits, byte failures and invalid aggregate sizes cancel metadata publication. Removed references remain recoverable through retained repository revisions and immutable resources; no R2 deletion or native file removal occurs from a UI action. The main IPC adapter allows only fixed task identifiers/digests and 8 MiB chunks, with main-owned scope and account checks. Merely reading a task does not upload, remove or execute files.

## Native Kanban attachment writeback (draft)

Cloud attachment changes now restore verified inert bytes into the original task directory and reconcile the original SQLite rows under the task's writer transaction and source CAS.

[[src/main/kanban-attachment-replica.ts#prepareKanbanAttachmentWriteback]] downloads owner-pinned chunks into a private bounded staging directory and verifies file/chunk fingerprints before SQL writes. Existing task paths never get overwritten: new fixed opaque filenames use exclusive no-follow descriptors and atomic non-replacing links, with file/directory fsync. Old source files remain intact and replaced/removed rows are retained in the same SQLite transaction as task edits and operation receipts. A marker preserves cloud attachment ordering and explicit empty projections across restarts while retaining later original-Agent additions. Exact uncommitted read-back must match the cloud projection or the whole SQL transaction rolls back; an unregistered new immutable file may remain after a failed transaction and never grants execution authority.

Cloud-created inactive tasks with attachments restore into an existing original board with the same original/cloud identity mapping and transaction receipt. Lost acknowledgements recover before redownloading or rereading source files. Account checks surround network waits; source versions are rechecked inside the writer transaction. Reads and reconciliation never invoke a dispatcher, tool, installer or historical run. New boards, active run reconstruction, Windows/custom attachment roots and production/installed qualification remain incomplete. This source draft is not a production or installer release.

## Original task history restoration (draft)

Inactive cloud tasks now restore original comments, event payloads and terminal run receipts into the existing board's SQLite working copy, including attachment-bearing tasks.

[[src/main/kanban-history-restore.ts#planKanbanHistoryRestore]] admits complete bounded rows before task insertion and verifies authored values plus the complete projection after insertion. Original numeric IDs, task/run event links, timestamps, summary, errors and metadata strings survive. The latest summary must match the retained last run; no invented summary or truncated records are accepted. Task insertion, original/cloud ID mapping, history, attachments and operation receipt share one writer transaction. Exact fresh snapshots and retained receipts qualify the result. Restoring history never adopts device claims, PIDs, heartbeats, active-run pointers or notifier subscriptions, and never calls a dispatcher/tool/installer.

Existing tasks can append terminal run receipts under the same CAS, preserving all prior history and native process fields. Deleting or rewriting prior history, active run reconstruction, new board creation and Windows/production/installed qualification still require work. Unknown schemas and SQL coercion retain the full source rather than drop fields. This remains a source draft on shared workspace 0.6.13 and unpublished Desktop preview.28.

## Historical identity reconciliation (draft)

Cloud history retains original IDs while the original SQLite working copy uses private collision-free row keys.

[[src/main/kanban-history-identity.ts#projectKanbanHistory]] translates comment/event/run IDs and event-to-run references only in the portable projection. [[src/main/kanban-history-restore.ts#planKanbanHistoryRestore]] allocates safe native aliases and commits their mapping with task history and receipts. Existing original rows are never overwritten. Source fingerprints retain actual native IDs; canonical projections sort by cloud IDs. Later original Agent additions and new cloud IDs overlapping prior aliases converge without duplication. Scalar JSON payloads decode once. Missing mapped rows/tasks retain the source and stop publication. Active authority, board creation, attachment key collisions and installed qualification remain outstanding.

## New named board working copies (draft)

Cloud-created named boards now restore a complete original SQLite schema and board.json without running Agent code or creating a separate UI.

[[src/main/kanban-board-replica.ts#restoreKanbanBoard]] stages empty original tables, portable display metadata and the retained operation receipt together. Exclusive Darwin/Linux directory publication refuses an existing or concurrently created board. Files and parent directories are synchronized before acknowledgement. Exact retries recover the published receipt before current metadata reads, and tasks then restore through the existing original working-copy adapter. [[src/main/kanban-board-replica.ts#kanbanBoardRecord]] retains display name, description, icon, color, project association, timestamps and archive flag; native work directories remain private but participate in source fingerprints. Reads do not switch boards, dispatch work or create subscriptions.

This is named-board creation and metadata observation; original-board metadata writeback/archive, missing default-board initialization, dependent task graph reconstruction, Windows publication and installed/multi-device qualification remain incomplete.

## Default board working-copy initialization (draft)

A new device can initialize its missing default Kanban database from the canonical cloud board without resetting original display metadata or the selected board.

[[src/main/kanban-board-replica.ts#restoreKanbanBoard]] admits a default board only when its portable metadata exactly matches the current original display projection. The complete empty original schema and owner-bound retained receipt are staged privately, then published with a no-replace hard link through directory descriptors. An existing or concurrently created database is never replaced. The original board.json and kanban/current remain byte-for-byte unchanged; later tasks use the ordinary task restoration route. Reading alone still creates no database.

Custom cloud metadata that differs from original metadata still requires the pending file/SQLite transaction protocol. Existing-board edits, graph reconstruction, Windows publication and installed/offline/multi-device qualification remain unfinished.


## Recoverable original board metadata adoption (draft)

Boards whose original display settings file is absent can adopt cloud names, descriptions and archive flags without replacing their task storage or UI.

[[src/main/kanban-board-replica.ts#initializeKanbanBoardMetadata]] prepares an owner-bound operation under SQLite source CAS before exclusive file publication. A durable pending journal survives interruption; no-follow publication and read-back synchronize the file and parent directory before committing the receipt. Original tasks and execution state remain unchanged. Concurrent file creation returns its original projection and clears the pending preparation without replacement.

[[src/main/kanban-board-replica.ts#hasPendingKanbanBoard]] prevents incomplete Kanban sources from publication. [[src/main/kanban-board-replica.ts#pendingKanbanBoards]] exposes only board recovery IDs to the existing durable-download reconciler. The main snapshot preserves these IDs and empty board scope alongside independent Memory and Capability scopes. Exact recovery checks operation contents and owner; later task changes do not invalidate a previously published historical receipt. Reads alone never prepare writes or execute work.

Existing nonempty board.json updates still require recoverable replacement with retained external edits. Missing-default custom metadata adoption, dependent task graphs, Windows and installed/offline/multi-device qualification remain outstanding.

Local qualification: 44 Native tests / 5 files passed, including source barriers, exact prepared-operation recovery, stale source refusal, publication collision, different-owner refusal, operation reuse, later original task/display edits and oversized UTF-8 metadata. Node/web types, full lint, production build and lat check passed. Existing nonempty metadata replacement and installed/authenticated publication remain unqualified.

Oversized metadata admission now returns before opening the writable SQLite handle, so a deferred operation cannot retain a database descriptor. The original Agent writer-lock prerequisite is being prepared separately; installed replacement remains unqualified.

## Existing board metadata replacement (draft)

The original Kanban board file can now receive cloud display edits under the same writer lock as the reviewed Agent implementation, without changing the original UI.

[[src/main/kanban-board-replica.ts#initializeKanbanBoardMetadata]] retains original private default_workdir, file permissions and immutable prior bytes. A before-image joins the durable SQLite preparation; source CAS and the permanent .board-metadata.lock protect atomic replacement. File and directory fsync precede receipt commit. Interrupted publication recovers the exact operation; concurrent original changes return conflict.

[[src/main/kanban-board-replica.ts#supportsKanbanMetadataReplacement]] admits only the exact reviewed writer sources from Agent PR 11. Old, missing or changed writers defer replacement. This source guard does not certify a running process or publish the updated Agent. The draft installer now pins merged Agent 806c0a47; publishing Desktop, upgrading and restarting installed runtimes, Windows support and authenticated installed/offline/multi-device qualification remain required.

A temporary-storage integration exercised the actual reviewed Agent writer and Native publisher together: the Agent refused edits during the pending preparation, cloud metadata applied with private fields retained, and subsequent Agent edits appeared in a fresh Native snapshot. No original user storage or production API was changed.

Final local qualification for existing-file replacement: 46 Native tests / 5 files passed; Node/web type checks, full lint, production build and lat check passed. The separate actual-Agent interoperability fixture passed on isolated temporary storage and was removed after qualification. Installer and production publication remain unverified.

## Coordinated Agent installer pin (draft)

The verified Desktop installer now selects the merged Agent metadata writer revision for both Unix and Windows bootstrap paths.

Agent PR 11 merged as 806c0a473b9eaba74a97a8c0d5f8e5fe0bc9c30b after 21 tests / 2 files passed through its canonical runner. The merged sources exactly match the Native admission digests. Both downloaded commit-pinned bootstrap files retain the checked SHA-256 values; their bootstrap bodies did not change. Existing runtime drain and restart remain owned by the normal install lifecycle. This source pin does not upgrade a running installation or release Desktop preview.28.

## Renderer attachment adapter initialization

The original workspace renderer resolves its stable attachment transport when mounted, after the consumer preload exists, rather than accessing Electron ports during module evaluation.

Shared rendering still uses the same download/upload adapter and owner-scoped main handlers. Existing renderer account/marketplace tests exercise the mounting path; the IPC inventory includes the dedicated attachment registration module. The exact two CI failures reproduced and the repaired suites passed 59 tests / 2 files.

## New inactive tasks with existing graph endpoints (draft)

New tasks can restore complete dependency rows when their original board already contains the connected inactive tasks.

[[src/main/kanban-task-restore.ts#restoreKanbanTask]] uses a nested writer savepoint so any deferred restoration rolls back inserted task, identity, history and graph rows. The existing schema-complete graph planner validates endpoints, cycle and execution ownership, then graph rows join the ordinary source fingerprint and receipt. Missing endpoints still require a connected-component restoration protocol; an empty new device with only mutually dependent cloud records is not yet qualified. No dispatcher or task promotion occurs.

New task graph local qualification: 2,622 tests / 281 files passed with the missing-credential fixture isolated from OPENROUTER_API_KEY. Node/web types, full lint and lat check passed. The targeted 34-test storage/graph/attachment suite also passed; original user storage and production APIs were untouched.

## Connected missing task reconstruction (draft)

The native working-copy adapter now restores missing connected tasks together rather than waiting indefinitely for each missing endpoint.

[[src/main/kanban-task-group-restore.ts#readStableKanbanTasks]] checks bounded complete task pages twice with owner and account guards. [[src/main/kanban-task-group-restore.ts#restoreKanbanTaskGroup]] resolves missing nodes, validates reciprocal edges, stages inactive tasks/history/identity under a writer savepoint and applies the original dependency planner. Exact final projections precede the retained root-operation receipt; incomplete or inconsistent components roll back. Native reads and restoration never dispatch work. Attachment-bearing components still require per-node verified byte plans, and installed/multi-device qualification remains required.

Connected-component local qualification: 2,624 Desktop tests / 281 files passed with the missing-credential fixture isolated from OPENROUTER_API_KEY. The final 30-test storage/attachment rerun includes interrupted admission, absent endpoints, execution-state refusal, exact source/receipt equality and repeat cloud owner/revision reads. Node/web types, full lint, production build and lat check passed. Previous head 5749324 passed GitHub CI run 37514655442; this new component head needs its own CI and installed qualification.


## Connected task attachment plans (draft)

Missing connected tasks now prepare owner-pinned, verified file plans before restoring the original Kanban records and relationships.

The main process selects missing nodes read-only, verifies each selected task file through the account-scoped API, then rechecks the group in the SQLite writer transaction. Original task history, attachment rows and graph edges commit with the root operation receipt. All preparation resources are disposed on refusal or completion. No file or tool is executed.

Refused groups roll back database rows and retain existing file bytes. Immutable unregistered files may remain after a transaction refusal; they never overwrite original files. Retained receipts replay without downloading again. The real-schema main-route invariant is [[cloud-workspace-tests#Cloud workspace tests#Connected component attachment restoration]].

Local qualification: 2,625 Desktop tests / 281 files, including 31 targeted storage/attachment tests, passed. Node/web types, full lint, production build and lat check passed. The missing-credential fixture ran without OPENROUTER_API_KEY. Prior Desktop head 2881575 passed CI run 37515852708. This follow-up requires new-head CI, publication and installed multi-device qualification.


## Attachment identity aliases (draft)

Cloud attachment IDs now retain private SQLite aliases when another original task owns the same key.

[[src/main/kanban-attachment-identity.ts#portableAttachmentRows]] projects cloud IDs while the original Desktop UI uses real SQLite keys. The writer allocates unused keys under its transaction, preserves existing rows and file bytes, and retains mappings across metadata replacements. Removed attachment mappings are retired with their rows; retained private history remains available. Cloud order uses mapped IDs. Missing mapped rows or tasks refuse publication rather than losing files.

The collision, later alias overlap, replacement and removal invariant is [[cloud-workspace-tests#Cloud workspace tests#Attachment identity collision reconciliation]]. Reads and synchronization do not execute files or tasks. Installed and multi-device qualification remain required.

Local alias qualification: 2,626 Desktop tests / 281 files and 32 targeted storage/attachment tests passed. Node/web types, production build and lat check passed. Missing-credential fixture isolated from OPENROUTER_API_KEY. Previous head ac92654 passed GitHub CI run 37516920103. New-head CI, publication and installed qualification remain outstanding.


## Custom default board initialization (draft)

The original default Kanban database can now initialize with cloud display metadata through a durable recovery preparation.

A privately staged full-schema database contains the owner/replica-bound preparation before exclusive DB publication. The original metadata transaction then publishes display settings under its existing lock and retains the receipt. A separate initial source version admits only this missing-default operation; subsequent task or metadata changes refuse unpublished adoption. Existing private default_workdir values, file permissions and current-board selection survive. Replacing existing metadata still requires the admitted original Agent writer.

[[cloud-workspace-tests#Cloud workspace tests#Custom default board initialization]] and [[cloud-workspace-tests#Cloud workspace tests#Custom default board recovery]] cover original schema, exact projections, interruptions before and after metadata publication, lost acknowledgement and concurrent native edits. Source snapshots report pending recovery rather than partial completion. No Agent command, dispatch or board switch occurs.

Custom default qualification: 2,628 Desktop tests / 281 files and 34 targeted board/storage tests passed. Node/web types, full lint and production build passed. The missing-credential fixture ran without OPENROUTER_API_KEY. Previous head 3aaf9c7 passed CI run 37517609935. New-head CI, publication and installed multi-device qualification remain outstanding.


## Archived chat model reconciliation (draft)

Original chat models now reconcile independently from titles and transcript items without executing a turn.

Native keeps separate native/cloud model baselines. A single-sided local edit uses a retained history operation with no items; a cloud edit updates only the captured original session model under SQLite CAS and account guards. Simultaneous edits remain conflicts across later transcript synchronization. A lost acknowledgement retries the original operation ID and validates its exact model receipt. Older journals with unequal models require review rather than choosing an origin implicitly.

Workspace 0.6.14 admits empty archival history items; the compatible API stores its model metadata without adding an event or executing inference. Publish that API before the new Desktop consumer. The shared Chromium attachment download adapter now has its own browser-only package entry, keeping DOM types out of the Worker protocol. Native and Web reuse that same adapter.

The invariants are [[cloud-workspace-tests#Cloud workspace tests#Native history model reconciliation]] and [[cloud-workspace-tests#Cloud workspace tests#Native model compare and swap]]. Reviewed model conflict controls are implemented below. Session deletion/continuation, remaining adapters and installed multi-device qualification remain outstanding.

Model reconciliation qualification: 2,630 Desktop tests / 281 files and 35 targeted history/inventory tests passed. Node/web types, full lint, production build and lat check passed. The installed session protocol and browser attachment download entry match the packed Workspace 0.6.14 bytes (SHA256 5eb75951375249e2cc18e48af1d95ac631888b7eddb785d508abcb1bac442381). Custom-default head db36476 passed CI run 37518503782. This model slice remains unpublished; API compatibility must precede consumer publication.

## Reviewed archived model choices

The original synchronization disclosure now reviews conflicting archival model values alongside titles. It uses the same owner-bound background reconciler and never changes provider authorization or starts inference.

[[cloud-workspace-tests#Cloud workspace tests#Reviewed model conflict resolution]] validates exact model choices, retained receipt replay and refusal after newer source/revision/account changes. [[cloud-workspace-tests#Cloud workspace tests#Model conflict review interaction]] covers the displayed pair, correct IPC dispatch and late old-owner result suppression. Main rechecks the captured values and cloud revision after complete history pagination; cloud choices use SQLite CAS, while source choices persist a metadata-only operation ID before transport.

Reviewed model qualification: 2,632 Desktop tests / 281 files passed, including 27 history reconciler and 3 rendered synchronization notice tests. Node/web types, full lint, production build and lat check passed. Previous Desktop 4345803 (run 37520255213) and Fund dfdf0e19 (run 37520256452) passed CI. This additional review control remains unpublished pending latest-head CI and installed multi-device qualification.

## Original archive visibility reconciliation (draft)

Original archive flags and cloud session visibility now reconcile in both directions while keeping source messages and folders intact. The original sidebar remains filtered; repository capture explicitly includes archived rows before pagination.

Original Agent `set_session_archived` updates compression ancestors/descendants, so Desktop uses that same lineage query with SQLite source CAS and whole-row readback. Related archive flags converge on subsequent captures. Unexpected metadata changes roll back the transaction. Schemas without archive support remain readable but refuse automatic archive writeback; partial lineage schemas and unsupported values retain source state.

A newly archived source writes complete history before its retained delete operation. Restoration uses the same owner-scoped API with the original operation ID persisted before transport. Receipt recovery checks exact revision and deletion state without inference, tools or task dispatch. Busy cloud turns defer; cloud writeback checks a fresh session checkpoint, original archive CAS and account identity. Older journals with unequal visibility require an explicit original-notice choice rather than inferred deletion from missing rows.

[[cloud-workspace-tests#Cloud workspace tests#Original chat archive synchronization]], [[cloud-workspace-tests#Cloud workspace tests#Reviewed chat visibility choices]], [[cloud-workspace-tests#Cloud workspace tests#Native archive compare and swap]], [[cloud-workspace-tests#Cloud workspace tests#Complete native archive inventory]], [[cloud-workspace-tests#Cloud workspace tests#Original compression lineage archive]], [[cloud-workspace-tests#Cloud workspace tests#Archive synchronization guards]] and [[cloud-workspace-tests#Cloud workspace tests#Chat visibility review interaction]] cover this behavior. Original Desktop physical deletion intent is implemented below. External Agent deletion writers, continuation, remaining adapters, publication and installed multi-device qualification remain outstanding.

Archive qualification: 2,639 Desktop tests / 281 files and 50 targeted history/archive/rendered-notice tests passed. Node/web types, full lint, production build and lat check passed. Previous model-review head 25957a7 passed CI 37520995340. This archive slice remains unpublished; physical native deletion intent, continuation, remaining adapters and authenticated installed multi-device qualification still require work. No original user DB/file or production API mutation occurred.

## Original physical deletion intent (draft)

Original Desktop deletion records an owner-bound cloud intent in the same SQLite transaction as its source deletion. Children stay intact; failed deletes roll back both data edits and intent.

Background capture establishes deterministic source/cloud mappings while original rows still exist, before asynchronous API publication. It refuses missing rows and owner rebinding. Legacy unmapped deletion keeps its existing native behavior; no cloud identity is invented from absent rows. Mapping and deletion records are Desktop-owned metadata in the original profile database, without credentials or filesystem paths.

The owner-guarded reconciler reads actual committed deletions, durably fixes each first base revision and retries the same operation ID. Exact accepted deletion receipts are retained in SQLite. Busy work defers, and CAS conflicts stay pending without rebasing or reconstructing the source from cloud cache. A missing target keeps its durable marker so a delayed cloud create cannot resurrect it. Cloud tombstones preserve prior cloud history; explicit later cloud restoration can be handled by existing working-copy reconstruction after the delete is acknowledged.

[[cloud-workspace-tests#Cloud workspace tests#Atomic original session deletion intent]], [[cloud-workspace-tests#Cloud workspace tests#Deletion rollback preserves original source]], [[cloud-workspace-tests#Cloud workspace tests#Durable original deletion acknowledgement]], [[cloud-workspace-tests#Cloud workspace tests#Original deletion receipt synchronization]], [[cloud-workspace-tests#Cloud workspace tests#Original deletion conflict and account guards]] and [[cloud-workspace-tests#Cloud workspace tests#Absent deletion targets stay durably suppressed]], [[cloud-workspace-tests#Cloud workspace tests#Original deletion response admission]] and [[cloud-workspace-tests#Cloud workspace tests#Other-owner native deletion isolation]] cover this path. Explicit pending-deletion conflict controls, external Agent deletion writer adoption, prior unmapped deletion recovery, full continuation, remaining adapters, publication and installed offline/multi-device qualification remain outstanding.

Physical deletion qualification: 2,647 Desktop tests / 282 files and 47 targeted deletion/history tests passed. Node/web types, full lint, production build and lat check passed. Prior archive head eb3d30d passed CI 37522300030. Fresh origin/main is already included (Desktop 67e2363 and Fund 34a5549b); preview.27 is the latest released installer and preview.28 remains unpublished. No original-user storage or production API mutation occurred. Latest-head CI and production/installed qualification remain outstanding.

## Shared Desktop publication qualification (2026-10-07)

Canonical Desktop views and original-history adapters are on Desktop main ac6bddf and Fund main d42a961. Public API and App are published; installed Desktop and full synchronization still need qualification.

Public API run 37528716094 attempt 2 deployed version 05d62894-534a-484d-919a-8de4411b5c91 after its complete voice/storage/schema gates. App run 37528710301 deployed 2fd83bf5-b217-48a6-b6b5-5d0d59cc79fc. An authenticated production model response rendered a real two-column table, survived reload and rendered at 390px without browser errors. Canonical Discover cards, Kanban columns, Memory and Capability panels, Settings dialog and Office 3D were observed; this does not qualify all source-data adapters.

Fund PR542/main 165f654 adds the original per-key English translation fallback for partial locale dictionaries. App run 37532384908 deployed ab1856ee-f4bf-445c-bd02-76b445063895; actual Japanese Settings/sidebar no longer expose bare translation keys, and the stored table still renders. Installer preview.28 run 37530012973 remains active: Windows/Linux packages passed, Mac packaging remains pending. Installed preview.27 lacks workspace:read authorization; neither installer completion nor actual installed cross-device synchronization is claimed.

## Agent original deletion writer adoption (draft)

Agent PR12 stages Desktop-compatible owner/profile delete intents inside original single/bulk SQLite deletion transactions, including delegate cascades. This closes a writer gap without changing account permissions or review guards.

Agent head c1c7e7ab73 has 18 passing SQLite tests, including guard/refused-review admission, atomic rollback and A-B-A profile stores. Its broad state suite has the same 64 persistent failures as unmodified main 806c0a473b on this macOS environment; an existing quarantine race also passed on retry and remains recorded. CI run 37534472453 is pending. This writer is not merged or installer-pinned; automatic retention/repair writers, deletion conflict controls, continuation and remaining adapters stay outstanding. No user database or cloud deletion was performed for this qualification.

## Original account reconnection (draft)

The shared renderer distinguishes automatic connection from an explicit reconnect. Desktop handles permission recovery through its original account card; browser authentication and device permissions remain in consumer adapters.

`beforeReconnect` defaults to `beforeConnect` for existing Web consumers. Desktop opens the original Mithril account dialog only when an explicit reconnect fails for missing Workspace scopes, absent identity or expired/refused sign-in. Automatic startup never opens the dialog or invokes device authorization. Network failures retain ordinary retry behavior. Profile/account changes close the dialog before reconnecting; no credential enters the shared package. [[cloud-workspace-tests#Cloud workspace tests#Explicit native reconnection recovery]] and [[cloud-workspace-tests#Cloud workspace tests#Transient reconnect never requests authorization]] cover the actual shared-renderer path.

## Shared UI and installer live verification (2026-10-07)

The production Web bundle renders the original Markdown table and Memory, Capability and Settings components. Preview.28 installers are published; installed Desktop and complete synchronization remain separate qualification steps.

Fund main ce39255136317e89f67c6282d549309ec270cb81 passed App run 37537276513 and deployed version 43e6696c-9843-4ce0-85e3-b3945735c971, with rollback ab1856ee-f4bf-445c-bd02-76b445063895. Browser reload actually loaded `/spa/assets/index-DdFLialY.js` (SHA256 6d4b293d2a9da67db9450ccc4b33a4c0d087d23368ab6d9c7b89fe10a8d1f1f0). The retained model response still displayed two table headers and JS/Python data rows. Memory exposed the original entries/profile/providers/persona tabs; Capability exposed original tools/MCP/skills tabs; Settings opened its original dialog. These observations qualify rendering and retained cloud reads, not every native tool or write adapter. Five original Markdown renderer tests and lat check passed locally.

Preview.28 platform run 37530012973 succeeded. The prerelease contains all five platform installers, preview feeds, blockmaps and SHA256SUMS; the public download page actually advertises preview.28 for Apple silicon, Intel Mac, Windows and Linux. Installed preview.27 was not replaced in this verification. Desktop main 2aa62cc005508dc2ced221a35a406361e5835dd3 passed main CI 37537279932; its preview.29 platform run 37537682040 is still building. Agent PR12 at 235ffe24f18fc4bb9f1c78e180ec0ac1fd408d48 remains unmerged with full CI 37537312566 running. Rich schedules (Cron, delivery, scripts), history continuation and remaining profile/data adapters are still outstanding; removal of a native view must preserve its data and actions.

### Original schedule source capture (draft)

Original Cron files are captured completely before any projection, with their source shape and metadata preserved.

[[src/main/cron-source-files.ts#captureOriginalCronFile]] reads the fixed profile's jobs.json through one opened inode, checks encoding, size, source identity and duplicate/malformed rows, and computes a byte-level source version. The final path check compares size and modification/change times with the opened descriptor, refusing in-place changes after its final read. Array and object file shapes remain distinct. Missing storage is not a fabricated empty file. Symlinked files/directories and changed sources fail without repairing or writing the original store.

[[src/main/cronjobs.ts#readOriginalCronSource]] remains main-process-only: retained source may contain private runtime bindings and is not admitted for cloud upload. The existing selected-schedule preview now starts from this complete capture instead of silently filtering malformed records. Tests use real temporary A-B-A profile files and verify exact metadata, untouched bytes, source revisions, legacy shape and unsafe-source refusal. Cloud field binding, locked restoration, original Schedules mounting and execution ownership remain required.

### Original schedule source restoration (draft)

[[src/main/cronjobs.ts#restoreOriginalCronSource]] sends locally bound original schedule files to the original Agent CLI on stdin. Restoration retains file shape and metadata, with byte-version CAS and durable private receipts.

The Agent uses its original profile-scoped jobs lock in strict cross-process mode. Changed jobs take original fire fences before the jobs lock and defer immediately if another process owns a fence, including the pre-claim window. Lost acknowledgement retries do not overwrite newer native edits; pending writes recover on either side of the atomic rename. Active execution claims and pending occurrences defer restoration; foreign claims and unbound activation are refused. Windows UTF-8 BOM sources retain unknown metadata through capture and subsequent original saves.

[[src/main/cron-source-restore.ts#parseOriginalCronRestoreResult]] checks the exact owner/profile/operation receipt and suppresses raw child errors. This main-process port is not exposed through raw-source IPC. The new Agent command must be included in the pinned Agent release before this port is usable; portable cloud field binding, continuous schedule reconciliation, original Schedules mounting and authoritative execution ownership remain required.

### Original schedule preparation (draft)

Original schedule creation uses the Agent's existing parser without writing a native job or granting execution authority.

[[src/main/cronjobs.ts#prepareOriginalCronSource]] sends the captured owner, profile, operation, timezone and original input to `cron source-prepare` on stdin. The Agent shares its complete job builder with native creation, preserving recurring phrases, Cron expressions and relative or dated one-time schedules. [[src/main/cron-source-prepare.ts#parseOriginalCronPrepareResult]] admits only a response bound to that exact request and suppresses raw child diagnostics. This main-only port still requires a qualified Agent pin and a cloud adapter; it is not an installed synchronization result.

Local qualification: 2,660 Desktop tests in 285 files passed using bundled Node 24 and an isolated provider environment; node/web types, full lint and lat check passed. An earlier Node 26 run failed 24 tests because of host Web Storage and provider-environment differences and is retained as a failed result. The shared parser adapter passed 206 tests; Agent Cron/atomic-source tests passed 1,460 with 13 platform skips. Actual Windows CI and execution ownership remain required before publication.

### Original lifecycle preparation (draft)

Pause and resume preparation use the original Agent policy while preserving authored data and overdue occurrences. The receipt is data only and grants no execution lease.

[[src/main/cronjobs.ts#prepareOriginalCronTransition]] captures owner, profile, timezone, operation and original source before invoking the readonly command. [[src/main/cron-source-transition.ts#parseOriginalCronTransitionResult]] rejects stale identity, lost counters, altered unknown metadata and active claims. The shared source validator allows only the original ordered skill canonicalization. Workspace 0.6.17 supplies this codec to both consumers. Source preparation is not yet installed-runtime qualification or a complete synchronized scheduler.

The vendored Workspace 0.6.17 archive SHA-256 is `0ab207a81b30afa505b6f8e7a17d1fba17e2e2b3a33611506d920eed187f16bc`. Its compiled exports include the original source, lifecycle adapter and complete-file codecs; the consumer imports those artifacts rather than copying UI or schedule semantics.

The archive was generated in a task-specific directory from Fund source `0352e6577dd8d466245bb4faca1f0f5944a1e56c`, and all three original schedule JS/type exports were checked before installation. A generic temporary archive is not accepted as source provenance.

## Exact original schedule source restoration (draft)

The complete schedule capture now carries exact UTF-8 source text, and restoration can preserve those bytes through the original locked CLI path.

[[src/main/cron-source-files.ts#captureOriginalCronFile]] retains BOM, CRLF, file formatting and opaque integer metadata in `sourceText`, alongside the parsed preview and byte digest. [[src/main/cron-source-restore.ts#validOriginalCronRestoreRequest]] admits exactly one bounded representation: the existing parsed file or exact source text. [[src/main/cron-source-restore.ts#parseOriginalCronRestoreResult]] verifies a text-mode receipt against the exact requested source SHA256. [[src/main/cronjobs.ts#restoreOriginalCronSource]] snapshots the request before awaiting the child. Raw source remains main-only; no upload, resource permission, execution ownership or renderer IPC is added.

## Exact original schedule preparation source (draft)

Original parser receipts can carry complete prepared JSON source text, checked against the bound parsed job. The text preserves opaque numeric tokens and stays in the main process.

Older Agent receipts remain readable but do not supply the raw source required by the full-file create adapter. This does not mount the shared Schedules screen, upgrade the Agent pin, authorize private upload or establish execution ownership. Tests reject malformed or mismatched source with static errors.


## Original schedule source resources

The shared package 0.6.21-schedules.2 provides a main-only owner-scoped schedule resource transport through the fixed Mithril API.

Its private R2 namespace is separate from Capability registration, and D1 stores verified complete-file pointers. Original Schedules components are unchanged.

[[src/main/cloud-workspace.ts#CloudWorkspace]] retains Workspace read/write scope, owner and account-generation checks for these binary requests. No raw source IPC or automatic upload is introduced. Continuous source restoration still requires private resource binding, exact Native receipts and one execution authority; original screen separation removal remains pending.

## Durable original schedule replica journal (draft)

The main process retains portable pending schedule source and its operation identity before network writes, using a private owner/profile/timezone journal.

[[src/main/original-schedule-replica-store.ts#NativeOriginalScheduleReplicaStore]] commits journal writes independently of its separate SQLite process lock. Abrupt process exit releases the OS-held lock without losing pending work; another window fails busy immediately and can retry its existing coordinator. Paths, permissions and identities are checked before access. This store does not capture, upload or restore Native scheduler files and is not yet mounted in the service lifecycle.

## Bound original schedule source port (draft)

A main-only adapter connects verified resource bindings with exact Native capture and original locked restoration, keeping portable source digests distinct from Native file CAS.

[[src/main/original-schedule-native-port.ts#BoundOriginalScheduleNativePort]] requires explicit capture/restore resource binders. Shared raw-token patches retain source bytes elsewhere; failed binding has no raw-source upload fallback. Scope guards surround asynchronous binding and original writes, and only the exact bound source hash can be acknowledged. Restore binding must retain an operation-bound target before the original Agent write, allowing retained Agent receipts to acknowledge earlier work without overwriting later edits. Concrete resource/authority binding and service mounting remain required.

The pinned workspace 0.6.21-schedules.4 archive was produced from Fund source `ba02898461e46b121b09703702b7e4b73cf5d31a`. It is complete (411 files) and has SHA256 `7ddc3e468a5837167055baab0587e7258d9244752cd29e70f4811f38c321d8da`; compiled source codec and replica exports were compared byte-for-byte with the completed producer build before installation. The earlier 0.6.21-schedules.2 archive remains unchanged.

### Durable original schedule binding targets (draft)

The private replica journal retains an operation's exact bound Native source before restoration, so restarting never recomputes a different target for a retained Agent receipt.

[[src/main/original-schedule-replica-store.ts#NativeOriginalScheduleReplicaStore#retain]] stores the exact portable request, Native target and SHA under the coordinator lock. Reused IDs with changed source, CAS or scope refuse; identical retries skip binding. [[src/main/original-schedule-native-port.ts#BoundOriginalScheduleNativePort]] requires this target store. Concrete resource resolution and lifecycle mounting remain incomplete.

### New Chat without connection gating

The shared sidebar opens an empty Chat without waiting for cloud identity or model discovery; the first submitted message creates the session through the existing canonical outbox.

Normal workspace screens and the Desktop sidebar no longer expose Device data/history migration sections. [[src/renderer/src/screens/CloudWorkspace/RepositoryReplication.tsx#RepositoryReplication]] continues background owner-scoped synchronization. [[src/renderer/src/screens/CloudWorkspace/MithrilChat.tsx]] shows a readable sign-in action instead of raw scope errors. Authentication and permissions remain enforced; no tokens gain scopes automatically.

The New Chat candidate pins workspace 0.6.23-schedules.2 from Fund b8f68349, SHA256 `8e17de27e7930368fbaed553c6143a0a3395e5c6f4c461fa5e35280d79f8b699`. The immutable archive contains 411 files and was packed only after the completed build; it remains a draft dependency pending production publication.

## Original schedule directory resources (draft)

Original scripts and workdir trees can be retained through owner-scoped schedule resources, preserving permitted file bytes and executable flags without running jobs.

[[src/main/original-schedule-directory-resources.ts#OriginalScheduleDirectoryResources]] uses the fixed schedule resource namespace with an immutable profile-bound manifest. Capture publishes verified chunks before returning its pointer and disposes staging files. Known credential/cache filenames are excluded by the existing directory capture policy; the main-only result retains the exclusion count. This is permitted-file synchronization, not synchronization of secrets, arbitrary runtime interpreters, empty directories or symbolic links.

[[src/main/skill-resource-snapshot.ts#downloadDirectoryResources]] reuses the existing bounded manifest/chunk verifier for schedule directories; the Skill-specific wrapper still validates its original pointer contract. Restoration downloads the retained baseline and target, then uses the original transactional directory CAS and durable operation receipts. Concurrent local changes produce a conflict, while an acknowledged retry leaves newer edits untouched. Private state is separated by owner/profile/timezone. Account guards surround asynchronous I/O and the native write. Windows restoration remains deferred by the existing filesystem adapter.

This primitive is tested against real temporary files and an owner-scoped storage fixture. Concrete job-field bindings, execution authority admission, lifecycle mounting, real-cloud qualification and installer publication are still required before claiming automatic original schedule synchronization. No new migration panel or renderer IPC is added.

## Original schedule script resources (draft)

Original script and monitor-script tokens now map to one immutable profile-script resource snapshot without reducing the rest of the original schedule source.

[[src/main/original-schedule-script-resources.ts#OriginalScheduleScriptResources]] resolves authored paths under the selected profile's scripts directory, captures actual permitted bytes, and emits canonical portable references containing only profile, manifest digest and relative path. Excluded/missing scripts cannot become valid references. Raw token patches preserve BOM, CRLF, unrelated fields and opaque numeric tokens.

Restoration accepts only canonical references from the same scope and snapshot. The directory transaction verifies every referenced file before writing; its retained baseline, durable operation and existing receipts preserve concurrent local edits and retries. Original script fields return to the Agent's existing scripts-relative path convention. Workdir/private-runtime bindings, execution authority and lifecycle mounting still need to compose this stage before complete schedule synchronization can ship.

## Original schedule workdir resources (draft)

Original workdir fields now bind to verified directory snapshots while retaining machine paths privately and preserving original job source tokens.

[[src/main/original-schedule-workdir-resources.ts#OriginalScheduleWorkdirResources]] captures authored absolute or home-relative working directories through the existing permitted-file resource transport. References bind profile, stable job ID and immutable manifest, without publishing the source device path. Restore resolves an operation-bound private target and baseline through its caller, then uses transactional directory CAS. Durable receipts preserve newer local edits on retry. Account guards surround storage and native restoration. Script semantics and unrelated raw source bytes remain unchanged.

This stage adds no UI split or migration panel. It remains draft: private target lifecycle persistence, runtime/authority binding, complete coordinator mounting and actual cloud/installer qualification must compose these resources before automatic schedule synchronization is complete.

## Original schedule resource composition (draft)

Script and workdir resource stages now compose with mandatory runtime binding under the private replica journal lock, retaining directory targets before writes.

[[src/main/original-schedule-resource-bindings.ts#OriginalScheduleFileResourceBindings]] implements the bound Native port's resource interface. Runtime binding remains mandatory and precedes resource restoration; it must not execute jobs. The main-only [[src/main/original-schedule-replica-store.ts#NativeOriginalScheduleReplicaStore#retainDirectoryTarget]] durably retains each operation's scripts or job-specific workdir destination and immutable comparison baseline before filesystem changes. Reused IDs with changed source, CAS or manifest refuse. Restart uses retained targets, never today's recaptured baseline. Machine paths remain private. Full execution-authority admission and lifecycle mounting remain required before production qualification.

## Original schedule runtime claim binding (draft)

Native process claims now become portable references and restore only from the receiving device's exact source, under mandatory execution admission.

[[src/main/original-schedule-runtime-bindings.ts#OriginalScheduleRuntimeBindings]] implements the runtime stage required by the composed resource binder. The original Agent's run_claim, fire_claim and pending_slot fields are replaced by canonical profile/job/field references before upload. Restoration rejects raw or foreign references, requires exact-source execution admission, verifies the current native file CAS and reuses exact receiving-device claim tokens. New inventories receive null claims. Unrelated source bytes and opaque metadata remain unchanged. This adapter never executes jobs or grants ownership. The cloud execution authority implementation and automatic lifecycle mounting remain unfinished; callers cannot supply a permissive production fallback.

## Original schedule shared workdir restoration (draft)

Jobs sharing a working directory restore one snapshot once. All private targets are resolved before filesystem writes, and aliases must agree on the source snapshot and native baseline.

Automatic capture now emits v2 workdir references with an opaque random folder identity retained in the owner/profile/timezone SQLite journal under the same process lock. The identity is independent of local path, job ID and content digest. A fresh device uses it for one managed destination across all referencing jobs; subsequent capture retains that identity. Identical independent folders remain separate. Alias-to-path binding refuses mismatched roots rather than merging local data. The decoder retains existing v1 per-job references; upgrading already divergent historical destinations still requires conflict qualification and is not implied by the fresh-device test.

[[src/main/original-schedule-workdir-resources.ts#OriginalScheduleWorkdirResources]] groups normalized absolute targets in original source order. The first job's existing operation receipt owns the shared directory transaction, so restart reuses that receipt instead of recapturing newer local edits. Conflicting manifests or baselines fail before directory writes. This remains draft resource integration; global execution ownership and automatic lifecycle installation are still required.

## New Chat and automatic synchronization

New Chat opens the shared empty conversation before authentication or model discovery. The first submitted message creates its canonical cloud session; ordinary navigation never exposes device migration screens.

The sidebar uses the same shared history and workspace across Web and Desktop. Background owner-scoped reconciliation in [[src/renderer/src/screens/CloudWorkspace/RepositoryReplication.tsx#RepositoryReplication]] continues without an import prompt. [[src/renderer/src/screens/CloudWorkspace/MithrilChat.tsx]] displays readable sign-in guidance on failed identity checks. Existing tokens remain scoped and never gain permissions automatically.

The installer candidate pins immutable workspace `0.6.24-chat.4`, SHA256 `2e32c3e3bec3927eb22310bf2ec8fab60b6b0d79fd2272e67b8cab7caf0c04cf`, built from Fund `a47f138f`. It excludes the unfinished original schedule resource/replica draft and includes only the normal Chat/migration-navigation repair on current main.

Preview.34 preserves the shared editor compile action approved in preview.33, and the Web URL history fix. The producer passed 228 workspace tests; Web consumer results are tracked independently.

## Current-main original schedule integration candidate

The complete-file schedule draft now includes current-main Desktop authentication and shared UI updates, using one new immutable Workspace artifact.

Desktop main `6e345be0a557eda54f3ed53ad087f67ea903d1c8` is merged into this draft. Workspace `0.6.26-schedules.1` was built from Fund `80e5cf576bfc787ac893dde74ac980fdd61d04a8`; its archive SHA256 is `2d80acd6c7b6f041e26190b9c5cd97ed7f693015f431e6ea2fba42b56544daee`. All compiled producer bytes were compared with its 415 archive files before dependency installation. The package and lockfile pin this exact local vendor archive.

Current-main Chat distinguishes authorization, account expiry and network retry. Its initial linked session is consumed once, retaining the shared New Chat fix. The original schedule source/resource/replica adapters stay in the same candidate. Dependency consumption does not mount the automatic schedule lifecycle or grant execution custody; those integrations, production qualification and a new installer release remain unfinished. Preview.36 is the inherited main manifest version, not evidence that this draft is installed or publicly released.

Qualification passed 64 selected tests across 13 files covering original source/resources, retained replica state, Chat/reconnection and account controls. Main/renderer typechecks, affected renderer lint, packaging identity, the complete Electron build and lat check passed. All installed package files were compared byte-for-byte with the vendor archive, and the lockfile version/path were verified. These local checks do not prove cross-device production synchronization or installer behavior.

## Original schedule main execution transport (draft)

The main process now connects the original schedule execution protocol to its existing account transport, without exposing credential or executor selection to renderer IPC.

[[src/main/cloud-workspace.ts#CloudWorkspace#originalScheduleCustody]] supports the fixed status/select/claim/transition route. [[src/main/original-schedule-custody.ts#validOriginalScheduleCustodyCommand]] checks exact fields, the original UTC microsecond instant and safe revisions before transmission. The selected profile must match; all existing workspace:write, chat:write and inference grants are required even for custody inspection. No token gains scopes automatically.

The route's receipt has no repository schemaVersion. It uses [[src/main/original-schedule-custody.ts#validOriginalScheduleCustodyReceipt]] rather than the unrelated repository envelope validator. Main validates the confirmed account, profile, operation and exact action receipt, limits response bytes to 8192, refuses redirects, and checks identity again after reading the response stream. Lost acknowledgements never retry mutations. Replayed fresh/changed false remain inspection evidence, not effect permission.

Real local HTTP qualification covers A/B/A credentials, original microsecond identity, foreign/extra/oversized receipts, redirect refusal, lost acknowledgements, missing grants and identity changes during streamed responses. Bypassing receipt validation made the foreign-owner regression fail; restoring it passes. This is the Native main transport needed by automatic execution admission. Durable per-source/occurrence binding, lifecycle mounting, unknown-result reconciliation, production API publication and installer qualification remain unfinished; adding this transport does not activate schedules.

Qualification passed 40 tests across five main-process transport, runtime binding, bound source and retained journal files. Main/renderer typechecks, changed-file ESLint, the complete Electron build, whitespace validation and lat check passed. The signed/installed release and production backend are separate evidence gates; this candidate remains draft.

## Original schedule Agent binding bridge (draft)

The main process can persist a published original source's execution policy through the selected profile's owned Agent CLI, without a migration panel or raw-source IPC.

[[src/main/cronjobs.ts#bindOriginalCronExecution]] uses the existing profile credential environment and local interpreter. [[src/main/original-schedule-agent-binding.ts#bindOriginalScheduleAgent]] sends an exact bounded anchor on stdin, fixes the named profile and command, bounds output and time, checks account guards before and after the child, and accepts only the exact persistence receipt. Child errors and credentials are not exposed. This does not admit any occurrence, publish the source, select an executor or silently grant scopes. Background lifecycle mounting, full source/resource reconciliation, production publication and installed behavior remain required.

The same main-only bridge prepares the required execution-policy lane before authored source restoration through [[src/main/cronjobs.ts#prepareOriginalCronExecution]]. Absent files retain a null CAS; existing source bytes remain unchanged. The owned Agent verifies account status and original fire fences before durable preparation. Passive replicas may retain source policies, but only the selected executor's fresh per-occurrence claim admits effects. Lifecycle mounting remains required.

Preparation now invokes the Agent checkout's owned `plugins/mithril-schedules/bootstrap.py` directly with the existing interpreter, profile and bounded stdin. This works without manually enabling the plugin CLI. The draft Agent verifies fixed-origin identity before PM-owned admission, preserves unrelated configuration, and refuses explicit disabling or external overrides. Binding still uses the enabled existing CLI. Successful PM publication, the reviewed Agent installer pin and installed-client qualification remain required; a local child-peer test proves the Native command contract only.

## Automatic original schedule replication (draft)

The main lifecycle now composes exact original source, resource binding, a private durable repository outbox and Agent policy preparation without a migration screen.

[[src/main/original-schedule-replication-runtime.ts#startOriginalScheduleReplication]] starts after secure profile credentials are registered and stops at app shutdown. [[src/main/original-schedule-replication-loop.ts#OriginalScheduleReplicationLoop]] serializes polling, cancels stale account/profile work and resumes the current identity after an interrupted run. Required API grants and the durable first-account source binding remain enforced.

[[src/main/original-schedule-replication.ts#OriginalScheduleReplication]] prepares the required original Agent policy lane before restoring authored inventories or selecting an absent authority. It never takes over an existing selected device. [[src/main/original-schedule-replication-admission.ts#originalScheduleReplicationAdmission]] requires fresh owner/profile custody at the retained revision and the exact local or owner-bound cloud source digest. Passive replicas may retain data; actual execution still requires a fresh per-occurrence claim. [[src/main/cloud-workspace.ts#CloudWorkspace#assertNativeContext]] guards account, token, profile and generation between asynchronous stages.

The private SQLite journal also retains repository snapshots and pending source-manifest operations under the same cross-process lock. Restoration retains existing scripts/workdir CAS and receipts. This composition is a draft: whole-coordinator multi-device tests, shared directory alias identity, default owned-plugin setup, cloud timezone policy, original shared Schedules mounting, production migration/publication and installer qualification remain required. No real-cloud or installed-app completion is claimed by the local lifecycle tests.

### Coordinator peer qualification

The mounted coordinator now has real-file/SQLite roundtrip and lost-acknowledgement tests across two device roots, retaining authored inventories and concurrent script edits.

The tests exercise the actual source/resource adapters, shared repository engine and durable journals against owner-scoped cloud and Native receipt peers. Preparation and binding are test ports, not a live Agent CLI, D1/R2 deployment or installed application. Full authority/Agent/cloud qualification, shared directory alias identity and the original Schedules consumer remain release requirements.

## Original Schedules screen mirror (draft)

Desktop now mounts the original shared Schedules component directly over its automatically synchronized original inventory, with no separate device dialog.

Workspace `0.6.29-schedules.5` resets the original renderer's rows, dialogs and action state when its API or profile changes. Out-of-order refresh replies cannot replace the newest inventory, and a successful refresh clears a prior load error. The new immutable vendor archive includes the shared browser original-file context export; the preceding archive is retained unchanged. Source package tests and consumer build checks remain distinct from a signed installer or installed behavior.

[[src/renderer/src/screens/CloudWorkspace/CloudSchedules.tsx]] retains the original cards, creation form and lifecycle controls, remounting on account changes. The existing narrow Cron IPC operations call [[src/main/original-schedule-replication-runtime.ts#runOriginalScheduleScreen]] through the same serialized lane as background replication. Profile/account identity is captured before queuing and checked before/after actions; switching users cannot apply an old queued action to a new account.

Before edits or manual execution, the original inventory must be confirmed synchronized and its required Agent policy prepared/bound. [[src/main/original-schedule-replication.ts#OriginalScheduleReplication#assertSelectedExecution]] additionally requires fresh selected-device custody for manual execution; the Agent still admits each occurrence separately. An owner-bound mirror remains readable during a sync outage/conflict, without allowing writes or execution through that recovery path. Committed edits retain their success acknowledgement after network confirmation fails and are retried by the durable background pipeline.

This is the Desktop mirror consumer, not proof of the Web full-manifest consumer, remote execution forwarding, Agent-pin/plugin setup, shared workdir aliases or production/installer qualification. Those gates remain open. The normal Desktop route now composes the same unified schedules adapter as Web over original Cron IPC and the fixed cloud schedule IPC transport. Existing cloud intervals retain their model, history and execution policy; original schedules retain their source parser and native custody. Account changes invalidate the connection before replacement rendering. No simple cloud list or device dialog is mounted.

## Original workdir private runtime boundaries (draft)

Working directories retain authored files while device-specific execution authority and synchronization journals remain private. The same exclusions govern capture, manifest acceptance and locked restoration.

[[src/main/original-schedule-replication.ts#OriginalScheduleReplication#sync]] supplies exact private paths for the profile's original jobs source, execution policy/bindings, lock and SQLite ledger sidecars, plus the replication state root. The canonical jobs source synchronizes through its separate original full-file port. Workdir snapshots retain scripts, outputs and other authored data; they cannot copy raw device bindings through a duplicate runtime source.

[[src/main/original-schedule-directory-resources.ts#OriginalScheduleDirectoryResources]] computes destination-relative exclusions, refuses roots inside private state, rejects incoming manifests covering reserved paths, and binds the exclusion set into restoration identity. [[src/main/resource-exclusions.ts#resourceExclusions]] validates the consumer-owned paths. Capture and locked file transactions apply the same paths; native restore receipt files remain excluded. Real Python filesystem tests preserve distinct device-private bytes while copying authored files and refuse a foreign authority manifest before changing either target file. This does not establish installed-client or production synchronization.

## Empty original profile synchronization (draft)

A fresh original profile is discoverable in Web before its first job exists. Background synchronization registers data context without creating jobs or altering original source bytes.

Workspace `0.6.28-schedules.2` adds `ensureOriginalScheduleFileContext` to the original file port. The main coordinator registers the confirmed profile/timezone after loading its durable repository, using the existing owner-bound CAS/outbox. A source manifest remains distinct and supplies the source revision; conflicting timezone metadata refuses. No device path or execution claim appears in the profile row.

The immutable archive replaces the draft consumer pin while retaining preceding archives. Actual coordinator tests cover an absent native source, repeated background polling and no source writes or binding calls. Shared and browser tests discover an empty profile, display the actual Desktop empty screen and create the first original job using test parser receipts. Production Agent parsing/execution, main publication, signed installers and installed-client qualification remain open.

The candidate archive SHA256 is `1b4e6cb8f382f8785ea72b9b68987a212cb559efcbff1877d005064249652040`; all 415 packaged files match the shared source build and installed dependency. This is dependency provenance, not an installed application update.

## Original parser mailbox processing (draft)

The background original schedule lane processes one confirmed read-only parser request per poll using the existing original Agent CLI, retaining results in the same account-bound repository.

[[src/main/original-schedule-replication.ts#OriginalScheduleReplication]] uses workspace 0.6.29-schedules.2's preparation mailbox inside the private journal's exclusive lane. [[src/main/original-schedule-replication-runtime.ts#runOriginalScheduleScreen]] shares that lane with original screen operations. The captured owner/profile/timezone is checked around the actual source-prepare/source-transition calls; only confirmed requests for that context are processed. The mailbox cannot select an executor, grant execution, or write jobs.json. Passive devices may prepare without executing. Read-only preparation precedes execution-policy admission and custody lookup, so an unavailable execution service cannot suppress an already confirmed parser result. Policy admission still precedes every authored restore and executor selection. Repository CAS retains the first result and the existing outbox recovers lost replies. Original raw numeric text remains retained in the owner-scoped receipt.

Local transport/parser peers verify composition and port wiring. Isolated actual Agent CLI tests verify read-only original preparation and transition behavior; neither check establishes installed-client or production API operation. The Agent pin, browser screen/manual execution connection, API release and installed-client qualification remain separate unfinished gates.

## Exact original manual execution port (draft)

The main-process manual run port sends a retained operation ID and the exact native source version to the original Agent. A correlated unknown receipt is distinct from confirmed completion.

[[src/main/cronjobs.ts#runOriginalCronSource]] uses [[src/main/cron-source-run.ts#callOriginalCronRun]] with the captured profile's native runtime and secure environment. Requests and result identifiers are bounded and exact; owner/profile/operation/job/version mismatches, extra authority and raw child errors cannot confirm a receipt. Source bodies, secrets and private errors never enter renderer IPC. The caller must verify selected execution custody before invocation and check the active account/profile before and after the child. The parser's short timeout is not applied to a running job; the original Agent's watchdog remains responsible for execution liveness.

The Agent `source-run` command retains request identity in its existing private executions database before effects, checks the full source under its original fire/store locks, and invokes the original runner including its execution policy. This does not grant execution authority or reconcile an unknown outcome. Local qualification executes harmless actual scripts through this Native transport in isolated A→B→A homes and verifies retained replay and source mismatch rejection. Agent source is PR #12 commit `835405c8833d77746a974fcf49d2aa2bc04b0ad8`; the installed Agent pin is not updated. The remote broker, background pump, primary Web route, publication and installed-client qualification remain unfinished.


## Original manual main consumer transport (draft)

Main owns manual take/report credentials and validates exact account/profile receipts; renderer intent cannot choose a device or grant dispatch authority.

[[src/main/cloud-workspace.ts#CloudWorkspace#originalScheduleManual]] uses the fixed API manual route, existing workspace-write/chat-write/inference grants, 15-second network bound and 8192-byte response limit. [[src/main/original-schedule-manual.ts#validOriginalManualCommand]] rejects caller owner/executor fields. [[src/main/original-schedule-manual.ts#validOriginalManualResult]] validates each result shape: only a fresh unknown take with positive custody revision permits dispatch. Empty, source-refused and replay receipts cannot authorize another run. Completion matches every original operation/source field. Account/profile changes during streamed responses discard the result. Lost take/report replies never retry automatically.

Real HTTP peers cover A/B/A identities, malformed/foreign/oversized/redirected/lost receipts, missing grants and streaming identity changes. This is the main transport boundary, not the background consumer or a running Web-to-Agent path. Durable dispatch/result storage, pump lifecycle, reconciliation, API publication and installed-client qualification remain unfinished.


## Original manual durable journal (draft)

Manual execution records share the original private owner/profile/timezone replica journal and its cross-process lock, with uncertainty committed before any external effect.

[[src/main/original-schedule-replica-store.ts#NativeOriginalScheduleReplicaStore#reserveManual]] binds the exact portable request, custody revision and native source version. [[src/main/original-schedule-replica-store.ts#NativeOriginalScheduleReplicaStore#beginManual]] commits unknown once; a replay or reopened unknown never authorizes another dispatch. [[src/main/original-schedule-replica-store.ts#NativeOriginalScheduleReplicaStore#recordManualResult]] retains only an exact native receipt and refuses contradictory terminal outcomes. [[src/main/original-schedule-replica-store.ts#NativeOriginalScheduleReplicaStore#acknowledgeManual]] requires the matching API completion receipt before clearing the report obligation. No native credentials or path bindings enter these records.

The existing FULL-synchronous SQLite journal holds bounded, digest-checked entries. Tests reopen real storage after simulated external/report failures and exercise A-B-A isolation. The caller still must verify a fresh API take and selected custody/resources before reservation and dispatch. A journal entry is not an execution grant. The background consumer, unknown reconciliation and installed production flow remain unfinished.


## Original manual consumer coordinator (draft)

The manual consumer combines main-only take/report transport with the private dispatch journal, while keeping long Agent execution outside the replica lock.

[[src/main/original-schedule-manual-consumer.ts#OriginalScheduleManualConsumer#poll]] recovers and reports retained outcomes first. Dispatch requires a fresh validated API take and matching synchronized native-source/custody binding. It commits the dispatch fence under the existing cross-process lock and invokes original source-run outside that lock. Failed reporting retries the result, never the effect. Account changes and stop invalidate later acknowledgements.

The API can rediscover an unresolved request for the exact selected credential/custody revision when no fresh pending request is available. Such nonfresh receipts never reach the run port. The consumer validates the synchronized source binding, journals uncertainty and reads the exact original Agent result. Only completed/rejected receipts settle; absent/unknown remain uncertain. Changed source or unavailable original native binding refuses recovery rather than guessing. Reserved entries lacking a recoverable receipt still require further reconciliation.

Tests use real private SQLite and synthetic transport/Agent peers to verify reopening, replay refusal, identity fences and nonblocking execution. The lifecycle and concrete synchronized resource/custody binding are now connected as described below. Production API, original route mount, installer and installed-client verification remain required.


## Original manual lifecycle mounting (draft)

A separate main-process lifecycle consumes original manual requests without occupying the source replication poller or the original screen's serialized action lane during execution.

[[src/main/original-schedule-replication-runtime.ts#startOriginalScheduleReplication]] starts and stops both lifecycles under the existing account-change subscription. [[src/main/original-schedule-replication.ts#OriginalScheduleReplication#manualConsumer]] serializes source/resource synchronization and binding, then invokes the existing main source-run port outside that lane. [[src/main/original-schedule-replication.ts#OriginalScheduleReplication#manualBinding]] recaptures verified script/workdir/runtime references under their original private store lock and checks the exact native version, source digest and selected custody revision. The Agent's original source CAS and execution policy still admit the effect. Output/counter changes return through the existing durable replication path after completion or report failure.

Runtime tests use synthetic Agent/transport peers. Concrete coordinator tests use real SQLite and files to verify binding and output replication. The updated Agent pin, reserved and missing-native-journal reconciliation, API schema publication, normal Web renderer, installer and installed-client execution remain unfinished; lifecycle wiring alone is not production proof.

## Original manual retained-result recovery (draft)

Uncertain native requests are inspected read-only before reporting, including requests already acknowledged as unknown. Only an exact retained terminal result can advance their status.

[[src/main/cronjobs.ts#inspectOriginalCronSource]] invokes [[src/main/cron-source-run.ts#callOriginalCronInspect]] through the existing selected-profile runtime. The fixed `source-run-status` command has a 15-second bound and the same strict receipt identity and active-account checks. `absent` is accepted solely by [[src/main/cron-source-run.ts#parseOriginalCronInspectResult]], never by the execution parser.

[[src/main/original-schedule-manual-consumer.ts#OriginalScheduleManualConsumer#recover]] inspects the saved original native version outside the replica lock. Completed or rejected results update the existing durable journal and clear its report acknowledgement, then report through the existing API port. Missing markers, unknown results and inspection failures do not authorize dispatch. Account changes and stop discard stale receipts. Terminal entries skip further inspection.

Actual Agent A/B/A tests verify read-only completed inspection after original source changes; consumer tests reopen real SQLite with synthetic Agent receipts. These checks do not establish a production Web-to-installed-Agent path, and lost take acknowledgements without a native journal still need separate reconciliation.


## Current-main shared schedules package

Desktop now pins workspace `0.6.29-schedules.8`, packed from Fund `51d1b162`, including current-main shared UI changes, the unified schedule adapter and individual browser settings pane support. Earlier archives remain immutable.

The installer candidate is preview.37 because preview.36 already has published assets.

Source, archive and installed files plus the lock integrity are checked together before consumer build verification. This package update does not change the Agent bootstrap pin, publish the original execution schema, or prove an installed-client release.


## Live shared schedule inventory

The original shared schedule renderer follows synchronized rows without reopening the screen.

Workspace `0.6.29-schedules.5` refreshes idle rows every five seconds through the existing account-scoped API. Background reads are serial and stop when unmounted; dialogs and pending actions suspend new background reads. The screen retains the existing controls and generation checks. The producer passed 28 focused shared tests and 24 browser adapter tests. Consumer build and tests, CI, installers and live cross-device behavior are separate gates.


## Memory drafts during cloud synchronization

The original shared Memory editor keeps new input while a save or remote refresh is pending.

Workspace `0.6.29-schedules.6` isolates Memory editors when the adapter/profile changes. Profile saves block duplicate submission, retain later typing and keep the acknowledged expected text. An older read cannot replace an acknowledged edit. Transport failures preserve drafts and do not report Saved. Producer renderer/file/note regressions passed 13 tests and browser screen tests passed four; App CI requires these regressions. Native credentials remain outside synchronized records. Production and installed-client checks remain separate.

Consumer validation compared all 426 archive files with producer and installed bytes and checked the lock SHA512. Native build, 19 tests across Memory locking/reconciliation and shared cloud routes, and lat validation passed. The installer candidate remains preview.37; it has not been published or installed by this change.

## Original settings pane consumer parity

The Desktop consumer retains its original settings provider while using the same shared pane renderer as Web.

Workspace `.7` permits individual consumer panes to fall back when undefined. Web Community now mounts the original component and original branding with browser link handling. Desktop keeps its complete native pane provider; the shared X icon is decorative so its button has one accessible name. Native runtime credentials and update actions do not move into browser authority.

The new immutable archive SHA256 is `9093df699c3dfa6e89b5f82520eb4d9661cebbabe297f23dc11efc45726058c9`. All 426 files match producer and installed dependency bytes, and lock SHA512 matches the archive. Browser route/component regressions passed 13 tests. Native build and 72 regressions across original Settings/Data/Connection and Cloud Workspace passed; lat validation passed. CI, publication and installed application behavior remain separate evidence gates. Browser Connection/Data/About/Logs adapters remain incomplete.

## Background connection retry lifecycle

The existing reconciler automatically recovers temporary startup connection failures without introducing a migration screen or requesting another sign-in.

[[src/renderer/src/screens/CloudWorkspace/RepositoryReplication.tsx#RepositoryReplication]] serializes status/enable reads and retries transient failures with a five-second delay growing to thirty seconds. Online events can retry immediately, but never overlap an outstanding request. Missing scopes or expired/refused authentication do not automatically prompt or grant authority. Identity generations are checked before enable and before applying owner state; cleanup removes timers and listeners. History and repository reconciliation begin only after the same owner is confirmed.

This fixes the one-shot startup recovery gap; it does not qualify complete cloud data synchronization, release or installed-client behavior.

## Canonical Settings entry points

Main-workspace settings entry points use the same account repository and original modal, with route-owned visibility and section selection.

[[src/renderer/src/components/settings/SettingsModalProvider.tsx#SettingsModalProvider]] delegates accepted commands to the handler registered by [[src/renderer/src/screens/Layout/Layout.tsx#Layout]]. Sidebar, shortcut and ordinary settings commands reset the requested section and open the canonical Cloud Workspace route. [[src/renderer/src/screens/CloudWorkspace/CloudWorkspace.tsx#CloudWorkspace]] forwards the original section argument and returns to Chat on close. Workspace `.8` closes its portaled modal when the retained screen is inactive.

Bootstrap setup and an explicit different native profile still use the original provider; multi-profile canonical targeting remains required. This is not full preference migration or installed-client proof.

The `.8` archive was verified against all 426 producer and installed files with lock SHA512; SHA256 `f09d12e8b5fcbb10b4de133a63c855f271406197b29be6f16b421c17a5427784`. Original Settings provider/modal/workspace tests passed 10 cases; shared browser Settings/Chat tests passed nine. Publication and installed-client qualification remain separate.

## Background presentation synchronization

Desktop applies confirmed account preferences independently of the selected screen using the canonical shared preferences observer.

The background reconciler observes the same rich `preferences/presentation` record as Settings and forwards validated values through the original Desktop theme, font, language, spellcheck and sound providers. Owner/profile epochs suppress old replies; pending values are not applied as confirmed. Startup does not seed defaults or grant authority. This candidate still requires production publication and installed-client verification.

## Explicit profile Settings routing

Every Settings command in the mounted Desktop workspace uses the same original shared modal, including commands targeting another profile.

[[src/renderer/src/screens/CloudWorkspace/useWorkspaceSettingsRoute.ts#useWorkspaceSettingsRoute]] preserves the explicit profile, section and request generation. Layout passes that profile to the original native Settings provider, while general preferences stay account-scoped. Opening settings never switches the current Chat agent or starts another conversation. Bootstrap setup remains available before Layout mounts.

## Original profile metadata file preservation (draft)

Original profile edits use the shared token-preserving metadata patcher and an atomic main-process file replacement before profile resource replication can be enabled.

[[src/main/profile-meta-files.ts#readProfileMetadataFile]] captures exact bounded UTF-8 object bytes without following linked storage. [[src/main/profile-meta-files.ts#patchProfileMetadataFile]] synchronously reads, patches only the authored name/color/avatar token, checks the source again and fsyncs a private temporary file before rename. Unknown extension fields, opaque integer precision, whitespace and BOM survive. All original `profile-meta.ts` appearance handlers use this lane; malformed or ambiguous source is retained instead of being replaced with empty projected metadata. This prepares the original edit surface for bidirectional sync but does not itself enable profile replication or prove installed-client publication.

## Original profile metadata compare and swap (draft)

Downloaded profile metadata can replace or remove a native file only when its exact captured bytes still match; concurrent appearance edits remain intact.

[[src/main/profile-meta-files.ts#replaceProfileMetadataFile]] snapshots caller buffers, validates the target, compares absence separately from an empty object, and checks again immediately before atomic replacement or deletion. Parent-directory fsync follows both mutations. Original appearance handlers share this lane. This is a file primitive for pending replica integration, not proof of automatic synchronization or publication.

## Durable profile metadata restoration (draft)

A private owner/profile/root SQLite journal commits exact pending bytes before replacement, retains completed receipts, and recovers interruptions without overwriting newer local edits.

[[src/main/profile-metadata-replica.ts#ProfileMetadataReplica]] uses FULL synchronous transactions and separate committed intent and completion phases. Restoration is synchronous; its caller must revalidate workspace authorization before calling apply or recover. Exact target bytes are bound to the profile pointer digest and size. Replayed results are read before recapturing a newer source. This pending native replica integration does not yet activate automatic metadata synchronization or publish an installer.

## Native profile test environment

Original profile integration tests run in Node against a canonical temporary directory so native Buffer validation and no-symlink storage checks match Electron main-process execution.

The prior jsdom suite treated native Node buffers as foreign Uint8Arrays, and macOS temporary paths passed through a system symlink. tests/profiles.test.ts now exercises its original 23 cases using the actual Node environment without weakening production metadata validation.

## Original profile metadata replica port (draft)

The existing rich replica now captures and restores the selected original profile metadata file through owner-bound resources, exact version checks and the durable native journal.

[[src/main/profile-metadata-port.ts#ProfileMetadataPort]] guards authorization before recovery and after each resource await. Concurrent original edits return a conflict. Completed receipts are replayed before recapture; physical deletion remains a stable tombstone. [[src/main/repository-kanban-runtime.ts#nativeReplicaSnapshot]] restricts profile completeness to the selected metadata ID and retains recovery records on unavailable source. [[src/main/repository-kanban-runtime.ts#nativeReplicaApply]] routes metadata restoration before Kanban fallback. All-profile inventory and Web original profile UI remain pending; this candidate is not production qualification.

## All-profile metadata source inventory (draft)

Original metadata replication inventories every valid native profile directory and retained current-owner source binding without changing the active profile or reading credentials.

[[src/main/profile-metadata-inventory.ts#profileMetadataInventory]] includes fresh empty directories and absent owned identities for deletion reconciliation. Different-owner sources are refused by the original source binding before bytes are captured. Symlinks, invalid names and forged binding identities are not adopted. The existing rich replica now claims each successfully captured metadata ID independently. Missing native profile directories defer nondeleted metadata download, including directory deletion during a resource await. This extends original metadata to all existing profiles; all-profile remaining file categories and creation of new cloud-only native profiles are not yet qualified.

All-profile metadata inventory reauthenticates workspace:write once at the operation boundary. Each resource I/O stage then uses the original captured-context main-process guard and source-owner binding; enumerating profiles does not add a /v1/me request for each identity guard. Resource transports retain their own authorization checks.

## Canonical original profile identity pane (draft)

The original Desktop profile identity pane, avatar, palette, image resizer and CSS now have one shared workspace implementation for native and browser adapters.

[[src/renderer/src/components/profile/ProfileModal.tsx#ProfileModal]] renders workspace DesktopProfileIdentity using original IPC, translation, chips and refresh callbacks. [[src/renderer/src/components/common/ProfileAvatar.tsx#ProfileAvatar]] supplies only the original logo to the shared avatar. Original Escape/blur cancellation and failed-save draft retention remain tested. Other modal panes remain original native components until their adapters are qualified. Browser metadata writes, live Web rendering and installer publication remain pending.

## All-profile Memory source inventory (draft)

Memory replication now captures all existing owner-bound profile working copies without switching the active profile.

[[src/main/profile-memory-inventory.ts#profileMemoryInventory]] reads the original three Memory files and configured limits through the existing reader. Only successfully captured profile IDs are claimed; absent, linked or invalid sources cannot erase other cloud records. [[src/main/repository-kanban-runtime.ts#nativeReplicaApply]] selects the exact owned profile from the validated Memory body and stable ID before invoking the original lock/CAS/receipt transaction. Capability configuration, Skills and schedules still require their all-profile paths; this is not published or installed-client qualification.

## All-profile Capability configuration capture (draft)

Capability configuration records now come from every present owner-bound original profile without switching the active selection.

[[src/main/repository-kanban-runtime.ts#nativeReplicaSnapshot]] reuses the validated profile inventory and original descriptor readers for each public configuration anchor. Exact configuration bytes and the original directory identity are checked across async descriptor reads; unavailable sources cannot claim deletion authority. [[src/main/repository-kanban-runtime.ts#nativeReplicaApply]] routes a validated Capability body and stable ID to the matching owned original profile before the existing lock/CAS transaction. Skill resources and schedule sources still need all-profile transport paths. Source tests and builds are separate from publication and installed-client verification.

## All-profile Skill resource replication (draft)

Original Skill directories now contribute separate cloud resource pointers for every present owner-bound profile.

[[src/main/repository-kanban-runtime.ts#nativeReplicaSnapshot]] captures and uploads each source without switching profile selection. Directory identity, current account and owner binding are fenced across I/O; a fresh capture must match the uploaded snapshot before the pointer is returned. Pending native transactions retain per-profile recovery records. [[src/main/repository-kanban-runtime.ts#nativeReplicaApply]] routes validated pointers to the matching owned profile, keeping the original download verification, source CAS and receipt recovery. Absent or replaced profile directories cannot be recreated by this path. This remains an unpublished candidate; all-profile schedules, original UI completion and installed cross-device checks are still pending.

## All-profile original schedule lifecycle (draft)

The background lifecycle replicates every present original profile owned by the captured account without changing the selected profile or adding execution consumers.

The existing metadata inventory supplies profile roots and account bindings. Each engine retains the original profile/timezone journal, parser, source CAS, resources and custody admission. Directory identity, ancestor symlinks and source ownership are checked across asynchronous stages. A failed profile leaves the pass deferred while later profiles can synchronize; account changes abort the captured pass. Missing directories are never recreated. Custody transport accepts a main-only captured active account context for these owned sources while retaining exact receipt validation, existing execution grants and no mutation retries. The default caller still requires the selected profile. The independent all-profile manual lifecycle now consumes each owned mailbox; production API/Agent publication and installed cross-device qualification remain unfinished.

## Shared original profile editor package consumption (draft)

Desktop now pins workspace `0.6.29-schedules.13`, including the same original identity component and revision-bound metadata editor available to Web.

The immutable archive has 441 files and SHA256 `c1b50fe55cfdadc07278a97c80b50f59da5cc0868fe1c9d4ae7a0527211f38c4`. All producer/archive/installed files were compared byte-for-byte, and explicit compiled export targets were verified. The existing original ProfileModal continues to import its identity pane directly; native edits use the existing original metadata replication, rather than a second profile storage. The remaining original modal panes and full cloud-only creation remain unfinished. Package consumption does not prove main CI, a public installer or installed cross-device behavior.

## All-profile original manual lifecycle (draft)

Each present owned original profile has an independent manual mailbox poller; long work in one profile does not block another profile or the original screen.

The same account-bound inventory discovers and removes profile pollers without switching active selection. Short engine creation, source synchronization and binding remain serialized; long Agent work remains outside that lane. Account changes and lifecycle stop invalidate every child consumer. Missing or unowned sources are removed, never recreated. Requests and results use the target engine's exact profile scope and original durable execution journal. Main-only transport accepts a captured active account context, preserves all execution grants and validates exact target-profile receipts; unknown outcomes are never retried as new work. Local runtime and real HTTP tests do not prove production or installed all-profile execution.

## Original profile navigation shared consumption (draft)

The original ProfileModal sidebar and section selection now render through DesktopProfileNavigation, shared directly with the Web profile surface.

Workspace `0.6.29-schedules.14` keeps Native's original section labels, icons, title primitive and selection handlers behind its consumer adapter. Web uses the same navigation and original Persona editor with owner-bound memory-file storage. The archive has 441 files, SHA256 `1645ef8388616098fa52585771ce92f6726e869fbd5b81457036a005edc141f9`. Remaining Web profile panes, publication and installed cross-device qualification are unfinished.

## Original Agent Memory shared consumption (draft)

Native ProfileModal and Web profiles now render DesktopProfileMemory from one component, using their existing storage adapters.

Workspace `0.6.29-schedules.15` removes the duplicate Native loader and connects Web Agent Memory to owner-bound original MEMORY resources. Failed loads require explicit retry instead of repeating forever, and late responses from replaced profiles are ignored. Entry saves retain the original MEMORY/USER baseline. Native preload Memory types now describe the actual main-process result. Publication and installed cross-device behavior remain unverified.

## Background profile identity refresh (draft)

The shared original identity editor retains active name drafts while Web observes remote metadata revisions automatically.

Workspace `0.6.29-schedules.16` refreshes clean Web identity panes from the existing owner-bound metadata/resource adapter. During name editing, its original snapshot remains the save baseline; a remote change produces a conflict instead of replacing the draft or silently overwriting it. Native uses the same identity component. Its archive contains 443 files with SHA256 `824e9da90e59336d08c4c6f2a185077a2b7fa619433310348ea88f4644e9d1f7`. Source tests and local builds do not prove public or installed cross-device operation.

## Background original Agent Memory pane (draft)

Native and Web share periodic profile Memory refresh, with frozen entry drafts and observed save baselines retained across remote changes.

Workspace `0.6.29-schedules.17` updates an already loaded pane every 20 seconds without overlapping reads or retrying an initial failed load automatically. Scope invalidation refuses late results. Removing the last remote entry cannot hide an active original entry editor or delete confirmation; adapter-provided portable-note baselines are preserved. The immutable archive contains 443 files, SHA256 `88aec801017fbc9508ebf8497b544a9c8f0c2997891ffbe089c873d97e2d3acd`. Timer/adapter regression tests and local builds remain distinct from publication and installed cross-device proof.

## Original profile Sync shared presentation (draft)

Native ProfileSyncPane now imports the original shared Sync body and styles, while its agent-sync effects remain behind the Native adapter.

Workspace `0.6.29-schedules.18` adds DesktopProfileSync and removes duplicate Native JSX/CSS. Web uses the same component with observed owner-bound repository status for original profile metadata only. Verified rows require a successful pass; pending/conflicting edits and failed transports remain visible and retryable. This extraction does not change agent execution authority or claim whole-profile synchronization. Archive: 445 files, SHA256 `d1af6fbf61de7815ba8764d7bfcd92f1f52a0f70d5e3350375a1570edba6bb17`. Publication and installed cross-device proof remain incomplete.

## Canonical Desktop profile Sync adapter (draft)

The original Sync pane now uses the same account-bound repository lifecycle as Web, replacing retired handlers that always reported signed out.

Workspace `0.6.29-schedules.19` exposes RepositoryProfileSync with owner-fenced background refresh, real repository metadata verification and explicit retry. Native obtains the current cloudWorkspace identity, enables only existing authorized workspace access, and invalidates late authentication on account/profile changes. Transient failures do not display the sign-in hint. Native tests exercise the actual shared repository component and verify that no retired agent-sync bridge is called. Full synchronization, public API/Web and installed behavior remain unfinished.

The canonical Sync candidate archive has 447 files with SHA256 `c66061dd0712f5f3d00010dce62c6577fdfedf346103a44e1e81497febfa2d5c`; producer, package and installed bytes are compared independently.

## Original Agents canonical connection (draft)

The original Agents list and profile Sync pane share one canonical workspace identity hook, retaining native profile operations while removing the separate workspace button.

The hook fences old account/profile responses and enables only already authorized workspace access. The list no longer invokes retired agent-sync handlers that always report signed out. Authenticated working copies refresh every 20 seconds without overlapping background reads; transport failures preserve the list and expose retry. This does not yet materialize cloud-only profiles or prove full Web list parity, production publication or installed synchronization.

## Cloud-only profile working copies (draft)

New remote original metadata can materialize a named Desktop profile automatically, while retained missing original sources remain deleted.

The replica transport verifies owner-scoped resource bytes before creation. A durable creation intent distinguishes first materialization from retained deletion, and canonical authority is rechecked before directory mutations. No credentials, runtime configuration or active selection are cloned. Existing original metadata CAS and receipts perform the actual content restoration. Public and installed cross-device qualification remain unfinished.

## Original Agents table shared consumption (draft)

Native and Web now import DesktopAgentsTable and the original table styles from workspace 0.6.29-schedules.20 instead of maintaining separate profile lists.

Native retains its original creation modal, profile selection, gateway polling, edit modal and Chat operations. Web uses owner-bound metadata resources and the same edit action without inventing runtime state or exposing unavailable execution. Original column layout scrolls on narrow browser viewports. Shared row tests cover keyboard event isolation and unknown state; Native creation/retry tests exercise the compiled package. Full management parity, release and installed proof remain incomplete.

The immutable shared archive contains 449 files with SHA256 `d6db9999d3308c2f722d2ec9e105ec5ec0dd8eb8cce7cc5b90459f31adf14fd2`; producer, archive, Native vendor and installed package bytes were independently compared.

## Original profile creation shared consumption (draft)

Native and Web use the original shared profile creation modal and its styles from workspace 0.6.29-schedules.21.

Native cloning remains behind its original adapter. Browser creation uploads public original metadata under the authenticated owner, requires a revision-zero receipt and selects only accepted profiles. Existing/tombstoned IDs cannot be reused; conflicts and offline operations stay durable without replacement requests. Account changes fence completion. Credentials and execution grants are not cloned. Real shared-form tests cover cloud creation and Native's existing ambiguous-create recovery; publication and installed cross-device proof remain unfinished.

The immutable creation archive contains 451 files with SHA256 `2e39b59ec70e8bc2723bbbe9f2eabee45b469bdf8b3bce169433bc334c4e63f0`; producer, archive, Native vendor and installed package bytes were compared independently.


## Installation account identity (draft)

Cloud workspace and chat use one encrypted installation account credential across profile selection; original native provider settings remain profile-scoped.

[[src/main/mithril-token-store.ts#readCloudAccountToken]] promotes only the selected legacy credential when the account record is absent. It never enumerates profiles. Sign-out persists a marker that blocks legacy fallback after restart; unreadable ciphertext also cannot select another account. API owner and existing scope validation, profile context fences and source custody remain mandatory. Explicit sign-in updates account and selected native provider records with ciphertext rollback on failure. Credential mutations serialize across profiles. Tests exercise both real CloudWorkspace instances, profile switches, stale contexts, sign-out and failed storage. Production, installer and installed upgrade qualification remain pending.

Local validation: all 308 test files passed (2815 tests, one existing skip), full Desktop typecheck/build and changed-file lint passed. On this Node 26 host, tests ran with `NODE_OPTIONS=--no-experimental-webstorage` and ambient `OPENROUTER_API_KEY` unset to preserve browser/test isolation; CI remains pinned to Node 22.


## Original profile dialog shared shell (draft)

DesktopProfileModal from workspace 0.6.29-schedules.22 now owns the original Desktop dialog frame across Native and Web profile editing.

Both consumers use the same modal, title, navigation, close control and Done footer. Native retains original pane adapters, icons and loader. Web opens the profile editor from the shared list and preserves owner-bound edits, Memory, Persona, Sync and conflict recovery inside the dialog. Shared tests cover actual modal open/close/reopen; the compiled Native package retains original name-edit, deletion and memory tests. Wallet, Advanced, full runtime parity, publication and installed qualification remain unfinished.

The immutable archive contains 451 files with SHA256 `6b209c54bed7c554db095b97001e178f4281cb5bfdc178416df098cb37d49b58`. Producer, archive, Native vendor and installed bytes match; shared 17 tests and Native 13 tests, Web typecheck, Native full build/typecheck and changed-file lint pass.


## Original profile dialog recovery (draft)

The original Native profile adapter recovers failed or missing reads inside the shared dialog and bounds each initial read to twelve seconds.

Read responses are fenced to the open profile and request generation. Changing or closing the dialog retires prior responses; loaded data from another profile is never rendered. Failed refresh keeps the current profile with retry, and a missing profile exposes close/retry instead of an infinite loader. A late deletion retains its authorized backend outcome but cannot close another selected profile or invoke stale view callbacks. Native read recovery does not yet qualify public cross-device synchronization or installed upgrade behavior.

Local validation passes all 18 original ProfileModal, ProfileSyncPane and Agents tests, Desktop build/types, changed-file lint and lat links. Release and installed operation remain separate gates.


## Original Advanced profile pane shared consumption (draft)

The original Advanced deletion pane now renders through DesktopProfileAdvanced from workspace 0.6.29-schedules.28, preserving the Native profile-scoped operation.

[[src/renderer/src/components/profile/ProfileModal.tsx#ProfileModal]] supplies the existing confirmation state, pending state, error, original icon and deletion handler. Default-profile protection and original confirmation markup are shared; Native retains account/profile effects and fences late responses. Existing adapter tests exercise failure/retry and dialog replacement against the actual compiled shared package. Browser all-data deletion remains unfinished because a metadata-only tombstone cannot represent removal of history, files, schedules and runtime state. Publication and installed upgrade/cross-device proof remain separate gates.

The immutable archive contains 461 matching producer/archive/vendor/installed files with SHA256 `d8a8e9a90107aae96df2cbf991f2d8f99cb98b1b23b8195927654d20c44c8fc4`.


## Ordinary Chat uses automatic history synchronization (draft)

The ordinary MithrilChat consumer no longer supplies the manual Native history import adapter to the shared chat settings menu.

[[src/renderer/src/screens/CloudWorkspace/MithrilChat.tsx#MithrilChat]] retains the same original source rows and canonical conversations in one shared sidebar. [[src/renderer/src/screens/CloudWorkspace/RepositoryReplication.tsx#RepositoryReplication]] continues existing background archival and conflict handling. The manual import service is retained for existing explicit operators, but it is not a second user migration flow. Tests open the real shared Chat settings and verify no local-history migration controls are rendered or invoked, alongside source selection and automatic synchronization tests. Installed upgrade and cross-device qualification remain pending.


## All-profile automatic original history archival (draft)

A main-process lifecycle now archives every present original profile owned by the captured account, independently of the selected screen and profile.

[[src/main/native-history-all-profiles-runtime.ts#startAllProfileHistoryReplication]] reuses the owner-bound source inventory and [[src/main/native-history-runtime.ts#createNativeHistoryRuntime]] with a fixed-profile canonical CloudChat transport. It never changes profile selection, starts inference or provisions a runtime. Account/generation, source ownership, root identity and symlink guards fence asynchronous capture and restoration; source failures retain their journals and retry. Background runs restore associated original sessions only, rather than reconstructing all account-wide remote conversations into every profile.

[[src/main/native-history-runtime.ts#serializeNativeHistory]] serializes foreground archival and metadata conflict recovery with background passes so the original durable journals cannot be overwritten by concurrent consumers. Startup installs the lifecycle and before-quit retires it. Existing conflict controls now review all owned profiles through [[cloud-workspace#All-profile history review without profile selection]]. Production publication and installed upgrade/cross-device evidence remain unfinished.

Local verification: seven lifecycle/serialization tests use actual scoped CloudWorkspace clients and original capture ports with a controlled sync engine, alongside fifty existing history-engine/cache/deletion/sidebar tests (57 passing). This proves source wiring and local boundaries, not authenticated production synchronization or installer upgrade behavior.

## All-profile history review without profile selection

The ordinary synchronization review includes conflicts from every owned original profile and resolves each against its own source without changing profile selection.

[[src/main/native-history-all-profiles-runtime.ts#synchronizeAllProfileHistories]] aggregates guarded canonical reports, labels metadata conflicts with their profile and restores unmapped remote conversations only for the selected profile. [[src/main/native-history-all-profiles-runtime.ts#resolveOwnedProfileHistory]] validates the authenticated owner and bound inventory before passing the reviewed choice to the original metadata engine. Both share the durable journal lane with background archival; account changes retire their results. The existing engine retains revision/value validation and receipt replay. A failed profile is reported as deferred rather than silently counted as complete. IPC exposes these operations to the existing review UI, not a separate migration screen.

Remote/SSH connections retain the existing authenticated history adapter. An absent original home still allows selected-profile cloud cache reconstruction; a directory appearing during that captured pass retires it. Local validation covers 63 tests across lifecycle/source wiring, actual review interaction, original history engine, cache and deletion suites. Authenticated production cross-device behavior remains unverified.

## All-profile archival protocol integration evidence

Local protocol integration now exercises the real original history engine, canonical CloudChat HTTP adapter and durable on-disk journals together across owned source fixtures.

The test simulates an accepted history write whose acknowledgement is lost. It checks that exactly one pending operation survives on disk, the next newly constructed profile engine queries the original receipt and clears that pending state, and another pass creates no duplicate sessions, events or execution. Original source database/cache ports remain controlled fixtures; this is not live D1/R2, installed upgrade or cross-device qualification. See [[cloud-workspace-tests#All-profile real archival engine replay]].

## Browser About shared application information

Workspace schedules.30 shares About information with Web while retaining native update and diagnostics ports.

Web uses the original shared card/meta layout, reports the loaded document build identity and canonical API host, and opens the existing Desktop download page explicitly. Build identity is injected with the same Vite manifest identity; no latest-version or native update readiness is inferred. Missing metadata remains unknown. Native consumes the new immutable archive; no release or installed application update is claimed.

The consumer continues to use [[src/renderer/src/components/settings/AboutPane.tsx#AboutPane]] and its original SettingsDataContext. This change does not authorize native diagnostics or updates in browsers. Connection/Data browser adapters and authenticated upgrade/cross-device QA remain required.

Consumer verification: all 461 archive files match producer and installed bytes; explicit exports and lock integrity are checked. SHA256 `6cddfb8e1f54dd6b42a7a03f79f0c687167c0a731bae9a870439af1fe851a53e`. Native TypeScript checks, build and 64 Settings/route regressions passed. Source/CI, publication and installed-client behavior remain separate.

## Automatic saved metadata reconnect

The shared Workspace renderer automatically resumes saved metadata edits with their original receipt IDs after checked-owner connection, retaining conflicts for explicit review.

The data-only synchronization lifecycle survives a cached inactive workspace, while account change/unmount retires it. Unsaved drafts, inference and tool actions remain outside the outbox. Background synchronization errors clear after recovery without clearing unrelated form errors; a pending/conflicted/offline state no longer reports Cloud synced. Original owned D1 receipts keep accepted replay idempotent. Shared tests include an actual WorkspaceApp/IndexedDB reconnect and inactive-screen recovery. Canonical API/local D1 qualification drops an accepted HTTP response and verifies one retained history row/revision after restart/replay, with another account isolated. Workspace Vitest source suites and Node packaging tests now run in their respective runners. This is not full cloud/installer qualification.

Saved metadata carries the renderer's checked owner through trusted preload IPC to [[src/main/cloud-workspace.ts#CloudWorkspace#applyOperations]]. The current installation owner must match before POST. The fixed owner header lets the canonical API reject a cookie-owner change before D1 admission. Missing caller/header values remain compatible with older consumers; API-first rollout is required. The new Native regression verifies refusal without POST and the exact owner header.

Consumer verification: workspace schedules.32 has 461 files and all explicit exports. Producer/archive/installed bytes and lock SHA512 match; archive SHA256 `e8de76d5ff7463796d39b9fb1905afcb0b5a98a322e5ffa4bbb9b4ebb1d8449f`. Native 32 targeted cloud transport/Settings regressions, types, build and lint pass. Shared 360, API/local D1 13 and Web 17 targeted tests pass separately. No production or installed-client qualification is claimed.


## Shared initial connection recovery

The original WorkspaceApp recovers transient startup transport failures without showing a separate device migration flow.

Workspace `.33` serializes initial reads with five-to-thirty-second backoff and online recovery. Native background reconciliation uses the same transient failure classifier; authentication, owner, schema, persistence and unknown failures stop retries. Disposal fences late enable replies before snapshot reads. This does not automatically authorize access or replay inference/tool calls. Web requests default to a fifteen-second deadline. Source tests are separate from production and installed-client qualification.


The `.33` consumer archive was compared against all 463 producer and installed files, with matching lock SHA512. SHA256 is `84a8174f0e53928c5e6f0443e3bc2ed984a6f7f5f1f0749b594077d47b02b0c6`. Shared qualification passed 375 tests and Native connection/route regressions passed 20 tests. Type checking and lat validation passed; publication and installed upgrade remain outstanding.


## Canonical account connection pane

The normal cloud Settings route uses the same original ConnectionPane cloud account renderer as Web, with native effects supplied through ports.

[[src/renderer/src/screens/CloudWorkspace/CloudConnectionPane.tsx#CloudConnectionPane]] reads main-owned canonical account status and opens the existing account dialog only after explicit account management. Its scope follows profile and account epochs, so late replies cannot restore another identity's display. The original complete native connection component remains under a closed execution subsection and mounts only on expansion. It does not create a separate local workspace or transfer native credentials into browser authority. Standalone native setup remains available through the original settings provider.

Workspace `.34` is a source candidate. Full Data archive adapters, authenticated release/upgrade/cross-device qualification and current-main publication remain required.


The `.34` archive SHA256 is `6cab4b70ee2c4aebed56898018dd1cb46a8c2b74851bace6e818e165a911690b`; all 463 files match producer and installed bytes and the lock SHA512 matches. Shared qualification passed 378 tests, browser Settings/Logs passed 13 and Native connection/modal/routes passed 13. Both builds, type checking, changed-file lint and lat validation passed. These checks do not substitute for installed-client or production evidence.


## Paged canonical session inventory

The Web and Desktop Chat adapters now share bounded, owner-checked inventory pagination instead of the old whole-account one-thousand-session response.

Workspace `.36` verifies every page, stable insertion boundary, total count, strict ID order and complete final count before exposing results; recent activity ordering is restored after all pages finish. [[src/main/cloud-chat.ts#CloudChat#list]] uses the existing main-owned authorized route per page. Native history synchronization no longer rejects a valid complete cloud inventory solely because other profiles bring its count above one thousand. Original per-profile source/journal and deletion limits remain to be migrated; this does not claim complete large-history synchronization.

The additive API page mode requires API-before-consumer publication. Legacy list responses remain unchanged. The canonical create/history admission removes the old whole-account one-thousand-row ceiling, preserving operation receipts, revision CAS and execution fences. No production schema mutation or publication is part of this source change.


## Installer API compatibility admission

Stable and beta installer publication require the paged canonical API before creating a tag or uploading release assets.

The release gate reads only the fixed `https://api.mithril.fund/health` route with a deadline, no credentials and no redirects, and requires `chat-inventory-keyset-v1`. CI tests reject absent/older protocol and failed health responses. This establishes compatibility admission, not authenticated behavior or complete synchronization qualification.

Local qualification: 56 targeted Native history/Chat tests, one Node release-gate test, Desktop build/typechecks, changed-file lint and `lat check` pass. Workspace `.36` archive SHA256 is `b0ebaa11496c737ba0c3e69bf0faadf66229de1ac4566eee3204dad4425f76f1`; all 463 archive files match the producer and installed consumer, and lockfile integrity matches. No installer or installed-client success is implied.

## Complete original profile source inventory

Original history reads use bounded hundred-row pages in one SQLite transaction with deterministic timestamp/ID ordering, preserving archived rows for synchronization.

The source inventory, rich history journal and provenance mapping no longer impose a one-thousand-session count ceiling. The existing journal byte bound, attachment limits, event checkpoints and deletion-outbox bounds remain; this is not yet unlimited storage or full synchronization qualification. Source ownership, captured-account checks, original transactional deletion and receipt replay remain unchanged. No inference is dispatched by history synchronization.

Local qualification covers 62 targeted tests, including 1,205 source rows and mappings, a 1,005-session real-engine archive/restart with a lost receipt, owner isolation and retained last-row deletion provenance. The initial whole-journal replay fixture took about 21 seconds; the incremental durability implementation below addresses that repeated-copy cost. No production or installed-client result is claimed.

## Incremental original history durability

The rich history engine now persists only the current conversation at each operation/receipt boundary, retaining the original owner/profile guard and durable-before-dispatch ordering.

Desktop stores an atomic, fsynced JSON entry per hashed session inside the existing hashed owner/profile journal namespace. Legacy JSON journals remain intact and are overlaid by newer checked entries on read, preserving pending operation IDs through an automatic upgrade. Temporary interrupted writes are not admitted. Entry envelopes check schema, owner, profile and filename identity; symlinked paths are refused. This removes whole-profile serialization and replacement per edit while preserving the old adapter fallback. The retained legacy-file and per-entry byte limits remain; all-entry reads, source capture, deletion paging and actual installed upgrade still need qualification.

Local qualification: 65 targeted tests, typechecks, Desktop build, changed-file lint and `lat check` pass. The incremental fixture completes the 1,005-session replay within the default five-second test deadline; this is a fixture regression gate, not a production latency measurement. Real all-profile runtime tests retain on-disk pending entries and recover lost canonical acknowledgements. Actual installed upgrade and live cross-device synchronization remain unproven.

## Complete original deletion synchronization

The retained native deletion outbox uses bounded keyset pages within one SQLite transaction, preserving the complete owner/profile inventory without a thousand-intent ceiling.

Preparation and acknowledgement query only the exact retained operation, preserving source/session identity, first base revision, acknowledged receipt bytes and suppression while a target is absent or a reply remains unknown. The local derived outbox gains an owner/profile/status/operation index; no cloud schema mutation is introduced. The engine validates the complete inventory before sending any delete, rechecks the account around transport, and admits exact deletion receipts before removing suppression. Accepted tombstones are mirrored to the working cache; pending deletes are not reconstructed. Long transcript/event and attachment limits remain separate outstanding work.

Local qualification: 67 targeted history tests, typechecks, Desktop build, changed-file lint and `lat check` pass. Real original SQLite deletion covers 1,205 retained intents; the real archival engine completes 1,005 tombstones after a lost acknowledgement without repeated delete events or inference. Other account/profile intents are excluded and exact receipt bytes remain stored. This is source/fixture evidence, not installed-client or production completion.

## Complete canonical sidebar inventory

Workspace `.37` removes the separate thousand-placement validator ceiling from the same sidebar used by Web and Desktop, preserving owner, shape, duplicate-ID and private-field rejection.

The API reads hundred-record keyset pages behind the existing endpoint, captures an insertion boundary and checks complete final count before returning the original response shape. New placements appear on the next read; changed tombstone membership/count rejects a partial response. Placement fields are observed during the read, not an immutable transactional snapshot across all D1 queries. Web and installer publication now require `sidebar-inventory-keyset-v1`; no provider or inference probe runs. HTTP still returns the complete placement inventory; provider response/query limits and pending-edit queue bounds remain separate work. Browser Data still needs a complete archive adapter rather than a substitute partial export.

Local qualification: 29 main-process cloud tests, installer compatibility test, Desktop typechecks/build, changed-file lint and `lat check` pass. All 463 `.37` archive files match the producer and installed package, with lock integrity verified; SHA256 `4a4cd3a937a15dec98b8374bb8f660278722aa64e1c9b0619e36f0db226315c2`. Installer publication and authenticated upgrade/cross-device checks remain required.

## Sidebar visual quality and automatic update cadence

The canonical shared CSS entrypoint loads the original Desktop sidebar styles on the first cloud screen, independently of legacy screen imports.

Fund's real Chromium component gate covers English/Japanese, empty/long lists and narrow/normal widths, with screenshots and a demonstrated failure when the stylesheet is removed. This fixture gate does not establish all-screen or authenticated installed-client usability.

[[src/main/app/updater.ts#scheduleUpdateChecks]] checks signed packaged clients after five seconds and every four hours after a completed check. Errors permit the next check, pending requests do not overlap and application quit retires scheduling. Existing auto-download preference, signature/feed guards and quit-time installation remain. Manual-update links now go directly to the download page. Local observation found signed installed preview.35, its preview channel and public preview.36 feed; no actual installer replacement is inferred from those reads.

Local qualification: 42 targeted cloud/updater tests, Desktop typechecks/build, changed-file lint and `lat check` pass. Native pins immutable workspace `.38`; all 463 files and lock integrity match, SHA256 `953f63c128eb98a72f4a9376d03113124584621b5e983a806921e199682f3018`. Candidate installer version is preview.38; it is not published or installed. The public preview.36 feed does not establish that the new source is deployed.

The native synchronization notice now participates in the layout above the page rather than floating over headings at a fixed screen position. Its height is bounded and its content can scroll. Four real Chromium checks of the compiled Desktop CSS pass (552/1280 pixels, dark/light); screenshots are retained by Native CI. This is a built-style layout fixture, not proof of an installed authenticated screen.

## Automatic durable chat metadata recovery

The shared Chat client recovers previously saved rename/delete/restore edits after checked-owner connection without a separate recovery or migration click.

Workspace `.39` retains original IDs/base revisions, receipt-first reconciliation and conflict review. Its automatic filter excludes inference, tools and unsaved queued edits. The owner-scoped IndexedDB journal reads complete hundred-record pages in one transaction instead of refusing inventories above a thousand edits. Known authority/data failures stop automatic recovery; no token scope changes occur. Pins/project placements still have their manual recovery path. Full archive and installed cross-device qualification remain required.

Local qualification: 392 shared tests and 50 targeted Native cloud/Chat/updater tests pass, including late old-account response retirement, complete 1,205-edit retention and recovery without inference. Both consumer builds/typechecks, 12 local visual scenarios, changed-file lint and `lat check` pass. All 463 `.39` package files match the producer and Native dependency; lock integrity is verified, SHA256 `db8ceffcb7668e5d7b5f09f164360dc0265debde72baa066b5dd5c43f81c5811`. Prior `.38` CI run 37707740127 succeeds and retains Desktop layout screenshots. `.39` CI/publication/installer and authenticated cross-device proof remain separate. The live fixed-route installer preflight still refuses the current canonical API protocol, so no publication or installed replacement is claimed.

## Automatic durable placement recovery

Workspace `.40` resumes saved pin/project placement edits through the original shared sidebar, preserving owner, operation identity, revision and explicit conflict review.

The connected client retries durable placement edits on reload and the established connection observer. Conflicts remain in IndexedDB across reload; explicit current-placement choice removes the edit, while explicit apply-my-change atomically replaces it with a new ID against the latest observed revision. Automatic recovery does not dispatch inference/tools or upgrade scopes. Late old-owner replies cannot retire pending edits or alter another account. Full archive/import and authenticated installed cross-device qualification remain outstanding.

Shared DOM/IndexedDB regressions include same-ID lost-ack recovery, durable-before-network project/pin changes, retained reload conflicts with both explicit choices, and old-owner automatic receipt retirement. The full 395-test suite passes with two workers; an unrestricted 77-worker run exceeded the existing five-second large-journal test deadline, so the bounded-worker rerun preserves its deadline and assertions. Native `.39` CI run 37708823735 succeeded. `.40` publication and installed behavior remain separate gates.

Candidate preview.40 pins the immutable `.40` package. All 463 archive files match producer and installed dependency, lock SHA512 matches and archive SHA256 is `43ea54eca9899ed9ae9b62b566e0bad72880bbdbd3a155e1ceebc5c241de097f`. Both builds/typechecks, 37 targeted cloud/Chat tests, updater tests and 12 visual scenarios pass. The fixed-route live installer preflight still rejects the unpublished canonical paged Chat API; no installer publication or installed replacement is claimed.

## Complete long transcript page reads

Mapped-source reconciliation and remote-only reconstruction no longer refuse a complete transcript solely because it spans more than a thousand HTTP pages.

Each continuation must advance through contiguous events below the immutable session's declared final event. Owner, session identity/version, active work, terminal completeness and disposal checks remain; an invalid final-event continuation fails before cache publication or title writeback. Native preview.41 retains the immutable workspace `.40` pin. Remote-only event/byte and cache-size limits remain separate unfinished storage work; this removes the pagination ceiling without claiming unbounded transcript storage.

Regression fixtures read 1,005 one-event pages on both mapped and remote-only paths, publish the complete remote-only inventory, update mapped title only after its complete checkpoint, reject false continuation at the final event, and never execute inference or tools. CI/publication and installed cross-device behavior remain separate evidence gates.

Local qualification: all seven native history suites pass (76 tests), both TypeScript checks and the preview.41 build pass. The preceding preview.40 Native CI run 37709729661 completed successfully. None of these results establishes API publication, installer release or installed-device behavior.

## Chunked complete remote history storage

Remote-only display caches store complete events and materialized timeline items in owner-bound SQLite chunks rather than a single bounded JSON value.

Native preview.42 removes the reconstruction's aggregate 20,000-event/50-MiB refusal and the corresponding cache ceiling. Chunks normally target at most 100 records/512 KiB; a single protocol-valid record remains indivisible. One immediate transaction replaces chunks and their count/hash manifest, preserving the previous complete cache on failure. Reads iterate chunks under one read transaction and validate order, counts, digests and contiguous events. Older single-body caches remain readable and convert on the next write; tombstones retain their previous complete timeline. Agent messages/execution tables remain untouched.

The current renderer and transport ports still materialize complete arrays, so memory/disk availability is not unlimited. This changes aggregate persistence, not per-event protocol limits or attachment resources. Full account archive/export/import, profile resource closure, canonical publication and authenticated installed cross-device QA remain outstanding. Workspace `.40` stays pinned unchanged.

Local qualification: all seven history suites pass (78 tests). The real SQLite cache regression retains 20,005 events and a combined timeline above 50 MiB, reads every record, checks chunk sizes, same-ID owner isolation, old-format conversion, same-revision rejection, missing/tampered chunk refusal and transactional rollback after simulated disk failure. Both typechecks and preview.42 build pass; installed/public behavior remains unproven.
