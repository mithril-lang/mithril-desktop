# Device protection and maintenance

Mithril Desktop brings endpoint protection and disk maintenance into one device-care workspace, with measured coverage, explicit action authority, and local evidence.

Status: initial implementation, 2026-10-08 JST. The sections below preserve the full product design; current support is bounded by the implementation ledger. Runtime hardening remains [[desktop-security]], process ownership remains [[main-process]], and consequential authority follows [[mithril-action-plane]].

## Current implementation

The local Device care screen provides ClamAV status and bounded folder scans, selected-folder storage analysis, reviewed temporary-media cleanup, recovery locations and private run summaries.

[[src/renderer/src/screens/DeviceCare/DeviceCare.tsx]] uses Desktop theme tokens, shared button styles and Japanese/English translations. It identifies the local computer even when the chat workspace is cloud-connected. [[src/main/device-care/ipc.ts#registerDeviceCareIpc]] exposes a typed [[src/shared/device-care.ts#DeviceCareAPI]] through preload and admits only the main window's main frame. Folder scope comes from native selection, never renderer paths.

[[src/main/device-care/protection.ts#DeviceCareProtection]] discovers ClamAV only at fixed installation paths, validates engine output, and requires signatures no older than seven days. Local folder scans have no upload, delete or quarantine arguments; they exclude symlinks and cross-volume traversal, bound archive/file size and depth, and stop after ten minutes. Engine completion always retains partial coverage. Cancellation terminates the owned scan process. Windows ClamAV engine discovery, OS access blocking, privileged helpers and commercial-provider remediation remain unsupported. The extensions below add selected-folder inspection, encrypted local custody and bounded vendor reads without claiming those unavailable capabilities.

[[src/main/device-care/storage.ts#DeviceCareStorage]] analyzes at most 20,000 entries, depth 16 and 15 seconds. Symlinks, other volumes and unreadable paths are excluded and counted. Folder analysis grants no cleanup authority. Only direct, single-link, current-user-owned generated media in the existing Desktop temp root, with old access/modification timestamps, matching content-name hash and a private or non-shared writable root, can become cleanup candidates. Internal legacy media cleanup still has its original scope; this slice does not turn it into whole-device cleanup.

Plans expire after five minutes and bind exact candidates and content digests. The executor consumes a plan before native Cancel-by-default confirmation, rechecks root/file identity and content, stages files into a private recovery directory, then moves verified staged originals to OS Trash. It does not permanently delete files or claim immediate space reclamation. Trash failure or an unexpected staged object preserves recovery data without overwriting the original path; recovery directories remain discoverable after restart. Native one-use enforcement exists locally; the dormant Agent Action API does not confer local authority.

Jobs serialize scans with storage analysis/cleanup. Analysis cancellation stops traversal; cleanup is bounded to the approved batch and reports per-item failures and skipped changes. A crash during staging preserves originals for manual recovery. OS Trash restoration uses the OS interface; in-app restoration is not implemented. History retains the latest 100 local summaries with private permissions and atomic writes, excluding paths, content and secrets. Clearing history does not change recovery data or Trash.

Local source-build verification on 2026-10-08 JST: the real Desktop sidebar opened Device care, detected ClamAV 1.5.4 with definition 28147, scanned two isolated test files, and displayed Eicar-Test-Signature for the harmless EICAR fixture. Desktop temp analysis displayed measured volume capacity, available space and zero eligible files. User files were not cleaned. This receipt does not qualify Windows/Linux, packaged-client behavior, resident protection or commercial vendor connectivity.

## Protection extension

Session background inspection, encrypted local quarantine and regional Vision One alert reads extend the initial device-care slice without claiming OS-wide malware prevention.

[[src/main/device-care/monitor.ts#DeviceCareMonitor]] defaults off and scans one native-selected folder every 60 seconds while Desktop is open. Scans serialize with analysis, cleanup and quarantine. Busy intervals are skipped visibly. Stopping prevents future starts; an already running scan has its separate Cancel control. App exit cancels its owned scan and stops monitoring; restarting requires selection again. It detects after arrival and does not block access or automatically isolate anything. The independent [[endpoint-protection]] sensor remains separate. ClamAV's clamonacc access-blocking mechanism is Linux-only; no privileged daemon or macOS Endpoint Security extension is shipped.

[[src/main/device-care/quarantine.ts#DeviceCareQuarantine]] is Mithril local custody, not a vendor quarantine API. Native per-file confirmation binds a five-minute single-use review, exact digest, owned single-link regular file and selected root. Limits/encrypted-file inspection heuristics are ineligible. Captured bytes are rescanned by the fresh installed ClamAV before mutation. A private 0700 vault stores AES-256-GCM ciphertext, its SHA-256 and a key wrapped by a real OS keyring; basic_text/plaintext fallback is refused. Ciphertext and metadata are synced and decrypted for integrity verification before moving the original. File identity and bytes are revalidated; a substituted or interrupted staged original remains in the private vault for recovery. Quarantine refuses insufficient storage, uses no network and never executes a sample. This cannot stop another process already holding an open handle; full OS containment is outside its scope.

Restoration uses native destination selection and a Cancel-default warning for the detected content. Exclusive file creation refuses overwrite and symlinks, writes mode 0600 and syncs bytes. It never executes restored content. Encrypted copies remain retained, including after restore; permanent purge is not provided. Entries marked pending/recovery-required remain recoverable after interruption. Vault locations are visible in retained recovery locations even if the keyring becomes unavailable. Vault keys require the same OS account/keyring; no export or cross-device recovery is promised. Private staging can temporarily contain a non-executable captured sample during reinspection; a crash preserves it in the private vault for manual recovery.

[[src/main/device-care/vendor.ts#DeviceCareVendor]] detects a fixed macOS Antivirus for Mac application bundle and provides an open-product handoff. Installation is not license, engine health or resident-state proof. Consumer-product status and controls stay unmeasured. Vision One configuration selects an official regional allowlist and wraps the token with the OS keyring; no credentials are read by renderer status calls. The user explicitly requests a single GET to /v3.0/workbench/alerts, with 15-second timeout, redirects rejected and 1 MiB body cap. Only ten projected alert summaries enter the renderer; nextLink is recorded as partial coverage and is never followed. HTTP/provider errors exclude body/credentials. No request runs just by opening the screen. Tenant alerts have no verified local endpoint mapping and cannot authorize local quarantine. Removing the connection removes the saved token but does not revoke it remotely.

Official references: [ClamAV on-access scope](https://docs.clamav.net/manual/OnAccess.html), [Vision One token authentication](https://docs.trendmicro.com/en-us/documentation/article/trend-vision-one-automation-center-authentication), and [Trend Micro API cookbook](https://github.com/trendmicro/tm-v1-api-cookbook). Live tenant authentication and consumer-product controls remain gated on the user's actual product, license and authorized API token. No vendor tenant was contacted during development.

### Extension live receipt

On 2026-10-08 JST, the isolated live adapter fixture verified detection, encrypted custody and exact restoration using ClamAV 1.5.4 and the macOS keyring.

`scripts/verify-device-care-live.mjs` used current signatures against an isolated EICAR fixture. One signature was detected, the original became an encrypted quarantine entry, and restoration reproduced the exact bytes. No customer files or vendor network were used. This adapter receipt does not establish installed UI, Windows/Linux keyrings, access blocking or Vision One authentication.

## Product surface

The sidebar entry 「端末の保護とメンテナンス」 / “Device care” contains Overview, Protection, Storage, and History using the existing Desktop shared components and tokens.

Overview shows the selected local device, OS, provider, coverage, last measurement time, threat findings, and reclaimable-space estimate. Protection offers status, scan scope, progress, findings, and provider-supported response. Storage offers usage analysis, cleanup candidates, exclusions, and a reviewed cleanup plan. History shows runs, partial failures, actions, and available restoration.

Settings holds providers, exclusions, retention, and opt-in schedules. Chat may open a view or propose a plan, but the same service policy and review card apply to both chat and button actions. Scan results remain accessible after cancellation or provider failure, with clear incompleteness and a safe return to the overview. Japanese and English labels must describe observed state without alarming marketing language.

## Capability and evidence model

Every operation is independently classified by platform, provider, permission, and verification state; the presence of an integration never implies active protection.

Proposed `DeviceCareCapability` fields: deviceId, platform, providerId, operation, availability (`available`, `unsupported`, `permission-required`, `not-configured`, `error`), verification (`design-only`, `fixture-tested`, `live-verified`), observedAt, coverage, limitations, and supported restore method. Operations include protection status, scan, cancel, findings read, quarantine, restore, storage analyze, cleanup plan, and cleanup execute.

Runtime measurements separately use `unknown`, `running`, `complete`, `partial`, `cancelled`, or `failed`. A completed scan with zero findings means only that the reported scope yielded zero findings; it never becomes a claim that the whole device is safe. Permission denial, stale provider data, skipped files, archive limits, unavailable mounts, and network failures remain visible. Staleness thresholds are provider-specific and explicit.

## Protection adapters

Desktop orchestrates supported security engines through bounded adapters rather than shipping an unverified detection engine or competing with an existing resident protector.

| Adapter candidate            | Intended scope                                                                 | Implementation gate                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Windows OS protection        | Read protection state and request supported on-demand scans                    | Verify official interfaces, supported OS editions, permissions, detection mapping, cancellation, and existing-provider coexistence |
| macOS OS protection          | Display only officially observable status; link to OS settings where necessary | Verify public interface availability; unavailable scan, quarantine, and resident-state APIs remain unsupported                     |
| Linux / optional ClamAV      | Explicit on-demand file scans where an installed engine is detected            | Verify engine discovery, signature freshness, safe invocation, exit codes, license/distribution, and OS-specific coverage          |
| Trend Micro consumer product | Optional product-specific status or handoff                                    | Verify exact product and license plus official integration availability; no consumer integration is assumed                        |
| Trend Vision One             | Optional tenant-scoped alert evidence                                          | Verify tenant authorization, pagination, source age, endpoint-device identity mapping, and an installed Desktop adapter            |

These are design candidates, not claims of current API support. Official provider documentation and actual OS/provider behavior must be checked during each implementation slice. Engine installation, commercial subscription, privileged helpers, and distribution licenses require separate product decisions before shipping.

The Registry's `docs/cybersecurity-product-verification-2026-10-06.md` records a fixture-tested Vision One Workbench read adapter, one-page coverage, no remediation, and no Desktop installation or live tenant verification. Treat it as a possible evidence source, not as the consumer ウイルスバスター engine or proof of local scanning. No credential, sample, or endpoint data is fetched merely by opening Device care.

### Scan workflow

A user chooses an explicit scan scope, sees required permissions and upload behavior, starts a bounded job, and reviews findings with source and coverage.

Offer selected file/folder and provider-supported quick/full scopes only when supported. Default to local scanning; cloud sample submission and hash lookup are separate opt-in operations with their exact destination and disclosed data. Bound traversal depth, archive expansion, bytes, time, CPU, and concurrency. Do not follow symlinks or mount boundaries implicitly. File access denial yields partial coverage, never silent success.

Each finding carries provider finding ID, engine/signature version where available, observed time, source, severity, path, and permitted responses. Threat severity is preserved from the source and is distinct from the risk of a proposed response. Quarantine and restore use the engine's supported mechanism and a reviewed action plan. If unsupported, offer a provider handoff; do not improvise file deletion as quarantine. Record measured resident protection independently of on-demand scan results.

## Storage analysis and cleanup

Storage analysis is read-only and produces explicit cleanup candidates; deletion always executes a separately reviewed and revalidated plan.

## Incremental storage index

[[src/main/device-care/storage-index.ts#StorageIndex]] reuses unchanged directory listings and short-lived file measurements while keeping cleanup on fresh native checks.

The local 0600 atomic index persists names and directory identity/timestamps only, limited to 20,000 entries, 2,000 directories and 4 MiB. Restart can reuse a listing after fresh directory identity, realpath and timestamp checks but revalidates every child. Only single-link regular files under an uninterrupted native directory watcher may reuse in-memory metadata, for at most 60 seconds. Directories and hard links always receive fresh lstat. At most 256 watchers run while Desktop is open; unavailable/failed watches and expired leases fall back to child metadata checks. Watch notifications are hints, not a lossless change journal. The timed lease and explicit detailed analysis cover missed/coalesced events; no instant or whole-disk freshness is claimed.

Dirty directories are enumerated again. Directory replacement recreates the inode-bound watcher; interrupted listings are not persisted. Changes during analysis mark coverage partial. Reports expose enumeration/reuse/metadata-check counts, cache age policy and update time. Detailed report-ID analysis forces fresh enumeration and file metadata. Temporary-media analysis bypasses the index and cleanup still revalidates native identity, ownership and digest. App exit releases watchers. No index content is uploaded.

### Reuses unchanged files and refreshes changed folders

Warm repeats avoid directory enumeration and unchanged file metadata reads; file-content changes refresh the dirty folder while preserving reuse for an unchanged sibling. Focused analysis forces a fresh measurement and cleanup bypasses the cache.

### Restarts validate metadata and reject corrupt indexes

Restart reuses only validated directory listings, never persisted file measurements. Private permissions and corrupt-index fallback preserve the read-only measurement boundary.

### Falls back without monitoring and expires leases

Unavailable watchers and expired leases always revalidate child metadata, even when directory modification times did not change.

## Desktop cleanup Skill

The installed Registry diskspace Skill runs through a fixed native Device care workflow, with audit, exact candidate selection, review, Trash and free-space receipts.

[[src/main/device-care/storage-skill.ts#installedStorageSkill]] validates the selected local profile, strict installed Skill path, bounded real adapter/definition files, canonical schema/scope and matching versions. The descriptor selects the existing Desktop-generated-media capability; it cannot add paths or execute downloaded shell scripts. [[src/main/device-care/ipc.ts#registerDeviceCareIpc]] admits only the main owner frame and serializes the fresh native audit with other jobs. The first report identifies Skill/version and distinguishes nothing eligible from awaiting selection; it never deletes automatically.

The shared Skills screen remains canonical, with a native wrapper link to Device care. The Storage card installs the Registry Skill into the active profile when requested and starts its native workflow. Existing candidate controls create the exact single-use plan and native Cancel-by-default confirmation; the executor rechecks identity/content, moves to OS Trash, preserves recovery and reports actual available-space measurements. Arbitrary application caches are review-only until independently supported native adapters exist. No cloud Agent local-filesystem authority or shell fallback is introduced.

### Validates installed adapter without expanding authority

Native execution requires a real matching installed Skill/adapter in the selected valid profile. Missing, symlinked, mismatched or broader-scope descriptors cannot authorize cleanup.

### Runs audit before native review

The owner-frame runner measures only the fixed native temporary-media root, records Skill identity and returns an empty or selection-required result. It never invokes Trash or approval merely by starting the Skill.

First scope: Desktop-owned disposable media/temp files and verified regenerable caches, plus user-selected folders for analysis. Show filesystem capacity, measured allocated bytes where supported, unavailable areas, and estimate limitations for shared blocks, hard links, sparse files, and snapshots. Existing [[src/main/media.ts#cleanupTempMediaFiles]] is an internal temp-file cleanup implementation, not whole-device maintenance; migrate its applicable user-visible behavior through the new service without changing its scope implicitly.

| Candidate class                                                         | Default behavior                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Desktop-owned disposable temp/cache                                     | Eligible only after ownership, regeneration, age, and active-use checks                     |
| User downloads and large files                                          | Report for review; excluded from automatic cleanup                                          |
| Duplicate candidates                                                    | Report only; equal content does not establish that one copy is disposable                   |
| System caches, app databases, other applications' data                  | Excluded until a dedicated verified adapter exists                                          |
| Trash, snapshots, backup archives                                       | Display separately where measurable; emptying or deletion is a distinct irreversible action |
| Credentials, chats, project source, model weights, evidence, quarantine | Protected by default; never classify as generic disposable cache                            |

Store exclusions by canonical root and enforce them in the executor. Analysis must not traverse network/removable volumes unless selected. Active sessions, open media, active downloads, and files required by another job remain ineligible. A freshness lease prevents a scan plan from acting on changed content. Where checking active use cannot be made reliable, exclude the candidate instead of guessing.

### Cleanup plan and execution

The cleanup plan shows selected items, reasons, allocated-byte estimates, exclusions, recovery method, and the exact action digest before any mutation.

Proposed candidate identity includes volume ID, canonical root, file identity, type, size, modification time, and content digest when justified. The executor revalidates identity and ownership immediately before acting using platform-safe handle-relative operations; a changed file or replaced symlink is skipped and requires a new plan. Renderer paths and Agent command strings cannot expand approved scope.

Prefer OS Trash only where supported and report its restore limits. Moving items to Trash does not reclaim free space immediately; show “moved to Trash” separately from measured bytes reclaimed. Permanently removing regenerable cache is explicitly irreversible and requires the corresponding reviewed plan. Never claim a backup exists unless it has been created and verified. Report per-item success, failure, skip, and actual post-action free-space measurement; cancel stops future items without claiming to undo completed operations.

## Service and IPC boundary

Renderer controls project typed device-care jobs; the Electron main process validates inputs, owns adapters, and enforces local execution policy.

Proposed modules are `src/shared/device-care.ts`, `src/main/device-care/`, and a DeviceCare renderer screen. These paths are planned, not existing code references. A worker process handles expensive scans/analysis with bounded progress events. Provider secrets use existing main-process secret boundaries, never renderer storage, logs, chat prompts, or general service environments.

Proposed IPC operations: `device-care-capabilities`, `device-care-status`, `device-care-start-scan`, `device-care-analyze-storage`, `device-care-plan`, `device-care-execute`, `device-care-cancel`, and `device-care-history`. Validate sender, device identity, operation enum, job ownership, path scope, payload size, expiry, and progress bounds. Execution accepts an opaque approved plan ID and digest rather than arbitrary commands. IPC names do not confer authority.

The local executor binds a one-use lease to device, exact plan digest, operation, selected identities, limits, and expiry. Existing [[mithril-action-plane#Action envelope]] and [[mithril-action-plane#Desktop approval projection]] describe a dormant projection, so the UI approval card alone cannot unlock cleanup/quarantine. The local policy/executor must enforce the contract, or these operations remain unavailable. Remote alerts never authorize a local action without verified endpoint mapping. Browser consumers may share UI behind adapters but cannot imply native execution capability.

## Scheduling and lifetime

Periodic analysis or scans are opt-in, bounded jobs with visible scope and a quiet unchanged-state policy; scheduled findings do not authorize destructive follow-up.

Default schedules are off. Show whether jobs run only while Desktop is open or through an explicitly installed helper. Suspending, stopping, cancelling, restarting, or updating Desktop must yield an honest job state. Preserve established OS/provider protection independently of Desktop lifetime. Do not register a resident protector or privileged daemon through the general [[service-supervisor]] configuration. A future helper requires verified packaging, narrow authenticated IPC, least privilege, updates, uninstall, and OS consent flows.

Concurrent scan and cleanup jobs use shared resource limits and per-root mutation locks. Suspend cleanup during overlapping scans or active use. Opt-in schedules may repeat approved read-only scope, but cleanup, quarantine, restore, sample upload, and protection-policy changes need action-specific authority. Notify on a new actionable finding, completed requested action, failure, or required user input; offer exclusion controls without hiding prior evidence.

## Local history and privacy

Device-care history is local and private by default, with bounded retention, explicit export, and minimal evidence sufficient to explain each action.

Proposed records contain job/plan IDs, device/provider identity, source time, coverage, digest, approved scope, item outcomes, before/after measurements, and restoration references. Protect storage with OS-appropriate private permissions. Redact full paths from telemetry and chat by default; never retain file contents, tokens, malware samples, or provider raw exports in general logs. Remote evidence and cloud sync require explicit data-scope selection. Give users retention and history-deletion controls; deleting history does not delete quarantine or restore the original files.

## Delivery and acceptance gates

Deliver independent verifiable slices, and promote each capability only after source, automated checks, packaged-client behavior, and actual provider evidence meet its stated scope.

1. Shared contracts, capability presentation, and read-only Desktop-owned storage analysis. Unsupported provider operations stay visibly unavailable.
2. Cleanup planning and locally enforced one-use authority for bounded disposable files, with receipts, cancellation, and restoration behavior.
3. One OS/provider adapter at a time for protection status and on-demand scans. Verify each supported platform in the packaged client.
4. Provider-supported quarantine/restore, explicit remote alert connections, and optional scheduling/helper integration after their individual gates pass.

Required future tests cover denied permissions, stale and partial measurements, zero findings without whole-device safety claims, malformed vendor responses, signature staleness, safe argument passing, symlink replacement, hard links, volume changes, active-use exclusion, protected data, expired/replayed leases, changed plan digests, cancellation, partial mutation, crash recovery, unavailable restore, and actual free-space read-back. Use isolated temporary fixtures and engine-approved harmless test artifacts; never scan or delete user data for automated tests.

Fixtures establish only `fixture-tested`. Live verification requires the relevant installed provider, authorized device/tenant, selected harmless scope, real receipts, and packaged UI read-back. Design integration is complete when these boundaries are cross-linked and validated; shipping is complete only after the implemented slices satisfy their gates.

## Implementation verification

Focused tests protect local filesystem authority, irreversible-action boundaries, bounded scan arguments and honest coverage reporting.

### Protects unselected data

Storage fixtures exclude credentials, nested media and symbolic links from cleanup, and read-only folder analysis cannot mint a cleanup plan.

### Binds single-use approval

The executor rejects changed digests, preserves originals when native approval is cancelled, and refuses replay of a consumed plan.

### Revalidates changed files

A selected file replaced by a symbolic link is skipped without moving or modifying the linked project source.

### Preserves failed cleanup

An OS Trash failure retains the verified original in a private recovery directory and reports a partial result.

### Rejects stale plans

Invalid selections, duplicate candidates and expired leases fail before the executor receives permission to move files.

### Limits scan authority

Hostile-looking folder names remain one executable argument, and the scan adapter never adds removal, quarantine or upload options.

### Keeps partial scan coverage

Zero findings preserve limited coverage; detections, engine failures and cancellation remain distinct outcomes.

### Rejects untrusted callers

Main-process admission rejects other windows and embedded frames before reading status or accessing local files.

### Requires native folder selection

Renderer-provided filesystem paths are invalid scopes, and cancellation of the native folder picker leaves history unchanged.

### Encrypts and restores quarantine

A detected file becomes a digest-verified encrypted entry after native approval, its lease cannot replay, and restoration refuses existing destinations while retaining its encrypted recovery copy.

### Rejects changed quarantine content

Cancelled or changed content and symlink substitution preserve user files; an engine that does not reconfirm the captured bytes cannot authorize removal.

### Bounds session monitoring

Inspection requires explicit native scope, never overlaps jobs, reports busy intervals and stops future inspections when disabled or Desktop exits.

### Confines vendor credentials

Vendor reads use one fixed official regional GET, reject redirects and malformed responses, never follow arbitrary pagination links and refuse weak OS keyrings.

## Disk space visualization

Storage separates whole-volume capacity from bounded folder composition, with coverage labels and keyboard-accessible details.

[[src/main/device-care/storage.ts#DeviceCareStorage]] retains top 12 groups plus Other, logical bytes and deduplicated allocated bytes within existing analysis bounds.

[[src/renderer/src/screens/DeviceCare/StorageVisualization.tsx]] shows separate volume and scope charts. Home analysis is read-only; group selection grants no cleanup authority.

### Preserves measured chart totals

Folder groups retain file counts, logical bytes and allocated bytes across the Other bucket. Symlinks remain excluded.

### Reports valid volume shares

Volume shares reject invalid denominators and never use selected-folder totals as whole-volume occupancy.

### Balances traversal and binds drilldown

Directory cursors rotate in batches of 32 within entry/time/depth bounds. Huge directories cannot monopolize the scan.

Renewed analysis uses a current report ID and revalidates directory identity; renderer paths and symlink replacements cannot expand scope.

### Navigates proportional maps

The accessible treemap preserves measured logical area, offers breadcrumbs and parent navigation, and exposes ranked files and a bounded focused analysis. Path-based cause hints preserve protected data and never mint cleanup authority.

### Cause investigation and Registry workflow

The inspector separates path-based hypotheses from verified growth. Registry's mithril-diskspace-management 1.3.0 adds the installed native Desktop cleanup adapter to metadata audits and fresh complete observation comparisons.

Application data, sources, histories and recovery remain protected; only existing reviewed temporary-media cleanup executes here.
