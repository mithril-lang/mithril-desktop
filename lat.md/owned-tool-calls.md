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

Desktop now vendors agency.16 from Fund's qualified source. Its compiled snapshot parser validates partial/unknown effect declarations before dispatch; the archive, lock integrity and task dependency are matched. The SDK captures an optional partial local target binding before asynchronous discovery and sends its original digest on tools.call; this digest does not itself grant human authority. Human native review displays declarations in Web's canonical card, not native status metadata.

[[src/renderer/src/screens/Chat/dashboardOwnedTools.ts#callDashboardOwnedTool]] resolves the host target on the selected attached context before dispatch, refuses supplied-target mismatch, and requires fresh discovery to retain that context/revision. Missing or malformed preview RPCs refuse dispatch; an explicit null target remains unknown. This does not grant effects or obtain a human choice.

The Cloud Browser runner and main adapter still consume only server-returned checkpoint child names for the exact owner context and JS/Python parent. This does not connect the dashboard hook to Cloud Chat or resolve targets. Candidate preview.48 is not a new installer or live qualification.

## Test specifications

Mounted consumer tests use the actual hook and compiled SDK with a synthetic gateway. They prove local admission and lifecycle behavior rather than hosted, installed or real provider execution.

### Malformed declared effects

The actual mounted dashboard hook and vendored compiled SDK reject a complete-coverage claim in discovery before tools.call. No effect or retry is issued; absent legacy metadata remains unknown in the existing lifecycle tests.

### Host target preview admission

The actual hook resolves the selected host target before dispatch. Explicit null remains unknown; missing/malformed RPC, caller-target mismatch or a changed context/revision before dispatch is refused. Presentation key order does not alter identity.

### Retired preview cannot dispatch

A delayed target preview cannot dispatch after model/provider/session/connection changes, A-to-B-to-A connection replacement, cancellation, disconnect or unmount. No retry or automatic grant occurs.

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
