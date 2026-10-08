export interface ProtectionStatus {
  platform: string;
  provider: "clamav" | "none";
  available: boolean;
  version: string | null;
  signatureDate: string | null;
  residentProtection: "unknown";
  observedAt: string;
}

export interface StorageCandidate {
  id: string;
  name: string;
  bytes: number;
  modifiedAt: string;
}

export interface StorageGroup {
  name: string;
  kind: "folder" | "files" | "other";
  logicalBytes: number;
  allocatedBytes: number;
  files: number;
}
export interface StorageReport {
  groups: StorageGroup[];
  root: string;
  observedAt: string;
  status: "complete" | "partial" | "cancelled";
  files: number;
  logicalBytes: number;
  allocatedBytes: number;
  capacity: number | null;
  freeBytes: number | null;
  skipped: number;
  candidates: StorageCandidate[];
  largest: { name: string; bytes: number }[];
  cleanupScope: boolean;
}

export interface CleanupPlan {
  id: string;
  digest: string;
  expiresAt: string;
  root: string;
  items: StorageCandidate[];
  bytes: number;
}

export interface CleanupReceipt {
  status: "complete" | "partial" | "cancelled";
  moved: number;
  skipped: number;
  failed: number;
  movedBytes: number;
  freeBytesBefore: number | null;
  freeBytesAfter: number | null;
  recoveryPaths: string[];
}

export interface ScanJob {
  id: string;
  state: "running" | "complete" | "partial" | "failed" | "cancelled";
  root: string;
  startedAt: string;
  finishedAt?: string;
  providerVersion: string;
  findings: string[];
  scannedFiles: number | null;
  output: string;
  error?: string;
}

export interface DeviceCareHistoryEntry {
  id: string;
  kind: "analysis" | "cleanup" | "scan";
  state: string;
  observedAt: string;
  files: number;
  bytes: number;
}

export interface DeviceCareAPI {
  monitorStatus: () => Promise<MonitorStatus>;
  startMonitor: () => Promise<MonitorStatus | null>;
  stopMonitor: () => Promise<MonitorStatus>;
  reviewQuarantine: () => Promise<QuarantineCandidate[]>;
  quarantine: (id: string) => Promise<QuarantineEntry | null>;
  quarantineEntries: () => Promise<QuarantineEntry[]>;
  restoreQuarantine: (id: string) => Promise<boolean>;
  vendorStatus: () => Promise<VendorReport>;
  configureVendor: (region: string, token: string) => Promise<void>;
  disconnectVendor: () => Promise<void>;
  vendorAlerts: () => Promise<VendorReport>;
  openConsumer: () => Promise<void>;
  status: () => Promise<ProtectionStatus>;
  analyze: (scope: "temp" | "folder" | "home") => Promise<StorageReport | null>;
  cancelAnalysis: () => Promise<void>;
  plan: (ids: string[]) => Promise<CleanupPlan>;
  execute: (id: string, digest: string) => Promise<CleanupReceipt>;
  startScan: () => Promise<ScanJob | null>;
  scanJob: () => Promise<ScanJob | null>;
  cancelScan: () => Promise<void>;
  history: () => Promise<DeviceCareHistoryEntry[]>;
  clearHistory: () => Promise<void>;
  recovery: () => Promise<string[]>;
}

export interface MonitorStatus {
  enabled: boolean;
  root: string | null;
  intervalSeconds: number;
  lastRun: string | null;
  error: string | null;
  lifetime: "desktop-session";
}
export interface QuarantineCandidate {
  id: string;
  path: string;
  signature: string;
  bytes: number;
  digest: string;
  expiresAt: string;
}
export interface QuarantineEntry {
  id: string;
  name: string;
  signature: string;
  bytes: number;
  digest: string;
  createdAt: string;
  state: "pending" | "quarantined" | "recovery-required" | "restored";
}
export interface VendorReport {
  consumerInstalled: boolean;
  consumerProtection: "unknown";
  configured: boolean;
  region: string | null;
  observedAt: string;
  alerts: { id: string; name: string; severity: string; updatedAt: string }[];
  coverage: "tenant-first-page";
  nextPage: boolean;
}
