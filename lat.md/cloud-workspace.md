# Cloud workspace

Desktop and Web consume one versioned Mithril workspace renderer and protocol, with signed-in automatic Cloud observation and explicitly selected native imports and no implicit import of local agent files.

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

The API-backed Chat shares Web’s expanded sidebar for cloud sessions and projects. Pins are owner-scoped device preferences; legacy device history stays separate. Reading the sidebar never creates sessions or executes tools.

### Read-only cloud sidebar

The shared sidebar reads the checked cloud account and project inventory without importing device history, writing workspace records, or issuing chat operations.

## Cloud sidebar placement

Pins and explicit project membership now use owner-scoped API records shared by both clients, with per-chat revisions and operation receipts.

[[src/main/cloud-workspace.ts#CloudWorkspace#getSidebar]] reads canonical placement without uploading device pins. [[src/main/cloud-workspace.ts#CloudWorkspace#applySidebar]] exposes only the fixed sidebar API through trusted IPC. The shared renderer offers explicit migration of each device pin, retains failed operation IDs for acknowledgement retries, and reports concurrent-edit conflicts. Legacy local pins remain intact; titles and folders never imply project membership.
