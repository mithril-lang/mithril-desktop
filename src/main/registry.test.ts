import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, default: { ...actual, execFileSync }, execFileSync };
});
vi.mock("./installer", () => ({
  HERMES_HOME: "/tmp/hermes",
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/tmp/hermes-agent",
  getEnhancedPath: () => "/usr/bin",
  hermesCliArgs: (args: string[]) => ["hermes.py", ...args],
  listMcpServers: () => [],
}));
vi.mock("./skills", () => ({
  installSkill: vi.fn(() => ({ success: true })),
  listInstalledSkills: () => [],
  bundledSkillMarkdown: vi.fn(() => ""),
}));
vi.mock("./profiles", () => ({
  createProfile: vi.fn(() => ({ success: true })),
}));
vi.mock("./soul", () => ({ writeSoul: vi.fn(() => true) }));
vi.mock("./utils", () => ({
  profileHome: () => "/tmp/hermes",
  safeWriteFile: vi.fn(),
}));
vi.mock("./process-options", () => ({ HIDDEN_SUBPROCESS_OPTIONS: {} }));

import {
  fetchRegistry,
  fetchRegistryDetail,
  installRegistryItem,
  validateGitPluginEntry,
} from "./registry";
import { bundledSkillMarkdown } from "./skills";

const artifact = {
  format: "git" as const,
  url: "https://github.com/kotoba-lang/zap-proxy",
  commit: "0c2d30f144b1bbfd58ec20331f0dfceadafbf77d",
};

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe("registry federation", () => {
  beforeEach(() => {
    execFileSync.mockReset();
    vi.unstubAllGlobals();
  });

  it("merges Hermes entries with installable Mithril plugins and skips tools", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("mithril-lang")
          ? response({
              entries: [
                {
                  id: "hermes-zap-proxy",
                  type: "plugin",
                  name: "ZAP Proxy DAST",
                  path: "plugins/hermes-zap-proxy",
                  artifact,
                },
                { id: "catalog-only", type: "tool", name: "Catalog only" },
              ],
            })
          : response({
              entries: [
                {
                  id: "example-skill",
                  type: "skill",
                  name: "Example",
                  path: "skills/example",
                },
              ],
            }),
      ),
    );

    const catalog = await fetchRegistry(true);
    expect(catalog.skills).toHaveLength(1);
    expect(catalog.plugins).toMatchObject([
      {
        id: "hermes-zap-proxy",
        registry: "mithril",
        installable: true,
      },
    ]);
  });

  it("installs only the artifact re-read from the Mithril Registry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          entries: [
            {
              id: "hermes-zap-proxy",
              type: "plugin",
              artifact,
            },
          ],
        }),
      ),
    );
    execFileSync.mockReturnValue(Buffer.from("installed"));

    const result = await installRegistryItem(
      "plugins",
      {
        id: "hermes-zap-proxy",
        name: "ZAP Proxy DAST",
        description: "",
        registry: "mithril",
        artifact: { ...artifact, commit: "f".repeat(40) },
      },
      "default",
    );

    expect(result).toEqual({ success: true });
    expect(execFileSync).toHaveBeenCalledWith(
      "/usr/bin/python3",
      [
        "hermes.py",
        "plugins",
        "install",
        artifact.url,
        "--ref",
        artifact.commit,
        "--enable",
      ],
      expect.objectContaining({ cwd: "/tmp/hermes-agent", timeout: 600000 }),
    );
  });
});

describe("Git plugin artifact validation", () => {
  it("requires HTTPS and an immutable full commit", () => {
    const entry = {
      id: "hermes-zap-proxy",
      type: "plugin" as const,
      name: "ZAP Proxy DAST",
      source: artifact.url,
      artifact,
    };
    expect(validateGitPluginEntry(entry)).toEqual({
      id: entry.id,
      source: artifact.url,
      commit: artifact.commit,
    });
    expect(() =>
      validateGitPluginEntry({
        ...entry,
        artifact: { ...artifact, commit: "main" },
      }),
    ).toThrow("full reviewed commit");
    expect(() =>
      validateGitPluginEntry({
        ...entry,
        source: "http://example.com/x",
        artifact: { ...artifact, url: "http://example.com/x" },
      }),
    ).toThrow("reviewed public GitHub");
  });

  it("opens a bundled skill from its local SKILL.md", async () => {
    vi.mocked(bundledSkillMarkdown).mockReturnValue(
      "python message_spam.py collect\npython message_spam.py analyze\npython message_spam.py register",
    );
    const detail = await fetchRegistryDetail("skills", {
      id: "message-spam",
      name: "message-spam",
      description: "Classify exported SMS and register local indicators.",
      source: "message-spam",
    });
    expect(detail.markdown).toContain("collect");
    expect(detail.markdown).toContain("analyze");
    expect(detail.markdown).toContain("register");
    expect(bundledSkillMarkdown).toHaveBeenCalledWith("message-spam");
  });
});
