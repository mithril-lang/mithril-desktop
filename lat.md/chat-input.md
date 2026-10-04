# Chat Input

The chat composer keeps message entry and its supporting controls inside one accessible, visually unified surface.

## Animated composer border

The composer uses a theme-aware decorative beam without changing its keyboard, attachment, voice, or submission behavior.

[[src/renderer/src/screens/Chat/ChatInput.tsx#ChatInput]] places `border-beam` beside `.chat-input-wrapper` in a shared shell, using the contained `pulse-inner` size, monochrome palette, and `0.7` strength. Theme colors follow the resolved Hermes theme appearance rather than the operating-system preference.

The beam is an absolutely positioned, non-interactive decoration whose generated CSS disables animation for `prefers-reduced-motion`. Its internal clipping cannot clip toolbar popovers because the interactive composer is a sibling; the shared shell carries focus styling and keeps overflow visible.

### Uses the requested beam preset

The ChatInput integration test verifies the requested preset, strength, and theme while ensuring the beam is decorative and not an overflow-clipping ancestor of the textarea or toolbar.

[[src/renderer/src/screens/Chat/ChatInput.test.tsx]] protects the component boundary and configuration without coupling tests to the dependency's generated animation CSS.

## Shared Desktop and Web surface

Desktop consumes the canonical compiled ChatComposer from the design-system package, together with the same CSS and screen components used on Web.

[[src/renderer/src/screens/Chat/ChatInput.tsx#ChatInput]] supplies attachment, voice, model/context, quick ask and border-beam slots. The shared composer owns textarea/toolbar/send layout, Enter and IME handling. Native callbacks retain readiness, permission and queue behavior.

ChatTabs, ChatWelcome, ToolActivity, WorkspaceNavigation and ChatSurface use the same package. Desktop supplies local profiles, run selection, native receipt content and navigation callbacks. No Electron or transport dependency enters the shared components. The package ships compiled ESM and declarations pinned by Git revision; CSS has one Desktop-derived owner.

[[src/renderer/src/screens/Chat/ChatInput.test.tsx]] and [[src/renderer/src/screens/Layout/ActiveSessionsBar.test.tsx]] protect native integration; packaged shared tests cover keyboard tabs, close isolation, mounted disclosure and explicit actions.
