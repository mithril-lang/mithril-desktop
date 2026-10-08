import { execFile, type ChildProcess } from "child_process";
import { lstat } from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import type { ProtectionStatus, ScanJob } from "../../shared/device-care";

const ENGINES =
  process.platform === "win32"
    ? []
    : [
        "/opt/homebrew/bin/clamscan",
        "/usr/local/bin/clamscan",
        "/usr/bin/clamscan",
      ];

const SCAN_ENV = { LC_ALL: "C", LANG: "C", TMPDIR: tmpdir() };
export function parseEngineVersion(raw: string): {
  version: string;
  signatureDate: string | null;
} {
  const [version, , date] = raw.trim().split("/");
  return {
    version: version || "ClamAV",
    signatureDate:
      date && Number.isFinite(Date.parse(date))
        ? new Date(date).toISOString()
        : null,
  };
}
export function scanArguments(root: string): string[] {
  return [
    "--recursive",
    "--infected",
    "--stdout",
    "--follow-dir-symlinks=0",
    "--follow-file-symlinks=0",
    "--cross-fs=no",
    "--max-filesize=25M",
    "--max-scansize=100M",
    "--max-recursion=16",
    "--max-dir-recursion=16",
    "--alert-exceeds-max=yes",
    "--alert-encrypted=yes",
    "--",
    root,
  ];
}
export function scanResult(
  code: number | null,
  output: string,
  interrupted: boolean,
): Pick<ScanJob, "state" | "findings" | "scannedFiles"> {
  const lines = output.split(/\r?\n/);
  const findings = lines
    .filter((line) => line.endsWith(" FOUND"))
    .slice(0, 100);
  const match = output.match(/Scanned files:\s*(\d+)/);
  // Traversal and archive limits mean a local engine run is bounded coverage, never a full-device guarantee.
  return {
    state: interrupted
      ? "cancelled"
      : code === 0 || code === 1
        ? "partial"
        : "failed",
    findings,
    scannedFiles: match ? Number(match[1]) : null,
  };
}

export class DeviceCareProtection {
  private executable: string | null = null;
  private child: ChildProcess | null = null;
  private current: ScanJob | null = null;
  private cancelled = false;
  async status(): Promise<ProtectionStatus> {
    this.executable = null;
    for (const path of ENGINES) {
      try {
        const stat = await lstat(path);
        if (!stat.isFile() && !stat.isSymbolicLink()) continue;
        const raw = await new Promise<string>((accept, reject) =>
          execFile(
            path,
            ["--version"],
            { timeout: 5000, maxBuffer: 8192, env: SCAN_ENV },
            (error, stdout) => (error ? reject(error) : accept(stdout)),
          ),
        );
        if (!raw.startsWith("ClamAV ")) continue;
        this.executable = path;
        return {
          platform: process.platform,
          provider: "clamav",
          available: true,
          ...parseEngineVersion(raw),
          residentProtection: "unknown",
          observedAt: new Date().toISOString(),
        };
      } catch {
        /* Try the next fixed engine path; do not execute renderer-supplied binaries. */
      }
    }
    return {
      platform: process.platform,
      provider: "none",
      available: false,
      version: null,
      signatureDate: null,
      residentProtection: "unknown",
      observedAt: new Date().toISOString(),
    };
  }
  async verifyCapturedFile(path: string): Promise<boolean> {
    const status = await this.status();
    if (
      !this.executable ||
      !status.signatureDate ||
      Date.now() - Date.parse(status.signatureDate) > 7 * 86400000 ||
      Date.parse(status.signatureDate) > Date.now() + 86400000
    )
      throw Error("Fresh ClamAV signatures required");
    return new Promise((resolve, reject) =>
      execFile(
        this.executable!,
        scanArguments(path),
        { timeout: 60000, maxBuffer: 1024 * 1024, env: SCAN_ENV },
        (error, output) => {
          const code = error ? error.code : 0;
          if (code !== 0 && code !== 1) {
            reject(Error("ClamAV verification failed"));
            return;
          }
          resolve(
            code === 1 &&
              output
                .split(/\r?\n/)
                .some(
                  (line) =>
                    line.startsWith(`${path}: `) &&
                    line.endsWith(" FOUND") &&
                    !line.includes(": Heuristics.Limits") &&
                    !line.includes(": Heuristics.Encrypted"),
                ),
          );
        },
      ),
    );
  }
  job(): ScanJob | null {
    return this.current
      ? { ...this.current, findings: [...this.current.findings] }
      : null;
  }
  cancel(): void {
    if (this.child) {
      this.cancelled = true;
      this.child.kill("SIGTERM");
    }
  }
  async start(root: string): Promise<ScanJob> {
    if (this.child) throw new Error("A scan is already running");
    const status = await this.status();
    if (!this.executable || !status.available)
      throw new Error("ClamAV is not installed");
    if (
      !status.signatureDate ||
      Date.now() - Date.parse(status.signatureDate) > 7 * 86400000 ||
      Date.parse(status.signatureDate) > Date.now() + 86400000
    ) {
      throw new Error(
        "ClamAV signatures are missing or stale; update them with freshclam before scanning",
      );
    }
    const stat = await lstat(root);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Error("Choose a regular file or directory");
    this.cancelled = false;
    this.current = {
      id: randomUUID(),
      state: "running",
      root,
      startedAt: new Date().toISOString(),
      providerVersion: status.version!,
      findings: [],
      scannedFiles: null,
      output: "",
    };
    let stdout = "",
      stderr = "";
    const child = execFile(
      this.executable,
      scanArguments(root),
      {
        timeout: 10 * 60000,
        maxBuffer: 1024 * 1024,
        env: SCAN_ENV,
      },
      (error, output, errors) => {
        const code = error
          ? typeof error.code === "number"
            ? error.code
            : null
          : 0;
        if (!this.current) return;
        this.current = {
          ...this.current,
          ...scanResult(code, output, this.cancelled),
          output: output.slice(-32768),
          finishedAt: new Date().toISOString(),
          error: this.cancelled
            ? undefined
            : code !== 0 && code !== 1
              ? (errors || error?.message || "Scan failed").slice(0, 2000)
              : undefined,
        };
        this.child = null;
      },
    );
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-32768);
      if (this.current) this.current.output = stdout;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
      if (this.current && stderr) this.current.error = stderr;
    });
    return this.job()!;
  }
}
