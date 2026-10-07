import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { WalletRepositoryStore } from "./wallet-repository-store";
import { WalletReplication } from "./wallet-replication";
import type {
  RepositoryDocument,
  RepositoryReceipt,
  RepositoryTransport,
} from "@mithril/workspace/repository";
const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function fixture(): {
  rows: Map<string, RepositoryDocument>;
  calls: string[];
  store: () => WalletRepositoryStore;
  engine: () => WalletReplication;
  changeName: (name: string) => void;
  remove: () => void;
  lose: () => void;
  retire: () => void;
  local: () => unknown;
  interruptRestore: () => void;
} {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-wallet-replica-")),
  );
  directories.push(directory);
  const rows = new Map<string, RepositoryDocument>(),
    receipts = new Map<string, RepositoryReceipt>(),
    calls: string[] = [];
  let lose = false,
    active = true,
    interruptRestore = false;
  const guard = (): void => {
    if (!active) throw Error("Account changed");
  };
  const store = (): WalletRepositoryStore =>
    new WalletRepositoryStore(directory, "alice", "research", guard);
  let wallets = [
    {
      id: "primary",
      name: "Primary",
      address: "0x1234567890abcdef1234567890abcdef12345678",
      network: "base" as const,
      createdAt: 1,
      imported: false,
      encryptedRecoveryPhrase: "private-ciphertext",
    },
  ];
  const transport: RepositoryTransport = {
    async page() {
      return {
        schemaVersion: 1,
        userId: "alice",
        documents: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)),
        nextAfter: null,
      };
    },
    async apply(edit) {
      calls.push(edit.operationId);
      const known = receipts.get(edit.operationId);
      if (known) return known;
      const before = rows.get(edit.id),
        accepted = (before?.revision ?? 0) === edit.baseRevision;
      const document = accepted
        ? {
            collection: edit.collection,
            id: edit.id,
            revision: (before?.revision ?? 0) + 1,
            updatedAt: 1,
            body: edit.body,
            deleted: edit.deleted,
          }
        : before!;
      if (accepted) rows.set(edit.id, document);
      const receipt: RepositoryReceipt = {
        schemaVersion: 1,
        userId: "alice",
        operationId: edit.operationId,
        status: accepted ? "accepted" : "conflict",
        document,
      };
      receipts.set(edit.operationId, receipt);
      if (lose) {
        lose = false;
        throw Error("Lost receipt");
      }
      return receipt;
    },
  };
  const engine = (): WalletReplication =>
    new WalletReplication({
      store: store(),
      transport,
      capture: () => wallets,
      restore: (before, after) => {
        const index = wallets.findIndex((wallet) => wallet.id === before.id);
        if (index < 0 || wallets[index].name !== before.name)
          throw Error("Source conflict");
        wallets[index] = { ...wallets[index], ...after };
        if (interruptRestore) {
          interruptRestore = false;
          throw Error("Interrupted after restore");
        }
      },
      guard,
    });
  return {
    rows,
    calls,
    store,
    engine,
    changeName: (name: string) => {
      wallets = [{ ...wallets[0], name }];
    },
    remove: () => {
      wallets = [];
    },
    lose: () => {
      lose = true;
    },
    retire: () => {
      active = false;
    },
    local: () => wallets,
    interruptRestore: () => {
      interruptRestore = true;
    },
  };
}
// @lat: [[cloud-workspace-tests#Wallet original publication and deletion]]
it("publishes original public metadata, captures edits and tombstones deletion without private ciphertext", async () => {
  const f = fixture();
  expect((await f.engine().sync())[0]).toMatchObject({
    name: "Primary",
    canTransact: false,
  });
  expect(JSON.stringify([...f.rows.values()])).not.toContain(
    "private-ciphertext",
  );
  f.changeName("Renamed");
  expect((await f.engine().sync())[0].name).toBe("Renamed");
  expect([...f.rows.values()][0].revision).toBe(2);
  f.remove();
  expect(await f.engine().sync()).toEqual([]);
  expect([...f.rows.values()][0].deleted).toBe(true);
});

