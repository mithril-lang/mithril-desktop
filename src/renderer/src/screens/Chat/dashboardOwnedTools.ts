import {
  callOwnedTool,
  finiteToolJson,
  ownedToolSnapshot,
  ownedToolTargetBinding,
  previewOwnedToolTarget,
  OwnedToolCallError,
  type OwnedToolCall,
  type OwnedToolClient,
  type OwnedToolResult,
} from "@mithril/workspace/owned-gateway-tools";

/** Selected attached transport only; preview identity never grants an effect. */
export async function callDashboardOwnedTool(
  client: OwnedToolClient,
  call: OwnedToolCall,
): Promise<OwnedToolResult> {
  const {
    sessionId,
    requestId,
    name,
    timeoutMs,
    targetBinding: expectedRaw,
  } = call;
  const attempt = `rpc:${requestId}`;
  const epoch = client.connectionEpoch;
  const current = (): boolean =>
    call.current() && client.connected && client.connectionEpoch === epoch;
  try {
    if (
      !current() ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(sessionId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(requestId) ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(name) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 120_000 ||
      !call.arguments ||
      typeof call.arguments !== "object" ||
      Array.isArray(call.arguments)
    )
      throw new Error("Invalid owned call");
    // Capture inputs before either discovery or target resolution yields control.
    const args = finiteToolJson(call.arguments, 120_000) as Record<
      string,
      unknown
    >;
    const expected = ownedToolTargetBinding(expectedRaw);
    const started = Date.now();
    const snapshot = ownedToolSnapshot(
      await client.request("tools.show", { session_id: sessionId }, 30_000),
    );
    if (!current() || !snapshot.definitions.some((row) => row.name === name))
      throw new Error("Retired owned preview");
    const target = await previewOwnedToolTarget(client, {
      sessionId,
      name,
      arguments: args,
      contextId: snapshot.contextId,
      revision: snapshot.revision,
      current,
    });
    const matches =
      expected === null
        ? target === null
        : target !== null &&
          expected.digest === target.digest &&
          expected.target.namespace === target.target.namespace &&
          expected.target.path === target.target.path;
    if (
      !current() ||
      Date.now() - started >= 30_000 ||
      (expectedRaw !== undefined && !matches)
    )
      throw new Error("Target preview no longer matches the caller");
    // The SDK performs fresh discovery before dispatch. It must still belong to
    // the context/revision that resolved this target; a new context needs a new call.
    const pinned: OwnedToolClient = {
      get connected() {
        return client.connected;
      },
      get connectionEpoch() {
        return client.connectionEpoch;
      },
      async request<T>(
        method: string,
        params?: Record<string, unknown>,
        timeout?: number,
      ): Promise<T> {
        const raw =
          timeout === undefined
            ? await client.request<T>(method, params)
            : await client.request<T>(method, params, timeout);
        if (method === "tools.show") {
          const fresh = ownedToolSnapshot(raw);
          if (
            fresh.contextId !== snapshot.contextId ||
            fresh.revision !== snapshot.revision
          )
            throw new Error("Preview context retired before dispatch");
        }
        return raw;
      },
    };
    return await callOwnedTool(pinned, {
      sessionId,
      requestId,
      name,
      timeoutMs,
      arguments: args,
      targetBinding: target,
      current,
    });
  } catch (error) {
    if (error instanceof OwnedToolCallError && error.attemptId === attempt)
      throw error;
    throw new OwnedToolCallError("not-dispatched", attempt);
  }
}
