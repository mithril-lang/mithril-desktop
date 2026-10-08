import { pathToFileURL } from "node:url";

/** Read-only release compatibility gate. No account token, inference or schema mutation. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- JavaScript release entry point.
export async function checkWorkspaceApi(request = fetch) {
  const response = await request("https://api.mithril.fund/health", {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  const health = await response.json();
  if (
    !response.ok ||
    health?.ok !== true ||
    health.sessionInventoryProtocol !== "chat-inventory-keyset-v1" ||
    health.sidebarInventoryProtocol !== "sidebar-inventory-keyset-v1"
  )
    throw Error(
      "Canonical paged Chat API must be published before this Desktop installer",
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await checkWorkspaceApi();
  console.log("Canonical paged Chat API compatibility verified");
}
