import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
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
import { originalScheduleResourceId } from "@mithril/workspace/original-schedule-resources";
import type { OriginalCronFile } from "./cron-source-files";
import { validOriginalCronScope } from "./cron-source-prepare";
import { OriginalScheduleDirectoryResources } from "./original-schedule-directory-resources";

const prefix = "mithril-schedule-workdir:v1:";
const sha = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
function tokens(
  text: string,
  scope: OriginalScheduleReplicaScope,
): OriginalScheduleBindingToken[] {
  validateOriginalScheduleText(text, scope.profile, scope.timeZone);
  const file = JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
  const jobs = Array.isArray(file) ? file : file.jobs;
  return originalScheduleBindingTokens(
    text,
    scope.profile,
    scope.timeZone,
    jobs
      .filter(
        (job: Record<string, unknown>) =>
          job.workdir !== undefined &&
          job.workdir !== null &&
          job.workdir !== "",
      )
      .map((job: Record<string, unknown>) => {
        if (typeof job.workdir !== "string")
          throw Error("Invalid original workdir binding");
        return { jobId: job.id as string, path: ["workdir"] };
      }),
  );
}
function decode(value: string, profile: string, jobId: string): string {
  if (!value.startsWith(prefix))
    throw Error("Original workdir resource binding required");
  const encoded = value.slice(prefix.length),
    bytes = Buffer.from(encoded, "base64url");
  if (bytes.length > 8192 || bytes.toString("base64url") !== encoded)
    throw Error("Invalid original workdir reference");
  const row = JSON.parse(bytes.toString("utf8"));
  if (
    !Array.isArray(row) ||
    row.length !== 3 ||
    row[0] !== profile ||
    row[1] !== jobId ||
    typeof row[2] !== "string" ||
    !/^[a-f0-9]{64}$/.test(row[2]) ||
    !Buffer.from(JSON.stringify(row)).equals(bytes)
  )
    throw Error("Invalid original workdir reference");
  return row[2] as string;
}

/** Workdir bytes travel through cloud resources; machine paths stay in the private binding journal. */
// @lat: [[cloud-workspace#Original schedule workdir resources (draft)]]
export class OriginalScheduleWorkdirResources {
  private readonly scope: Readonly<OriginalScheduleReplicaScope>;
  constructor(
    scope: OriginalScheduleReplicaScope,
    private readonly directories: OriginalScheduleDirectoryResources,
    private readonly assertActive: () => Promise<void>,
  ) {
    if (
      !validOriginalCronScope({ ...scope, operationId: "scope" }) ||
      !directories.matchesScope(scope)
    )
      throw Error("Invalid original workdir resource scope");
    this.scope = Object.freeze({ ...scope });
  }
  async capture(
    source: OriginalCronFile,
  ): Promise<readonly OriginalScheduleBindingPatch[]> {
    await this.assertActive();
    if (
      source.profile !== this.scope.profile ||
      sha(source.sourceText) !== source.version
    )
      throw Error("Original workdir source changed");
    const selected = tokens(source.sourceText, this.scope);
    const roots = selected.map((token) => {
      const raw: string = JSON.parse(token.sourceText);
      const expanded = raw.startsWith("~/")
        ? resolve(homedir(), raw.slice(2))
        : raw;
      if (!isAbsolute(expanded) || raw.includes("\0"))
        throw Error("Original workdir requires an absolute directory");
      return resolve(expanded);
    });
    const captured = new Map<string, string>();
    const patches: OriginalScheduleBindingPatch[] = [];
    for (let index = 0; index < selected.length; index++) {
      const token = selected[index],
        root = roots[index];
      await this.assertActive();
      let manifest = captured.get(root);
      if (!manifest) {
        const result = await this.directories.capture(root);
        manifest = result.pointer.manifest;
        captured.set(root, manifest);
      }
      await this.assertActive();
      patches.push({
        ...token,
        expectedSourceText: token.sourceText,
        replacementSourceText: JSON.stringify(
          prefix +
            Buffer.from(
              JSON.stringify([this.scope.profile, token.jobId, manifest]),
            ).toString("base64url"),
        ),
      });
    }
    return patches;
  }
  async restore(
    write: OriginalScheduleNativeWrite,
    targetForJob: (
      jobId: string,
      manifest: string,
    ) => Promise<{ root: string; expectedManifest: string }>,
  ): Promise<readonly OriginalScheduleBindingPatch[]> {
    await this.assertActive();
    if (
      write.owner !== this.scope.owner ||
      write.profile !== this.scope.profile ||
      write.timeZone !== this.scope.timeZone ||
      !validOriginalCronScope(write)
    )
      throw Error("Original workdir workspace changed");
    const selected = tokens(write.sourceText, this.scope);
    // Validate the complete source before restoring any directory.
    const refs = selected.map((token) => ({
      token,
      manifest: decode(
        JSON.parse(token.sourceText),
        this.scope.profile,
        token.jobId!,
      ),
    }));
    const resourceId = await originalScheduleResourceId(this.scope.profile);
    // Resolve every durable target before the first filesystem write. Multiple
    // jobs may share one directory, but must agree on both snapshot and baseline.
    const targets = [] as {
      token: OriginalScheduleBindingToken;
      manifest: string;
      root: string;
      expectedManifest: string;
    }[];
    const groups = new Map<string, (typeof targets)[number]>();
    for (const { token, manifest } of refs) {
      await this.assertActive();
      const target = await targetForJob(token.jobId!, manifest);
      await this.assertActive();
      if (!target || !isAbsolute(target.root) || target.root.includes("\0"))
        throw Error("Invalid private workdir target");
      const row = { token, manifest, ...target, root: resolve(target.root) };
      const previous = groups.get(row.root);
      if (
        previous &&
        (previous.manifest !== row.manifest ||
          previous.expectedManifest !== row.expectedManifest)
      )
        throw Error("Conflicting shared original workdir target");
      if (!previous) groups.set(row.root, row);
      targets.push(row);
    }
    for (const { token, manifest, root, expectedManifest } of groups.values()) {
      await this.assertActive();
      const status = await this.directories.restore(
        {
          format: "mithril-original-schedule-directory-v1",
          profile: this.scope.profile,
          resourceId,
          manifest,
        },
        root,
        expectedManifest,
        "workdir_" + sha(JSON.stringify([write.operationId, token.jobId])),
      );
      if (status !== "applied")
        throw Error("Original workdir resource restoration " + status);
      await this.assertActive();
    }
    const patches = targets.map(({ token, root }) => ({
      ...token,
      expectedSourceText: token.sourceText,
      replacementSourceText: JSON.stringify(root),
    }));
    return patches;
  }
}
