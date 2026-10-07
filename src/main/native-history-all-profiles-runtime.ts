import { app } from "electron";
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { CloudChat } from "./cloud-chat";
import { CloudWorkspace } from "./cloud-workspace";
import { cloudChat, onCloudChatAccountChanged } from "./cloud-chat-runtime";
import { readCloudAccountToken } from "./mithril-token-store";
import { mithrilApiOrigin } from "./mithril-token";
import { getActiveProfileNameSync } from "./utils";
import { getConnectionConfig } from "./config";
import { HERMES_HOME } from "./installer";
import { profileMetadataInventory } from "./profile-metadata-inventory";
import {
  bindRepositorySource,
  repositorySourceOwned,
} from "./repository-kanban-runtime";
import { WorkspaceReplicationLoop } from "./original-schedule-replication-loop";
import {
  createNativeHistoryRuntime,
  serializeNativeHistory,
} from "./native-history-runtime";

/** Archive all owned original sources without selecting profiles or starting agent work. */
// @lat: [[cloud-workspace#All-profile automatic original history archival (draft)]]
export function startAllProfileHistoryReplication(): () => void {
  const loop = new WorkspaceReplicationLoop({
    changed: onCloudChatAccountChanged,
    create: async () => {
      let stopped = false;
      return {
        stop: () => {
          stopped = true;
        },
        sync: () =>
          serializeNativeHistory(async () => {
            await cloudChat.auth.enable();
            const context = await cloudChat.auth.nativeContext(true);
            const accountGuard = (): void => {
              if (stopped) throw Error("History archival retired");
              cloudChat.auth.assertNativeContext(context);
              if (getConnectionConfig().mode !== "local")
                throw Error("Original history source changed");
            };
            accountGuard();
            const bindings = join(
              app.getPath("userData"),
              "repository-source-owners",
            );
            const inventory = profileMetadataInventory(
              HERMES_HOME,
              bindings,
              context.userId,
              (profile) =>
                bindRepositorySource(bindings, profile, context.userId),
            );
            for (const source of inventory.sources) {
              if (!source.present) continue;
              accountGuard();
              const before = lstatSync(source.root);
              const guard = async (): Promise<void> => {
                accountGuard();
                for (let path = source.root; ; path = dirname(path)) {
                  if (lstatSync(path).isSymbolicLink())
                    throw Error("Unsafe history source");
                  if (dirname(path) === path) break;
                }
                const current = lstatSync(source.root);
                if (
                  !current.isDirectory() ||
                  current.ino !== before.ino ||
                  current.dev !== before.dev ||
                  !repositorySourceOwned(
                    bindings,
                    source.profile,
                    context.userId,
                  )
                )
                  throw Error("History profile owner changed");
              };
              try {
                await guard();
                const client = new CloudChat(
                  new CloudWorkspace({
                    token: () =>
                      readCloudAccountToken(getActiveProfileNameSync()),
                    profile: () => source.profile,
                    origin: mithrilApiOrigin,
                    fetch: (input, init) => fetch(input, init),
                    changed: () => {},
                    readScope: "chat:read",
                    writeScope: "chat:write",
                  }),
                );
                await client.auth.enable();
                const scoped = await client.auth.nativeContext(true);
                if (
                  scoped.userId !== context.userId ||
                  scoped.actor !== context.actor
                )
                  throw Error("History account changed");
                await guard();
                // Only associated original sessions are restored here. Account-wide remote
                // conversations stay in the existing canonical sidebar/cache, not every profile.
                await createNativeHistoryRuntime(client, guard, false).run();
                await guard();
              } catch {
                accountGuard(); // A failed source may retry; a retired account stops the pass.
              }
            }
          }),
      };
    },
  });
  loop.start();
  return () => loop.stop();
}
