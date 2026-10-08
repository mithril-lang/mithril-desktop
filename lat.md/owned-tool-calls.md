---
lat:
  require-code-mention: true
---
# Owned tool calls

Desktop's existing dashboard Chat hook exposes explicit tool calls on its attached idle session through the shared workspace SDK. This hook API does not yet wire Browser JS/Python or a user-facing tool router.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] retains the native IPC connection acquisition and existing WebSocket client. The SDK uses a fresh built model-visible snapshot, explicit request ID and bounded arguments, with no automatic create/resume/prompt or retry.

Connection, profile, model/provider, session, cancellation and unmount retire call authority. A late response after dispatch becomes unknown; this does not attest that a handler stopped. Package, installed source, authenticated runtime and UI routing remain separate qualification gates.

Desktop now vendors agency.10. Its Cloud Browser runner and main adapter consume only server-returned checkpoint child names for the exact owner context and JS/Python parent. This does not connect the dashboard hook to Cloud Chat or replace server effect grants.

## Test specifications

Mounted consumer tests use the actual hook and compiled SDK with a synthetic gateway. They prove local admission and lifecycle behavior rather than hosted, installed or real provider execution.

### Mounted owned call lifecycle

Reject missing or busy authority, capture arguments before discovery, dispatch exactly once on the attached session, and discard responses after model/provider, connection/session, cancellation, disconnect or unmount changes.

### Actual client wire

The real client sends one stable owned call with its explicit timeout. Discovery-only or malformed input is refused; replay, loss, expiry, reconnect and invalid results never trigger retry.
