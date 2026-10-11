# E2EE Vault source qualification

This preview adds offline device enrollment, recovery files and one-item local
Hermes credential disclosure. Privacy settings never receive secret values,
root keys, recovery codes or decrypted snapshots. Native confirmations disclose
that Hermes's existing credential-capture handler persists an approved value
into profile `.env`/authentication data. Grant expiry/revocation stops further
Vault disclosures; it does not erase credentials already released to an agent.

## Source receipts

Run the controller with the existing owner's qualified Node 24 runtime:

```
node scripts/independent-macos/source-cli.mjs qualify --checkout /absolute/source --state /external/owner-only/state --mode candidate
node scripts/independent-macos/source-cli.mjs verify --checkout /absolute/source --state /external/owner-only/state --receipt /external/owner-only/state/receipt.receipt.bundle --mode candidate
```

The controller itself must be committed and clean. Only the fixed Desktop,
kagi SDK and kagitaba SDK repositories/profiles are accepted. The Mac sends an
exact Git archive to the configured `gad` runner, uses the existing immutable
Node 24 Docker image and shared dependency cache, and mounts no host checkout,
provider token, deployment secret or signing key. Dependency setup can reach
public package sources; subsequent tests/builds have no network. Containers drop
capabilities and enforce CPU, memory and PID limits. Only the newly created
source volume is removed after a run.

The existing Mac Developer ID signs the receipt with the native codesign resource seal. Verification
checks the strict code signature, hardened-runtime/timestamp metadata and exact owner certificate, then repository, SHA, recipe/controller/runtime
hashes, 24-hour freshness, logs and compiled artifact inventory. A candidate
receipt is not an installer, external security review, production migration or
publication authority. The library profiles qualify the new SDK adapters;
existing CLJK sensitivity and Noble interoperability tests are checked separately.

After normal reviewed integration, repeat qualification using `--mode
current-main`. The mode refuses any SHA differing from current remote main.
Fund API uses its existing `scripts/standalone-ci.mjs verify --host gad --profile
api` and its own signing authority; these receipts cannot substitute for it.

## Release boundaries

The native installer qualifier retains its clean-current-main, Developer ID,
notarization, Gatekeeper, launch and architecture guards. Windows/Linux native
owners remain separate. The API feature flag defaults off and migration 0059
is not applied by these source checks. General availability requires the external
review and recovery drill in kagi SECURITY.md, native installed-client evidence,
reviewed schema deployment and live sync read-back. Device revocation, automatic
item discovery and authenticated deletion remain outside this preview.
