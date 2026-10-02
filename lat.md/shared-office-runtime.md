# Shared Office and runtime boundaries

Desktop and Web reuse the existing Office 3D source from the canonical workspace package. Local runtime actions retain their existing native approval flows.

## Canonical renderer

The Desktop Office modules are compatibility reexports of the compiled shared package, rather than separate copies of the city, interiors, animations and walking implementation.

[[src/renderer/src/screens/Office/office3d/Office3D.tsx]] loads the same renderer used by Web. Models, textures and the local font ship in the package; MIT and font OFL attribution remain with the assets. React Three Fiber, Drei and Three resolve once per renderer.

The shared scene displays an empty real city before authenticated inspection. Actual agents and task activity come only from an owner-validated runtime snapshot. Viewing, entering a building and walking never launch compute or dispatch tools. Desktop scene buttons open the existing native Office controls; browser device actions remain visibly unavailable.

## Remote runtime transport

[[src/main/cloud-chat.ts#CloudChat]] exposes explicit runtime availability inspection and narrow runtime-turn operations through the authenticated Mithril API.

Only explicit `/v1/chat/runtime` inspection uses the extra sandbox scope. A runtime turn requires chat write, inference and sandbox scopes. No provider URL, tool arguments, device permission or bearer token reaches the renderer or D1 checkpoint. Runtime resume remains read-only and does not replay tools.

## Current-device lease contract

[[src/main/native-chat-lease.ts#NativeChatLease]] provides a main-only guarded-runner contract; no production runner is registered in this draft.

The legacy gateway cannot enforce a D1 lease before every tool. Its native screens and approval flows remain available, but it is never substituted into canonical device execution. Readiness stays unavailable until a dedicated runner proves fixed Mithril routing, pre-inference and pre-tool guards, native owner-bound approval, and descendant stop.

An explicit injected run obtains its private lease once. Lost acknowledgement never retries execution. Private tokens stay inside main memory; public results contain only status and turn ID. Requests time out after four seconds, a separate local lease watchdog stops a hanging runner, and a hard two-minute deadline bounds execution. Owner/profile/token-generation, turn and checkpoint revision fences are checked before continuing. Each tool requires a durable pre-execution claim; duplicate claims never run again. Queued heartbeats cannot invalidate an acknowledged terminal checkpoint.

[[src/main/native-chat-lease.test.ts]] verifies these boundaries entirely with injected fixtures: no runner readiness, unsafe operation rejection, fixed routing, lost acknowledgement, duplicate tool claims, approval ownership, cancellation, owner change and watchdog expiry. No actual native tool, paid inference or new permission is exercised.

## Plugin intent handoff

[[src/main/native-workspace.ts#NativeWorkspace]] previews owner-bound plugin intent without installing a package or granting permission.

[[src/main/registry.ts#listInstalledPluginNames]] reads installed directory names only. The adapter combines these names with sanitized official catalog metadata; unknown enabled state stays unknown. Plans bind identity, profile, token generation and inspected revision, expire after five minutes, and require explicit confirmation. Confirmation records an ephemeral handoff intent only.

## Verification

Fixture tests and blocked-network visual checks exercise renderer reuse, ownership and explicit operation boundaries without running native tools or inference.

## Native Memory transactions

[[src/main/memory-file-lock.ts#mutateMemoryFiles]] uses Hermes's separate MEMORY.md.lock and USER.md.lock files for coordinated native edits.

On POSIX, fixed-order exclusive locks protect raw snapshot comparison, configured-limit fingerprint verification, private backup and atomic replacement. Reads use regular-file descriptors with no-follow flags; paths with symbolic-link ancestors are refused. A fixed isolated Python interpreter receives inputs through stdin, never a shell or inherited provider environment. Lock waits are bounded and failure never automatically retries a mutation.

[[src/main/memory.ts]] routes every native Memory writer through this lock protocol. Existing native entry and USER editors capture their raw edit base and pass it through narrow IPC, so a stale index cannot edit a different entry after another writer changes the list. Explicit legacy whole-file replacement remains replacement, not a CAS operation. No automatic cloud import or deletion of older local data occurs. Successful changes keep private local backups.

Shared Memory editing is enabled only for the POSIX implementation with directory-descriptor anchoring. Windows native flows retain byte-lock coordination; shared editing remains unavailable until equivalent directory safety is verified. [[src/main/memory-file-lock.test.ts]] uses temporary files and a real competing Python flock to prove that newer Agent content survives stale edits. Settings expose the actual persisted display locale only; provider configuration and permissions remain in their native flows.

## Persisted display settings

[[src/main/desktop-config-transaction.ts#DesktopConfigTransaction]] protects both existing desktop.json writers with original-document CAS and an ephemeral exclusive lock.

Reads retain the original raw-document hash in a WeakMap associated with the returned object. Writes acquire a create-exclusive lock, recheck the original document, and use the existing atomic temp-file replacement. Independent Desktop instances cannot silently replace one another's changes. Busy or stale locks fail visibly; no other process's lock is deleted or automatically recovered. Malformed documents and untracked copied objects cannot overwrite the existing file.

If a writer crashes while holding the lock, the error explains that all Desktop instances must be closed before the stale desktop.json.desktop-lock is cleared manually. A crash does not authorize another instance to remove an unknown live lock.

[[src/main/config.ts#writeDesktopConfig]] covers the existing connection-registry writer and [[src/main/locale.ts#setAppLocale]] covers the actual locale preference. Locale persistence succeeds before the process-wide language changes. No startup single-instance restriction, provider expansion or additional permission is introduced. [[src/main/desktop-config-transaction.test.ts]] verifies independent-writer conflicts, unrelated-field preservation and unreadable-document refusal.

The atomic writer is resolved lazily when a save occurs, so unrelated runtime modules do not initialize file-writing dependencies. [[tests/memory-limits.test.ts]] verifies configured caps through the real isolated helper using canonical temporary paths and captured native edit bases.

[[src/renderer/src/screens/Memory/MemoryEditing.test.tsx]] verifies captured entry and USER edit bases across refreshes. Untouched USER drafts adopt refreshed data, while edited drafts keep their original revision until an explicit save or cancellation.

[[src/main/cloud-chat.test.ts]] verifies runtime scopes and fixed routes. [[src/main/native-workspace.test.ts]] verifies plugin intent, stale revisions and identity isolation. Existing Office tests continue through canonical reexports, including [[src/renderer/src/screens/Office/office3d/objects/AgentsLayer.test.tsx]]. Actual Web canvas QA checks city, interior and walking with mocked owner snapshots, zero POSTs and no external network.
