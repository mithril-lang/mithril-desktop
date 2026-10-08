import { lstat, readFile, realpath } from "fs/promises";
import { join } from "path";
import { listInstalledSkills } from "../skills";
import { isValidNamedProfileName } from "../utils";

export const STORAGE_SKILL = "mithril-diskspace-management";

export async function readStorageSkillAdapter(
  directory: string,
): Promise<{ name: string; version: string }> {
  const file = join(directory, "desktop-adapter.json");
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 4096 ||
    (await realpath(file)) !== file
  )
    throw Error("Invalid diskspace Skill adapter");
  const adapter = JSON.parse(await readFile(file, "utf8"));
  if (
    adapter.schemaVersion !== 1 ||
    adapter.id !== "mithril.diskspace-cleanup/v1" ||
    adapter.skill !== STORAGE_SKILL ||
    adapter.cleanupScope !== "desktop-generated-media" ||
    typeof adapter.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(adapter.version)
  )
    throw Error("Unsupported diskspace Skill adapter");
  const definition = join(directory, "SKILL.md");
  const definitionInfo = await lstat(definition);
  if (
    !definitionInfo.isFile() ||
    definitionInfo.isSymbolicLink() ||
    definitionInfo.size > 65536 ||
    (await realpath(definition)) !== definition
  )
    throw Error("Invalid diskspace Skill definition");
  const content = await readFile(definition, "utf8");
  const header = content.startsWith("---")
    ? content.slice(3, content.indexOf("---", 3))
    : "";
  const version = header.match(
    /^\s+version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m,
  )?.[1];
  if (version !== adapter.version)
    throw Error("Diskspace Skill version does not match its adapter");
  return { name: STORAGE_SKILL, version: adapter.version };
}

export async function installedStorageSkill(
  profile: unknown,
): Promise<{ name: string; version: string } | null> {
  if (
    profile !== undefined &&
    (typeof profile !== "string" ||
      (profile !== "default" && !isValidNamedProfileName(profile)))
  )
    throw Error("Invalid Skill profile");
  const matches = listInstalledSkills(
    profile as string | undefined,
    true,
  ).filter((s) => s.name === STORAGE_SKILL);
  if (!matches.length) return null;
  if (matches.length !== 1)
    throw Error("Ambiguous diskspace Skill installation");
  try {
    return await readStorageSkillAdapter(matches[0].path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
