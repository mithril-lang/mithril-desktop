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

### Original Markdown rendering

The original Desktop Markdown component is shared with Web; a display-only normalization restores structurally unambiguous tables whose source lost newlines.

Stored replies remain unchanged. The shared workspace normalizer leaves ordinary GFM, fenced examples, inline code and inconsistent column counts untouched. This repairs historical one-line tables without replacing the original renderer or changing their contents.

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
