// @vitest-environment node
// @lat: [[mithril-migration#Legacy inference isolation]]

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LEGACY_KEY = "KOTOBA_API_KEY";
const LEGACY_TOKEN = "kc_pat_legacy.id.mac";
let profileHome: string;

async function config(): Promise<typeof import("./config")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", profileHome);
  return import("./config");
}

beforeEach(() => {
  profileHome = mkdtempSync(join(tmpdir(), "mithril-legacy-isolation-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(profileHome, { recursive: true, force: true });
});

describe("legacy cloud credential isolation", () => {
  it("does not overlay or inject a quarantined keychain credential", async () => {
    writeFileSync(
      join(profileHome, "kotoba-cloud-token.json"),
      JSON.stringify({
        ciphertext: Buffer.from(LEGACY_TOKEN).toString("base64"),
      }),
    );
    const subject = await config();

    expect(subject.readEnv()[LEGACY_KEY]).toBeUndefined();
    expect(subject.secureSpawnEnv()).toEqual({});
  });

  it("does not route an explicitly written legacy name through the old keychain", async () => {
    const subject = await config();
    subject.setEnvValue(LEGACY_KEY, LEGACY_TOKEN);

    expect(readFileSync(join(profileHome, ".env"), "utf8")).toContain(
      `${LEGACY_KEY}=${LEGACY_TOKEN}`,
    );
    expect(subject.secureSpawnEnv()).toEqual({});
    expect(existsSync(join(profileHome, "kotoba-cloud-token.json"))).toBe(
      false,
    );
  });

  it("continues to store supported provider keys in the profile env", async () => {
    const subject = await config();
    subject.setEnvValue("OPENAI_API_KEY", "sk-test");

    expect(subject.readEnv().OPENAI_API_KEY).toBe("sk-test");
  });
});
