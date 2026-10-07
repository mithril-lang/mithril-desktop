---
lat:
  require-code-mention: true
---

# Cloud workspace tests

The main-process adapter enforces account-bound consent and a narrow portable-data boundary even when the renderer or network supplies invalid input.

## Dedicated authorization scopes

Cloud Workspace requires explicit workspace read and write scopes; inference and billing credentials are not upgraded or sent to a credential-issuance route.

## Explicit consent

Before opt-in, account identity may be checked but user workspace data cannot be fetched or written.

## Narrow data and fixed transport

Unknown configuration, path, permission and secret fields fail before networking; only explicitly authored operations reach the fixed API with redirects and cookies disabled.

## Account isolation

Replacing the secure-store token, switching local profiles or signing out clears prior consent and requires a new explicit opt-in.

## Late responses and expiry

Responses arriving after logout cannot repopulate user data; expired or refused identity resets the workspace before further requests.

## Offline and owner mismatch

Transient network errors preserve consent for retry without exposing exception secrets, while a snapshot for a different owner resets the session.

## Conflict and history

CAS conflict responses retain their operation ids for shared UI resolution; record history remains bounded to the requested record and rejects injected secret fields.

## Trusted renderer

Only the main Desktop window's trusted top frame may invoke workspace IPC; webviews, secondary windows, remote navigation and other development origins are refused.

## Shared renderer consent

Desktop mounts shared screens and automatically reads through existing scoped main authorization. Observation does not write or grant scopes.

## Renderer account reset

Account-change events and local profile changes clear the prior renderer owner and recheck scoped identity before reading the new workspace. They never replay edits or tools.

## Bot and project import

An explicit preview projects the actual selected bot instructions, user context, model preference, linked project titles and capability preferences. Known device-specific text is excluded and preview makes no cloud write or native mutation.

## Agency contact template review

The packaged shared renderer offers fourteen agency contacts and fills a reviewable draft. Selecting a contact makes no account write; the existing explicit Save action owns publication.

## Cloud sidebar identity

Sidebar reads and writes use only fixed cloud routes, preserve operation IDs, reject nonportable input, and discard records from a different owner.

## Paged native history migration

Completed local chat histories can be reviewed in bounded pages beyond the first fifty; opening a page never uploads history or runs inference.

## Cloud schedule boundaries

Schedule tests cover fixed API routes, owner validation, scope refusal and local-only preview projection.

Credentials, absolute paths, scripts, delivery destinations and native tool grants are excluded. Calendar schedules require an explicit new interval; no background import starts a cloud run.

## Stable disconnected identity

Repeated denied sign-in or missing-scope checks preserve the error without repeatedly remounting the renderer.

Explicit credential changes still notify disconnected renderers and invalidate in-flight requests.

## Security execution boundaries

Security tests require explicit read/run scopes, fixed main-process API routes and tenant-checked snapshots. Renderer requests cannot carry credentials or executor policy.

## Rich Kanban migration snapshot

Read every supported board in SQLite read transactions, retain comments, events, runs and dependencies, preserve stable IDs, and keep paths and active execution locks on the device. Reading does not mutate the source DB or run an agent.

## Native migration owner binding

Bind a device profile's automatic migration source to its first authorized account. A later different account is refused without replacing that binding, while a separate profile can have its own owner.

## Continuous Kanban replica

The rich replica keeps a stable device/profile ID across restart.

SQLite metadata writes use an immediate transaction, compare the full source version, preserve private paths and locks, and store operation receipts in the same transaction. Tests verify replay, stale-write rejection, claimed-task deferral and archival tombstones. Shared reconciliation tests verify disjoint-field merging, conflicting history preservation, restart after lost acknowledgement, deletion conflicts and independent progress while a record is busy.

## Continuous rich chat history

Rich chat archival persists pending operation IDs before sending. Restart recovery reads the same receipt; archived arguments and results never authorize execution.

Tests cover repeated snapshots, native edits, lost acknowledgements, retained cloud conflicts, executable journal rejection and independent progress while another chat is busy. API tests cover rich history CAS and owner-scoped R2 attachment reads/writes.

## Cloud history working cache

Cloud edits and tombstones update the original Desktop timeline through a checked cache without changing agent messages or executions. Native changes invalidate stale overlays; separate baselines prevent stale echo after restart.

## Original Markdown table rendering

Flattened archived tables with multiple inline code values and a consistent GFM separator render as a table through the same Desktop/Web Markdown component. Fenced examples and ambiguous pipes remain literal; stored transcript text is unchanged.

## Remote-only chat reconstruction

Reconstruct complete owner-bound remote timelines into a display cache without modifying agent sessions, messages or executions.

Changed revisions, incomplete pages and changed accounts preserve the previous cache. Metadata tombstones retain original history for recovery.

## Strict Capability skill sources

Strict source reads preserve full skill bodies and refuse invalid encodings or symlinks instead of publishing partial snapshots. Existing native skill operations retain their original behavior.

