---
lat:
  require-code-mention: true
---

# Owned tool calls

Desktop's existing dashboard Chat hook resolves host targets before explicit tool calls on its attached idle session through the shared workspace SDK. This hook API does not yet wire Browser JS/Python or a user-facing tool router.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] retains the native IPC connection acquisition and existing WebSocket client. The SDK uses a fresh built model-visible snapshot, explicit request ID and bounded arguments, with no automatic create/resume/prompt or retry.

Connection, profile, model/provider, session, cancellation and unmount retire call authority. A late response after dispatch becomes unknown; this does not attest that a handler stopped. Package, installed source, authenticated runtime and UI routing remain separate qualification gates.

The existing approval card and bounded action projection are now canonical compiled workspace components reused by Web and Desktop. Desktop owns its translation/message adapter; Web owns cookie/peer transport and shows only the selected conversation. Queue acceptance remains distinct from an effect receipt.

The compiled shared SDK captures peer approval IDs, immutable session/choices and cancellation. Consumed/cancelled IDs remain retired until connection change, and conflicting presentation withdraws the card. Pending custody is bounded to 32 requests and 256 captured IDs per connection.

The dashboard client advertises server requests on gateway.ready and routes captured peer approval requests to the existing cards. User selection queues a response on the original peer ID; it is not an effect or delivery receipt. Cancel/retirement removes the card authority. Unsupported peer kinds explicitly return method-not-found; no automatic approval or credential entry occurs.

The latest successful session attachment response restores original approval frames from its bounded open_requests snapshot. Session IDs must match, metadata never creates authority, and answered/cancelled IDs cannot revive. Restoring a pending card still requires a new explicit human choice.

Desktop now vendors agency.21 built from Fund's candidate source. Its compiled snapshot parser validates partial/unknown effect declarations before dispatch; the archive, lock integrity and task dependency are matched. The SDK captures an optional partial local or selected-session todo/memory target binding before asynchronous discovery and sends its original digest on tools.call; this digest does not itself grant human authority. Human native review displays declarations in Web's canonical card, not native status metadata.