// @lat: [[cloud-workspace-tests#Wallet remote metadata restoration]]
it("restores remote metadata to the original source and then publishes a later native edit", async () => {
  const f = fixture();
  await f.engine().sync();
  const [id, row] = [...f.rows.entries()][0];
  f.rows.set(id, {
    ...row,
    revision: 2,
    body: {
      ...(row.body as object),
      wallet: {
        ...(row.body as { wallet: object }).wallet,
        name: "Web rename",
      },
    },
  });
  await f.engine().sync();
  expect(f.local()).toMatchObject([
    { name: "Web rename", encryptedRecoveryPhrase: "private-ciphertext" },
  ]);
  expect(f.calls).toHaveLength(1);
  f.changeName("Desktop rename");
  await f.engine().sync();
  expect(f.rows.get(id)).toMatchObject({
    revision: 3,
    body: { wallet: { name: "Desktop rename" } },
  });
});

// @lat: [[cloud-workspace-tests#Wallet interrupted remote restoration]]
it("recovers after original file restoration but before checkpoint acceptance without republishing the remote edit", async () => {
  const f = fixture();
  await f.engine().sync();
  const [id, row] = [...f.rows.entries()][0];
  f.rows.set(id, {
    ...row,
    revision: 2,
    body: {
      ...(row.body as object),
      wallet: {
        ...(row.body as { wallet: object }).wallet,
        name: "Web rename",
      },
    },
  });
  f.interruptRestore();
  await expect(f.engine().sync()).rejects.toThrow("Interrupted after restore");
  await f.engine().sync();
  expect(f.local()).toMatchObject([{ name: "Web rename" }]);
  expect(f.calls).toHaveLength(1);
  expect(f.rows.get(id)?.revision).toBe(2);
});
// @lat: [[cloud-workspace-tests#Wallet retained acceptance recovery]]
it("recovers creation and update receipts after reopening the real SQLite journal", async () => {
  const f = fixture();
  f.lose();
  await expect(f.engine().sync()).rejects.toThrow("Lost receipt");
  await f.engine().sync();
  expect(f.calls[0]).toBe(f.calls[1]);
  expect([...f.rows.values()][0].revision).toBe(1);
  f.changeName("After restart");
  f.lose();
  await expect(f.engine().sync()).rejects.toThrow("Lost receipt");
  await f.engine().sync();
  expect(f.calls[2]).toBe(f.calls[3]);
  expect([...f.rows.values()][0].revision).toBe(2);
});
// @lat: [[cloud-workspace-tests#Wallet concurrent cloud edit conflict]]
it("retains a concurrent cloud edit and the exact queued native edit rather than overwriting either", async () => {
  const f = fixture();
  await f.engine().sync();
  const [id, row] = [...f.rows.entries()][0];
  f.rows.set(id, {
    ...row,
    revision: 2,
    body: {
      ...(row.body as object),
      wallet: {
        ...(row.body as { wallet: object }).wallet,
        name: "Other device",
      },
    },
  });
  f.changeName("Native edit");
  await expect(f.engine().sync()).rejects.toThrow("conflict");
  const journal = f.store();
  await journal.exclusive(async () => {
    const state = await journal.read("alice");
    expect(state.pending).toHaveLength(1);
    expect(state.conflicts).toHaveLength(1);
  });
  expect(f.rows.get(id)?.body).toMatchObject({
    wallet: { name: "Other device" },
  });
});
// @lat: [[cloud-workspace-tests#Wallet retired owner scope]]
it("refuses retired account access and unlocked or foreign-owner journal access", async () => {
  const f = fixture();
  await expect(f.store().read("alice")).rejects.toThrow("owner lock");
  const store = f.store();
  await store.exclusive(async () => {
    await expect(store.read("bob")).rejects.toThrow("owner lock");
  });
  f.retire();
  await expect(f.engine().sync()).rejects.toThrow("Account changed");
  expect(f.rows.size).toBe(0);
});
