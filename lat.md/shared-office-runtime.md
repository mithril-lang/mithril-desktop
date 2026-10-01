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

[[src/main/cloud-chat.test.ts]] verifies runtime scopes and fixed routes. [[src/main/native-workspace.test.ts]] verifies plugin intent, stale revisions and identity isolation. Existing Office tests continue through canonical reexports, including [[src/renderer/src/screens/Office/office3d/objects/AgentsLayer.test.tsx]]. Actual Web canvas QA checks city, interior and walking with mocked owner snapshots, zero POSTs and no external network.
