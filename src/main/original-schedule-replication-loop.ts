import type { OriginalScheduleReplication } from "./original-schedule-replication";
interface Ports {
  create(): Promise<Pick<OriginalScheduleReplication, "sync" | "stop"> | null>;
  changed(callback: () => void): () => void;
}
/** Single main lifecycle poller: no screen dependency or manual migration action. */
export class OriginalScheduleReplicationLoop {
  private stopped = true;
  private busy = false;
  private generation = 0;
  private engine: Pick<OriginalScheduleReplication, "sync" | "stop"> | null =
    null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  constructor(
    private readonly ports: Ports,
    private readonly interval = 20000,
  ) {}
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribe = this.ports.changed(() => {
      this.generation++;
      this.engine?.stop();
      void this.run();
    });
    this.timer = setInterval(() => void this.run(), this.interval);
    this.timer.unref?.();
    void this.run();
  }
  stop(): void {
    this.stopped = true;
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.engine?.stop();
  }
  async run(): Promise<void> {
    if (this.stopped || this.busy) return;
    this.busy = true;
    const generation = this.generation;
    try {
      const engine = await this.ports.create();
      if (this.stopped || generation !== this.generation) {
        engine?.stop();
        return;
      }
      this.engine = engine;
      await engine?.sync();
    } catch {
      // Original data/outboxes remain durable. Normal account UI owns sign-in;
      // connectivity, busy work and unsupported API versions retry on the poll.
    } finally {
      this.engine?.stop();
      this.engine = null;
      this.busy = false;
      if (!this.stopped && generation !== this.generation) void this.run();
    }
  }
}
