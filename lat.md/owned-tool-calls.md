---
lat:
  require-code-mention: true
---
# Owned tool calls

Desktop's existing dashboard Chat hook exposes explicit tool calls on its attached idle session through the shared workspace SDK. This hook API does not yet wire Browser JS/Python or a user-facing tool router.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] retains the native IPC connection acquisition and existing WebSocket client. The SDK uses a fresh built model-visible snapshot, explicit request ID and bounded arguments, with no automatic create/resume/prompt or retry.

Connection, profile, model/provider, session, cancellation and unmount retire call authority. A late response after dispatch becomes unknown; this does not attest that a handler stopped. Package, installed source, authenticated runtime and UI routing remain separate qualification gates.

The compiled shared SDK captures peer approval IDs, immutable session/choices and cancellation. Consumed/cancelled IDs remain retired until connection change, and conflicting presentation withdraws the card. Pending custody is bounded to 32 requests and 256 captured IDs per connection.

The dashboard client advertises server requests on gateway.ready and routes captured peer approval requests to the existing cards. User selection queues a response on the original peer ID; it is not an effect or delivery receipt. Cancel/retirement removes the card authority. Unsupported peer kinds explicitly return method-not-found; no automatic approval or credential entry occurs.

Desktop now vendors agency.11. Its Cloud Browser runner and main adapter consume only server-returned checkpoint child names for the exact owner context and JS/Python parent. This does not connect the dashboard hook to Cloud Chat or replace server effect grants.

## Test specifications

Mounted consumer tests use the actual hook and compiled SDK with a synthetic gateway. They prove local admission and lifecycle behavior rather than hosted, installed or real provider execution.

### Mounted owned call lifecycle

Reject missing or busy authority, capture arguments before discovery, dispatch exactly once on the attached session, and discard responses after model/provider, connection/session, cancellation, disconnect or unmount changes.

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
