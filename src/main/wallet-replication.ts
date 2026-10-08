import { RepositorySync } from "@mithril/workspace/repository-sync";
import {
  WalletDescriptorEditor,
  publicWalletDescriptor,
  walletDescriptorView,
  type WalletDescriptor,
} from "@mithril/workspace/wallet-descriptors";
import {
  repositoryFingerprint,
  type JsonValue,
  type RepositoryTransport,
} from "@mithril/workspace/repository";
import type {
  ProfileWallet,
  WalletView,
} from "@mithril/workspace/desktop-wallet-types";
import { WalletRepositoryStore } from "./wallet-repository-store";
const equal = (a: WalletDescriptor, b: WalletDescriptor): boolean =>
  repositoryFingerprint({ body: a as unknown as JsonValue, deleted: false }) ===
  repositoryFingerprint({ body: b as unknown as JsonValue, deleted: false });
/** Data-only publication with durable intent before admission and receipt-aware restart recovery. */
export class WalletReplication {
  private stopped = false;
  constructor(
    private readonly ports: {
      store: WalletRepositoryStore;
      transport: RepositoryTransport;
      capture(): ProfileWallet[];
      restore(before: ProfileWallet, after: ProfileWallet): void;
      guard(): void;
    },
  ) {}
  stop(): void {
    this.stopped = true;
  }
  originalWallets(): ProfileWallet[] {
    this.guard();
    return this.ports
      .capture()
      .map(
        (wallet) =>
          publicWalletDescriptor(this.ports.store.profile, wallet).wallet,
      );
  }
  private guard(): void {
    if (this.stopped) throw Error("Wallet synchronization retired");
    this.ports.guard();
  }
  async sync(): Promise<WalletView[]> {
    const { store } = this.ports;
    return store.exclusive(async () => {
      this.guard();
      const sync = new RepositorySync(
        store.owner,
        {
          page: async (...args) => {
            this.guard();
            const value = await this.ports.transport.page(...args);
            this.guard();
            return value;
          },
          apply: async (edit) => {
            this.guard();
            const value = await this.ports.transport.apply(edit);
            this.guard();
            return value;
          },
        },
        store,
        undefined,
        ["profile"],
      );
      try {
        await sync.sync();
        this.guard();
        const editor = new WalletDescriptorEditor(sync);
        const current = this.ports
          .capture()
          .map((wallet) => publicWalletDescriptor(store.profile, wallet));
        if (
          current.length > 100 ||
          new Set(current.map((d) => d.wallet.id)).size !== current.length
        )
          throw Error("Invalid wallet inventory");
        const checkpoints = new Map(
          store.checkpoints().map((cp) => [cp.source.wallet.id, cp]),
        );
        // Recover authored data before considering newer native changes. Lost receipts reuse the outbox.
        for (const cp of checkpoints.values()) {
          if (cp.cloud && equal(cp.cloud.descriptor, cp.source)) continue;
          const remote = (await editor.list(store.profile)).find(
            (row) => row.descriptor.wallet.id === cp.source.wallet.id,
          );
          const saved =
            remote && equal(remote.descriptor, cp.source)
              ? remote
              : await editor.save(store.profile, cp.source.wallet, cp.cloud);
          this.guard();
          cp.cloud = saved;
          store.checkpoint(cp);
        }
        for (const source of current) {
          this.guard();
          let cp = checkpoints.get(source.wallet.id);
          if (!cp) {
            const existing = (await editor.list(store.profile)).find(
              (row) => row.descriptor.wallet.id === source.wallet.id,
            );
            if (existing && !equal(existing.descriptor, source))
              throw Error(
                "Wallet identity already belongs to a different source version",
              );
            cp = { source, cloud: existing ?? null };
            store.checkpoint(cp);
            checkpoints.set(source.wallet.id, cp);
            if (!existing) {
              const saved = await editor.save(
                store.profile,
                source.wallet,
                null,
              );
              this.guard();
              cp.cloud = saved;
              store.checkpoint(cp);
            }
          } else {
            const remote = (await editor.list(store.profile)).find(
              (row) => row.descriptor.wallet.id === source.wallet.id,
            );
            if (remote && equal(remote.descriptor, source)) {
              // Recover interruption after file restoration but before checkpoint commit.
              cp = { source, cloud: remote };
              store.checkpoint(cp);
              checkpoints.set(source.wallet.id, cp);
              continue;
            }
            if (
              remote &&
              equal(cp.source, source) &&
              !equal(remote.descriptor, cp.source)
            ) {
              this.guard();
              this.ports.restore(source.wallet, remote.descriptor.wallet);
              this.guard();
              cp = { source: remote.descriptor, cloud: remote };
              store.checkpoint(cp);
              checkpoints.set(source.wallet.id, cp);
              continue;
            }
            if (equal(cp.source, source)) continue;
            cp = { source, cloud: cp.cloud };
            store.checkpoint(cp);
            const saved = await editor.save(
              store.profile,
              source.wallet,
              cp.cloud,
            );
            this.guard();
            cp = { source, cloud: saved };
            store.checkpoint(cp);
            checkpoints.set(source.wallet.id, cp);
          }
        }
        // A removed native record becomes a public tombstone only against its last observed cloud revision.
        for (const cp of checkpoints.values()) {
          if (
            current.some((d) => d.wallet.id === cp.source.wallet.id) ||
            !cp.cloud
          )
            continue;
          this.guard();
          const id = cp.cloud.document.id;
          const row = sync.state.documents.find(
            (doc) => doc.collection === "profile" && doc.id === id,
          );
          if (row?.deleted) continue;
          if (
            sync.state.pending.some(
              (edit) => edit.collection === "profile" && edit.id === id,
            )
          )
            throw Error("Wallet deletion retained");
          await sync.edit(
            "profile",
            id,
            null,
            true,
            cp.cloud.document.revision,
          );
          await sync.sync();
          this.guard();
          if (
            sync.state.pending.some(
              (edit) => edit.collection === "profile" && edit.id === id,
            )
          )
            throw Error("Wallet deletion requires conflict resolution");
        }
        const active = await editor.list(store.profile);
        this.guard();
        return active.map((row) => walletDescriptorView(row.descriptor));
      } finally {
        sync.stop();
      }
    });
  }
}
