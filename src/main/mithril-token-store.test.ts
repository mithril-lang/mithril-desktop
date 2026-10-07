import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  base: "",
  available: true,
  backend: "gnome_libsecret",
  failRead: false,
  encryptionsUntilFailure: null as number | null,
}));
vi.mock("electron", () => ({
  app: { getPath: () => join(state.base, "userData") },
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    getSelectedStorageBackend: () => state.backend,
    encryptString: (value: string) => {
      if (state.encryptionsUntilFailure !== null) {
        if (state.encryptionsUntilFailure-- === 0)
          throw new Error("storage failed");
      }
      return Buffer.from(`sealed:${value}`);
    },
    decryptString: (value: Buffer) => {
      if (state.failRead) throw new Error("keychain locked");
      return value.toString().replace(/^sealed:/, "");
    },
  },
}));
vi.mock("./utils", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  return {
    profileHome: (profile?: string) =>
      path.join(state.base, profile ?? "default"),
    safeWriteFile: (file: string, value: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, value);
    },
  };
});

import {
  clearMithrilToken,
  clearCloudAccountToken,
  readCloudAccountToken,
  writeCloudAccountToken,
  writeMithrilAccountCredentials,
  MITHRIL_ACCOUNT_TOKEN_FILE,
  MITHRIL_INSTALL_SECRET_FILE,
  MITHRIL_TOKEN_FILE,
  mithrilStorageProtection,
  readMithrilToken,
  writeMithrilToken,
} from "./mithril-token-store";

beforeAll(() => {
  state.base = mkdtempSync(join(tmpdir(), "mithril-token-test-"));
});
afterAll(() => {
  rmSync(state.base, { recursive: true, force: true });
});

