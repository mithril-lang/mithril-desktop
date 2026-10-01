# Cloud workspace

Desktop and Web consume one versioned Mithril workspace renderer and protocol, with explicit opt-in portable user data and no implicit import of local agent files.

## Main process boundary

[[src/main/cloud-workspace.ts#CloudWorkspace]] verifies the active secure-store bearer and owner before each fixed Mithril API request; renderer IPC never receives the credential.

Consent lasts in memory for one account and local profile. Replacing a token, disconnecting, switching profiles, authentication expiry or owner mismatch clears consent and notifies the renderer. Offline failures preserve unsent edits in the current renderer window.

Workspace access requires explicit `workspace:read` and `workspace:write` scopes. Existing inference or billing tokens are never upgraded, and the renderer cannot issue tokens. The API retains its existing passkey confirmation before granting sensitive scopes.

## Shared screens

The shared workspace package supplies Discover, Office, Kanban, Projects, Capabilities, Memory, Settings and Profile through one source; native Desktop screens remain available for device operations.

Discover projects the official Mithril Registry into safe catalog links. Projects, tasks, workrooms, notes, profile and preferences use the owner-scoped workspace API. Capability preferences express intent without installing a plugin or granting device permission.

Cloud entries are deliberately separate from existing local profiles, agent configuration and memory. No filesystem scan, credential upload or permission upload occurs. Closing the workspace or app can discard unsent in-memory changes; the UI reports this limitation.

## Release boundary

Workspace changes require a coordinated API migration and shared-package release before installer publication; this branch prepares draft review without a production migration or release.

[[mithril-migration#Mithril desktop migration#Desktop release gate]] remains the packaged release gate after explicit publication authorization.
