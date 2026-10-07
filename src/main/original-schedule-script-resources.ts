import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
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
import { validOriginalCronScope } from "./cron-source-prepare";
import type { OriginalCronFile } from "./cron-source-files";
import { OriginalScheduleDirectoryResources } from "./original-schedule-directory-resources";

const prefix = "mithril-schedule-script:v1:";
function portablePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 1024 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}
/** Only authored script fields are selected. Raw token patches retain all other source bytes. */
function tokens(
  text: string,
  scope: OriginalScheduleReplicaScope,
): OriginalScheduleBindingToken[] {
  validateOriginalScheduleText(text, scope.profile, scope.timeZone);
  const file = JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
  const jobs = Array.isArray(file) ? file : file.jobs;
  const fields: { jobId: string; path: string[] }[] = [];
  for (const job of jobs)
    for (const field of ["script", "monitor_script"]) {
      const value = job[field];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "string")
        throw Error("Invalid original script binding");
      fields.push({ jobId: job.id, path: [field] });
    }
  return originalScheduleBindingTokens(
    text,
    scope.profile,
    scope.timeZone,
    fields,
  );
}
function reference(
  value: string,
  profile: string,
): { manifest: string; path: string } {
  if (!value.startsWith(prefix))
    throw Error("Original script resource binding required");
  const encoded = value.slice(prefix.length),
    bytes = Buffer.from(encoded, "base64url");
  if (bytes.length > 8192 || bytes.toString("base64url") !== encoded)
    throw Error("Invalid original script reference");
  const decoded = JSON.parse(bytes.toString("utf8"));
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 3 ||
    decoded[0] !== profile ||
    typeof decoded[1] !== "string" ||
    !/^[a-f0-9]{64}$/.test(decoded[1]) ||
    !portablePath(decoded[2]) ||
    !Buffer.from(JSON.stringify(decoded)).equals(bytes)
  )
    throw Error("Invalid original script reference");
  return { manifest: decoded[1], path: decoded[2] };
}

/** Concrete script-resource stage; workdir/runtime/authority bindings compose outside this stage. */
// @lat: [[cloud-workspace#Original schedule script resources (draft)]]
export class OriginalScheduleScriptResources {
  private readonly scope: Readonly<OriginalScheduleReplicaScope>;
  private readonly scriptsRoot: string;
  constructor(
    scope: OriginalScheduleReplicaScope,
    scriptsRoot: string,
    private readonly directories: OriginalScheduleDirectoryResources,
    private readonly assertActive: () => Promise<void>,
  ) {
    if (
      !validOriginalCronScope({ ...scope, operationId: "scope" }) ||
      !isAbsolute(scriptsRoot) ||
      !directories.matchesScope(scope)
    )
      throw Error("Invalid original script resource scope");
    this.scope = Object.freeze({ ...scope });
    this.scriptsRoot = resolve(scriptsRoot);
  }

  get root(): string {
    return this.scriptsRoot;
  }

  manifestForRestore(write: OriginalScheduleNativeWrite): string | null {
    if (
      write.owner !== this.scope.owner ||
      write.profile !== this.scope.profile ||
      write.timeZone !== this.scope.timeZone ||
      !validOriginalCronScope(write)
    )
      throw Error("Original script workspace changed");
    const selected = tokens(write.sourceText, this.scope);
    if (!selected.length) return null;
    const refs = selected.map((token) =>
      reference(JSON.parse(token.sourceText), this.scope.profile),
    );
    if (refs.some((ref) => ref.manifest !== refs[0].manifest))
      throw Error("Original script snapshot conflict");
    return refs[0].manifest;
  }

  async capture(
    source: OriginalCronFile,
  ): Promise<readonly OriginalScheduleBindingPatch[]> {
    if (
      source.profile !== this.scope.profile ||
      createHash("sha256").update(source.sourceText).digest("hex") !==
        source.version
    )
      throw Error("Original script source changed");
    const selected = tokens(source.sourceText, this.scope);
    if (!selected.length) return [];
    const paths = selected.map((token) => {
      const raw: string = JSON.parse(token.sourceText);
      const expanded = raw.startsWith("~/")
        ? resolve(homedir(), raw.slice(2))
        : raw;
      if (raw.startsWith("~") && !raw.startsWith("~/"))
        throw Error("Unsupported original script path");
      const path = relative(
        this.scriptsRoot,
        resolve(this.scriptsRoot, expanded),
      );
      if (!portablePath(path))
        throw Error("Original script outside profile scripts directory");
      return path;
    });
    await this.assertActive();
    const captured = await this.directories.capture(this.scriptsRoot);
    await this.assertActive();
    if (
      captured.pointer.profile !== this.scope.profile ||
      !paths.every((path) => captured.paths.includes(path))
    )
      throw Error("Original script resource unavailable");
    return selected.map((token, index) => ({
      jobId: token.jobId,
      path: token.path,
      expectedSourceText: token.sourceText,
      replacementSourceText: JSON.stringify(
        prefix +
          Buffer.from(
            JSON.stringify([
              this.scope.profile,
              captured.pointer.manifest,
              paths[index],
            ]),
          ).toString("base64url"),
      ),
    }));
  }

  async restore(
    write: OriginalScheduleNativeWrite,
    expectedScriptsManifest: string,
  ): Promise<readonly OriginalScheduleBindingPatch[]> {
    if (
      write.owner !== this.scope.owner ||
      write.profile !== this.scope.profile ||
      write.timeZone !== this.scope.timeZone ||
      !validOriginalCronScope(write)
    )
      throw Error("Original script workspace changed");
    const selected = tokens(write.sourceText, this.scope);
    if (!selected.length) return [];
    const refs = selected.map((token) =>
      reference(JSON.parse(token.sourceText), this.scope.profile),
    );
    const manifest = refs[0].manifest;
    if (refs.some((ref) => ref.manifest !== manifest))
      throw Error("Original script snapshot conflict");
    await this.assertActive();
    const resourceId = await originalScheduleResourceId(this.scope.profile);
    await this.assertActive();
    const status = await this.directories.restore(
      {
        format: "mithril-original-schedule-directory-v1",
        profile: this.scope.profile,
        resourceId,
        manifest,
      },
      this.scriptsRoot,
      expectedScriptsManifest,
      "scripts_" + createHash("sha256").update(write.operationId).digest("hex"),
      refs.map((ref) => ref.path),
    );
    if (status !== "applied")
      throw Error("Original script resource restoration " + status);
    await this.assertActive();
    return selected.map((token, index) => ({
      jobId: token.jobId,
      path: token.path,
      expectedSourceText: token.sourceText,
      replacementSourceText: JSON.stringify(refs[index].path),
    }));
  }
}
