# Canonical Mithril chat

Desktop keeps its native New Chat, Projects and history. Synchronized chat is an explicit sidebar entry backed by shared D1 checkpoints.

This path uses the Mithril API model inventory and never selects retained local provider credentials.

## Authenticated transport

[[src/main/cloud-chat.ts#CloudChat]] exposes fixed session list, events, operation, receipt and cached model-inventory routes. [[src/main/cloud-workspace.ts#CloudWorkspace#authorizedRequest]] verifies the secure-store identity and response owner for each request.

Chat consent is independent from portable workspace consent, requires `chat:read` and `chat:write`, and paid turns additionally require `inference`. Explicit remote-runtime inspection also requires `sandbox`; `runtime_turn` requires both `inference` and `sandbox`. No token upgrade or persistent grant occurs.

The model inventory comes from `/v1/chat/models`, which reads cached availability without live probes. Refresh, checkpoint, receipt and resume do not start inference. Explicit turn operations preserve operation IDs through the shared client's ephemeral outbox, so reconnect does not silently create a second paid request. Expired active leases remain uncertain until a server checkpoint resolves them.

## Retained local data

Existing local history and provider configurations remain unchanged.

[[src/main/legacy-provider-snapshot.ts#legacyProviderSnapshot]] captures stat-only retained configuration metadata after explicit connection; no config body, provider name, URL or key is read or uploaded.

The old Chat only mounts after an explicit legacy-history action. The new default Chat has no custom-provider URL or credential field, and never uses a retained legacy provider. Device runtime operations remain separate native actions.

[[src/main/native-session-import.ts#NativeSessionImport]] creates an explicit, expiring, owner/profile/token/generation-bound preview. The production projection reads completed text rows from the selected local session database without attachments, runnable tool calls, provider configuration or key files. Unsupported multimodal content, unfinished history and known credentials or device paths are excluded; this is a conservative known-pattern guard, not a universal secret detector.

The selected available Mithril model is displayed in the preview and confirmed by the user's selection. Import only stores portable historical messages, never executes them. Stable opaque source IDs prevent repeated import from silently duplicating history. An existing cloud session cannot be overwritten: only an explicitly confirmed separate copy is allowed. Submitted selections retain operation IDs and cache receipts for repeated clicks and network retries. Native files are never overwritten or deleted.

## Native runtime views

[[src/main/native-workspace.ts#NativeWorkspace]] inspects actual Memory, toolset/MCP metadata, local profile status, and Kanban boards/tasks through injected native sources.

The shared panel labels unavailable execution, grants, installation and configuration operations. Links open the existing native 3D Office, Memory, Tools, Kanban, profiles and settings views instead of substituting portable records for native features.

Shared Desktop native Memory edits use the same cross-process file locks as Hermes on supported POSIX systems, with under-lock raw snapshot and configuration comparisons. The existing native editor uses captured edit snapshots too. Windows retains native editing; shared Memory editing remains unavailable pending equivalent directory-handle safety. Capability configuration writes remain unavailable. No grants or installation occurs through this adapter. Display locale edits use the inspected revision and app-local preferences only.

Portable workspace import is a separate preview and selection flow. It excludes paths, secrets, provider configuration and device permissions, uses existing cloud revisions for explicitly confirmed replacement, and never changes the native source. Import previews expire and are cleared on identity changes.

## Fixture verification

[[src/main/cloud-chat.test.ts]] verifies dedicated scopes, explicit consent, cached inventory without probes, paid-turn rejection, checkpoint ownership and delayed prior-account isolation.

[[src/main/native-session-import.test.ts]] proves selected Native-to-shared import, default skip, nonportable exclusion, repeated-click receipts, no overwrite, explicit copies and account-bound previews. [[src/main/native-workspace.test.ts]] verifies actual memory limits, path exclusion, explicit refusal of unsafe native writes and non-destructive selected import using injected fixtures only.

## Shared bot and agent goal

Canonical sessions capture a selected bot profile revision and persistent goal before explicit inference. Context edits use the session revision so a stale client cannot silently replace another client's instructions.

[[src/renderer/src/screens/CloudWorkspace/MithrilChat.tsx]] mounts the common bot/goal controls. Bot inventory requires separate workspace opt-in; chat consent never silently enables workspace access. Existing native provider configuration, permissions and run routing remain in the original New Chat.

The API captures reviewed authored instructions, USER context and goal in an owner-scoped agent_context event. Later bot edits do not silently change the captured session instructions. Both clients read identical goal and tool checkpoints; observing and reconnecting starts no iteration. This is persistent-goal synchronization, not automatic transfer of a running native Ralph loop.

## Shared information architecture

The coordinated workspace artifact 0.4.1 names the shared conversation screen Chat. Connection controls, tool permissions, bot goals and usage information are opened on demand. Native history import is available only when the native import adapter exists.

The Desktop adapter supplies the current display locale to the same shared renderer used on Web; no consent or transport scope changes accompany this presentation update.
