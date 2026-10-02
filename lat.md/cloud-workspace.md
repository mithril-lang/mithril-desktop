# Cloud workspace

Desktop and Web consume one versioned Mithril workspace renderer and protocol, with explicit opt-in portable user data and no implicit import of local agent files.

## Main process boundary

[[src/main/cloud-workspace.ts#CloudWorkspace]] verifies the active secure-store bearer and owner before each fixed Mithril API request; renderer IPC never receives the credential.

Consent lasts in memory for one account and local profile. Replacing a token, disconnecting, switching profiles, authentication expiry or owner mismatch clears consent and notifies the renderer. Offline failures preserve unsent edits in the current renderer window.

Workspace access requires explicit `workspace:read` and `workspace:write` scopes. Existing inference or billing tokens are never upgraded, and the renderer cannot issue tokens. The API retains its existing passkey confirmation before granting sensitive scopes.

## Shared screens

The shared workspace package supplies Discover, Office, Kanban, Projects, Capabilities, Memory, Settings and Profile through one source; native Desktop screens remain available for device operations.

Discover projects the official Mithril Registry into safe catalog links. Portable projects, tasks, workrooms, notes, profile and preferences use the owner-scoped workspace API. Actual native runtime views are separately inspected and linked; portable records do not substitute for native Office or tool execution. Capability preferences express intent without installing a plugin or granting device permission.

Cloud entries are deliberately separate from existing local profiles, agent configuration and memory. No automatic filesystem scan, credential upload or permission upload occurs. Explicit selected native preview is described in [[canonical-chat#Canonical Mithril chat#Native runtime views]]. Closing the workspace or app can discard unsent in-memory changes; the UI reports this limitation.

## Release boundary

Workspace changes require a coordinated API migration and shared-package release before installer publication; this branch prepares draft review without a production migration or release.

[[mithril-migration#Mithril desktop migration#Desktop release gate]] remains the packaged release gate after explicit publication authorization.

## Four-surface synchronization

Projects, capability preferences and bot definitions use the shared owner-scoped record protocol. Canonical agent goals and run/checkpoint state use the shared session event protocol.

While the shared workspace is active and connected, read-only observation refreshes every five seconds and on focus or network recovery. It never flushes unsent edits; explicit save/reconnect owns writes. Editing retains its captured revision, so remote updates become conflicts instead of replacing a draft.

[[src/main/native-workspace.ts#NativeWorkspace#previewImport]] includes reviewed selected SOUL/USER content and model preference, linked working-folder titles and current toolset preferences. Only opaque IDs and portable authored fields enter the preview. Absolute folder paths, credentials and execution grants are excluded; selected import leaves native files unchanged.
