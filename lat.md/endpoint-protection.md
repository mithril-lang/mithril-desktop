# Endpoint protection

Desktop provides opt-in local file and connection monitoring alongside cloud diagnostics. This bounded preview issues investigation leads and never claims comprehensive antivirus protection.

## Native monitoring

[[src/main/endpoint/runtime.ts#EndpointRuntime]] owns device-wide preferences, monitored folder selection, bounded scans, OS connection polling and alert retention in the Electron main process.

The Security screen uses canonical [[src/renderer/src/screens/CloudWorkspace/CloudSecurity.tsx]] navigation and disclosure components from the shared design system. [[src/renderer/src/screens/CloudWorkspace/EndpointProtection.tsx]] exposes native start/stop, folder removal, file selection and definition update controls through [[src/shared/endpoint-protection.ts#EndpointAPI]]. Renderer callers cannot choose programs, update origins or arbitrary file scan paths. IPC requires the main window sender and native file dialogs.

Monitoring defaults off. Enabling saves device-wide consent and resumes at later app launches; app exit stops monitoring. Folder membership is native-dialog selected. File bytes, process/socket rows and local alerts never leave this device. Only definition checks use the network. Alerts live in memory for the session; configuration and verified definitions stay in private userData files.

The initial public engine is a separate, deliberately small native implementation; private security-core engine binaries and proprietary catalogs are not copied into the public Desktop repository. Six bounded literal rules, host file change rate, process connection fanout and periodic contacts are implemented. Private-key material is a data exposure signal, not a malware verdict. Fanout is a possible scan/spread signal and can also be legitimate. No infection certainty, automatic response or execution interception is claimed.

[[src/main/endpoint/sensors.ts#collectConnections]] uses fixed absolute programs without a shell: macOS lsof, Linux ss and Windows netstat. Process identity uses OS-reported PID and process name where available. Reused PIDs, incomplete process ownership, five-second sampling and visibility limited by OS permissions constrain attribution. Connection metadata does not inspect packets, DNS or TLS contents.

Scans admit regular files up to 2 MiB, exclude symlinks, restrict watcher scans to selected roots and enumerate at most 500 initial entries per root. At most eight roots, 100 queued files, 2000 socket rows, 100 visible connections and 100 session alerts are retained. Overflow and sensor/watch failure remain explicit coverage gaps. Compression, encryption, kernel prevention, rootkit detection, PID-attributed file writes and a service running after app exit remain open.

## Definition delivery

[[src/main/endpoint/definitions.ts#DefinitionStore]] downloads a fixed-origin manifest and an immutable content-addressed pack, verifies an embedded Ed25519 key, schema, version, expiry, size and SHA-256, and atomically replaces a combined signed receipt plus pack.

Bundled rules work offline. Monitoring checks on start and about hourly with jitter. A manual update works while monitoring is off. Failed checks retain the last verified rules and report failure. Expired cached definitions remain usable but visibly stale. Older versions and changed bytes under the same version are rejected; a corrective rollback publishes the old rules under a newer version. This is a single-key preview protocol, not a complete TUF implementation. The local user's control of cache files and OS clock is outside its anti-rollback boundary.

`scripts/publish-endpoint-definitions.mjs` signs the exact metadata payload using a repository Actions secret whose public counterpart is embedded in the app. The feed branch contains only signed metadata and packs. CI publishes on definition changes and refreshes the fourteen-day expiry daily. No private key is committed, bundled or returned over IPC. Rotation currently requires an app release with a new trust anchor; offline root/online delegated keys, threshold signatures, revocation and channel/canary promotion are future hardening.

The source definitions are JSON data with literal byte markers and bounded numeric settings. Definitions cannot name commands, actions, paths, regexes, URLs or program modules. A new engine capability requires an installer release. The updater checks network trust independently of HTTPS transport. Reference patterns: https://docs.clamav.net/manual/Usage/SignatureManagement.html and https://theupdateframework.io/docs/metadata/.

## Verification

Tests exercise signatures, tampering, expiry, rollback, literal scanning, host fanout, beacon timing, sensor parsing, root confinement and native file monitoring. OS-specific fixture tests do not prove Windows/Linux installed-client behavior.

On 2026-10-08 JST, `scripts/verify-endpoint-live.mjs` launched the built Electron app with an isolated userData/Hermes profile. Real preload/main IPC selected an inert fixture folder, detected the PHP marker, observed macOS sockets, verified the public signed v1 feed and stopped monitoring. The harness supplied fixture paths in place of native file-dialog interaction; it did not use an account or customer files. This is built-app macOS evidence, separate from notarized installers and Windows/Linux execution.
