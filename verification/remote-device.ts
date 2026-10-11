import { readFileSync } from "node:fs";
import { LocalWorkspace } from "../src/main/local-workspace";
import { CloudWorkspace } from "../src/main/cloud-workspace";
const config = JSON.parse(readFileSync(0, "utf8")) as {
  token: string;
  endpoint: string;
  owner: string;
};
let online = true;
const cloud = new CloudWorkspace({
  token: () => config.token,
  profile: () => "default",
  origin: () => config.endpoint,
  changed: () => {},
  fetch: (url, init) => {
    if (!online) return Promise.reject(Error("offline"));
    return fetch(url, init);
  },
});
const open = (): LocalWorkspace =>
  new LocalWorkspace("/work/device.sqlite", () => "remote-qa", cloud);
async function run(): Promise<void> {
  let local = open();
  await local.enable();
  await local.sync();
  if (!local.getSnapshot().records.some((r) => r.data.title === "Mac to gad"))
    throw Error("Remote device did not receive Mac edit");
  online = false;
  local.applyOperations(
    [
      {
        operationId: "gad-offline-op",
        id: "gad-offline-project",
        kind: "project",
        baseRevision: 0,
        data: { title: "gad to Mac after offline restart" },
        deleted: false,
        datasetGeneration: 0,
      },
    ],
    config.owner,
  );
  await local.sync();
  if (local.syncStatus().pending !== 1) throw Error("Missing remote outbox");
  local.close();
  local = open();
  await local.enable();
  await local.sync();
  if (
    local.syncStatus().pending !== 1 ||
    !local.getSnapshot().records.some((r) => r.id === "gad-offline-project")
  )
    throw Error("Offline restart lost remote edit");
  online = true;
  await local.sync();
  if (local.syncStatus().pending !== 0)
    throw Error("Remote replay did not complete");
  local.close();
  process.stdout.write(
    JSON.stringify({
      remoteDevice: "gad",
      macToRemote: true,
      offlineRestart: true,
      remoteToD1: true,
      node: process.version,
    }),
  );
}
void run().catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
