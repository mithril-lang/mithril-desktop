# Shared Mithril workspace

`mithril-workspace-0.3.1.tgz` is the compiled npm pack artifact of the canonical
[`mithril-lang/mithril-fund/packages/workspace`](https://github.com/mithril-lang/mithril-fund/tree/893ae441dae67d8fb6806e92a5f041e33279a152/packages/workspace)
package. It contains ESM, TypeScript declarations, CSS, shared Office source compiled to ESM, local GLB/font assets, upstream licenses and package
documentation. Desktop does not maintain a separate copy of the workspace UI source.

SHA-256: `04324f87f3e7dbff3ec596e40c2809305eaee42c3c2eedcb35545c055bcdb7a5`.

To update, review the canonical package, build it there, run `npm pack -w
@mithril/workspace`, replace this artifact and update its file dependency and npm
lock integrity. Run Desktop typechecks, tests, lint, production build and `lat
check`; verify the browser and Desktop consume the same protocol and renderer.

This artifact is draft integration version 0.3.1. The coordinated API workspace
migration and dedicated workspace/chat-scope authorization must be available before
publishing a Desktop installer. No grants or production migration happen during
installation of this dependency.

Canonical source commit: `893ae441dae67d8fb6806e92a5f041e33279a152`, prepared in [Fund draft PR317](https://github.com/mithril-lang/mithril-fund/pull/317).
