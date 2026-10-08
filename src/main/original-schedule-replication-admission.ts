import { createHash } from "node:crypto";
import type { OriginalScheduleReplicaScope } from "@mithril/workspace/original-schedule-file-replica";
import type { OriginalScheduleRuntimeAdmission } from "./original-schedule-runtime-bindings";
import {
  validOriginalScheduleCustodyReceipt,
  type OriginalScheduleCustodyCommand,
  type OriginalScheduleCustodyReceipt,
} from "./original-schedule-custody";

interface Ports {
  scope: OriginalScheduleReplicaScope;
  authorityRevision: number;
  datasetGeneration?: number;
  check(): Promise<void>;
  custody(
    command: OriginalScheduleCustodyCommand,
  ): Promise<OriginalScheduleCustodyReceipt>;
  source(direction: "capture" | "restore"): Promise<string | null>;
}

/** Admit data only against fresh custody and the exact local or owner-bound cloud source. */
// @lat: [[cloud-workspace#Automatic original schedule replication (draft)]]
export function originalScheduleReplicationAdmission(
  p: Ports,
): OriginalScheduleRuntimeAdmission["assert"] {
  return async (input) => {
    await p.check();
    if (
      input.owner !== p.scope.owner ||
      input.profile !== p.scope.profile ||
      input.timeZone !== p.scope.timeZone
    )
      throw Error("Schedule runtime identity changed");
    const command: OriginalScheduleCustodyCommand = {
      action: "status",
      profile: p.scope.profile,
    };
    const authority = await p.custody(command);
    await p.check();
    if (
      !validOriginalScheduleCustodyReceipt(authority, p.scope.owner, command) ||
      !("revision" in authority) ||
      authority.revision < 1 ||
      authority.revision !== p.authorityRevision ||
      (authority.datasetGeneration ?? 0) !== (p.datasetGeneration ?? 0)
    )
      throw Error("Schedule authority changed");
    const text = await p.source(input.direction);
    await p.check();
    if (
      text === null ||
      createHash("sha256").update(text).digest("hex") !== input.sourceDigest
    )
      throw Error("Schedule source changed");
    // Passive replicas can retain data. Every actual effect still requires a fresh occurrence claim.
  };
}