[[src/renderer/src/screens/Chat/dashboardOwnedTools.ts#callDashboardOwnedTool]] resolves the host target on the selected attached context before dispatch, refuses supplied-target mismatch, and requires fresh discovery to retain that context/revision. Missing or malformed preview RPCs refuse dispatch; an explicit null target remains unknown. This does not grant effects or obtain a human choice. Multiple local targets carry content/entry resolution; every path and resolution must match, including both Move endpoints.

The Cloud Browser runner and main adapter still consume only server-returned checkpoint child names for the exact owner context and JS/Python parent. This does not connect the dashboard hook to Cloud Chat or resolve targets. Candidate preview.50 is not a new installer or live qualification.

The previous SDK19 candidate passed separate canonical inline32 and file27 network families using actual Web/Electron UI, JS/Python WASM, main/IPC, HTTP/D1 and Hermes handlers. Todo review pins the resolved store digest. Account/model/issuer/pairing/local D1 remain fixtures; these serial fresh runs do not establish real account whole boot, OS permissions, continuous stability, publication or installed behavior.

The agency.20 memory target consumer tests remain historical evidence; agency.21 adds the compiled shared human memory review panel. Mounted Desktop104 and Web39 pass, with fresh source/archive/lock/dependency byte checks. Current-source network and installed behavior require separate verification. Memory target identity binds the actual store route and declared mirrors, not data revision CAS, staging authority or atomicity.

## Test specifications

Mounted consumer tests use the actual hook and compiled SDK with a synthetic gateway. They prove local admission and lifecycle behavior rather than hosted, installed or real provider execution.

### Malformed declared effects

The actual mounted dashboard hook and vendored compiled SDK reject a complete-coverage claim in discovery before tools.call. No effect or retry is issued; absent legacy metadata remains unknown in the existing lifecycle tests.

### Host target preview admission

The actual hook resolves the selected host target before dispatch. Explicit null remains unknown; missing/malformed RPC, caller-target mismatch or a changed context/revision before dispatch is refused. Presentation key order does not alter identity.

### Multi-file target admission

The adapter compares every path and content/entry resolution against the reviewed target. Changed or missing endpoints refuse dispatch even with an unchanged digest. The same complete identity dispatches once.

### Retired preview cannot dispatch

A delayed target preview cannot dispatch after model/provider/session/connection changes, A-to-B-to-A connection replacement, cancellation, disconnect or unmount. No retry or automatic grant occurs.

### Session store target admission

The compiled SDK consumer compares the reviewed todo store's session and opaque profile owner. A changed owner, session or ambiguous shape refuses dispatch even with the same digest; a matching identity sends one exact digest.

### Original peer restoration

Only the latest attachment response restores its matching original peer frames. Stale responses, foreign session frames, unrelated RPC results and consumed requests cannot create authority; a still-pending frame can restore its display.

### Mounted owned call lifecycle

Reject missing or busy authority, capture arguments and target binding before discovery, dispatch exactly once on the attached session, and discard responses after model/provider, connection/session, cancellation, disconnect or unmount changes.

### Actual client wire

The real client sends one stable owned call with its explicit timeout. Discovery-only or malformed input is refused; replay, loss, expiry, reconnect and invalid results never trigger retry.

### Peer approval wire

The real client advertises peer requests and projects captured approvals into existing cards. Human choices match original request/session/choices; cancellation, close and unsupported requests never approve or replay an operation.

### Retired socket cannot affect current peer

Delayed messages and close from a retired socket cannot alter the current connection's events or pending responses.

### Mounted peer approval choice

The mounted hook returns only an explicit allowed human choice to the original peer ID. It does not auto-approve, repeat a choice or fall through to legacy approval RPC.

### Mounted peer cancellation isolation

A matching cancellation retires only its original approval. Foreign-session cancellation cannot disable the next owned card or grant its action.

### Shared approval retirement

Compiled shared approval custody suppresses identical duplicate requests and withdraws conflicting presentation. Answered or cancelled peer IDs cannot recreate actionable cards on the same connection.

### Memory store and mirror admission

The consumer compares the reviewed memory store, session, profile owner, store identity and every mirror name and identity. Target changes refuse dispatch with the same outer digest; unchanged targets dispatch once.

## Pending memory human review

The compiled shared panel requires a full selected proposal review and explicit human approve or reject. It never derives consent from a model, a pending ID or a successful send.

### Attached conversation custody

The adapter permits review and digest-bound decisions only on the attached conversation. Connection, profile, session, model, cancellation and disconnect retire stale controls. Unknown results require a new queue read.

### Explicit decision and unknown outcome

The actual hook and compiled shared panel render complete memory review before one explicit approve or reject. Duplicate clicks send once; lost results remove controls without dispatching again.

### Retired review has no authority

A delayed full review cannot restore decision controls after model, provider, connection, session, cancellation, disconnect or unmount. Even a retained adapter cannot send a stale decision.

### Real Electron review and result loss

A sandboxed Electron window uses production preload, dashboard client, Chat hook and shared panel. Real ticket WS and persistent workers qualify human review, A/B/A custody, retired review and committed reply loss.

Launch/profile URL issuance and the surrounding screen are fixtures; no real account, installed app or whole boot is claimed. The renderer must apply the packaged review stylesheet. The backend independently checks disk, queues, frozen prompts and history.

### Explicit saved-result closure

Uncertain memory outcomes require full proposal, receipt and saved-data review. Saved/unsaved confirmation sends one fixed closure command; this mode never becomes approve/reject and lost results never retry.

The attached adapter permits the fixed digest-bound closure verbs under the same current profile/session/generation guard. Relay custody additionally matches the review decision mode. Backend closure records the human assessment without running a memory write.

The current local fixture qualifies seven explicit closures in isolated Electron and six through the real Web relay, across A/B/A. Full saved state is unchanged by closure. Lost closure replies reconnect without a second decision; partial closure failure and installed/whole/native/provider stability remain unqualified.

A persisted terminal assessment with a residual queue record is reviewable again. Explicit confirmation of the same assessment removes only that queue entry; a different choice is refused. Local Electron/Web fixtures verify full store state and original receipt bytes remain unchanged during this cleanup. Power loss, arbitrary filesystem writers and installed/whole clients remain unqualified.
