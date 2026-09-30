// @vitest-environment node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  home: "",
  stored: new Map<string, string>(),
  failWrite: false,
}));

vi.mock("./installer", () => ({
  get HERMES_HOME() {
    return state.home;
  },
}));
vi.mock("./config", () => ({ invalidateSecretsCache: vi.fn() }));
vi.mock("./agent-config-providers", () => ({
  mirrorFirstPartyAgentProviders: vi.fn(),
}));
vi.mock("./mithril-token-store", () => ({
  readMithrilToken: (profile?: string) =>
    state.stored.get(profile ?? "default") ?? null,
  writeMithrilToken: (profile: string | undefined, token: string) => {
    if (state.failWrite) throw new Error("no secure storage");
    state.stored.set(profile ?? "default", token);
  },
}));

import {
  migrateAllMithrilEnvKeys,
  migrateMithrilEnvKey,
  registerMithrilSecureEnv,
} from "./mithril-sync";
import { registerSecureEnvSource, secureEnvFor } from "./secure-env";

const token = `mf_${"a".repeat(43)}`;
const envPath = (profile?: string): string =>
  join(state.home, ...(profile ? ["profiles", profile] : []), ".env");
const put = (content: string, profile?: string, mode = 0o600): void => {
  mkdirSync(join(envPath(profile), ".."), { recursive: true });
  writeFileSync(envPath(profile), content, { mode });
  chmodSync(envPath(profile), mode);
};

beforeEach(() => {
  state.home = mkdtempSync(join(tmpdir(), "mithril-migrate-"));
  state.stored.clear();
  state.failWrite = false;
  vi.clearAllMocks();
});
afterEach(() => {
  registerSecureEnvSource(null);
  rmSync(state.home, { recursive: true, force: true });
});

describe("migrating a plaintext MITHRIL_API_KEY out of .env", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#Token-only-in-secure-store#Startup migration]]
  it("stores the token, removes only that line, keeps other lines and the mode", () => {
    put(
      `# providers\nOPENAI_API_KEY=sk-keep\nMITHRIL_API_KEY=${token}\nEMPTY=\n\nTAIL=1\n`,
      undefined,
      0o640,
    );
    expect(migrateMithrilEnvKey()).toBe("migrated");
    expect(state.stored.get("default")).toBe(token);
    const after = readFileSync(envPath(), "utf-8");
    expect(after).toBe(
      "# providers\nOPENAI_API_KEY=sk-keep\nEMPTY=\n\nTAIL=1\n",
    );
    expect(after).not.toContain(token);
    expect(after).not.toContain("MITHRIL_API_KEY");
    expect(statSync(envPath()).mode & 0o777).toBe(0o640);
  });

  it("handles export/quotes/CRLF and keeps CRLF on the remaining lines", () => {
    put(`A=1\r\nexport MITHRIL_API_KEY="${token}"\r\nB=2\r\n`);
    expect(migrateMithrilEnvKey()).toBe("migrated");
    expect(state.stored.get("default")).toBe(token);
    expect(readFileSync(envPath(), "utf-8")).toBe("A=1\r\nB=2\r\n");
  });

  it("deletes the file only when nothing else is left", () => {
    put(`MITHRIL_API_KEY=${token}\n`);
    expect(migrateMithrilEnvKey()).toBe("migrated");
    expect(existsSync(envPath())).toBe(false);
    put(`\n# just a comment\nMITHRIL_API_KEY=${token}\n`, "alice");
    expect(migrateMithrilEnvKey("alice")).toBe("migrated");
    expect(existsSync(envPath("alice"))).toBe(true);
  });

  it("does not overwrite a token that is already stored, but still removes the stale line", () => {
    state.stored.set("default", `mf_${"z".repeat(43)}`);
    put(`X=1\nMITHRIL_API_KEY=${token}\n`);
    expect(migrateMithrilEnvKey()).toBe("already-stored");
    expect(state.stored.get("default")).toBe(`mf_${"z".repeat(43)}`);
    expect(readFileSync(envPath(), "utf-8")).toBe("X=1\n");
  });

  it("never loses the token: if the secure store refuses it, .env is untouched", () => {
    const content = `X=1\nMITHRIL_API_KEY=${token}\n`;
    put(content);
    state.failWrite = true;
    expect(migrateMithrilEnvKey()).toBe("failed");
    expect(readFileSync(envPath(), "utf-8")).toBe(content);
    expect(state.stored.size).toBe(0);
  });

  it("leaves a non-mf_ value alone and clears an empty one", () => {
    put("MITHRIL_API_KEY=sk-not-mithril\nX=1\n");
    expect(migrateMithrilEnvKey()).toBe("skipped-not-mithril");
    expect(readFileSync(envPath(), "utf-8")).toContain("sk-not-mithril");
    put("MITHRIL_API_KEY=\nX=1\n");
    expect(migrateMithrilEnvKey()).toBe("cleared-empty");
    expect(readFileSync(envPath(), "utf-8")).toBe("X=1\n");
  });

  it("does nothing without a file or without the key", () => {
    expect(migrateMithrilEnvKey()).toBe("none");
    put("X=1\n# MITHRIL_API_KEY=commented\n");
    expect(migrateMithrilEnvKey()).toBe("none");
    expect(readFileSync(envPath(), "utf-8")).toBe(
      "X=1\n# MITHRIL_API_KEY=commented\n",
    );
  });

  it("migrates the default profile and every named profile at startup", () => {
    put(`MITHRIL_API_KEY=${token}\nA=1\n`);
    put(`MITHRIL_API_KEY=mf_${"b".repeat(43)}\nB=1\n`, "bob");
    put("C=1\n", "carol");
    expect(migrateAllMithrilEnvKeys()).toEqual({
      default: "migrated",
      bob: "migrated",
    });
    expect(state.stored.get("bob")).toBe(`mf_${"b".repeat(43)}`);
    expect(readFileSync(envPath("carol"), "utf-8")).toBe("C=1\n");
  });
});

describe("the agent reads the token from the secure store", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#Token-only-in-secure-store#Agent env is in-memory]]
  it("overlays the stored mf_ token in memory and writes no file", () => {
    state.stored.set("default", token);
    registerMithrilSecureEnv();
    expect(secureEnvFor()).toEqual({ MITHRIL_API_KEY: token });
    expect(secureEnvFor("nobody")).toEqual({});
    expect(existsSync(envPath())).toBe(false);
  });

  it("ignores a stored value that is not an mf_ token", () => {
    state.stored.set("default", "sk-legacy");
    registerMithrilSecureEnv();
    expect(secureEnvFor()).toEqual({});
  });
});
