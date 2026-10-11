# Analytics

Privacy-first, opt-out usage analytics that report anonymous events to the in-house Hermes analytics service. Replaces the former PostHog integration; no third-party analytics SDK is bundled.

Events are sent directly over `fetch` from the renderer — there is no client library. Each event POSTs to `{VITE_ANALYTICS_BASE_URL}/v1/events` with an `x-api-key: {VITE_ANALYTICS_API_KEY}` header and a JSON body of `{ anonymous_id, event, source: "desktop", properties }`. The base URL and API key are injected at build time from GitHub Actions secrets, so analytics is silently disabled in local and unofficial builds where neither is configured. It is also disabled on the Vite dev server — [[src/renderer/src/utils/analytics.ts#isConfigured]] short-circuits when `import.meta.env.DEV` is true, since the `http://localhost:5173` dev origin isn't allowed by the service's CORS (every request would just fail preflight and spam the console). Packaged builds run `vite build`, so they are unaffected.

## Per-install identity

A random UUID created on first launch and persisted in `localStorage` under `hermes-anonymous-id` is the analytics user id — created if absent, reused if present.

It contains no PII and never leaves the device except as the `anonymous_id` field on events.

[[src/renderer/src/utils/analytics.ts]] owns this logic. `getOrCreateAnonymousId` reads or mints the id; `resetAnalytics` clears it so a fresh id is minted on the next event.

## Consent

Analytics is opt-out: enabled by default when the endpoint is configured, and the user can disable it from Settings. The choice is stored in `localStorage` under `hermes-analytics-enabled`.

[[src/renderer/src/components/settings/PrivacyPane.tsx#PrivacyPane]] (the Privacy pane of the settings modal) renders the toggle and a short one-line privacy note, calling `setAnalyticsConsent`; the initial state comes from `getAnalyticsConsent` in [[src/renderer/src/components/settings/useSettingsData.ts#useSettingsData]]. When consent is off, `capture` short-circuits and no requests are made.

## Capture surface

`initAnalytics` runs once at renderer startup from [[src/renderer/src/main.tsx]] and emits an `app_opened` event.

Its properties are `app_version` (the Hermes version from `package.json`, fetched over the `get-app-version` IPC — not the runtime version), `electron_version`, `node_version`, and `platform`.

Screen navigation is tracked via `captureScreenView` from [[src/renderer/src/App.tsx#App]], and `captureFeatureUsage` records feature-level events. No chat content, prompts, model responses, file paths, or credentials are ever collected.

## Build & CSP

The `VITE_ANALYTICS_BASE_URL` and `VITE_ANALYTICS_API_KEY` secrets are injected into every `npm run build` step of the release workflow (`.github/workflows/release.yml`).

The Content-Security-Policy in [[src/main/app/start.ts]] and `src/renderer/index.html` allows `connect-src` to reach the analytics host (`https://*.hermesone.org`); the former PostHog `script-src`/`connect-src` allowances were removed.

## Mithril account usage days

Authenticated client usage days require a separate explicit opt-in, disabled by default. They do not reuse legacy Hermes analytics consent or identify an installed binary.

[[src/main/mithril-client-day.ts#recordMithrilClientDay]] sends only client type and consent to the fixed Mithril endpoint, using the encrypted active-profile token solely in main. [[src/renderer/src/utils/mithril-client-days.ts#startMithrilClientDays]] reports foreground use once per successful UTC day; failures remain nonblocking. Privacy Settings allows revocation. No chat content, device identifier, credential, file path or installation proof is submitted.

The boundary is covered by [[mithril-client-days-tests#Mithril usage day tests]].

## Native measurement installer candidate

The client-day reporter is merged into main. Preview.70 was used for isolated Mac qualification without replacing preview.69. The packaging fix preserves the newer main version and dependencies.

Source tests and signed local Mac candidates do not prove notarization, cross-platform release or installed retention.

## Packaged measurement candidate inputs

Source vendor archives remain compiler/install inputs and are excluded from native installers. Installed Workspace dependencies and compiled main/preload/renderer files remain packaged.

The first candidate contained 101 source tarballs totaling 659 MiB despite no runtime references to that source directory. The repackaged preview.70 ASAR contains no source vendor tarballs, retains 279 Workspace files and 872 compiled runtime entries, and contains the client-day endpoint in its main bundle. The DMG is 255,213,322 bytes and the ZIP is 254,754,911 bytes. Deep strict Developer ID verification and the actual bundle version pass. The ZIP and initial DMG were accepted by Apple notarization after the existing team key was paired with its browser-confirmed Issuer ID. The app passes ticket validation and Gatekeeper and launches from an isolated QA installation. The initial unsigned DMG failed container assessment despite notarization; DMG signing is now required. The signed preview.70 container was separately accepted by Apple, stapled and passed signature and Gatekeeper assessment. Public release, authenticated use, cross-platform and update replacement checks remain pending.
