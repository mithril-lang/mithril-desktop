# Mithril Code

Desktop calls Hermes's owned Mithril Code plugin to assemble two bounded To-do functions, review generated CLJK and show typed logic with actual execution measurements.

## Native execution

[[src/main/code-harness.ts#codeHarness]] invokes the profile-scoped `hermes mithril-code` CLI through fixed subprocess arguments. The brief travels over stdin; only the selected profile supplies the runner credential. No automatic execution, retries or publication occurs.

The Agent plugin requires explicit enablement, a configured trusted runner and the profile's CODE_RUNNER_TOKEN. HTTP is loopback-only; remote URLs require HTTPS. Unknown POST outcomes remain uncertain. Existing registered free-trial quota/replay contracts in Fund PR492 are independent and must not be inferred from this operator runner adapter.

## Review and measurements

[[src/renderer/src/screens/Code/Code.tsx#Code]] mounts the same shared Code workspace as Web, with source editing, import/export, verification receipts and explicit GitHub publication.

Switching profiles remounts the result view and clears its credentials.

The prior Code case qualifies toggle/count against fixed checks and 511 vectors. UI is maintained host code. Five-round model comparison on 2026-10-06 did not establish Jev speed or price superiority. Adapter tests use a synthetic local service; they do not prove fresh Jev inference or published native installers.

## GitHub publication

[[src/main/code-api.ts#codeApi]] accepts only fixed Code GitHub routes through trusted IPC. The user's GitHub credential stays in the owning screen's memory and is cleared when the profile changes or the user disconnects.

Desktop, App `/code` and Code use the compiled workspace `CodeWorkspace`, including Desktop's composer, file navigation, tabs and receipt disclosure. The shared editor builds the immutable starter plus actual verified source and typed logic. CLJK edits do not recompile the runtime artifacts. Source edits invalidate the saved version; saving retains the verification distinction. GitHub uses a captured head and non-force update. Pages publishes only the saved public branch and refuses conflicting settings. Unknown write outcomes are not retried.

## Execution destination

Desktop explicitly offers a configured Hermes profile runner or the fixed Code service. Selecting a destination never starts execution or silently falls back after a failure.

[[src/main/code-api.ts#codeServiceRun]] validates a bounded brief and sends only the fixed To-do task to Code with the screen's GitHub/provider credentials. The service retains its existing authorization and model-cost policy. This choice needs no local device runtime and does not borrow the browser's session-only free allowance. [[src/main/code-api.ts#codeServiceStatus]] reads readiness without credentials or inference.
