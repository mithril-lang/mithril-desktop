import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityResourceTransport } from "@mithril/workspace/capability-resources";
import { originalScheduleResourceId } from "@mithril/workspace/original-schedule-resources";
import type { OriginalScheduleReplicaScope } from "@mithril/workspace/original-schedule-file-replica";
import { validOriginalCronScope } from "./cron-source-prepare";
import {
  captureSkillResources,
  downloadDirectoryResources,
  publishSkillResources,
} from "./skill-resource-snapshot";
import {
  applySkillResources,
  type SkillApplyStatus,
} from "./skill-resource-replica";

export interface OriginalScheduleDirectoryPointer {
  format: "mithril-original-schedule-directory-v1";
  profile: string;
  resourceId: string;
  manifest: string;
}

/** Main-only storage of original scripts/workdir bytes, without starting or admitting jobs. */
// @lat: [[cloud-workspace#Original schedule directory resources (draft)]]
export class OriginalScheduleDirectoryResources {
  private readonly resources: CapabilityResourceTransport;
  private readonly scope: Readonly<OriginalScheduleReplicaScope>;
  private readonly stateRoot: string;
  constructor(
    scope: OriginalScheduleReplicaScope,
    transport: CapabilityResourceTransport,
    private readonly python: string,
    stateRoot: string,
    private readonly assertActive: () => Promise<void>,
  ) {
    if (!validOriginalCronScope({ ...scope, operationId: "scope" }))
      throw Error("Invalid schedule directory scope");
    this.scope = Object.freeze({ ...scope });
    this.resources = transport.forOwner(scope.owner);
    this.stateRoot = join(
      stateRoot,
      "schedule-directories-" +
        createHash("sha256")
          .update(JSON.stringify([scope.owner, scope.profile, scope.timeZone]))
          .digest("hex"),
    );
  }

  matchesScope(scope: OriginalScheduleReplicaScope): boolean {
    return (
      scope.owner === this.scope.owner &&
      scope.profile === this.scope.profile &&
      scope.timeZone === this.scope.timeZone
    );
  }

  async capture(root: string): Promise<{
    pointer: OriginalScheduleDirectoryPointer;
    excluded: number;
    paths: readonly string[];
  }> {
    await this.assertActive();
    const resourceId = await originalScheduleResourceId(this.scope.profile);
    await this.assertActive();
    const initial = lstatSync(root);
    if (!initial.isDirectory() || initial.isSymbolicLink())
      throw Error("Schedule directory source unavailable");
    const capture = captureSkillResources(
      root,
      this.python,
      this.stateRoot,
      resourceId,
    );
    try {
      const current = lstatSync(root);
      if (initial.dev !== current.dev || initial.ino !== current.ino)
        throw Error("Schedule directory source changed");
      await this.assertActive();
      const manifest = await publishSkillResources(
        capture,
        this.resources,
        this.assertActive,
      );
      return {
        pointer: {
          format: "mithril-original-schedule-directory-v1",
          profile: this.scope.profile,
          resourceId,
          manifest,
        },
        excluded: capture.excluded,
        paths: capture.manifest.files.map((file) => file.path),
      };
    } finally {
      capture.dispose();
    }
  }

  /** Compare original destination bytes before restoring; concurrent local edits survive. */
  async restore(
    pointer: OriginalScheduleDirectoryPointer,
    root: string,
    expectedManifest: string,
    operationId: string,
    requiredFiles: readonly string[] = [],
  ): Promise<SkillApplyStatus> {
    if (
      !pointer ||
      typeof pointer !== "object" ||
      Array.isArray(pointer) ||
      Object.keys(pointer).sort().join(",") !==
        "format,manifest,profile,resourceId" ||
      pointer.format !== "mithril-original-schedule-directory-v1" ||
      pointer.profile !== this.scope.profile ||
      typeof pointer.manifest !== "string" ||
      !/^[a-f0-9]{64}$/.test(pointer.manifest) ||
      typeof expectedManifest !== "string" ||
      !/^[a-f0-9]{64}$/.test(expectedManifest) ||
      typeof operationId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,160}$/.test(operationId)
    )
      throw Error("Invalid schedule directory restore");
    await this.assertActive();
    const resourceId = await originalScheduleResourceId(this.scope.profile);
    if (pointer.resourceId !== resourceId)
      throw Error("Schedule directory profile changed");
    await this.assertActive();
    // The caller retains the acknowledged baseline and operation ID in its private journal.
    // Download that immutable baseline rather than recapturing newer destination edits.
    const before = await downloadDirectoryResources(
      resourceId,
      expectedManifest,
      this.resources,
      this.stateRoot,
      this.assertActive,
    );
    try {
      const after = await downloadDirectoryResources(
        resourceId,
        pointer.manifest,
        this.resources,
        this.stateRoot,
        this.assertActive,
      );
      try {
        if (
          !Array.isArray(requiredFiles) ||
          requiredFiles.length > 20000 ||
          !requiredFiles.every(
            (path) =>
              typeof path === "string" &&
              after.manifest.files.some((file) => file.path === path),
          )
        )
          throw Error("Schedule directory required file unavailable");
        await this.assertActive();
        const status = applySkillResources(
          root,
          this.python,
          this.stateRoot,
          operationId,
          JSON.stringify([
            this.scope.owner,
            this.scope.profile,
            this.scope.timeZone,
            expectedManifest,
            pointer.manifest,
          ]),
          before,
          after,
        );
        await this.assertActive();
        return status;
      } finally {
        after.dispose();
      }
    } finally {
      before.dispose();
    }
  }
}
