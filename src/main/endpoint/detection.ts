import type { EndpointConnection } from "../../shared/endpoint-protection";
import type { Definitions } from "./definitions";
import { remoteHost } from "./sensors";

export interface Finding {
  rule: string;
  severity: "medium" | "high";
  subject: string;
}
export class FileChangeDetector {
  private roots = new Map<string, Map<string, number>>();
  reset(): void {
    this.roots.clear();
  }
  evaluate(
    root: string,
    file: string,
    pack: Definitions,
    now: number,
  ): Finding | null {
    const changed = this.roots.get(root) || new Map<string, number>();
    for (const [path, time] of changed)
      if (now - time > pack.files.windowMs) changed.delete(path);
    changed.set(file, now);
    if (changed.size > 10000) changed.delete(changed.keys().next().value!);
    this.roots.set(root, changed);
    return changed.size >= pack.files.changes
      ? { rule: "mass-file-change", severity: "high", subject: root }
      : null;
  }
}
export function scanBytes(
  bytes: Buffer,
  subject: string,
  pack: Definitions,
): Finding[] {
  return pack.content
    .filter(
      (r) =>
        bytes.length <= r.maxBytes && bytes.includes(Buffer.from(r.hex, "hex")),
    )
    .map((r) => ({ rule: r.id, severity: r.severity, subject }));
}
interface Contact {
  time: number;
  host: string;
  pid: number;
}
export class ConnectionDetector {
  private previous = new Set<string>();
  private initialized = false;
  private contacts: Contact[] = [];
  reset(): void {
    this.initialized = false;
    this.previous.clear();
    this.contacts = [];
  }
  evaluate(
    rows: EndpointConnection[],
    pack: Definitions,
    now: number,
  ): Finding[] {
    const current = new Set<string>();
    const findings: Finding[] = [];
    for (const r of rows) {
      const host = remoteHost(r.remote);
      // Listening/UDP/ownerless snapshots cannot establish process-attributed contacts.
      if (
        !host ||
        !r.pid ||
        !["ESTABLISHED", "ESTAB", "SYN_SENT", "SYN-SENT"].includes(r.state)
      )
        continue;
      const key = `${r.pid}|${r.process}|${r.local}|${r.remote}`;
      current.add(key);
      if (this.initialized && !this.previous.has(key))
        this.contacts.push({ time: now, host, pid: r.pid });
    }
    this.previous = current;
    this.initialized = true;
    this.contacts = this.contacts
      .filter((c) => now - c.time <= pack.network.windowMs)
      .slice(-10000);
    const pids = new Set(this.contacts.map((c) => c.pid));
    for (const pid of pids) {
      const contacts = this.contacts.filter((c) => c.pid === pid);
      if (new Set(contacts.map((c) => c.host)).size >= pack.network.fanout)
        findings.push({
          rule: "connection-fanout",
          severity: "high",
          subject: `PID ${pid}`,
        });
      for (const host of new Set(contacts.map((c) => c.host))) {
        const times = [
          ...new Set(
            contacts.filter((c) => c.host === host).map((c) => c.time),
          ),
        ];
        if (times.length < pack.network.beaconSamples) continue;
        const intervals = times.slice(1).map((t, i) => t - times[i]);
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        if (
          mean >= 5000 &&
          intervals.every(
            (i) => Math.abs(i - mean) / mean <= pack.network.tolerance,
          )
        )
          findings.push({
            rule: "periodic-contact",
            severity: "medium",
            subject: `PID ${pid} → ${host}`,
          });
      }
    }
    return findings;
  }
}
