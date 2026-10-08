export default {
  indexReuse: "Index reused",
  indexFolders: "folder listings",
  indexFiles: "file measurements",
  indexChecked: "Metadata checked",
  indexUpdated: "Analysis updated",
  indexNote:
    "Unchanged watched files use measurements up to 60 seconds old. Restart, expired leases and unavailable watches require metadata checks. Detailed folder analysis forces a fresh measurement. Cleanup always revalidates files.",
  indexChanged:
    "Changes arrived during analysis; measure the affected folder again.",
  folderTrail: "Folder navigation",
  upFolder: "Parent folder",
  measured: "Measured scope",
  partialShort: "Partial measurement",
  moreFolders:
    "Showing the largest 48 entries. Analyze this folder to narrow the scope.",
  inspectFolder: "Analyze this folder in detail",
  causeTitle: "What may be taking space",
  causeNote:
    "A path-based clue, not a verified cause or permission to delete. Compare complete measurements to confirm growth.",
  registryWorkflow: "Registry · storage workflow",
  registryWorkflowNote:
    "Audit → compare growth → check owner and active use → review exact cleanup candidates → measure free space again.",
  mapNote:
    "Tile area represents measured file size. Open a folder to explore its children; tiny items remain in the list.",
  groupNote:
    "Cleanup requires a reviewed plan. Source, chats, credentials, models and recovery data are preserved by default.",
  cause: {
    protected:
      "History, source or recovery data may be present. Preserve it; use the owning application’s retention/export controls.",
    dependencies:
      "Dependencies or development environments may have accumulated. Verify active projects and a reproducible reinstall before proposing cleanup.",
    cache:
      "Possible application cache. Verify its owner, active use and documented regeneration method.",
    logs: "Possible log accumulation. Check retention and the writing process before reviewing archived logs.",
    models:
      "Possible local model weights. Verify configured models and a recoverable download before reviewing unused versions.",
    downloads:
      "Possible downloads or installer archives. Verify the original and recovery copy before selecting exact items.",
    unknown:
      "The name does not establish a cause. Inspect the largest files and their owning application first.",
  },

  analyzeHome: "Analyze home folder (bounded, read-only)",
  diskMap: "Disk space overview",
  occupied: "Used or unavailable",
  occupiedShort: "used / unavailable",
  volumeNote:
    "Whole-volume capacity. Folder analysis below is a separate, bounded measurement.",
  folderMap: "Measured folder breakdown",
  partialMap:
    "Coverage is incomplete. Uninspected files are excluded from the chart.",
  rootFiles: "Files directly in this folder",
  otherGroups: "Other measured groups",
  noMeasuredFiles: "No regular files measured in this scope.",
  allocatedNote:
    "Allocated bytes are estimates. Hard links count once; APFS clones, compression and snapshots may differ from actual free space.",

  vendor:
    "Vendor connections are measured separately from ClamAV. Local quarantine is Mithril custody, not Trend Micro quarantine.",
  monitorTitle: "ClamAV background inspection",
  monitorNote:
    "Inspect the selected folder every 60 seconds while Desktop is open. Stops on app exit; restart requires a new selection. Detection occurs after file arrival, cannot block access, and never quarantines automatically. Large scopes and engine limits may leave gaps.",
  monitorOn: "Background inspection enabled",
  monitorOff: "Background inspection off",
  lastRun: "Last inspection started",
  startMonitor: "Choose folder and enable background inspection",
  stopMonitor: "Stop future inspections",
  quarantineTitle: "Local encrypted quarantine",
  quarantineNote:
    "Review genuine ClamAV detections, confirm the exact file, and preserve an encrypted local copy under the OS keyring. Up to 25 MiB, owned files only. Captured bytes are scanned again before removal. Restore to a new file without overwriting or executing it. An OS-backed keyring is required. Interrupted originals remain in the private device-care-quarantine vault.",
  reviewQuarantine: "Review eligible detections",
  quarantineAction: "Confirm encrypted quarantine…",
  restoreAction: "Choose destination and restore…",
  noQuarantine: "No quarantine entries",
  vendorTitle: "Trend Micro connections",
  consumerNote:
    "Consumer product integration opens the installed Antivirus for Mac. Protection, license and quarantine status remain unmeasured; operate them in the product.",
  consumerInstalled:
    "Antivirus for Mac installation found; protection not measured",
  consumerMissing: "Antivirus for Mac not detected on this platform",
  openConsumer: "Open Trend Micro Antivirus",
  visionNote:
    "Read-only Workbench alerts from the selected tenant region, first page only (up to 10). No sample upload or remote response. Alerts are not mapped to this computer and cannot authorize local quarantine. Token is encrypted in the OS keyring. Reading alerts sends the token only to the selected official regional API.",
  region: "API region",
  apiToken: "Vision One API token",
  saveVendor: "Save connection",
  configured: "Connection saved; authentication unverified",
  notConfigured: "Not configured",
  readAlerts: "Read tenant alerts",
  disconnectVendor: "Remove saved connection",
  moreAlerts: "More pages exist; displayed coverage is partial",
  quarantineState: {
    pending: "Pending / recovery review",
    quarantined: "Quarantined",
    "recovery-required": "Recovery required",
    restored: "Restored (copy retained)",
  },
  title: "Device care",
  subtitle: "Protection and storage maintenance for this computer",
  overview: "Overview",
  protection: "Protection",
  storage: "Storage",
  history: "History",
  local: "This computer · local execution",
  refresh: "Refresh status",
  loading: "Working…",
  engine: "Scan engine",
  missing: "No supported scan engine detected",
  resident: "Resident protection: not measured",
  signature: "Signature database",
  unknown: "Not measured",
  scan: "Choose folder and scan",
  cancel: "Cancel",
  scanNote:
    "Local ClamAV scans only the selected folder. Files are not uploaded. Limits: 25 MiB per file, 100 MiB archive expansion, depth 16, 10 minutes. Symlinks and other volumes are excluded; coverage is partial.",
  setup:
    "Install ClamAV and update its signatures with freshclam, then refresh. No engine is installed automatically.",

  noFindings:
    "No findings reported in the inspected scope. This does not establish whole-device safety.",
  findings: "Engine findings",
  scanned: "Files scanned",
  capacity: "Volume capacity",
  free: "Available space",
  analyzeTemp: "Analyze Desktop temporary files",
  analyzeFolder: "Choose folder to analyze",
  cleanupNote:
    "Cleanup is limited to Desktop-generated temporary media unused for at least 24 hours. Chats, credentials, projects, models and other applications are excluded. Selected folders are analysis only.",
  logical: "File size total",
  allocated: "Allocated bytes (estimate)",
  files: "Files",
  skipped: "Skipped / unavailable",
  candidates: "Temporary files eligible for review",
  empty: "No eligible temporary files",
  largest: "Largest files",
  plan: "Review selected files",
  execute: "Move reviewed files to Trash…",
  selected: "Selected",
  expires: "Plan expires",
  trashNote:
    "The next step opens an OS confirmation for this exact plan. Restore through the OS Trash. Moving to Trash may not reclaim space until Trash is emptied.",
  moved: "Moved to Trash",
  failed: "Failed",
  bytesMoved: "Bytes moved",
  before: "Free space before",
  after: "Free space after",
  recovery: "Retained recovery items",
  recoveryNote:
    "Interrupted or failed cleanup items remain in these private folders. Review them in the file manager; they are not deleted automatically.",
  clear: "Clear local history",
  historyNote:
    "Only run summaries are saved locally (latest 100). File contents, full paths and tokens are not included in history.",
  noHistory: "No recorded runs",
  noAnalysis: "Analyze storage to see measured usage and cleanup candidates.",
  state: {
    running: "Running",
    complete: "Complete",
    partial: "Partial coverage / result",
    cancelled: "Cancelled",
    failed: "Failed",
  },
  kind: {
    analysis: "Storage analysis",
    cleanup: "Cleanup",
    scan: "Virus scan",
  },
} as const;
