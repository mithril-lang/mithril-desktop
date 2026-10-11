// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { newVaultKey, sealSecret } from "@kotoba-lang/kagi/mithril-vault";
import { secretItem } from "@kotoba-lang/kagitaba/secret-item";
import {
  KagiVaultClient,
  type VaultState,
  type VaultSession,
  type EncryptedVaultRecord,
} from "./kagi-vault-client";

const itemId = "b".repeat(32);
const input = {
  id: itemId,
  title: "Private provider",
  key: "PROVIDER_API_KEY",
  value: "synthetic-secret",
};
function fixture(): {
  client(): KagiVaultClient;
  persist: ReturnType<typeof vi.fn<(next: VaultState) => void>>;
  calls: Array<{ url: string; init: RequestInit }>;
  state: VaultState;
  setSession(s: VaultSession | null): void;
  dropNext(): void;
  setRemote(value: EncryptedVaultRecord): void;
  durable(): VaultState;
} {
  const state: VaultState = {
    ownerId: "owner-a",
    vaultId: "a".repeat(32),
    key: newVaultKey(),
    records: {},
  };
  let session: VaultSession | null = {
    ownerId: state.ownerId,
    token: "mf_synthetic",
  };
  let durable = state;
  const persist = vi.fn((next: VaultState) => {
    durable = next;
  });
  let saved: EncryptedVaultRecord | undefined;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let drop = false;
  const transport = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      if (init?.method === "PUT") {
        const mutation = JSON.parse(init.body as string);
        saved ??= {
          ...mutation,
          revision: mutation.expectedRevision + 1,
          createdAt: 10,
        };
        if (drop) {
          drop = false;
          throw new Error("network disappeared");
        }
      }
      return new Response(JSON.stringify(saved), { status: 200 });
    },
  );
  const client = (): KagiVaultClient =>
    new KagiVaultClient(
      durable,
      async () => session,
      persist,
      transport as typeof fetch,
    );
  return {
    client,
    persist,
    calls,
    state,
    setSession: (s: VaultSession | null) => {
      session = s;
    },
    dropNext: () => {
      drop = true;
    },
    setRemote: (value: EncryptedVaultRecord) => {
      saved = value;
    },
    durable: () => durable,
  };
}
describe("kagi + kagitaba Desktop transport", () => {
  it("sends ciphertext to the fixed API and resolves only the explicitly requested key", async () => {
    const f = fixture(),
      client = f.client();
    await client.save(input);
    expect(f.calls[0].url).toBe(
      `https://api.mithril.fund/v1/vault/${f.state.vaultId}/items/${itemId}`,
    );
    expect(f.calls[0].init.redirect).toBe("error");
    for (const secret of [input.value, input.key, input.title])
      expect(f.calls[0].init.body).not.toContain(secret);
    expect(await client.resolve(itemId, input.key)).toBe(input.value);
    expect(await client.resolve(itemId, "OTHER_KEY")).toBeNull();
    client.lock();
    await expect(client.resolve(itemId, input.key)).rejects.toMatchObject({
      code: "vault_locked",
    });
  });
  it("durably replays the exact operation after a lost response and process restart", async () => {
    const f = fixture(),
      client = f.client();
    f.dropNext();
    await expect(client.save(input)).rejects.toMatchObject({
      code: "vault_write_uncertain",
    });
    expect(f.durable().pending?.[itemId]).toBeDefined();
    await expect(client.save(input)).rejects.toMatchObject({
      code: "vault_write_pending",
    });
    await f.client().retryPending(itemId);
    expect(f.calls[1].init.body).toBe(f.calls[0].init.body);
    expect(f.durable().pending?.[itemId]).toBeUndefined();
  });
  it("refuses rollback and account switching without changing durable state", async () => {
    const f = fixture(),
      client = f.client();
    await client.save(input);
    const previous = f.durable().records[itemId];
    const second = {
      ...previous,
      revision: 2,
      envelope: sealSecret(
        f.state.key,
        {
          ownerId: f.state.ownerId,
          vaultId: f.state.vaultId,
          itemId,
          generation: 2,
        },
        secretItem(input),
      ),
    };
    f.setRemote(second);
    await client.pull(itemId);
    f.setRemote(previous);
    await expect(client.pull(itemId)).rejects.toMatchObject({
      code: "vault_rollback_detected",
    });
    expect(f.durable().records[itemId].revision).toBe(2);
    f.setSession({ ownerId: "owner-b", token: "mf_other" });
    await expect(client.resolve(itemId, input.key)).rejects.toMatchObject({
      code: "vault_account_mismatch",
    });
  });
  it("does not trust an unsigned server deletion marker", async () => {
    const f = fixture(),
      client = f.client();
    await client.save(input);
    f.setRemote({
      ...f.durable().records[itemId],
      revision: 2,
      deleted: true,
      envelope: null,
    });
    await expect(client.pull(itemId)).rejects.toMatchObject({
      code: "vault_authenticated_deletion_required",
    });
    expect(f.durable().records[itemId].revision).toBe(1);
  });
  it("preserves the previous state if persistence fails", async () => {
    const f = fixture(),
      client = f.client();
    f.persist.mockImplementationOnce(() => {
      throw new Error("disk failed");
    });
    await expect(client.save(input)).rejects.toThrow("disk failed");
    expect(f.calls).toHaveLength(0);
    expect(f.durable().pending).toBeUndefined();
  });
});
