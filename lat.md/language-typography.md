# Language typography

Default UI typography follows the region in the preferred browser/OS locale through the shared design system, using reusable government fonts and script fallbacks bundled for offline use.

The legacy `manrope` preference id resolves to `--font-locale` in [[src/renderer/src/components/FontProvider.tsx]]. Explicit alternative font choices retain their own stacks. [[src/renderer/src/components/I18nProvider.tsx]] preserves the preferred navigator locale region in `data-font-country`, independently of the chosen HTML `lang`. Language switches retain the visitor country; bare locales never imply a country. The pinned design-system package documents sources, licensing and fallback status in TYPOGRAPHY.md. Code and numeric fonts stay separate.
