# Independent CI adoption

This repository is registered with Mithril's organization-owned CI controller.
The immutable controller revision, verification scope, runtime readiness and
publication gates are recorded in [independent-actions.json](independent-actions.json).

Use the [organization adoption guide](https://github.com/mithril-lang/.github/blob/cbc4c165c464c8aa7e986b52a87de5df03739f5b/INDEPENDENT_ACTIONS.md).
Check out `mithril-lang/.github` at `cbc4c165c464c8aa7e986b52a87de5df03739f5b` in a separate trusted checkout, then run:

```sh
node /path/to/org-policy/tools/independent-actions/cli.mjs plan --checkout /path/to/this-repo
node /path/to/org-policy/tools/independent-actions/cli.mjs check-adapter --checkout /path/to/this-repo
```

The adapter cannot provide executable shell commands. Review the shared policy
before upgrading its pin. A prepared source profile is limited to its stated
coverage. Runtime-required profiles fail closed until their listed dependencies
and native environments have been qualified. Fund delegates to its existing
signed scheduler and dedicated publishers.

This initial registration does not retire existing workflows or qualify a
production release. Repository-specific signing, native validation, owner,
credentials, rollback and live/installed-client verification remain required.
Adapter validation is not full application CI.

## Apple-first native qualification

Use `scripts/independent-macos/cli.mjs` directly on a trusted Mac with Node 24.
`preflight --arch arm64` checks actual Developer ID and notarization readiness.
`package --arch arm64 --state ...` can prepare signed-only bytes while credentials
are pending; this never produces a qualified receipt.
`qualify --arch arm64 --state /absolute/private/state` builds, signs, notarizes,
staples and launches the current clean main. Repeat on a separate fresh checkout
with `--arch x64`, using the same private state directory. `verify --state ...`
requires both receipts and their exact final bytes.

Provide either `MITHRIL_NOTARY_PROFILE` for an existing notarytool credential,
or `APPLE_API_KEY` (owner-only local .p8 path), `APPLE_API_KEY_ID` and
`APPLE_API_ISSUER`. Use 1Password references through `op run` where available;
do not put secret values in the command line, source or logs. The existing
Developer ID key must already be usable in the worker's keychain.

This qualification is Apple-first preparation. It does not unlock the held
organization adapter or publish a partial cross-platform release. Windows/Linux
native receipts and installer/update verification remain required.
