---
lat:
  require-code-mention: true
---

# Gateway tool schema observations

The attached gateway turn observes profile discovery schemas separately from the conversation's model-visible schemas, without granting tool execution or claiming provider success.

[[src/main/gateway-tool-schemas.ts#GatewayToolSchemas]] uses the common workspace schema hash in the main process. Schema contents remain ephemeral; only hashes, opaque context, revision, source and observation times accompany tool activity.

The local gateway chat reads `tools.show` on its existing attached transport and session before submitting the prompt, and refreshes asynchronously after session-info changes. Each read has a one-second RPC deadline; older replies cannot overwrite newer reads. Older or malformed readbacks leave observation unknown without replaying or disabling legacy chat. No credential, provider URL or model-controlled profile enters the schema adapter. Remote dashboard and Web adapters remain pending.

Observations expire after thirty seconds. Stable call starts bind the schema metadata to that call, and completion only reuses its matching start. Session-info replacement, disconnect, finish, cancellation and API fallback invalidate the observer. The metadata is always `verified: false`: a tool-complete frame is not an authenticated execution receipt, and discovery is not admission. The native lease, generic router, installed Hermes publication and Web/Desktop live verification remain separate gates.

## Test specifications

Tests exercise the real shared schema hashing code and ensure metadata cannot substitute for transport ownership, action admission or execution receipts.

### Owned call correlation

Actual schema hashes change with schema content; starts and completions correlate only within the same observer. Duplicate, mismatched, unstable and foreign call IDs remain unobserved.

### Unknown and expired schemas

Old protocols, malformed schemas, deadline expiry, disconnect invalidation and retired asynchronous observations remain unknown, with no fallback schema or execution permission.
