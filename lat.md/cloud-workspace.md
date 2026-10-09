# Cloud workspace

Desktop and Web should preserve the original Desktop UI through one account-scoped cloud data repository; the current shared cloud screens and native dialogs are transitional.

## Main process boundary

[[src/main/cloud-workspace.ts#CloudWorkspace]] verifies the active secure-store bearer and owner before each fixed Mithril API request; renderer IPC never receives the credential.

Consent lasts in memory for one account and local profile. Replacing a token, disconnecting, switching profiles, authentication expiry or owner mismatch clears consent and notifies the renderer. Offline failures preserve unsent edits in the current renderer window.

Workspace access requires explicit `workspace:read` and `workspace:write` scopes. Existing inference or billing tokens are never upgraded, and the renderer cannot issue tokens. The API retains its existing passkey confirmation before granting sensitive scopes.

### Cloud Chat IPC registration

[[src/main/cloud-chat-ipc.ts#registerCloudChatIPC]] registers the fixed Cloud Chat channels with the same trusted-main-frame guard used by the application entry point.

Each handler checks the sender before accessing account authorization, file custody, sessions, Browser checkpoints or native child approval. Preload exposes bounded operations; credentials remain in main. This separation permits testing the production registration and preload inside Electron without starting unrelated services.

### Isolated Electron Chat qualification

`scripts/owned-chat-electron-main.mjs` boots an isolated test window with the actual preload, Cloud Chat registrar and trusted sender guard. It uses the real CloudChat and CloudWorkspace classes with explicit account/model/browser-open fixtures.

`scripts/build-owned-chat-electron.mjs` compiles the test entry and production preload to a task directory. The cross-repository actual MithrilChat/WASM qualifier then checks JS/Python read/write/deny/alias through HTTP/D1 and Hermes, plus refusal of foreign windows and disallowed navigation and absence of IPC in Kuro frames. The entry is excluded from installer packaging. The opt-in entry records review invocation state, fixed main refusal categories and callback-side locator count/JSON; intent bodies and credentials are omitted. Failed screen qualifiers also report visible alerts to distinguish a missing click from a main refusal. This qualifies neither whole application startup nor installed account/profile configuration, OS pairing/permissions or all operations.

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

[[src/main/memory-replica-files.ts#memoryReplicaSnapshot]] reads only the selected owner-bound profile files and configured capacities. Snapshots explicitly claim only that profile’s three record IDs; unavailable collections report warnings and cannot delete unrelated data. Credentials, configuration values, installation metadata and device paths are excluded from canonical bodies.

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

## New Chat and automatic synchronization

New Chat opens the shared empty conversation before authentication or model discovery. The first submitted message creates its canonical cloud session; ordinary navigation never exposes device migration screens.

The sidebar uses the same shared history and workspace across Web and Desktop. Background owner-scoped reconciliation in [[src/renderer/src/screens/CloudWorkspace/RepositoryReplication.tsx#RepositoryReplication]] continues without an import prompt. [[src/renderer/src/screens/CloudWorkspace/MithrilChat.tsx]] displays readable sign-in guidance on failed identity checks. Existing tokens remain scoped and never gain permissions automatically.

The installer candidate pins immutable workspace `0.6.24-chat.4`, SHA256 `2e32c3e3bec3927eb22310bf2ec8fab60b6b0d79fd2272e67b8cab7caf0c04cf`, built from Fund `a47f138f`. It excludes the unfinished original schedule resource/replica draft and includes only the normal Chat/migration-navigation repair on current main.

Preview.34 preserves the shared editor compile action approved in preview.33, and the Web URL history fix. The producer passed 228 workspace tests; Web consumer results are tracked independently.

Desktop preview.39 requires a live Mithril account identity before mounting the workspace or device setup. Stored-token presence alone never admits the app. Sign-out closes the workspace; focus, network recovery and serialized one-minute checks revalidate the session. Successful sign-in enters the app; Retry connection verifies retained credentials without a new browser login. Source qualification is separate from signed release and installed-client evidence.

## Interpreter parent lifetime

Workspace agency.16 retires each JS/Python parent's signal and pending child approval when that parent completes, times out or fails, while retaining the turn signal for its receipt acknowledgement. Turn retirement also aborts the current parent.

The shared runner checks the signal after a late child response. This is local lifetime narrowing; it cannot undo a dispatched effect or certify remote cancellation. Shared controlled-executor tests reproduce the old JS/Python leak and verify retirement. Consumer checks use this compiled vendored candidate; whole Electron/runtime qualification and the previous Python exit124 cause remain separate and unresolved. Kuro's existing interpreter deadline and human grant/checkpoint deadlines are unchanged. No installer publication, Actions dispatch or production deployment is claimed.

Workspace agency.18 passes the exact API codeDeadline from the captured parent checkpoint through this screen to Kuro. A bridged parent uses that absolute wall deadline, capped at45 seconds, while host-clock initialization/execution retain a30-second budget excluding pending broker wait. This is phase accounting, not CPU attestation. Worker markers or model arguments cannot renew the wall deadline. The shared runner retires the parent signal at expiry, so pending native approval cannot release a new effect afterward; late outcomes remain unknown and never retry.

The frame must advertise the parent-deadline protocol before this path starts. Older assets refuse execution and require an update. Unbridged/legacy calls retain their30-second host timeout and35-second outer wait. Latest SDK17 Electron failures and local API timings remain preserved as the baseline; SDK18 whole-screen, stability, publication and installed evidence must be qualified separately.


## Isolated multi-target patch qualification

Actual Electron Chat, main, SDK18 and Hermes patch are locally qualified through Web consent for JS/Python allow/deny across five content/entry targets. Installed and authenticated whole-app behavior remain unverified.

One V4A request covers Add/Update/Delete/Move. The canonical human card must show all five exact resolved targets; files remain unchanged before approval and on denial, while accepted handlers perform all expected file dispositions. Actual main rejects duplicate release/retired parent requests. The canonical cross-runtime run passes Web12/Electron12/native3,18 returned attempts, other-profile0 and unchanged schema/history, retry0 (runner454.2s; testcase449.091s). API45s, host active30s, Web/Desktop function180s, native90s/process210s bounds remain. This Desktop increment changes documentation only; SDK18 runtime/archive and preview.48 remain unchanged.

Account/model/issuer/pairing/local D1 are fixtures, Web parent creation is seeded, and browser opening is captured. Remote/atomic targets, cancellation/result-loss recovery, all operations/providers, real account settings/whole boot/native permissions, continuing stability, signing/publication, installed Desktop and original Chat require further evidence. Prior SDK18 whole19 success and earlier timeout failures remain recorded separately.
