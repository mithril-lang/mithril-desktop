# Shared Mithril workspace

`mithril-workspace-0.2.0.tgz` is the compiled npm pack artifact of the canonical
[`mithril-lang/mithril-fund/packages/workspace`](https://github.com/mithril-lang/mithril-fund/tree/main/packages/workspace)
package. It contains ESM, TypeScript declarations, CSS, the license and package
documentation. Desktop does not maintain a separate copy of the workspace UI source.

SHA-256: `171c37a0f8d8d9713fab13d73f808c58eb9f5cdfb09e83e16193b33c68b0d107`.

To update, review the canonical package, build it there, run `npm pack -w
@mithril/workspace`, replace this artifact and update its file dependency and npm
lock integrity. Run Desktop typechecks, tests, lint, production build and `lat
check`; verify the browser and Desktop consume the same protocol and renderer.

This artifact is draft integration version 0.2.0. The coordinated API workspace
migration and dedicated workspace/chat-scope authorization must be available before
publishing a Desktop installer. No grants or production migration happen during
installation of this dependency.
