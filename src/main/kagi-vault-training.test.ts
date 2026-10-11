// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trainingVaultSession } from "./kagi-vault-training";
import { VAULT_TRAINING_ORIGIN } from "./kagi-vault-client";
const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function setup(): {
  path: string;
  s: {
    ownerId: string;
    token: string;
    realm: string;
    origin: string;
    expiresAt: number;
  };
  write(v: object): void;
  fetcher: ReturnType<typeof vi.fn<() => Promise<Response>>>;
} {
  const d = mkdtempSync(join(tmpdir(), "vault-training-"));
  dirs.push(d);
  const path = join(d, "account.json");
  const s = {
    ownerId: "training-" + "a".repeat(32),
    token: "mf_training" + "b".repeat(35),
    realm: "vault-training-v1",
    origin: VAULT_TRAINING_ORIGIN,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
  const write = (v: object): void =>
    writeFileSync(path, JSON.stringify(v), { mode: 0o600 });
  write(s);
  vi.stubEnv("MITHRIL_VAULT_TRAINING_SESSION_FILE", path);
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          realm: s.realm,
          user: { id: s.ownerId },
          via: "api_token",
          scopes: ["vault:read", "vault:write"],
        }),
        { headers: { "X-Mithril-Realm": s.realm } },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  return { path, s, write, fetcher };
}
it("admits only a private, fixed-origin, live scoped training identity", async () => {
  const f = setup();
  expect(await trainingVaultSession()).toEqual({
    ownerId: f.s.ownerId,
    token: f.s.token,
    realm: f.s.realm,
  });
  expect(f.fetcher.mock.calls.length).toBe(1);
  f.fetcher.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          realm: f.s.realm,
          user: { id: "another" },
          via: "api_token",
          scopes: ["vault:read", "vault:write"],
        }),
        { headers: { "X-Mithril-Realm": f.s.realm } },
      ),
  );
  expect(await trainingVaultSession()).toBeNull();
});
it("never transmits production credentials or insecure/expired/redirected configurations", async () => {
  const f = setup();
  for (const change of [
    { token: "mf_" + "p".repeat(43) },
    { origin: "https://api.mithril.fund" },
    { ownerId: "production-user" },
    { expiresAt: 1 },
  ]) {
    f.write({ ...f.s, ...change });
    expect(await trainingVaultSession()).toBeNull();
  }
  f.write(f.s);
  chmodSync(f.path, 0o644);
  expect(await trainingVaultSession()).toBeNull();
  chmodSync(f.path, 0o600);
  const link = f.path + ".link";
  symlinkSync(f.path, link);
  vi.stubEnv("MITHRIL_VAULT_TRAINING_SESSION_FILE", link);
  expect(await trainingVaultSession()).toBeNull();
  expect(f.fetcher).not.toHaveBeenCalled();
});
