import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { resourceExclusions, resourceExcluded } from "./resource-exclusions";
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
  private readonly privatePaths: readonly string[];
  constructor(
    scope: OriginalScheduleReplicaScope,
    transport: CapabilityResourceTransport,
    private readonly python: string,
    stateRoot: string,
    private readonly assertActive: () => Promise<void>,
    privatePaths: readonly string[] = [],
  ) {
    if (!validOriginalCronScope({ ...scope, operationId: "scope" }))
      throw Error("Invalid schedule directory scope");
    if (
      !Array.isArray(privatePaths) ||
      privatePaths.length > 100 ||
      !privatePaths.every(
        (path) => typeof path === "string" && isAbsolute(path),
      )
    )
      throw Error("Invalid private resource roots");
    this.privatePaths = Object.freeze(
      privatePaths.map((path) => resolve(path)),
    );
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

  private exclusions(root: string): readonly string[] {
    const base = resolve(root);
    const paths: string[] = [];
    for (const privatePath of this.privatePaths) {
      if (!isAbsolute(privatePath))
        throw Error("Invalid private resource root");
      const reserved = resolve(privatePath);
      const inside = relative(reserved, base);
      if (
        inside === "" ||
        (!isAbsolute(inside) &&
          inside !== ".." &&
          !inside.startsWith(".." + sep))
      )
        throw Error("Schedule directory is private runtime state");
      const path = relative(base, reserved);
      if (!isAbsolute(path) && path !== ".." && !path.startsWith(".." + sep))
        paths.push(path.split(sep).join("/"));
    }
    return resourceExclusions(paths);
  }

  async capture(root: string): Promise<{
    pointer: OriginalScheduleDirectoryPointer;
    excluded: number;
    paths: readonly string[];
  }> {
    await this.assertActive();
    const resourceId = await originalScheduleResourceId(this.scope.profile);
    await this.assertActive();
    const exclusions = this.exclusions(root);
    const initial = lstatSync(root);
    if (!initial.isDirectory() || initial.isSymbolicLink())
      throw Error("Schedule directory source unavailable");
    const capture = captureSkillResources(
      root,
      this.python,
      this.stateRoot,
      resourceId,
      exclusions,
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
    const exclusions = this.exclusions(root);
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
          [before, after].some((capture) =>
            capture.manifest.files.some((file) =>
              resourceExcluded(file.path, exclusions),
            ),
          )
        )
          throw Error("Schedule directory contains private runtime state");
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
            ...(exclusions.length ? [exclusions] : []),
          ]),
          before,
          after,
          exclusions,
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
