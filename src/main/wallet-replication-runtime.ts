import { app } from "electron";
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  cloudWorkspace,
  onCloudWorkspaceAccountChanged,
} from "./cloud-workspace-runtime";
import {
  profileMetadataInventory,
  type ProfileMetadataSource,
} from "./profile-metadata-inventory";
import {
  bindRepositorySource,
  repositorySourceOwned,
} from "./repository-kanban-runtime";
import { HERMES_HOME } from "./installer";
import { listWallets } from "./wallet-store";
import { WalletRepositoryStore } from "./wallet-repository-store";
import { WalletReplication } from "./wallet-replication";
import { WorkspaceReplicationLoop } from "./original-schedule-replication-loop";
import { captureWalletSource, restoreWalletSource } from "./wallet-source";
import type { WalletSyncResult } from "@mithril/workspace/desktop-wallet-types";
let lane: Promise<void> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = lane.then(operation);
  lane = next.then(
    () => {},
    () => {},
  );
  return next;
}
type WalletContext = Awaited<ReturnType<typeof cloudWorkspace.nativeContext>>;
async function context(): Promise<WalletContext> {
  await cloudWorkspace.enable();
  return cloudWorkspace.nativeContext(true);
}
function sources(
  c: WalletContext,
): ReturnType<typeof profileMetadataInventory> {
  const directory = join(app.getPath("userData"), "repository-source-owners");
  return profileMetadataInventory(HERMES_HOME, directory, c.userId, (profile) =>
    bindRepositorySource(directory, profile, c.userId),
  );
}
function engine(
  source: ProfileMetadataSource,
  c: Awaited<ReturnType<typeof context>>,
  retired: () => boolean = () => false,
): WalletReplication {
  if (!source.present) throw Error("Wallet profile unavailable");
  const directory = lstatSync(source.root);
  const guard = (): void => {
    if (retired()) throw Error("Wallet synchronization retired");
    cloudWorkspace.assertNativeContext(c);
    for (let path = source.root; ; path = dirname(path)) {
      if (lstatSync(path).isSymbolicLink()) throw Error("Unsafe wallet source");
      if (dirname(path) === path) break;
    }
    const current = lstatSync(source.root);
    if (
      !current.isDirectory() ||
      current.ino !== directory.ino ||
      current.dev !== directory.dev ||
      !repositorySourceOwned(
        join(app.getPath("userData"), "repository-source-owners"),
        source.profile,
        c.userId,
      )
    )
      throw Error("Wallet profile owner changed");
  };
  guard();
  return new WalletReplication({
    store: new WalletRepositoryStore(
      join(app.getPath("userData"), "mithril-wallet-replicas"),
      c.userId,
      source.profile,
      guard,
    ),
    guard,
    transport: {
      page: (...args) => cloudWorkspace.repositoryPage(...args),
      apply: (edit) => cloudWorkspace.repositoryApply(edit),
    },
    capture: () =>
      captureWalletSource(join(source.root, "wallets.json"), guard),
    restore: (before, after) =>
      restoreWalletSource(
        join(source.root, "wallets.json"),
        before,
        after,
        guard,
      ),
  });
}
/** Same identity and data-only poller used by original schedules; no screen or migration toggle. */
export function startWalletReplication(): () => void {
  const loop = new WorkspaceReplicationLoop({
    changed: onCloudWorkspaceAccountChanged,
    create: async () => {
      let stopped = false;
      let current: WalletReplication | null = null;
      return {
        stop: () => {
          stopped = true;
          current?.stop();
        },
        sync: () =>
          serial(async () => {
            const c = await context();
            const inventory = sources(c);
            for (const source of inventory.sources) {
              if (!source.present) continue;
              current = engine(source, c, () => stopped);
              try {
                await current.sync();
              } catch {
                cloudWorkspace.assertNativeContext(c);
              } finally {
                current.stop();
              }
            }
          }),
      };
    },
  });
  loop.start();
  return () => loop.stop();
}
export async function synchronizeWallets(
  profile: string,
): Promise<WalletSyncResult> {
  return serial(async () => {
    try {
      const c = await context();
      const source = sources(c).sources.find(
        (row) => row.profile === profile && row.present,
      );
      if (!source) throw Error("Wallet profile unavailable");
      const current = engine(source, c);
      try {
        const wallets = await current.sync();
        const nativeIds = new Set(
          listWallets(profile).map((wallet) => wallet.id),
        );
        return {
          status: "ok",
          wallets: wallets.filter((wallet) => !nativeIds.has(wallet.id)),
        };
      } finally {
        current.stop();
      }
    } catch (error) {
      return {
        status: "error",
        wallets: [],
        error:
          error instanceof Error
            ? error.message
            : "Wallet synchronization unavailable",
      };
    }
  });
}
