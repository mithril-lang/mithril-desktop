---
lat:
  require-code-mention: true
---

# Cloud workspace tests

The main-process adapter enforces account-bound consent and a narrow portable-data boundary even when the renderer or network supplies invalid input.

## Dedicated authorization scopes

Cloud Workspace requires explicit workspace read and write scopes; inference and billing credentials are not upgraded or sent to a credential-issuance route.

## Explicit consent

Before opt-in, account identity may be checked but user workspace data cannot be fetched or written.

## Narrow data and fixed transport

Unknown configuration, path, permission and secret fields fail before networking; only explicitly authored operations reach the fixed API with redirects and cookies disabled.

## Account isolation

Replacing the secure-store token, switching local profiles or signing out clears prior consent and requires a new explicit opt-in.

## Late responses and expiry

Responses arriving after logout cannot repopulate user data; expired or refused identity resets the workspace before further requests.

## Offline and owner mismatch

Transient network errors preserve consent for retry without exposing exception secrets, while a snapshot for a different owner resets the session.

## Conflict and history

CAS conflict responses retain their operation ids for shared UI resolution; record history remains bounded to the requested record and rejects injected secret fields.

## Trusted renderer

Only the main Desktop window's trusted top frame may invoke workspace IPC; webviews, secondary windows, remote navigation and other development origins are refused.

## Shared renderer consent

Desktop mounts shared screens and automatically reads through existing scoped main authorization. Observation does not write or grant scopes.

## Renderer account reset

Account-change events and local profile changes clear the prior renderer owner and recheck scoped identity before reading the new workspace. They never replay edits or tools.

## Bot and project import

An explicit preview projects the actual selected bot instructions, user context, model preference, linked project titles and capability preferences. Known device-specific text is excluded and preview makes no cloud write or native mutation.

## Cloud sidebar identity

Sidebar reads and writes use only fixed cloud routes, preserve operation IDs, reject nonportable input, and discard records from a different owner.

## Paged native history migration

Completed local chat histories can be reviewed in bounded pages beyond the first fifty; opening a page never uploads history or runs inference.

## Cloud schedule boundaries

Schedule tests cover fixed API routes, owner validation, scope refusal and local-only preview projection.

Credentials, absolute paths, scripts, delivery destinations and native tool grants are excluded. Calendar schedules require an explicit new interval; no background import starts a cloud run.

## Stable disconnected identity

Repeated denied sign-in or missing-scope checks preserve the error without repeatedly remounting the renderer.

Explicit credential changes still notify disconnected renderers and invalidate in-flight requests.

## Security execution boundaries

Security tests require explicit read/run scopes, fixed main-process API routes and tenant-checked snapshots. Renderer requests cannot carry credentials or executor policy.

## Rich Kanban migration snapshot

Read every supported board in SQLite read transactions, retain comments, events, runs and dependencies, preserve stable IDs, and keep paths and active execution locks on the device. Reading does not mutate the source DB or run an agent.

## Native migration owner binding

Bind a device profile's automatic migration source to its first authorized account. A later different account is refused without replacing that binding, while a separate profile can have its own owner.

## Continuous Kanban replica

The rich replica keeps a stable device/profile ID across restart.

SQLite metadata writes use an immediate transaction, compare the full source version, preserve private paths and locks, and store operation receipts in the same transaction. Tests verify replay, stale-write rejection, claimed-task deferral and archival tombstones. Shared reconciliation tests verify disjoint-field merging, conflicting history preservation, restart after lost acknowledgement, deletion conflicts and independent progress while a record is busy.

## Continuous rich chat history

Rich chat archival persists pending operation IDs before sending. Restart recovery reads the same receipt; archived arguments and results never authorize execution.

Tests cover repeated snapshots, native edits, lost acknowledgements, retained cloud conflicts, executable journal rejection and independent progress while another chat is busy. API tests cover rich history CAS and owner-scoped R2 attachment reads/writes.

## Cloud history working cache

Cloud edits and tombstones update the original Desktop timeline through a checked cache without changing agent messages or executions. Native changes invalidate stale overlays; separate baselines prevent stale echo after restart.

## Original Markdown table rendering

Flattened archived tables with a consistent GFM separator render as a table through the same Desktop/Web Markdown component. Fenced examples and ambiguous pipes remain literal; stored transcript text is unchanged.

## Strict Capability skill sources

Strict source reads preserve full skill bodies and refuse invalid encodings or symlinks instead of publishing partial snapshots. Existing native skill operations retain their original behavior.

These cases exercise [[src/main/skills.ts#getSkillContent]] and [[src/main/skills.ts#listInstalledSkills]] using temporary owner-profile roots; no runtime installation occurs during synchronization.

## Capability snapshot identity

Capability snapshots keep configuration bounded and omit credential values and paths. Large duplicate-name Skills stay in original folders and the resource namespace. Owner changes reject reads; no installs run.

## Capability resource transport

Capability resource uploads and downloads use the fixed Mithril API through the main process.

Tests preserve binary content, owner and content-type headers, reject owner switches and unsupported namespaces, discard late account responses, and refuse uploads without workspace write scope. Storage reads never invoke installation or execution.

## Original Skill resource capture

Original Skill resources retain their actual category/directory tree, binary bytes, references and executable attributes without executing any script.

Descriptor-based capture rejects symlinks, invalid Markdown, colliding paths and unavailable interpreters while retaining the source. Tests verify credential exclusions, stable manifests, staging cleanup, upload ordering, repeat-upload avoidance and account-change cancellation.

## Verified Skill resource download

Download tests verify private staging, immutable chunk deduplication, canonical manifests and complete file integrity before native application.

Corrupt chunks, inconsistent file fingerprints and account changes remove staging without altering original files or executing scripts.

## Skill resource file transactions

Native transaction tests verify original relative paths, binary bytes, executable flags, credential retention and private backups.

They cover source conflicts, moved-parent descriptor refusal, symlink refusal, interrupted before/after recovery (including a real interpreter exit after the first replacement), snapshot blocking, changed operation reuse and file/directory replacements.

## Original Skills resource IPC

Original Skills resource requests use validated arguments and trusted renderer checks before main-owned storage access.

Tests verify explicit owner binding, binary forwarding, refusal of untrusted senders, oversized chunks, malformed manifests, endpoint-shaped IDs and invalid owner values. These ports expose no bearer credentials or arbitrary endpoints.

## Repository retained history

Original repository bodies use the fixed authenticated history route. Wrong identities and missing Chat authority reject reads before exposing retained text or replaying work.

The Desktop test verifies the main-owned route and schema checking. D1 and shared client tests cover immutable original bodies, owner isolation, tombstones, descending pagination and concurrent edits.
