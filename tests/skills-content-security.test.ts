import { describe, expect, it, vi } from "vitest";
import { join } from "path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "fs";

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, default: { ...actual, execFileSync }, execFileSync };
});

const { TEST_HOME, TEST_REPO } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  const home = path.join(os.tmpdir(), `hermes-skill-content-${Date.now()}`);
  return {
    TEST_HOME: home,
    TEST_REPO: path.join(home, "hermes-agent"),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_REPO: TEST_REPO,
  HERMES_PYTHON: "python",
  hermesCliArgs: (args: string[] = []) => args,
  getEnhancedPath: () => "",
}));

import {
  listInstalledSkills,
  bundledSkillMarkdown,
  getSkillContent,
  installSkill,
} from "../src/main/skills";

function writeSkill(root: string, content: string): string {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "SKILL.md"), content);
  return root;
}

describe("getSkillContent path validation", () => {
  it("allows default-profile installed skills", () => {
    const skillPath = writeSkill(
      join(TEST_HOME, "skills", "productivity", "planner"),
      "default skill",
    );

    expect(getSkillContent(skillPath)).toBe("default skill");
  });

  it("allows named-profile installed skills", () => {
    const skillPath = writeSkill(
      join(TEST_HOME, "profiles", "work_1-prod", "skills", "ops", "deploy"),
      "profile skill",
    );

    expect(getSkillContent(skillPath)).toBe("profile skill");
  });

  it("allows bundled skills from the hermes-agent repo", () => {
    const skillPath = writeSkill(
      join(TEST_HOME, "hermes-agent", "skills", "writing", "brief"),
      "bundled skill",
    );

    expect(getSkillContent(skillPath)).toBe("bundled skill");
  });

  it("blocks sibling directory prefix tricks", () => {
    const skillPath = writeSkill(
      join(TEST_HOME, "skills-evil", "productivity", "planner"),
      "not allowed",
    );

    expect(getSkillContent(skillPath)).toBe("");
  });

  it("blocks invalid profile names", () => {
    const skillPath = writeSkill(
      join(TEST_HOME, "profiles", "-bad", "skills", "ops", "deploy"),
      "not allowed",
    );

    expect(getSkillContent(skillPath)).toBe("");
  });

  it("blocks arbitrary absolute paths outside Hermes roots", () => {
    const skillPath = writeSkill(
      join(TEST_HOME, "..", `outside-${Date.now()}`, "skill"),
      "not allowed",
    );

    expect(getSkillContent(skillPath)).toBe("");
  });
});

describe("bundled message-spam skill", () => {
  const skillBody = [
    "---",
    "name: message-spam",
    "description: Classify exported SMS and register local indicators.",
    "---",
    "",
    "python message_spam.py collect",
    "python message_spam.py analyze",
    "python message_spam.py register",
    "",
  ].join("\n");

  it("returns the local SKILL.md procedure for Discover", () => {
    writeSkill(
      join(TEST_REPO, "skills", "security", "message-spam"),
      skillBody,
    );

    const markdown = bundledSkillMarkdown("message-spam");
    expect(markdown).toContain("collect");
    expect(markdown).toContain("analyze");
    expect(markdown).toContain("register");
  });

  it("installs a repo-local skill into the profile when the hub cannot resolve it", () => {
    writeSkill(
      join(TEST_REPO, "skills", "security", "message-spam"),
      skillBody,
    );
    execFileSync.mockImplementation(() => {
      const error = new Error("spawn failed") as Error & { stderr?: Buffer };
      error.stderr = Buffer.from(
        "No exact match for 'message-spam'. Did you mean one of these?",
      );
      throw error;
    });

    const result = installSkill("message-spam");
    const installed = join(
      TEST_HOME,
      "skills",
      "security",
      "message-spam",
      "SKILL.md",
    );

    expect(result).toEqual({ success: true });
    expect(existsSync(installed)).toBe(true);
    expect(readFileSync(installed, "utf-8")).toContain("register");
  });
});

describe("strict Capability skill snapshots", () => {
  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Strict Capability skill sources]]
  it("retains the full body and refuses invalid encodings rather than truncating", () => {
    const root = writeSkill(
      join(TEST_HOME, "skills", "snapshot", "long-body"),
      "# Long body\n" + "evidence ".repeat(900),
    );
    expect(getSkillContent(root, true)).toHaveLength(
      readFileSync(join(root, "SKILL.md")).length,
    );
    writeFileSync(join(root, "SKILL.md"), Buffer.from([0xff, 0xfe]));
    expect(() => getSkillContent(root, true)).toThrow("encoding");
    rmSync(root, { recursive: true });
  });
  it("rejects a symlinked source without returning a partial list", () => {
    const root = join(TEST_HOME, "skills", "snapshot", "linked");
    const target = writeSkill(join(TEST_HOME, "symlink-target"), "# Retained");
    mkdirSync(join(root, ".."), { recursive: true });
    symlinkSync(target, root, "dir");
    expect(() => listInstalledSkills(undefined, true)).toThrow("Unsafe skill");
    rmSync(root);
  });
});
