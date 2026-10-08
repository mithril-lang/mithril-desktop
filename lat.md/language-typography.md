# Language typography

Default UI typography follows the active document language through the shared design system, using reusable government fonts and script fallbacks bundled for offline use.

The legacy `manrope` preference id resolves to `--font-locale` in [[src/renderer/src/components/FontProvider.tsx]]. Explicit alternative font choices retain their own stacks. [[src/renderer/src/components/I18nProvider.tsx]] mirrors the chosen locale to the HTML `lang` attribute, so switching language selects the font without resetting preferences. The pinned design-system package documents sources, licensing and fallback status in TYPOGRAPHY.md. Code and numeric fonts stay separate.
