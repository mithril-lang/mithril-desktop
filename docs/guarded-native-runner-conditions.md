# Current-device canonical runner: remaining integration conditions

The canonical D1 lease endpoints and Desktop main orchestrator are implemented.
The production current-device runner is intentionally not installed. Native
Hermes Chat, Office, tools and their existing approvals remain available through
the existing native flows. This document does not approve execution or installation.

## Evidence inspected

- Sandbox pinned Hermes revision: `f14f86dd5ccc568296dcd71a74014eb5a1729cf9`.
- Read-only task-5 Hermes checkout inspected:
  `ef454e1085f24ffa60b007ab3c3208108815afad`.
- Desktop consumer: `src/main/native-chat-lease.ts`, `NativeRunHooks` and
  `GuardedNativeRunner`. Actual readiness requires all five guarantees, including
  `descendantStop`; no production adapter currently supplies them.
- Hermes `agent/tool_executor.py`: `_safe_callback` suppresses callback failures;
  `_pre_tool_block` also treats plugin-hook failures as an allowed call.
  `_dispatch_authorized_once` / `_run_agent_tool_execution_middleware` are the
  actual dispatch boundary. A progress callback or a gateway event cannot enforce
  a durable execution claim.
- Hermes `tools/approval.py`: `register_gateway_notify` and
  `resolve_gateway_approval(..., request_id=..., resolve_all=False)` implement an
  addressable native approval queue. Desktop `src/main/hermes.ts` already binds
  approval responses to their renderer/run and checks a single resolved request.
- Hermes `tools/environments/local.py`: `_run_bash` uses
  `start_new_session=True`; `_kill_process_group_posix` snapshots descendants
  before sending signals, then `_sweep_escaped_descendants` kills only that
  snapshot. Enumeration and signal failures are suppressed. Newly detached or
  reparented processes can escape the owned group and the snapshot.

No Hermes process, inference, native tool, permission prompt or installer was
invoked for this analysis. The task-5 repository was not modified.

## Implementable adapter boundary

A single-attempt dedicated child can construct the real `AIAgent` with a
per-turn fixed Mithril base URL/model, no credential pool or provider fallback,
and an HTTP guard before every inference request. It can gate the actual tool
executor before a side effect, persist a one-shot D1 tool claim, retain the
original native authorization/approval pipeline, and record a sanitized result
only after its durable receipt is acknowledged. Loss of acknowledgement must
stop the attempt and never replay the tool. Completed history is not an executor.

This cannot be implemented by forwarding canonical turns to existing
`sendMessage`, by consuming `tool.started`, or by adding a callback that the
native executor may suppress. A plugin/middleware wrapper must also cover nested
and concurrent dispatch, approval re-entry, delegation and configured MCP/plugin
paths; it must recheck the lease after a human approval and before dispatch.

## Why actual readiness remains false

The present Mac local environment has no demonstrated non-escapable execution
boundary for all enabled native tools. Killing a Python child or its POSIX
process group is insufficient for tools that create another process group,
detach/reparent, launch GUI/system work, or schedule work outside that process.
A watchdog that disappears with the Desktop process is also insufficient.

Setting `descendantStop: true` on an adapter backed by this cleanup would be a
false guarantee. Restricting the adapter to a few tools would not deliver native
feature parity. The remote runner's narrow supported-tool containment does not
prove arbitrary current-device terminal/MCP/plugin containment.

The blocker is a code/runtime guarantee, not the absence of paid live QA.
Configured paid providers remain supported in the product; mock fixtures can
verify their integration without making a paid request.

## Required proof before connecting the actual runner

1. A trusted execution boundary must own every enabled tool descendant, survive
   Desktop/gateway crashes, prevent escape or reliably terminate escaped work,
   and have no ability for an executed command/plugin to release that boundary.
   Linux delegated cgroup containment or a reviewed platform supervisor may be
   a candidate; current Mac POSIX group cleanup is not that proof. External or
   intentionally persistent work needs an explicit separate operation contract,
   rather than being silently continued by an expired chat lease.
2. A blocking native dispatch integration must admit exactly one attempt/tool
   receipt and fail closed before every side effect. Exceptions must not be
   swallowed into successful execution. All dispatch variants must be exercised.
3. The installed runtime must prove its exact reviewed source/dependency identity,
   fixed Mithril inference routing, no implicit continuation/fallback, and no
   automatic SDK/plugin installation. Credentials stay in main/child only.
4. Existing addressable approvals must remain bound to the current owner/profile,
   renderer and attempt, with one-time choice semantics and cancellation after
   account change, lease loss or process death. No new persistent grant is implied.
5. No-network subprocess fixtures must demonstrate expiry and Desktop crash while
   a tool is blocked, hung or detached; lost acknowledgements; duplicate attempts;
   approval cancellation/re-entry; owner changes; source mismatch; and complete
   descendant termination. Actual supported-platform proof is required before
   setting readiness true; interface mocks alone cannot establish it.

A Hermes-side integration or platform supervisor change would require a
separate scoped change in that repository/runtime image. Only the Fund and
Desktop checkouts are implementation targets for this task; no third-repository
change or new platform permission has been made. Any required Mac system
extension/helper installation or persistent OS grant must be separately
reviewed and explicitly authorized before use.

## Concrete next review targets

| Proposed action | Target | Current blocker |
| --- | --- | --- |
| Prepare a source-only native blocking-dispatch integration and mocked approval/lease fixtures | `mithril-lang/mithril-agent`, `agent/tool_executor.py` and the existing approval integration | This checkout is read-only in this task; a third-repository implementation scope has not been authorized. |
| Prepare a confinement test for a compatible supervised Linux runtime, using harmless detached-process fixtures and mocked providers | A separately selected candidate runtime image/backend, not production | No reviewed supervisor/cgroup ownership and escape-proof lifecycle contract is currently available. This candidate must prove containment before advertising native parity. |
| Connect the actual current Mac runner | Desktop `GuardedNativeRunner` installation boundary | Current process-group/snapshot cleanup cannot prove containment. A Mac supervisor with the necessary reviewed platform guarantees is missing; no OS helper installation or persistent device permission is authorized. |

These are preparation/review targets, not instructions to deploy, execute an
agent, install a supervisor, change permissions, or incur inference charges.
