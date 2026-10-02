# Shared chat components

Web App and Desktop use the same React chat components from the separate Mithril design-system repository, pinned to a Git commit in each consumer lockfile.

## Components and platform adapters

Markdown, code blocks, bubble classes, IME-safe textarea submission and Send/Stop controls have one implementation. Transport, media, history and account behavior remain with the apps.

`@mithril/design-system/react` exports `AgentMarkdown`, `ChatTextarea`,
`ChatSubmitButton` and `ChatBubble`. Desktop's
[[src/renderer/src/components/AgentMarkdown.tsx#AgentMarkdown]] supplies native
clipboard, preview navigation, local media and locale labels. Web supplies its
browser clipboard, safe new tabs and text-only images. The shared package has
no Electron or service dependencies.

The public `mithril.fund` favicon is the canonical crystal mark. All renderer
brand surfaces import `@mithril/design-system/mithril-mark.svg`, including the
onboarding hero. Native package icons retain the same crystal artwork; logo
changes require an explicit branding request, as recorded in shared BRANDING.md.

[[src/renderer/src/screens/Chat/ChatInput.tsx#ChatInput]] keeps voice, attachments,
input history, slash menu and resize behavior. Shared textarea keyboard handling
runs application navigation first and sends only an unconsumed Enter outside
IME composition; Shift+Enter inserts a newline. The app checks readiness before
keyboard submission. Shared Send/Stop controls use the existing callbacks.
[[src/renderer/src/screens/Chat/MessageRow.tsx#MessageRow]] uses the shared bubble
container while keeping media, timestamps, approval and error contents local.

## Dependency updates and verification

Consumers pin the same shared source commit. Shared changes pass component CI, then each app updates its dependency and publishes through its existing release gate.

The shared repo checks adapter clipboard/link behavior, image policy, code
expansion isolation during streaming, IME Enter, app-consumed keys, Send/Stop
and bubble slots. Stop cancels the browser click default before invoking abort,
so a synchronous return to Send cannot submit the restored draft a second time.
Desktop retains its Markdown diagram/highlighting regressions and chat
interaction tests. Run `npm run typecheck`, `npm test`, `npm run lint`
and `npm run lat:check` before publication. Desktop changes require a new preview
installer; Web changes use current-main App CI only.
