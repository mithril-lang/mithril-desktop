import type { MonitorStatus, ScanJob } from "../../shared/device-care";

/** Session-only periodic inspection: no OS access blocking and no automatic response. */
export class DeviceCareMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private generation = 0;
  private value: MonitorStatus = {
    enabled: false,
    root: null,
    intervalSeconds: 60,
    lastRun: null,
    error: null,
    lifetime: "desktop-session",
  };
  constructor(private scan: (root: string) => Promise<ScanJob | null>) {}
  status(): MonitorStatus {
    return { ...this.value };
  }
  start(root: string): MonitorStatus {
    this.stop();
    this.value = {
      ...this.value,
      enabled: true,
      root,
      lastRun: null,
      error: null,
    };
    this.timer = setInterval(() => void this.tick(), 60000);
    this.timer.unref();
    void this.tick();
    return this.status();
  }
  stop(): MonitorStatus {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.value.enabled = false;
    return this.status();
  }
  async tick(): Promise<void> {
    if (this.running || !this.value.enabled || !this.value.root) return;
    this.running = true;
    const generation = this.generation;
    try {
      const job = await this.scan(this.value.root);
      if (generation === this.generation) {
        if (job) {
          this.value.lastRun = job.startedAt;
          this.value.error = null;
        } else
          this.value.error =
            "Another device-care operation is running; this interval was skipped.";
      }
    } catch {
      if (generation === this.generation)
        this.value.error =
          "Folder inspection failed; review the engine, signatures and selected folder.";
    } finally {
      this.running = false;
    }
  }
}