These cases exercise [[src/main/skills.ts#getSkillContent]] and [[src/main/skills.ts#listInstalledSkills]] using temporary owner-profile roots; no runtime installation occurs during synchronization.

## Capability snapshot identity

Capability snapshots keep configuration bounded and omit credential values and paths. Large duplicate-name Skills stay in original folders and the resource namespace. Owner changes reject reads; no installs run.

## Capability resource transport

Capability resource uploads and downloads use the fixed Mithril API through the main process.

Tests preserve binary content, owner and content-type headers, reject owner switches and unsupported namespaces, discard late account responses, and refuse uploads without workspace write scope. Storage reads never invoke installation or execution.

## Original Skill resource capture

Original Skill resources retain their actual category/directory tree, binary bytes, references and executable attributes without executing any script.

Descriptor-based capture rejects symlinks, invalid Markdown, colliding paths and unavailable interpreters while retaining the source. Tests verify credential exclusions, stable manifests, staging cleanup, upload ordering, repeat-upload avoidance and account-change cancellation.

## Verified Skill resource download

Download tests verify private staging, immutable chunk deduplication, canonical manifests and complete file integrity before native application.

Corrupt chunks, inconsistent file fingerprints and account changes remove staging without altering original files or executing scripts.

## Skill resource file transactions

Native transaction tests verify original relative paths, binary bytes, executable flags, credential retention and private backups.

They cover source conflicts, moved-parent descriptor refusal, symlink refusal, interrupted before/after recovery (including a real interpreter exit after the first replacement), snapshot blocking, changed operation reuse and file/directory replacements.

## Original Skills resource IPC

Original Skills resource requests use validated arguments and trusted renderer checks before main-owned storage access.

Tests verify explicit owner binding, binary forwarding, refusal of untrusted senders, oversized chunks, malformed manifests, endpoint-shaped IDs and invalid owner values. These ports expose no bearer credentials or arbitrary endpoints.

## Repository retained history

Original repository bodies use the fixed authenticated history route. Wrong identities and missing Chat authority reject reads before exposing retained text or replaying work.

The Desktop test verifies the main-owned route and schema checking. D1 and shared client tests cover immutable original bodies, owner isolation, tombstones, descending pagination and concurrent edits.

## Capability migration transport

The native fixed-route API port preserves both configuration and Skill pointer revisions in the migration journal. Malformed guards cannot issue requests.

Shared and D1 tests cover original content proof, simultaneous pointer changes, retained original history, missing acknowledgements and restart with the exact operation ID. Replica tests verify that identical post-migration content settles initial conflicts without native execution.

## Shared original sidebar adapter

The shared original list reads through its adapter without issuing metadata writes, retains stable session IDs for selection and copying, and rolls back a failed inline rename.

Desktop's original context-menu interaction test must still pass through its shared wrapper.

## Cloud sidebar original view and durable metadata

Shared UI tests verify the original menu's project and pin actions, receipt retries after reload, owner changes, newer revisions, and rename acknowledgement recovery without inference or tool replay.

Storage tests verify account isolation, concurrent writes, original IDs across reopen, atomic replacement and rejection of execution requests or mutation of an existing ID. Desktop's wrapper must still pass its original menu interaction and compile with the matching shared tar.

## Owner-bound source sidebar selection

The original shared sidebar opens a checked source ID while it awaits archival. Reading/selecting never invokes cloud inference or an import preview.

Cloud records supersede matching source IDs, including tombstones; account changes remove the source inventory.

## Read-only source inventory

Only an existing owner-bound local profile produces stable source and cloud IDs. Tests reject account changes, another owner, and oversized inventories; reading never binds a source, captures messages, enables sync or starts execution.

## Bidirectional original chat titles

Native and cloud title changes reconcile against independent acknowledged baselines. Concurrent changes preserve both titles; restart recovers a lost acknowledgement with the same operation ID without executing work or acknowledging a newer edit.

## Native title compare and swap

Cloud title application checks the exact captured original title in a SQLite transaction. User title provenance protects against late automatic generation, while stale reads, duplicate titles and older schemas retain source records.

## Reviewed title conflict resolution

Title choices compare the reviewed names, cloud revision and owner/profile before writing. Newer edits require fresh review; lost rename acknowledgements retain their operation IDs without execution.

## Title conflict review interaction

The synchronization disclosure shows both reviewed names and sends only a metadata choice with its account/profile and cloud revision. Account changes hide old titles immediately and ignore late resolution failures.

## Native dependency graph reconciliation

Dependency edits preserve other tasks' edges and schema metadata, reject cycles and inconsistent projections, and defer missing or runnable endpoints. Graph writes share the task's SQLite transaction and roll back on failure or SQLite value coercion.

## Dependency graph replica receipts

Task CAS guards dependency updates and durable receipts recover repeated operations without rewriting graph state. Returned fingerprints match fresh source snapshots; device paths and execution statuses remain unchanged.

## Cloud-created task reconstruction

Cloud-created inactive tasks retain IDs through restoration, receipt replay and later edits using the actual Agent schema fixture. Collisions, missing fields, nonempty history and executable state defer without overwriting source data.

## Kanban device execution state isolation

Cloud projections exclude task/run claim leases, PIDs, process fingerprints, heartbeat state and active-run pointers. Metadata edits preserve these native fields, while receipt fingerprints still detect changes to the full source rows.


## Original Kanban attachment capture

Registered binary attachments retain original IDs, metadata and bytes for each board while private paths stay native.

Immutable captures survive later source edits, verify account/upload receipts, reject unsafe or incomplete files and leave source storage untouched.

## Kanban attachment metadata CAS

Metadata edits preserve attached files and return exact file-aware source fingerprints. Lost acknowledgements retain receipts even after source files disappear. Cloud attachment changes defer without altering task metadata or source rows.

## Task attachment IPC authority

Main-process task chunk requests pin the owner and keep credentials outside the renderer. Unsupported routes and stale owners are rejected; late bytes are discarded after an account change.

## Kanban attachment file writeback

Cloud attachment additions, replacements and removals reconcile with the original SQLite task and fixed attachment directory, preserving source files and retained metadata.

Default and named boards must match fresh source fingerprints. Corrupt bytes, account changes, source conflicts, symlinks and SQL coercion retain the old rows/files. New inactive tasks restore attached bytes without a dispatcher call; retained receipts recover after later file loss.

## Historical task reconstruction

Inactive cloud tasks retain original comments, event payloads, terminal runs, IDs and derived summaries in the original SQLite working copy without executing historical work.

The actual-schema source projection must equal the restored projection and a fresh snapshot. Missing/duplicate identities, unknown fields, summary mismatches, SQL coercion and active run authority retain the whole task. Terminal run additions preserve existing history and native process metadata; receipts prevent duplicated reconstruction.


## Kanban attachment publication barrier

The native snapshot exposes task records only after every private byte upload is acknowledged for the expected owner. Failed publication omits the Kanban scope and preserves source files and attachment rows.

## Task attachment download IPC

Verify bounded chunk reads, metadata checks and staging writes require a mandatory owner and trusted renderer sender.

Invalid owners, identifiers, digests, sizes and byte payloads must be rejected before storage access. No deletion or filesystem path channel is exposed.

## Historical row identity collisions

Original cloud history IDs survive collisions with another task's SQLite keys through private per-table identity mappings.

Actual-schema tests preserve existing rows, remap event/run joins, append original Agent records, and converge both directions. Later cloud IDs may overlap a previously allocated native alias without overwriting it. Receipt replay preserves mappings; scalar JSON payloads decode exactly once. Missing mapped rows or tasks refuse publication rather than falsely acknowledge deleted history.

## Cloud-created board working copy

New named cloud boards restore the original Agent schema and display metadata as a complete directory with their retained receipt.

Tests compare the accepted record with a fresh source snapshot, restore a subsequent task through the original working copy, verify no notifier subscriptions or work are created, and recover exact receipts without duplicate boards.

## Board publication refusal

Existing source directories, symlinks, device execution fields and failed publication retain their original contents and expose no partial board.

## Concurrent board publication

An exclusive directory publication never replaces another writer's board, even when it appears after staging. Retained receipts recover lost acknowledgements, original metadata edits change fingerprints, and another account cannot adopt the receipt.

## Default board initialization

A missing default database is initialized with the original schema and retained receipt while existing display metadata and current-board selection stay unchanged.

Tests compare the acknowledged board with a fresh snapshot, restore a subsequent task, and verify private native metadata bytes survive without being uploaded.

## Default board publication collision

An atomic no-replace link preserves a default database created concurrently by another writer. Incompatible display metadata defers initialization rather than silently resetting it.


## Absent board metadata adoption

Original display metadata can be adopted into an existing DB without changing tasks, execution ownership or the selected board.

## Board metadata crash recovery

A committed preparation hides incomplete sources and recovers the exact operation after filesystem publication fails to return. Different owners and changed operation contents cannot recover it; later task and display edits remain distinct.

## Board metadata concurrent creation

Exclusive publication retains another writer's newly created metadata and private settings, clears the uncommitted preparation, and returns the current source for reconciliation.

## Board metadata preparation refusal

Stale source versions cannot prepare metadata. Existing board files remain untouched, including their private execution directories.


## Unpublished metadata recovery conflict

Prepared metadata that never published cannot override later original task edits. Recovery releases the barrier and returns a source conflict; oversized UTF-8 display data cannot create an unreadable file.

## Original board metadata replacement

Reviewed Agent writers allow source-CAS replacement while preserving private work directories, original permissions and retained prior bytes. Fresh snapshots equal receipts, and unsupported writers defer without replacing originals.

## Original metadata replacement recovery

Interrupted publication recovers the exact prepared operation before source reconciliation. Concurrent original edits win without replacement, and completed receipts remain independent of later native edits.

## New task dependency reconstruction

New inactive tasks restore graph edges with exact source receipts. Missing or runnable endpoints defer without partial task, graph, mapping or receipt writes; private endpoint state stays unchanged.

## Connected task group restoration

Missing connected task nodes restore together with original relationships and history. Incomplete components leave no partial source; fresh snapshots equal the accepted receipt and complete cloud bodies, and retries do not duplicate history.

## Stable task component inventory

Repeated complete task pages must retain owner and revision equality. Wrong owners and changing cloud documents refuse component adoption before native storage writes.

## Connected component attachment restoration

Main-owned group restoration verifies selected files before SQL writes, rolls back refused groups, preserves existing bytes and replays exact receipts offline.


## Attachment identity collision reconciliation

Cloud attachment IDs map to private SQLite keys without overwriting another task. Updates, alias overlaps and removals preserve exact projections; missing mapped rows refuse publication.


## Custom default board initialization

A missing default database adopts custom cloud display metadata through a durable preparation, retaining private workdirs, file permissions, original schema and board selection.

## Custom default board recovery

Interrupted default publication resumes with owner-bound exact receipts. Concurrent original metadata or tasks are retained instead of overwritten, and complete snapshots wait for recovery.


## Native history model reconciliation

Archived model metadata converges in both directions without turns or history duplication. Lost acknowledgements retain operation IDs; simultaneous model edits remain conflicts across later content sync.

## Native model compare and swap

Cloud model metadata replaces only the captured session model, preserving titles and other sessions. Stale or invalid updates retain original data.

## Reviewed model conflict resolution

Model choices compare the displayed values, owner/profile and cloud revision before metadata-only writeback. Lost acknowledgements retain the same operation ID; stale choices cannot overwrite newer edits or execute a turn.

## Model conflict review interaction

The existing synchronization disclosure shows both model values and sends the reviewed choice. Account changes clear private values and suppress late results.

## Original chat archive synchronization

Archive and restore converge in both directions without removing source history. A newly archived source uploads complete items before cloud hiding; lost delete/restore acknowledgements retain their operation IDs and never execute a turn.

## Reviewed chat visibility choices

Older unequal visibility states require an explicit choice rather than inferred deletion. Reviewed values, owner/profile and cloud revision must still match; new revisions and owner changes preserve the original state.

## Native archive compare and swap

Archive writeback changes only the captured original flag under SQLite CAS. Exact row readback rolls back mutated metadata; original messages, project folders and other sessions remain intact, while legacy schemas stay unmodified.

## Complete native archive inventory

Repository capture explicitly includes archived original rows before pagination. The ordinary sidebar stays filtered; unsupported archive values fail capture instead of becoming false visibility states.

## Chat visibility review interaction

Visibility choices use the existing synchronization disclosure with localized states and the correct owner-bound IPC. Title and model resolvers are not called by visibility controls.

## Original compression lineage archive

Archive and restore use the original Agent compression ancestry/descendancy semantics. Entire-lineage readback preserves unrelated conversations and rolls back metadata changes from unexpected triggers.

## Archive synchronization guards

Busy/uncertain cloud work prevents archival metadata dispatch. Changed cloud checkpoints and unsupported legacy archive schemas retain original visibility instead of silently overwriting it.

## Atomic original session deletion intent

Original single/batch deletion writes owner-bound outbox entries in its existing SQLite transaction. Children stay intact, repeated deletion retains operation IDs, and unmapped histories receive no invented cloud owner.

## Deletion rollback preserves original source

Failed original deletion rolls back its staged cloud intent, messages and child-link edits together. Existing source mappings cannot silently move to a different authenticated owner.

## Durable original deletion acknowledgement

First preparation retains its operation ID and base revision across reconnects. Exact owner/session/deletion/revision receipts are required before acknowledging the outbox, and retained receipts remain in original storage.

## Original deletion receipt synchronization

Physical native deletion uses its retained SQLite outbox and exact cloud receipt before acknowledgement. Failed transport suppresses cloud cache reconstruction, while accepted tombstones retain prior cloud history without replaying work.

## Original deletion conflict and account guards

Busy cloud work defers explicit native deletion; CAS conflicts preserve the first operation/revision. Owner changes before acknowledgement cannot consume another account's original intent or expose a pending conversation through cache reconstruction.

## Absent deletion targets stay durably suppressed

A missing cloud target does not erase a durable native deletion marker. Delayed creation is deleted with the original operation ID before its record can be reconstructed as a visible working copy.

## Original deletion response admission

Owner, operation, target deletion state and exact revision are checked again after transport. Invalid replies retain the original intent and suppress cache reconstruction; later valid receipts recover without a new operation.

## Other-owner native deletion isolation

A native profile bound to another owner cannot supply deletion intents to the current account. Its outbox stays intact while verified current-owner cloud working copies remain available.

## Explicit native reconnection recovery

Automatic scoped reads never start authorization. An explicit reconnect after missing/expired Workspace permission opens the original Mithril account card without invoking device sign-in; account change closes it and resumes scoped data reads.

## Transient reconnect never requests authorization

A network failure retries the original transport and never opens an account prompt. No data mutation or permission grant occurs merely from reading or retrying the workspace.


## Original schedule resource transport

The original source transport uses only schedule-source resource IDs and the fixed Mithril API.

Credentials and owner headers stay in main; wrong-owner responses, account changes and missing write scopes refuse access before storing bytes. It does not register a Capability, grant execution or automatically publish Native data.

## Original schedule main execution receipts

Real HTTP A/B/A requests preserve the original occurrence identity and accept only exact current-owner receipts. Foreign, extra, oversized, redirected and lost receipts cannot confirm an execution; mutations never retry.

## Original schedule main execution identity fence

Existing execution grants are required before custody requests. Caller-supplied identities, invalid instants and transitions are refused, and account/profile changes during response streaming discard stale receipts.

## Durable original schedule replica journal

A committed pending operation retains exact source bytes and identity after external failure and store reopening. Files remain private.

## Original schedule replica process lock

Concurrent instances and separate processes cannot reconcile the same scope at once. Abrupt process termination releases the OS lock without deleting committed pending work.

## Original schedule replica identity isolation

Different owners, profiles and timezones have separate journals; wrong-identity writes and reads are refused.

## Original schedule replica storage isolation

Redirected and publicly readable storage is refused without changing the redirect target.

## Bound original schedule source roundtrip

Real source files preserve BOM, CRLF and opaque numeric tokens through portable capture and Native rebind. Missing files stay absent, binding failures have no raw-source fallback, and retained receipts do not overwrite newer authored edits.

## Bound original schedule identity and receipt guards

Wrong owners, stale raw digests, failed token CAS and mismatched restore hashes are refused without acknowledging an unverified source.

## Bound original schedule account invalidation

An account change while binding is awaited prevents the old source from reaching the Native restore boundary.

## Durable original schedule binding targets

A real private SQLite journal preserves the exact bound target after restart, never calls the binder on receipt replay, and refuses changed operation CAS or writes outside the coordinator lock.

## Original schedule directory byte roundtrip

Real temporary script/binary files roundtrip through owner-scoped resource storage and transactional restoration, retaining executable flags, excluding credentials and preserving newer edits when a receipt is replayed after restart.

## Original schedule directory isolation

Foreign owners/profiles, symlink sources and invalidated accounts cannot restore schedule directory files; destination bytes remain intact.

## Original schedule directory integrity

Tampered downloaded chunk bytes are rejected before any destination mutation, retaining original files for recovery.

## Original schedule script binding roundtrip

Real script and monitor files are published, rebound and restored while complete original source retains BOM, CRLF and opaque integers; retrying an acknowledged directory operation preserves newer local edits.

## Original schedule script binding refusal

Escaped paths, excluded or missing scripts, raw remote paths and foreign directory scopes refuse before schedule restoration; portable references must match the verified resource manifest.

## Original schedule workdir roundtrip

Verify actual binary working-directory bytes survive portable source capture and native restoration, raw numeric metadata stays exact, credentials are excluded, and acknowledged retries preserve newer local edits.

## Original schedule workdir conflict and scope

Verify concurrent directory edits, raw cloud paths, foreign job references, relative source paths and stale owners fail without overwriting the local working directory.

## Durable original schedule directory targets

Verify a process stop before filesystem restoration leaves the exact private path and baseline durable, restarted resolution is not invoked, and changed manifests or operation CAS refuse under the required owner lock.

## Original schedule resource composition restart

Verify real script and workdir files restore together through the composed binding and SQLite journal, then a failed source write and restart preserve newer local file edits without recapturing baselines or rebinding destinations.

## Original schedule private runtime claim roundtrip

Verify portable source contains no originating PID or process nonce, destination claim tokens retain opaque integers exactly, and execution admission receives the complete source digest and stable job identities.

## Original schedule runtime claim admission refusal

Verify raw and foreign cloud claims, changed native CAS and unavailable execution authority refuse before native capture or any restoration can occur.

## Original schedule runtime absent native claims

Verify new native inventories receive null runtime claims while preserving original schedule data and account changes refuse further binding work.

## Original schedule shared workdir restart

Verify multiple original jobs sharing one directory restore it once, and a real restored receipt after process restart retains newer local edits even when the source write previously failed.

## Original schedule shared workdir conflict preflight

Verify jobs resolving to one native directory cannot request different cloud snapshots or local baselines; reject before any destination bytes change.

## New Chat before sign-in

Failed identity checks display readable sign-in guidance and no chat operation is sent. Shared tests cover opening without identity/models and retaining the new screen after an initial session link.

## Signed-in scoped authorization recovery

Chat distinguishes missing scoped permission from account expiry and transport errors. Its original shared welcome action offers permission approval or network retry; retries never start device sign-in or change stored credentials.

## Original schedule Agent binding bridge

Real child processes receive exact anchors on stdin for A/B/A profiles; fixed command arguments and account checks surround persistence receipts, and changed accounts cannot accept a receipt.

## Original schedule Agent binding refusal

Foreign identities, extra fields, oversized output, lost acknowledgements and malformed anchors cannot confirm persistence or leak child stderr. Invalid anchors never reach the account guard or child invocation.

## Original schedule Agent preparation

Absent and existing sources use the owned Agent bootstrap through bounded stdin without manually enabling its CLI. Foreign, damaged or lost receipts cannot confirm preparation, and no executor is selected.

## Automatic schedule exact source admission

Both passive restoration and local capture require a fresh authority revision and an exact source digest, including BOM and line-ending bytes; changed or missing source refuses.

## Automatic schedule authority refusal

Absent or changed authority, foreign owner/profile, timezone mismatch and stale identity refuse before source admission.

## Automatic schedule account race

Account changes during custody or source I/O invalidate the result before runtime/resource binding can continue.

## Automatic schedule lifecycle polling

A single lifecycle poller starts without a screen, ignores duplicate starts and stops polling and subscriptions during shutdown.

## Automatic schedule stale lifecycle cancellation

An engine created during an identity switch is discarded before synchronization and the current identity resumes immediately.

## Automatic schedule interrupted lifecycle recovery

Identity changes stop in-flight work without concurrent runs; temporary failures retry on the next poll while retained state remains available.

## Automatic schedule repository outbox durability

A real private SQLite journal preserves pending source-manifest operations across failure and reopening, retains acknowledged documents and refuses unlocked or foreign access.

## Automatic schedule native context guard

Background work validates the retained account/token/profile/generation without network calls and refuses stale or forged context after identity changes.

## Automatic original schedule device roundtrip

The actual coordinator and SQLite journals publish real script/workdir files and restore them on a fresh passive device, retaining original BOM, CRLF and opaque integers before reopening without a second source write.

## Automatic original schedule lost cloud acknowledgement

A cloud peer commits a source manifest then loses its reply; reopening the durable outbox reuses its exact operation and retains one cloud revision and the original Native bytes.

## Automatic original schedule lost native acknowledgement

A Native peer writes the original source but loses its reply; reopening replays the retained receipt and preserves subsequent real script edits before publishing their new snapshot.

## Automatic original schedule concurrent device edits

Independent edits on two devices produce a retained conflict, preserving the receiving device source and the accepted cloud revision rather than silently replacing authored data.

## Original Schedules operation lane

Original screen actions serialize behind the same synchronization lane, verify first-account source ownership and publish committed edits before the next action.

## Original Schedules uncertain admission refusal

Unconfirmed source synchronization, stale profile context or passive-device execution refuse before any original Native action.

## Original Schedules committed write recovery

A committed edit retains its success acknowledgement after network confirmation fails and releases the lane for later operations.

## Original Schedules unified screen

The actual original Desktop component combines colliding original/cloud IDs in one list, preserves cloud model and interval on pause, forwards original controls to Cron IPC, and reloads on account changes without a device dialog.

## Unified Schedules late connection isolation

An old account status reply resolving after the account event cannot construct or query a schedule adapter; only the replacement owner inventory is displayed.

## Original Schedules mirror read recovery

The owner-bound original inventory remains readable during synchronization outages or conflicts; this recovery does not admit edits or execution.

## Original Schedules queued identity isolation

An account switch during an in-flight operation invalidates both its result and queued actions, preventing a prior user's command from running in the new account.

## Original Schedules concrete custody gate

The real coordinator rejects stale profiles, passive or foreign custody and stopped identities while admitting only fresh owner-bound selected-device custody.

## Original Schedules background lane coordination

The lifecycle poll queues behind an in-flight original screen action, avoiding concurrent entry into the same replica journal lock.

## Original workdir identity durability

Opaque working-directory identities remain stable across SQLite journal restart, require the existing cross-process lock, isolate owners and refuse rebinding an identity to another private root.

## Automatic shared workdir device synchronization

The actual coordinator preserves shared folders on a fresh passive device, keeps identical independent folders separate and retains identity across restart.

A receiving-device edit synchronizes back to the original shared root without altering the independent folder; reopening does not republish unchanged source.

## Original workdir alias preflight

One portable folder identity cannot resolve to two private destination roots. The workdir stage rejects that conflict before replacing either folder's actual files.

## Original workdir private runtime preservation

Original authored scripts and outputs synchronize while each device retains its own Cron authority, locked source, ledger and restore receipts, even when the workdir contains that runtime.

## Original workdir private manifest refusal

Incoming manifests containing destination-private state are refused before replacing files. Capturing private synchronization storage itself cannot publish chunks or recurse into its staging area.

## Empty original profile background registration

A fresh profile with no jobs source registers its account-bound timezone through the actual coordinator without creating or restoring jobs. Reopening does not publish another profile revision.

## Empty original profile acknowledgement recovery

A committed profile registration whose reply is lost reuses its retained outbox identity after reopening, with one cloud revision and no native source write.

## Simultaneous empty original profile devices

Two fresh devices use independent private journals and converge on one confirmed profile row without creating jobs. Reopening the passive device does not retain or republish a redundant registration.

## Original parser mailbox background roundtrip

An independent client submits a confirmed request that the actual coordinator processes on a passive device. The result retains raw integer text and reopening does not parse again or create a native jobs source.

An original scheduled resume receipt remains available even when the subsequent execution-policy admission fails; no authored source is restored.

## Original parser mailbox runtime scope

The runtime forwards exact preparation and transition requests to the original Cron ports. Foreign owner requests and a timezone change during parsing cannot return an accepted result.

## Original manual execution receipt boundary

The real child-process transport accepts only the exact request's finite status receipt. Foreign, oversize, extra-field, lost and malformed replies or an account change never report completion or leak child output.

## Original manual execution actual Agent qualification

The Native port executes harmless scripts through the actual Agent in isolated A→B→A homes. Replays retain the original result without changing files or repeating effects; stale full-source versions refuse execution.

The same actual CLI path inspects absent and completed requests without altering source, effect or execution-ledger bytes. Inspection remains valid after the run changed the jobs source version.

This explicit local qualification requires `MITHRIL_AGENT_SOURCE_RUN_CHECKOUT` and `MITHRIL_AGENT_SOURCE_RUN_PYTHON` test inputs. CI without that checkout skips this qualification rather than substituting a fake CLI. It does not prove installed-client or production operation.


## Original manual main transport receipts

Real HTTP A/B/A take/report requests retain exact source and operation identity; malformed, foreign, oversized, redirected and lost replies refuse confirmation without retry. Replayed, empty and source-refused takes cannot grant fresh permission.

## Original manual main transport identity fence

Missing execution grants never upgrade the credential or send manual commands. Spoofed owner fields refuse before transmission; account/profile changes during streamed responses discard stale receipts.


## Original manual durable dispatch fence

An exact request/native-version binding commits unknown before external effects. Reopening after failure cannot dispatch it again; changed identities conflict, and the existing private cross-process lock remains mandatory.

## Original manual durable result reporting

Confirmed native results survive failed reporting. Only exact API acknowledgements mark them reported; repeated acknowledgement is idempotent and contradictory or foreign results cannot replace retained outcomes.

## Original manual journal account isolation

A-B-A journals isolate request identities. Unconfirmed transport outcomes cannot become completion, and a reserved request cannot retain a completed result before its dispatch fence is committed.


## Original manual consumer retained report replay

An actual SQLite journal is reopened after a lost report; only the retained result is resent, without another Agent invocation.

## Original manual consumer nonblocking execution

A long Agent peer releases the replica lock so another store can synchronize. Simultaneous local polls cannot dispatch a second effect.

## Original manual consumer uncertainty retention

Unknown child outcomes and lost take acknowledgements never rerun. Even a faulty peer repeating a fresh take cannot bypass the committed dispatch fence.

## Original manual server uncertainty discovery

A server-unknown request without a native journal is inspection only: exact completed/rejected Agent receipts synchronize, while absent/unknown outcomes remain uncertain and never dispatch.

## Original manual consumer identity admission

Fresh take receipts must match account, profile, timezone, source and custody bindings. Foreign, mismatched and replayed responses cannot reach the Agent port.

## Original manual consumer account change fence

Stopping or switching accounts during execution retains uncertainty and refuses stale reporting; reopening never invokes that request again.


## Original manual lifecycle wiring

The manual lifecycle starts independently of the source poller. A long running peer does not block original screen operations, and stop invalidates the consumer and its captured engine.

Both original execution and retained-result inspection are connected to their main-only ports with the captured engine's active-scope fence.

## Original manual read-only native receipt boundary

Inspection uses the fixed bounded status command, correlates every request field, and admits absent only as inspection data. Foreign, malformed or lost results and account changes refuse confirmation.

## Original manual read-only result recovery

Reopened actual SQLite journals recover exact terminal Agent receipts even after unknown was acknowledged by the API. Failed reporting retains the terminal result for acknowledgement-only replay; effects never repeat.

## Original manual read-only uncertainty fence

Absent, unknown, foreign and unavailable inspection results retain uncertainty without dispatch. An account change during inspection prevents retaining or reporting its stale terminal receipt.

## Original manual concrete source resource binding

The real coordinator, private SQLite and actual script files bind dispatch to synchronized native/source versions. Output returns through ordinary replication; a reopened report obligation never invokes the effect again.

## Original manual concrete stale resource refusal

Changed script bytes, custody revisions, passive devices and stopped contexts refuse the concrete dispatch binding before reaching the Agent port.

## Automatic background connection recovery

Transient startup failures retry scoped connection reads automatically; missing authority and stale identities never enable background synchronization.

The original background reconciler resumes native history after a five-second network retry without another sign-in. Online signals cannot overlap an in-flight read. Account changes suppress late status replies before enable; unmount clears timers/listeners. Missing scope waits for explicit account authorization.

## Canonical Settings command routing

Global settings commands delegate to the active workspace instead of opening a second native preference editor.

The command retains its requested section and explicit profile. An accepted workspace handler mounts no bootstrap modal; cleanup restores the original setup path. A declined handler retains bootstrap setup before the workspace mounts. Explicit different-profile commands now retain their selected target in the canonical workspace. Browser tests separately exercise the original dialog's active/inactive lifecycle without replacing transports.

## Background presentation synchronization

Confirmed cloud presentation preferences apply while Chat is active, without opening Workspace or writing startup defaults.

The always-mounted reconciler applies the initial theme and language, refreshes a revision edited on another device after ten seconds, and does not write preferences. An old-account reply after account change cannot reach Desktop providers.

## Explicit profile Settings routing

A Settings command for another profile uses the same canonical workspace without changing the agent selected in Chat.

The selected profile and section remain fixed while the active Chat profile changes. A later command without an explicit profile uses the then-current Chat profile and remounts the settings provider. Neither path mounts the bootstrap preference editor.

## Profile metadata retains original extension tokens

Changing a profile name preserves exact unknown extension tokens, large opaque integers and unrelated source whitespace.

## Invalid profile metadata is retained

Malformed, duplicate-key or nonobject metadata cannot be overwritten by an appearance mutation, and no temporary file remains.

## Profile metadata avatar capacity

Clearing another appearance field retains the complete original native avatar allowance and extension metadata.

## Profile metadata rejects linked storage

Appearance edits refuse symbolic metadata links without changing their destination.

## Profile metadata sequential appearance edits

Main-process name and color mutations share a synchronous file lane so a later edit cannot discard the preceding field.

## Original profile appearance handlers preserve data

The original public name, color, avatar and removal handlers use the lossless lane, retain extension tokens and return failure while preserving malformed source.

## Original profile metadata resource transport

Profile resources use the fixed main-process API with captured owner and existing scopes. Invalid resource ids, another owner, stale account replies and read-only writes are rejected without expanding credentials.

## Profile metadata downloaded writes preserve concurrent edits

A download captured before a newer local appearance edit cannot replace or delete that edit, and an absent-file baseline cannot overwrite a created file.

## Profile metadata exact replacement and tombstone

A matched source accepts exact cloud bytes including BOM and opaque integers; invalid targets preserve the file, and matched deletion does not accept a stale recreation baseline.

## Profile metadata durable interruption recovery

Real SQLite pending intents recover exact bytes on reopening whether interruption occurred before or after the file rename.

## Profile metadata durable receipt replay

Completed receipts survive reopening, preserve later local edits, and reject a reused operation identity with a changed fingerprint.

## Profile metadata interrupted restoration conflict

Interrupted restoration refuses newer local bytes and retains its pending intent; another owner cannot access that intent.

## Profile metadata receipt binds target bytes

A mismatched target digest or foreign profile receipt is rejected before any original metadata mutation.

## Profile metadata durable tombstone restoration

Physical metadata deletion retains its completed receipt across restart, and replay never deletes a later recreated file.

## Profile metadata replica resource roundtrip

The original file is captured through the resource protocol, exact downloaded bytes are restored, and retained receipts preserve subsequent original edits.

## Profile metadata download fences edits and identity

Edits or authorization changes during resource download prevent native restoration and retain the current original file.

## Profile metadata replica tombstone baseline

Physical deletion produces a stable native tombstone, and documents for another profile never enter the metadata file adapter.

## All-profile metadata inventory preserves selection

The inventory includes empty and populated original profiles without changing the active selection or accessing runtime credential contents. Foreign source bindings remain excluded.

## All-profile metadata inventory retains absent owned sources

Missing current-owner profile identities remain in the metadata inventory so deletion can reconcile; missing foreign identities cannot become this account's sources.

## All-profile metadata inventory rejects linked sources

Linked roots and invalid names are not adopted, and mismatched private binding filenames fail inventory validation.

## Deleted original profile is never recreated by metadata download

When an original profile directory disappears, metadata download is deferred and neither a directory nor a metadata file is recreated.

## All-profile Memory inventory preserves original files

Tests capture default, research and empty owned profiles with original contents and limits, while excluding configuration credentials and avoiding profile selection writes.

## All-profile Memory inventory preserves unavailable sources

Tests retain missing, linked and malformed source data without claiming their Memory IDs as complete or deleting cloud records.

## All-profile Capability configuration capture

Tests capture default, research and empty profiles while excluding a differently owned profile.

Original selection is preserved, public descriptors are keyed to the correct profile, and credential values and install/test execution remain excluded.

## All-profile Capability restore targets its original profile

Tests restore a cloud configuration change into the owned research working copy while the selected default configuration remains byte-identical. No installation is performed.

## All-profile Skill resource capture

Tests publish separate original Skill bytes under default and research profile resource IDs without executing installation.

The existing restoration test also runs for both default and research, checks interruption recovery and receipt replay after later original edits, and rejects altered operation reuse.

## Skill resource upload preserves concurrent original edits

Tests change the original Skill file during chunk upload, refuse the stale repository pointer, retain the newer original bytes, and remove private capture staging.

## All-profile original schedule lifecycle

Runtime tests verify owned present profiles use their original homes without switching selection, adding manual consumers or recreating absent directories. Removing a captured root invalidates later operations.

## All-profile schedule failure isolation

A failed original source does not suppress later owned profiles. Captured engine operations reject an account change before continuing native or cloud work.

## All-profile schedule transport identity

Real HTTP transport tests verify another profile requires an explicit valid captured account context, receipts bind the requested profile, and stale contexts send no custody request.
