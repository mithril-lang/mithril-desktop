# Mithril Code

Desktop uses its ordinary Chat harness and profile-scoped Hermes plugin to generate bounded Mithril applications, then opens the shared source and GitHub editor.

## Native execution

[[src/main/code-harness.ts#codeHarness]] invokes the profile-scoped `hermes mithril-code` CLI through fixed subprocess arguments. The brief travels over stdin; only the selected profile supplies its encrypted Mithril API credential. No automatic execution, retries or publication occurs.

The Agent plugin requires explicit enablement and the selected profile's MITHRIL_API_KEY. It calls the owned Code verification service, whose only inference route is api.mithril.fund/v1/chat/completions (qwen/qwen3.8-27b). Legacy runner settings are retained but never used as fallback. Unknown POST outcomes remain uncertain. The shared registered Code quota and API inference allowance apply.

## Review and measurements

[[src/renderer/src/screens/Code/Code.tsx#Code]] mounts the same shared Code workspace as Web, with source editing, import/export, verification receipts and explicit GitHub publication.

Switching profiles remounts the result view and clears its credentials.

The prior Code case qualifies toggle/count against fixed checks and 511 vectors. UI is maintained host code. Five-round model comparison on 2026-10-06 did not establish Jev speed or price superiority. Adapter tests use a synthetic local service; they do not prove fresh Jev inference or published native installers.

## GitHub publication

[[src/main/code-api.ts#codeApi]] accepts only fixed Code GitHub routes through trusted IPC. The user's GitHub credential stays in the owning screen's memory and is cleared when the profile changes or the user disconnects.

Desktop, App `/code` and Code use the compiled workspace `CodeWorkspace`, including Desktop's composer, file navigation, tabs and receipt disclosure. The shared editor retains admitted Mithril source, App IR, HTML and receipts. Editing Mithril requires explicit recompilation before GitHub saving. Historical To-do CLJK artifacts remain a separate legacy contract. Source edits invalidate the saved version; saving retains the verification distinction. GitHub uses a captured head and non-force update. Pages publishes only the saved public branch and refuses conflicting settings. Unknown write outcomes are not retried.

## Execution destination

Desktop explicitly offers a configured Hermes profile runner or the fixed Code service. Selecting a destination never starts execution or silently falls back after a failure.

[[src/main/code-api.ts#codeServiceRun]] validates a bounded brief and sends the bounded Mithril application task to Code with a transient Mithril API token and fresh request ID; GitHub credentials are excluded. The service emits Mithril Form source and requires the existing App compiler to admit its ontology application and semantic stages. Receipts state actual model and usage, not Jev identity or fabricated API cost. This choice needs no local device runtime and does not borrow the browser's session-only free allowance. [[src/main/code-api.ts#codeServiceStatus]] reads readiness without credentials or inference.

## Kuro source execution

Code shares Kuro JS/Python source execution across App, Code and Desktop.

The public App Kuro assets run in an opaque sandbox frame through a MessageChannel. No account, provider or GitHub credentials or Desktop IPC authority cross that boundary. Each explicit run gets a fresh bounded runtime; edits clear the displayed execution result. This is independent of the separate Mithril API typed-AST generation. Python is not a Pages backend and CLJK is not compiled by this action.

Desktop preserves the pinned public Kuro asset CSP through [[src/main/app/response-headers.ts#applyResponseHeaders]]. Its sandbox, restricted asset-only connections and blob worker policy remain authoritative; the local renderer keeps its own policy. Header tests verify this boundary and unchanged registry icon caching.

## Owned HTTP client

Hermes sends its own Mithril-Code-Hermes identifier because Cloudflare rejects the default Python identifier. Preview.30 pins the reviewed Agent language-tool merge and workspace 0.6.18.

Installer digests match the exact published script bytes; local builds are distinct from installer publication and live qualification.

Code preserves consumed attempts and receipt IDs while moving its external-runner pilot admission limit from 3 to 50/account/UTC day. Its service cap remains 100; Mithril API independently enforces its inference allowance and scopes. Web discloses the limit; native identity remains profile scoped.

## System One coding in the normal chat harness

The canonical Chat starts the same client-bound tool turn as App and Code after an explicit acknowledged send.

Mithril generation uses the owning profile's existing `mithril_code` Hermes plugin. The plugin returns `application.mith`, the admitted App IR, compiler/semantic receipts and static HTML. Supported output is a bounded static ontology application; arbitrary runtime logic remains outside this contract. Existing imported history never starts tools, and duplicate acknowledgements cannot replay generation after an uncertain result.

The tool checkpoint opens the existing shared Code source/GitHub editor. The Code navigation entry returns to Chat. Editing `.mith` requires an explicit recompilation before saving, and GitHub creation/commit/Pages retain the existing reviewed, non-force operations. Compiler calls carry source only. Native chat uses narrow owner-scoped IPC for canonical tool checkpoints; no bearer credential reaches the renderer or sandbox frame.

[[src/main/cloud-chat.ts#CloudChat]] owns the authenticated checkpoint request. [[src/renderer/src/screens/CloudWorkspace/MithrilChat.tsx]] adapts the shared client tool runner to the profile harness. [[src/renderer/src/screens/Code/Code.tsx]] adapts the shared artifact editor and publication transport.

The main process advertises `mithril-language-v1` on validated Chat checkpoints. The owner API captures the offered tool inventory for the lifetime of the turn; cached legacy clients retain their JS/Python inventory. Preview.31 adds this explicit negotiation to the preview.30 integration. No renderer-supplied protocol override or token upgrade is admitted.

Preview.32 pins the exact workspace 0.6.20 archive after merging the concurrent main changes. Web and native coding consumers share the accepted tool runner and source/GitHub editor; consumer transport and authority stay separate. Preview.30 and preview.31 remain unpublished drafts.
