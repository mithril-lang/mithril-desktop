import { createHash } from "node:crypto";
import {
  originalScheduleBindingTokens,
  validateOriginalScheduleText,
  type OriginalScheduleBindingPatch,
  type OriginalScheduleBindingToken,
} from "@mithril/workspace/original-schedule-text";
import type {
  OriginalScheduleNativeWrite,
  OriginalScheduleReplicaScope,
} from "@mithril/workspace/original-schedule-file-replica";
import type { OriginalCronFile } from "./cron-source-files";
import type {
  OriginalScheduleNativeBoundary,
  OriginalScheduleResourceBindings,
} from "./original-schedule-native-port";
import { validOriginalCronScope } from "./cron-source-prepare";

const fields = ["run_claim", "fire_claim", "pending_slot"] as const;
const prefix = "mithril-schedule-runtime:v1:";
const sha = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
function jobs(
  text: string,
  scope: OriginalScheduleReplicaScope,
): Record<string, unknown>[] {
  validateOriginalScheduleText(text, scope.profile, scope.timeZone);
  const file = JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
  return Array.isArray(file) ? file : file.jobs;
}
function tokens(
  text: string,
  scope: OriginalScheduleReplicaScope,
): OriginalScheduleBindingToken[] {
  return originalScheduleBindingTokens(
    text,
    scope.profile,
    scope.timeZone,
    jobs(text, scope).flatMap((job) =>
      fields
        .filter((field) => Object.hasOwn(job, field))
        .map((field) => ({ jobId: job.id as string, path: [field] })),
    ),
  );
}
function portable(
  profile: string,
  token: OriginalScheduleBindingToken,
): string {
  return JSON.stringify(
    prefix +
      Buffer.from(
        JSON.stringify([profile, token.jobId, token.path[0]]),
      ).toString("base64url"),
  );
}
export interface OriginalScheduleRuntimeAdmission {
  /** Must validate the selected execution authority against the exact source. Storage is not authority. */
  assert(
    input: OriginalScheduleReplicaScope & {
      direction: "capture" | "restore";
      sourceDigest: string;
      operationId: string | null;
      jobIds: readonly string[];
    },
  ): Promise<void>;
}

/** Replace native claims with references; never restore another process's PID, nonce or pending slot. */
// @lat: [[cloud-workspace#Original schedule runtime claim binding (draft)]]
export class OriginalScheduleRuntimeBindings implements OriginalScheduleResourceBindings {
  private readonly scope: Readonly<OriginalScheduleReplicaScope>;
  constructor(
    scope: OriginalScheduleReplicaScope,
    private readonly native: Pick<OriginalScheduleNativeBoundary, "capture">,
    private readonly admission: OriginalScheduleRuntimeAdmission,
    private readonly assertActive: () => Promise<void>,
  ) {
    if (!validOriginalCronScope({ ...scope, operationId: "scope" }))
      throw Error("Invalid original runtime scope");
    this.scope = Object.freeze({ ...scope });
  }
  private async admit(
    text: string,
    direction: "capture" | "restore",
    operationId: string | null,
  ): Promise<void> {
    await this.assertActive();
    await this.admission.assert({
      ...this.scope,
      direction,
      operationId,
      sourceDigest: sha(text),
      jobIds: jobs(text, this.scope).map((job) => job.id as string),
    });
    await this.assertActive();
  }
  async capture(
    source: OriginalCronFile,
  ): Promise<readonly OriginalScheduleBindingPatch[]> {
    await this.assertActive();
    if (
      source.profile !== this.scope.profile ||
      source.version !== sha(source.sourceText)
    )
      throw Error("Original runtime source changed");
    await this.admit(source.sourceText, "capture", null);
    return tokens(source.sourceText, this.scope).map((token) => ({
      jobId: token.jobId,
      path: token.path,
      expectedSourceText: token.sourceText,
      replacementSourceText: portable(this.scope.profile, token),
    }));
  }
  async restore(
    write: OriginalScheduleNativeWrite,
  ): Promise<readonly OriginalScheduleBindingPatch[]> {
    await this.assertActive();
    if (
      write.owner !== this.scope.owner ||
      write.profile !== this.scope.profile ||
      write.timeZone !== this.scope.timeZone ||
      !validOriginalCronScope(write)
    )
      throw Error("Original runtime identity changed");
    const selected = tokens(write.sourceText, this.scope);
    if (
      selected.some(
        (token) => token.sourceText !== portable(this.scope.profile, token),
      )
    )
      throw Error("Original runtime reference required");
    await this.admit(write.sourceText, "restore", write.operationId);
    const current = this.native.capture(this.scope.profile);
    if (
      (current?.version ?? null) !== write.expectedVersion ||
      (current &&
        (current.profile !== this.scope.profile ||
          current.version !== sha(current.sourceText)))
    )
      throw Error("Original runtime native source changed");
    const local = new Map(
      (current ? tokens(current.sourceText, this.scope) : []).map((token) => [
        JSON.stringify([token.jobId, token.path]),
        token.sourceText,
      ]),
    );
    await this.assertActive();
    return selected.map((token) => ({
      jobId: token.jobId,
      path: token.path,
      expectedSourceText: token.sourceText,
      replacementSourceText:
        local.get(JSON.stringify([token.jobId, token.path])) ?? "null",
    }));
  }
}