describe("Mithril token at rest", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#Secure Mithril token storage#Profile isolation]]
  it("stores a round-trippable encrypted file in the selected profile only", () => {
    const token = `mf_${"a".repeat(43)}`;
    writeMithrilToken("alice", token);
    expect(readMithrilToken("alice")).toBe(token);
    expect(readMithrilToken("bob")).toBeNull();
    expect(
      readFileSync(join(state.base, "alice", MITHRIL_TOKEN_FILE), "utf8"),
    ).not.toContain(token);
    clearMithrilToken("alice");
    expect(readMithrilToken("alice")).toBeNull();
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Secure Mithril token storage#No plaintext fallback]]
  it("uses the OS keychain format when a real backend exists", () => {
    writeMithrilToken("kc", `mf_${"e".repeat(43)}`);
    const file = JSON.parse(
      readFileSync(join(state.base, "kc", MITHRIL_TOKEN_FILE), "utf8"),
    );
    expect(file.version).toBe(1);
    expect(mithrilStorageProtection("kc")).toBe("keychain");
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Secure Mithril token storage#Reduced-protection file fallback]]
  it.each([
    ["encryption unavailable", { available: false, backend: "unknown" }],
    ["basic_text backend", { available: true, backend: "basic_text" }],
  ])(
    "falls back to an AES-256-GCM file when %s, never plaintext",
    (_name, cfg) => {
      Object.assign(state, cfg);
      const token = `mf_${"f".repeat(43)}`;
      const log = vi.spyOn(console, "log");
      const warn = vi.spyOn(console, "warn");
      const err = vi.spyOn(console, "error");
      try {
        writeMithrilToken("nokr", token);
        expect(mithrilStorageProtection("nokr")).toBe("reduced");
        expect(readMithrilToken("nokr")).toBe(token);
        const raw = readFileSync(
          join(state.base, "nokr", MITHRIL_TOKEN_FILE),
          "utf8",
        );
        expect(raw).not.toContain(token);
        expect(raw).not.toContain(token.slice(3, 20));
        const parsed = JSON.parse(raw);
        expect(parsed).toMatchObject({
          version: 2,
          scheme: "aes-256-gcm-hkdf-sha256",
        });
        // The key material lives outside the profile dir, mode 0600.
        const secretPath = join(
          state.base,
          "userData",
          MITHRIL_INSTALL_SECRET_FILE,
        );
        expect(existsSync(secretPath)).toBe(true);
        if (process.platform !== "win32")
          expect(statSync(secretPath).mode & 0o777).toBe(0o600);
        expect(raw).not.toContain(readFileSync(secretPath, "utf8").trim());
        for (const spy of [log, warn, err]) {
          for (const call of spy.mock.calls)
            expect(JSON.stringify(call)).not.toContain(token);
        }
        // Rewriting reuses the same install secret and a fresh IV/salt.
        const before = parsed.iv;
        writeMithrilToken("nokr", token);
        expect(
          JSON.parse(
            readFileSync(join(state.base, "nokr", MITHRIL_TOKEN_FILE), "utf8"),
          ).iv,
        ).not.toBe(before);
        expect(readMithrilToken("nokr")).toBe(token);
      } finally {
        vi.restoreAllMocks();
        Object.assign(state, { available: true, backend: "gnome_libsecret" });
      }
    },
  );

  it("rejects a tampered fallback file or a missing/changed install secret", () => {
    Object.assign(state, { available: false, backend: "unknown" });
    const token = `mf_${"g".repeat(43)}`;
    writeMithrilToken("tamper", token);
    const file = join(state.base, "tamper", MITHRIL_TOKEN_FILE);
    const good = readFileSync(file, "utf8");
    const parsed = JSON.parse(good);
    const flipped = Buffer.from(parsed.data, "base64");
    flipped[0] ^= 1;
    writeFileSync(
      file,
      JSON.stringify({ ...parsed, data: flipped.toString("base64") }),
    );
    expect(readMithrilToken("tamper")).toBeNull();
    writeFileSync(file, good);
    expect(readMithrilToken("tamper")).toBe(token);
    const secretPath = join(
      state.base,
      "userData",
      MITHRIL_INSTALL_SECRET_FILE,
    );
    const secret = readFileSync(secretPath, "utf8");
    rmSync(secretPath);
    expect(readMithrilToken("tamper")).toBeNull();
    writeFileSync(secretPath, Buffer.alloc(32, 7).toString("base64"));
    expect(readMithrilToken("tamper")).toBeNull();
    writeFileSync(secretPath, secret);
    expect(readMithrilToken("tamper")).toBe(token);
    Object.assign(state, { available: true, backend: "gnome_libsecret" });
  });

  it("still reads a keychain-format file after the keyring disappears only if safeStorage can decrypt it", () => {
    writeMithrilToken("mixed", `mf_${"h".repeat(43)}`);
    state.failRead = true;
    expect(readMithrilToken("mixed")).toBeNull();
    state.failRead = false;
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Secure Mithril token storage#Failed replacement]]
  it("restores the prior encrypted token when a replacement cannot be read back", () => {
    const previous = `mf_${"c".repeat(43)}`;
    writeMithrilToken("carol", previous);
    state.failRead = true;
    expect(() => writeMithrilToken("carol", `mf_${"d".repeat(43)}`)).toThrow(
      "The keychain could not read the stored token.",
    );
    state.failRead = false;
    expect(readMithrilToken("carol")).toBe(previous);
  });
});

import { CloudWorkspace } from "./cloud-workspace";

describe("installation cloud account identity", () => {
  beforeEach(() => {
    state.encryptionsUntilFailure = null;
    rmSync(join(state.base, "userData", MITHRIL_ACCOUNT_TOKEN_FILE), {
      force: true,
    });
    Object.assign(state, {
      available: true,
      backend: "gnome_libsecret",
      failRead: false,
    });
  });

  it("preserves the selected legacy account across new profiles without copying credentials into them", () => {
    const token = `mf_${"j".repeat(43)}`;
    writeMithrilToken("upgrade-source", token);
    expect(readCloudAccountToken("upgrade-source")).toBe(token);
    expect(readCloudAccountToken("cloud-only-profile")).toBe(token);
    expect(readMithrilToken("cloud-only-profile")).toBeNull();
    expect(existsSync(join(state.base, "cloud-only-profile"))).toBe(false);
    // Switching to a profile with another legacy identity does not switch account.
    writeMithrilToken("other-owner", `mf_${"k".repeat(43)}`);
    expect(readCloudAccountToken("other-owner")).toBe(token);
  });

  it("persists sign-out across profile changes and fresh reads, then accepts explicit sign-in", () => {
    writeMithrilToken("retained-owner", `mf_${"l".repeat(43)}`);
    readCloudAccountToken("retained-owner");
    clearCloudAccountToken();
    expect(readCloudAccountToken("retained-owner")).toBeNull();
    expect(readCloudAccountToken("other-owner")).toBeNull();
    const next = `mf_${"m".repeat(43)}`;
    writeCloudAccountToken(next);
    expect(readCloudAccountToken("retained-owner")).toBe(next);
  });

  it("does not fall back to legacy credentials when account ciphertext is unreadable", () => {
    const token = `mf_${"n".repeat(43)}`;
    writeCloudAccountToken(token);
    writeMithrilToken("legacy-readable", `mf_${"o".repeat(43)}`);
    const path = join(state.base, "userData", MITHRIL_ACCOUNT_TOKEN_FILE);
    writeFileSync(path, "broken record");
    expect(readCloudAccountToken("legacy-readable")).toBeNull();
  });

  it("keeps account encryption and rollback when the system keyring is unavailable", () => {
    state.available = false;
    const token = `mf_${"p".repeat(43)}`;
    writeCloudAccountToken(token);
    const path = join(state.base, "userData", MITHRIL_ACCOUNT_TOKEN_FILE);
    expect(readFileSync(path, "utf8")).not.toContain(token);
    expect(readCloudAccountToken("new")).toBe(token);
    const previous = readFileSync(path, "utf8");
    state.available = true;
    state.failRead = true;
    expect(() => writeCloudAccountToken(`mf_${"q".repeat(43)}`)).toThrow();
    state.failRead = false;
    expect(readFileSync(path, "utf8")).toBe(previous);
    expect(readCloudAccountToken("new")).toBe(token);
  });
  it("rolls back both account and native provider if the second encrypted write fails", () => {
    const old = `mf_${"r".repeat(43)}`;
    writeMithrilAccountCredentials("atomic", old);
    const paths = [
      join(state.base, "atomic", MITHRIL_TOKEN_FILE),
      join(state.base, "userData", MITHRIL_ACCOUNT_TOKEN_FILE),
    ];
    const prior = paths.map((path) => readFileSync(path, "utf8"));
    state.encryptionsUntilFailure = 1;
    expect(() =>
      writeMithrilAccountCredentials("atomic", `mf_${"s".repeat(43)}`),
    ).toThrow();
    expect(paths.map((path) => readFileSync(path, "utf8"))).toEqual(prior);
    expect(readCloudAccountToken("atomic")).toBe(old);
    expect(readMithrilToken("atomic")).toBe(old);
  });

  it("keeps workspace and chat identity across profile switches while fencing old native contexts", async () => {
    writeMithrilAccountCredentials("existing", `mf_${"t".repeat(43)}`);
    let profile = "existing";
    const create = (readScope: string, writeScope: string): CloudWorkspace =>
      new CloudWorkspace({
        token: () => readCloudAccountToken(profile),
        profile: () => profile,
        origin: () => "https://api.mithril.fund",
        changed: () => {},
        readScope,
        writeScope,
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                via: "api_token",
                user: { id: "owner" },
                scopes: [
                  "workspace:read",
                  "workspace:write",
                  "chat:read",
                  "chat:write",
                ],
              }),
              { status: 200 },
            ),
        ) as typeof fetch,
      });
    const workspace = create("workspace:read", "workspace:write");
    const chat = create("chat:read", "chat:write");
    await workspace.enable();
    await chat.enable();
    const priorContext = await workspace.nativeContext();
    profile = "new-cloud-profile";
    expect(await workspace.status()).toMatchObject({ userId: "owner" });
    expect(await chat.status()).toMatchObject({ userId: "owner" });
    expect(() => workspace.assertNativeContext(priorContext)).toThrow();
    expect(readMithrilToken(profile)).toBeNull();
    await workspace.enable();
    await chat.enable();
    clearCloudAccountToken();
    expect(await workspace.status()).toEqual({ userId: null, enabled: false });
    expect(await chat.status()).toEqual({ userId: null, enabled: false });
  });
});
