import { createHash } from "crypto";
import {
  patchOriginalScheduleBindingsText,
  validateOriginalScheduleText,
  type OriginalScheduleBindingPatch,
} from "@mithril/workspace/original-schedule-text";
import type {
  OriginalScheduleNativePort,
  OriginalScheduleNativeSnapshot,
  OriginalScheduleNativeWrite,
  OriginalScheduleReplicaScope,
} from "@mithril/workspace/original-schedule-file-replica";
import { validOriginalCronScope } from "./cron-source-prepare";
import type { OriginalCronFile } from "./cron-source-files";
import type {
  OriginalCronRestoreRequest,
  OriginalCronRestoreResult,
} from "./cron-source-restore";

export interface OriginalScheduleResourceBindings {
  /** Verify and publish referenced resource bytes before returning portable field patches.
   * Explicit private/runtime bindings must cover this source; no raw-source fallback exists. */
  capture(
    source: OriginalCronFile,
  ): Promise<readonly OriginalScheduleBindingPatch[]>;
  /** Resolve verified private resource bytes and one execution authority. Retain a stable,
   * operation-bound target before returning, so receipt replay cannot rebind newer local edits. */
  restore(
    write: OriginalScheduleNativeWrite,
  ): Promise<readonly OriginalScheduleBindingPatch[]>;
}
export interface OriginalScheduleNativeBoundary {
  capture(profile: string): OriginalCronFile | null;
  restore(
    request: OriginalCronRestoreRequest,
  ): Promise<OriginalCronRestoreResult>;
}
const hash = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Main-only exact source adapter for the shared coordinator. Resource binding is mandatory;
 * raw private source never becomes its portable snapshot or a renderer IPC payload.
 */
export class BoundOriginalScheduleNativePort implements OriginalScheduleNativePort {
  private readonly scope: OriginalScheduleReplicaScope;
  constructor(
    scope: OriginalScheduleReplicaScope,
    private readonly boundary: OriginalScheduleNativeBoundary,
    private readonly bindings: OriginalScheduleResourceBindings,
    private readonly assertActive: () => Promise<void>,
  ) {
    if (!validOriginalCronScope({ ...scope, operationId: "scope" }))
      throw Error("Invalid schedule replica identity");
    this.scope = Object.freeze({ ...scope });
  }
  private sameScope(scope: OriginalScheduleReplicaScope): boolean {
    return (
      scope.owner === this.scope.owner &&
      scope.profile === this.scope.profile &&
      scope.timeZone === this.scope.timeZone
    );
  }
  async capture(): Promise<OriginalScheduleNativeSnapshot> {
    await this.assertActive();
    const captured = this.boundary.capture(this.scope.profile);
    if (!captured) {
      await this.assertActive();
      return {
        ...this.scope,
        sourceText: null,
        sourceDigest: null,
        version: null,
      };
    }
    if (
      captured.profile !== this.scope.profile ||
      captured.version !== hash(captured.sourceText)
    )
      throw Error("Original schedule source changed");
    let sourceText: string;
    try {
      const patches = await this.bindings.capture(structuredClone(captured));
      await this.assertActive();
      sourceText = patchOriginalScheduleBindingsText(
        captured.sourceText,
        this.scope.profile,
        this.scope.timeZone,
        patches,
      );
    } catch {
      throw Error("Original schedule resource binding unavailable");
    }
    await this.assertActive();
    return {
      ...this.scope,
      sourceText,
      sourceDigest: hash(sourceText),
      version: captured.version,
    };
  }
  async restore(
    write: OriginalScheduleNativeWrite,
  ): ReturnType<OriginalScheduleNativePort["restore"]> {
    await this.assertActive();
    if (
      !write ||
      !this.sameScope(write) ||
      typeof write.operationId !== "string" ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(write.operationId) ||
      (write.expectedVersion !== null &&
        !/^[a-f0-9]{64}$/.test(write.expectedVersion))
    )
      throw Error("Schedule replica identity changed");
    const request = structuredClone(write);
    validateOriginalScheduleText(
      request.sourceText,
      this.scope.profile,
      this.scope.timeZone,
    );
    let sourceText: string;
    try {
      const patches = await this.bindings.restore(structuredClone(request));
      await this.assertActive();
      sourceText = patchOriginalScheduleBindingsText(
        request.sourceText,
        this.scope.profile,
        this.scope.timeZone,
        patches,
      );
    } catch {
      throw Error("Original schedule resource binding unavailable");
    }
    await this.assertActive();
    const result = await this.boundary.restore({
      owner: this.scope.owner,
      profile: this.scope.profile,
      operationId: request.operationId,
      expectedVersion: request.expectedVersion,
      sourceText,
    });
    await this.assertActive();
    if (
      !result.success ||
      result.receipt.owner !== this.scope.owner ||
      result.receipt.profile !== this.scope.profile ||
      result.receipt.operationId !== request.operationId ||
      result.receipt.version !== hash(sourceText)
    )
      throw Error("Original schedule restoration unconfirmed");
    return {
      ...this.scope,
      operationId: request.operationId,
      version: result.receipt.version,
      sourceDigest: hash(request.sourceText),
    };
  }
}
