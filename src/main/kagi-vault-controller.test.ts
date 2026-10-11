// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  KagiVaultController,
  transferFingerprint,
} from "./kagi-vault-controller";
import { sealSecret, newOpaqueId } from "@kotoba-lang/kagi/mithril-vault";
import type { VaultState } from "./kagi-vault-client";
interface Fixture {
  controller: KagiVaultController;
  consent: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  session: ReturnType<
    typeof vi.fn<
      (profile: string) => Promise<{ ownerId: string; token: string }>
    >
  >;
  stored(): VaultState;
  owner(value: string): void;
  time(value: number): void;
}
function fixture(): Fixture {
  let stored: VaultState | null = null;
  let owner = "owner";
  let now = 1000;
  const consent = vi.fn(async () => true);
  const session = vi.fn(async (_profile: string) => ({
    ownerId: owner,
    token: "mf_synthetic",
  }));
  const controller = new KagiVaultController({
    session,
    exists: () => !!stored,
    read: () => structuredClone(stored),
    write: (state) => {
      stored = structuredClone(state);
    },
    consent,
    now: () => now,
  });
  return {
    controller,
    consent,
    session,
    stored: () => stored!,
    owner: (value: string) => {
      owner = value;
    },
    time: (value: number) => {
      now = value;
    },
  };
}
async function withSecret(f: ReturnType<typeof fixture>): Promise<string> {
  await f.controller.create("profile");
  const state = f.stored(),
    id = newOpaqueId();
  state.records[id] = {
    vaultId: state.vaultId,
    itemId: id,
    revision: 2,
    operationId: newOpaqueId(),
    deleted: false,
    createdAt: 1000,
    envelope: sealSecret(
      state.key,
      { ownerId: "owner", vaultId: state.vaultId, itemId: id, generation: 2 },
      {
        format: "kagitaba-secret-v1",
        id,
        title: "Synthetic",
        key: "SYNTHETIC_KEY",
        value: "synthetic-value",
      },
    ),
  };
  f.controller.lock();
  await f.controller.unlock("profile");
  return id;
}
describe("Vault enrollment, recovery and execution boundaries", () => {
  // @lat: [[e2ee-vault#Device enrollment and recovery]]
  it("enrolls an empty device with both trusted fingerprints and persisted revision floors", async () => {
    const a = fixture(),
      b = fixture(),
      id = await withSecret(a);
    const request = await b.controller.requestDevice("profile");
    const box = await a.controller.approveDevice(
      "profile",
      request.request,
      request.fingerprint,
    );
    await b.controller.completeDevice("profile", box, transferFingerprint(box));
    expect((await b.controller.view("profile")).items[0]).toMatchObject({
      id,
      revision: 2,
      granted: false,
    });
    await expect(
      b.controller.completeDevice("profile", box, transferFingerprint(box)),
    ).rejects.toThrow();
    expect(b.stored().key).toEqual(a.stored().key);
  });
  it("consumes a substituted enrollment and never overwrites a vault during recovery", async () => {
    const a = fixture(),
      b = fixture();
    await withSecret(a);
    const request = await b.controller.requestDevice("profile");
    const box = await a.controller.approveDevice(
      "profile",
      request.request,
      request.fingerprint,
    );
    await expect(
      b.controller.completeDevice("profile", box, "0".repeat(64)),
    ).rejects.toThrow();
    expect(b.stored()).toBeNull();
    await expect(
      b.controller.completeDevice("profile", box, transferFingerprint(box)),
    ).rejects.toThrow();
    const kit = await a.controller.recovery("profile");
    await b.controller.recover("profile", kit.code, kit.package);
    const prior = b.stored();
    await expect(
      b.controller.recover("profile", kit.code, kit.package),
    ).rejects.toThrow();
    expect(b.stored()).toEqual(prior);
    const c = fixture();
    c.owner("other");
    await expect(
      c.controller.recover("profile", kit.code, kit.package),
    ).rejects.toThrow();
    expect(c.stored()).toBeNull();
  });
  // @lat: [[e2ee-vault#Execution consent]]
  it("requires per-item consent and releases only once to the same profile", async () => {
    const a = fixture(),
      id = await withSecret(a);
    expect(
      await a.controller.resolve("profile", "SYNTHETIC_KEY", "session"),
    ).toBeNull();
    await a.controller.grant("profile", id);
    expect(
      await a.controller.resolve("profile", "OTHER_KEY", "session"),
    ).toBeNull();
    const values = await Promise.all([
      a.controller.resolve("profile", "SYNTHETIC_KEY", "session"),
      a.controller.resolve("profile", "SYNTHETIC_KEY", "session"),
    ]);
    expect(values.filter(Boolean)).toEqual(["synthetic-value"]);
    await a.controller.grant("profile", id);
    a.time(601001);
    expect(
      await a.controller.resolve("profile", "SYNTHETIC_KEY", "session"),
    ).toBeNull();
    a.time(1000);
    await a.controller.grant("profile", id);
    await expect(
      a.controller.resolve("other-profile", "SYNTHETIC_KEY", "session"),
    ).rejects.toThrow();
    expect((await a.controller.view("profile")).status).toBe("locked");
  });
  it("denies cancellation and account switching while release consent is open", async () => {
    const a = fixture(),
      id = await withSecret(a);
    await a.controller.grant("profile", id);
    a.consent.mockResolvedValueOnce(false);
    expect(
      await a.controller.resolve("profile", "SYNTHETIC_KEY", "session"),
    ).toBeNull();
    await a.controller.grant("profile", id);
    a.consent.mockImplementationOnce(async () => {
      a.controller.revoke();
      return true;
    });
    expect(
      await a.controller.resolve("profile", "SYNTHETIC_KEY", "session"),
    ).toBeNull();
    await a.controller.grant("profile", id);
    a.consent.mockImplementationOnce(async () => {
      a.owner("other");
      return true;
    });
    await expect(
      a.controller.resolve("profile", "SYNTHETIC_KEY", "session"),
    ).rejects.toThrow();
    expect((await a.controller.view("profile")).status).toBe("locked");
  });
});
