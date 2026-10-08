# Mithril Action Plane

Mithril Desktop projects bounded action authority from the Mithril Agent fork instead of treating an upstream command string as the complete approval contract.

[[device-care#Current implementation]] enforces one-use local cleanup plans independently of the dormant Agent Action API, with native approval and private recovery on failure.

The Desktop remains a projection and response surface. Server and Agent policy must independently enforce the approved plan, capability lease, expiry, budget, and receipt; renderer validation alone never grants authority.

The canonical runtime boundary is the public `mithril-lang/mithril-agent` fork. Its gateway identifies itself as `mithril-agent`, but advertises no Action Contract until server-side enforcement exists. [[src/shared/agent-capabilities.ts#buildAgentCapabilitySnapshot]] requires both that distribution and `mithril.action/v1` before it marks an Action runtime trusted, so this first slice deliberately remains fail-closed.

## Action envelope

`mithril.action/v1` adds a bounded action summary to an existing addressable gateway approval request while retaining the safe deny path for legacy requests.

[[src/shared/chat-approval.ts#normalizeActionEnvelope]] accepts only the versioned allowlisted fields: action id, operation, target, risk, evidence count, maximum cost, expiry, digest, reversibility, and receipt requirement. Unknown versions or incomplete identities stay ordinary command approvals and arbitrary payload fields do not cross into the renderer.

Consequential and critical actions can be approved only once or denied. Session and permanent choices are removed because approval is bound to one exact plan; the future Mithril Agent and Action API must enforce the same rule rather than trusting the Desktop projection.

### Normalizes bounded action metadata

A valid v1 envelope retains the authority context needed for informed review while discarding undeclared payload fields.

### Restricts consequential approval scope

A consequential or critical envelope never exposes session-wide or permanent authority even if a gateway offers those choices.

## Desktop approval projection

The existing approval card shows structured Mithril action context before the raw command and keeps the established addressable response flow unchanged.

[[src/renderer/src/screens/Chat/ApprovalCard.tsx#ApprovalCard]] displays risk, operation, target, evidence count, optional cost and expiry, and the exact plan digest. It does not execute an action, mint a lease, infer evidence, or write a receipt.

### Shows normalized authority context

The approval card renders the bounded fields as text, including the exact target and digest, without interpreting untrusted markup.
