# Runtime security

Desktop runtime values and downloaded bootstrap code cross explicit trust boundaries before rendering or execution.

## Verified Agent bootstraps

Desktop verifies commit-pinned Mithril Agent bootstraps on Unix and Windows before executing the tested revision. Any download, checksum, or installer failure fails the operation even when older binaries exist.

[[src/main/installer-download.ts#verifiedInstallerCommand]] stages the Unix file under a unique temporary path and removes it on success, download failure, checksum mismatch, or installer failure. [[src/main/installer-download.ts#verifiedWindowsInstallerScript]] verifies the raw Windows bytes before making the UTF-8-BOM copy required by Windows PowerShell 5.1. [[src/main/installer.ts#runInstall]] treats every nonzero bootstrap exit as a failure rather than accepting an older surviving binary tree.

The pin is Mithril Agent commit `4fda47e0bfa9595066608ea02de934e46ff32074`. Its `scripts/install.sh` SHA-256 is `0fbf2969c12b9ef9c90b81519814865faa9ee4e22056e2a9a4d0b1d5e59966e8`; `scripts/install.ps1` is `5204fb92ced8b94af58e9ce37151cbbbc489b3b03ca81830a57362362d3d20da`. Bump the commit and both digests together after review.

[[tests/installer-download.test.ts]] executes the Unix pipeline with real checksum tools and a harmless downloaded fixture, and inspects the Windows verification order. [[tests/installer-verification-result.test.ts]] checks that verification failure cannot become success merely because binaries exist. Desktop exposes no copyable `curl | bash` or `irm` fallback; failure recovery stays on the same verified in-app retry path.

## Agent checkout migration

Fresh install and explicit local Update use the same pinned Mithril Agent bootstrap. Existing Nous checkouts move once through the Agent installer's source-aware, idempotent update path instead of a Desktop-authored git rewrite.

Desktop supplies `HERMES_REPO_URL=https://github.com/mithril-lang/mithril-agent.git`, `main`, the exact commit, `HERMES_HOME`, and the checkout directory on both platforms. The Agent installer changes `origin` before fetch, includes untracked files in its autostash, and writes rescue refs before replacing divergent or orphaned commits. Profile auth and configuration remain outside the checkout under `HERMES_HOME`.

[[src/main/agent-install-lifecycle.ts#installAgentAndRestoreRuntimes]] snapshots running gateways and managed dashboards after the idle gate, waits for their captured OS processes to exit, runs the installer, and restores only that prior topology even when installation fails. Every restore is attempted; false results and throws are aggregated without masking the installer error.

[[src/main/ipc/register.ts#registerIpcHandlers]] waits indefinitely for active Desktop turns, profile cron executions, and dashboard leases, and refuses new local chat/audio while checkout maintenance is in progress. The wait is cancellable; after runtime shutdown begins, cancellation is disabled so topology restoration cannot be skipped. A failed installer never claims migration success.

[[src/main/agent-install-lifecycle.test.ts]] covers busy signals, waiting for captured runtime exit, shared gateway exclusion, restart-only-previously-running behavior, exhaustive restoration, and original-error preservation. [[src/main/gateway-restart-defer.test.ts]] covers cancellation before the deferred mutation. The Agent repository owns platform-parity integration tests for stash and rescue mechanics; Desktop verifies its pinned invocation contract rather than duplicating that git implementation.

## Memory provider HTML boundary

The active memory provider is escaped once before interpolation into translated HTML. Translation markup stays intact while provider names remain literal text.

[[src/renderer/src/screens/Memory/MemoryProviders.test.tsx]] renders actual translations in every supported locale and verifies normal names, markup, and literal HTML entities inside the provider label.
