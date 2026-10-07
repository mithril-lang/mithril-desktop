import type { OriginalScheduleReplicaScope } from "@mithril/workspace/original-schedule-file-replica";
import { NativeOriginalScheduleReplicaStore } from "./original-schedule-replica-store";
import {
  validOriginalManualResult,
  type OriginalManualCommand,
  type OriginalManualResult,
  type OriginalManualReceipt,
} from "./original-schedule-manual";
import {
  originalManualNativeRequest,
  originalManualWireRequest,
  validOriginalManualBinding,
  type OriginalManualBinding,
  type OriginalManualJournalEntry,
} from "./original-schedule-manual-journal";
import {
  parseOriginalCronRunResult,
  type OriginalCronRunRequest,
  type OriginalCronRunResult,
} from "./cron-source-run";

interface Ports {
  scope: OriginalScheduleReplicaScope;
  store: NativeOriginalScheduleReplicaStore;
  check(): Promise<void>;
  command(input: OriginalManualCommand): Promise<OriginalManualResult>;
  /** Resolve only the freshly synchronized source/resources and selected custody. */
  bind(
    request: OriginalManualReceipt,
    authorityRevision: number,
  ): Promise<OriginalManualBinding>;
  run(request: OriginalCronRunRequest): Promise<OriginalCronRunResult>;
}
/** Fresh dispatch only, with durable results and short journal locks. The original
 * Agent owns effects/watchdogs; neither a replay nor unknown recovery reruns it.
 */
export class OriginalScheduleManualConsumer {
  private busy = false;
  private stopped = false;
  constructor(private readonly ports: Ports) {}
  stop(): void {
    this.stopped = true;
  }
  private async check(): Promise<void> {
    if (this.stopped) throw Error("Manual schedule consumer stopped");
    await this.ports.check();
    if (this.stopped) throw Error("Manual schedule consumer stopped");
  }
  private async locked<T>(action: () => Promise<T>): Promise<T> {
    return this.ports.store.exclusive(this.ports.scope, async () => {
      await this.check();
      return action();
    });
  }
  private async report(entry: OriginalManualJournalEntry): Promise<void> {
    if (entry.reported || entry.status === "reserved") return;
    await this.check();
    const command: OriginalManualCommand = {
      action: "complete",
      ...originalManualWireRequest(entry.binding),
      status: entry.status,
    };
    const receipt = await this.ports.command(command);
    await this.check();
    if (!validOriginalManualResult(receipt, entry.binding.owner, command))
      throw Error("Manual report receipt unconfirmed");
    await this.locked(async () =>
      this.ports.store.acknowledgeManual(
        entry.binding,
        receipt as OriginalManualReceipt,
      ),
    );
  }
  async poll(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    const p = this.ports;
    try {
      const retained = await this.locked(async () =>
        p.store.manualRequests(p.scope),
      );
      for (const entry of retained) await this.report(entry);
      await this.check();
      const command = { action: "take" as const, profile: p.scope.profile };
      const value = await p.command(command);
      await this.check();
      if (
        !validOriginalManualResult(value, p.scope.owner, command) ||
        !("fresh" in value)
      )
        throw Error("Manual take receipt unconfirmed");
      if (!value.fresh || !value.request || !value.authorityRevision) return;
      const binding = await p.bind(value.request, value.authorityRevision);
      await this.check();
      if (
        !validOriginalManualBinding(binding) ||
        binding.owner !== p.scope.owner ||
        binding.profile !== p.scope.profile ||
        binding.timeZone !== p.scope.timeZone ||
        binding.authorityRevision !== value.authorityRevision ||
        !Object.entries(originalManualWireRequest(binding)).every(
          ([key, v]) =>
            value.request![key as keyof OriginalManualReceipt] === v,
        )
      )
        throw Error("Manual source binding unconfirmed");
      const fresh = await this.locked(async () => {
        p.store.reserveManual(binding);
        return p.store.beginManual(binding);
      });
      await this.check();
      if (!fresh) return;
      // No replica lock is held while a script/model may run for a long time.
      let result: OriginalCronRunResult;
      try {
        result = await p.run(originalManualNativeRequest(binding));
      } catch {
        result = { success: false, error: "Manual result unconfirmed" };
      }
      await this.check();
      const confirmed = parseOriginalCronRunResult(
        JSON.stringify(result),
        originalManualNativeRequest(binding),
      );
      const entry = await this.locked(async () => {
        if (confirmed.success)
          return p.store.recordManualResult(binding, confirmed);
        return p.store
          .manualRequests(p.scope)
          .find((e) => e.binding.operationId === binding.operationId)!;
      });
      await this.report(entry);
    } finally {
      this.busy = false;
    }
  }
}
