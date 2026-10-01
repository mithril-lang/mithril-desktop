# Shared Mithril workspace

`mithril-workspace-0.3.0.tgz` is the compiled npm pack artifact of the canonical
[`mithril-lang/mithril-fund/packages/workspace`](https://github.com/mithril-lang/mithril-fund/tree/921bf7665846113748cf054a5055c7768a00ca62/packages/workspace)
package. It contains ESM, TypeScript declarations, CSS, shared Office source compiled to ESM, local GLB/font assets, upstream licenses and package
documentation. Desktop does not maintain a separate copy of the workspace UI source.

SHA-256: `713c22659536873b2e27c08719cde600846f3dc1348194388819e2ef59fea619`.

To update, review the canonical package, build it there, run `npm pack -w
@mithril/workspace`, replace this artifact and update its file dependency and npm
lock integrity. Run Desktop typechecks, tests, lint, production build and `lat
check`; verify the browser and Desktop consume the same protocol and renderer.

This artifact is draft integration version 0.3.0. The coordinated API workspace
migration and dedicated workspace/chat-scope authorization must be available before
publishing a Desktop installer. No grants or production migration happen during
installation of this dependency.

Canonical source commit: `921bf7665846113748cf054a5055c7768a00ca62`, prepared in [Fund draft PR317](https://github.com/mithril-lang/mithril-fund/pull/317).
