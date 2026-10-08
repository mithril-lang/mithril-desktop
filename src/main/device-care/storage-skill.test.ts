// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, realpath, writeFile, rm, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../skills", () => ({ listInstalledSkills: mocks.list }));
import {
  installedStorageSkill,
  readStorageSkillAdapter,
} from "./storage-skill";

describe("installed native storage Skill", () => {
  let root: string;
  const adapter = {
    schemaVersion: 1,
    id: "mithril.diskspace-cleanup/v1",
    skill: "mithril-diskspace-management",
    version: "1.3.0",
    cleanupScope: "desktop-generated-media",
  };
  beforeEach(async () => {
    root = await realpath(
      await mkdtemp(join(tmpdir(), "diskspace-skill-test-")),
    );
    mocks.list.mockReturnValue([{ name: adapter.skill, path: root }]);
    await writeFile(
      join(root, "desktop-adapter.json"),
      JSON.stringify(adapter),
    );
    await writeFile(
      join(root, "SKILL.md"),
      '---\nname: mithril-diskspace-management\nmetadata:\n  version: "1.3.0"\n---\n',
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  // @lat: [[device-care#Desktop cleanup Skill#Validates installed adapter without expanding authority]]
  it("binds execution to the selected installed profile and fixed native scope", async () => {
    expect(await installedStorageSkill("default")).toEqual({
      name: adapter.skill,
      version: "1.3.0",
    });
    expect(mocks.list).toHaveBeenCalledWith("default", true);
    await expect(installedStorageSkill("../../private")).rejects.toThrow(
      "Invalid Skill profile",
    );
    await writeFile(
      join(root, "desktop-adapter.json"),
      JSON.stringify({ ...adapter, cleanupScope: "/Users/private" }),
    );
    await expect(readStorageSkillAdapter(root)).rejects.toThrow("Unsupported");
  });
  it("rejects version mismatch and symlink adapters and distinguishes absent installations", async () => {
    await writeFile(
      join(root, "SKILL.md"),
      '---\nmetadata:\n  version: "1.2.0"\n---\n',
    );
    await expect(readStorageSkillAdapter(root)).rejects.toThrow("version");
    await rm(join(root, "desktop-adapter.json"));
    expect(await installedStorageSkill("default")).toBeNull();
    await symlink(join(root, "SKILL.md"), join(root, "desktop-adapter.json"));
    await expect(readStorageSkillAdapter(root)).rejects.toThrow("Invalid");
    mocks.list.mockReturnValue([]);
    expect(await installedStorageSkill("default")).toBeNull();
  });
});
