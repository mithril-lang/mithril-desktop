import { app } from "electron";
import { join } from "node:path";
import { EndpointRuntime } from "./runtime";
let instance: EndpointRuntime | null = null;
let ready: Promise<void> | null = null;
let mutations: Promise<unknown> = Promise.resolve();
export async function endpointRuntime(): Promise<EndpointRuntime> {
  await app.whenReady();
  if (!instance) {
    instance = new EndpointRuntime(
      join(app.getPath("userData"), "endpoint-protection"),
    );
    ready = instance.initialize();
  }
  await ready;
  return instance;
}
export function mutateEndpoint<T>(
  operation: (runtime: EndpointRuntime) => Promise<T>,
): Promise<T> {
  const next = mutations.then(async () => operation(await endpointRuntime()));
  mutations = next.catch(() => undefined);
  return next;
}
export function stopEndpoint(): void {
  instance?.stop();
}
