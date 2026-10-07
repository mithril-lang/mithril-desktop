// @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account#Runtime credential refresh]]
import type {
  MithrilAccountConnectResult,
  MithrilDeviceCode,
} from "../shared/account";

export interface MithrilRuntimeLifecycleDeps {
  connect: (
    token: string,
    profile?: string,
  ) => Promise<MithrilAccountConnectResult>;
  deviceLogin: (
    profile: string | undefined,
    onCode: (info: MithrilDeviceCode) => void,
  ) => Promise<MithrilAccountConnectResult>;
  disconnect: (profile?: string) => { success: boolean };
  refreshRuntime: (profile?: string) => Promise<unknown>;
  onRefreshError?: (profile: string | undefined) => void;
}

export interface MithrilRuntimeRefreshPlan {
  restartGateway: boolean;
  gatewayProfile: string;
  affectedProfiles: string[];
}

/**
 * Decide which managed processes can safely receive a changed credential.
 * A named profile served by the default multiplexer cannot inject a distinct
 * Electron-only secret into that already shared process, so only its
 * profile-scoped dashboard is recreated.
 */
export function planMithrilRuntimeRefresh(
  requestedProfile: string,
  multiplexed: boolean,
  secondaries: string[],
): MithrilRuntimeRefreshPlan {
  if (!multiplexed) {
    return {
      restartGateway: true,
      gatewayProfile: requestedProfile,
      affectedProfiles: [requestedProfile],
    };
  }
  return {
    restartGateway: requestedProfile === "default",
    gatewayProfile: "default",
    affectedProfiles: ["default", ...secondaries],
  };
}

/** Keep every Mithril credential mutation on one runtime-refresh path. */
export function createMithrilRuntimeLifecycle(
  deps: MithrilRuntimeLifecycleDeps,
): {
  connect: (
    token: string,
    profile?: string,
  ) => Promise<MithrilAccountConnectResult>;
  deviceLogin: (
    profile: string | undefined,
    onCode: (info: MithrilDeviceCode) => void,
  ) => Promise<MithrilAccountConnectResult>;
  disconnect: (profile?: string) => Promise<{ success: boolean }>;
} {
  const mutationQueues = new Map<string, Promise<void>>();
  const runSerialized = async <T>(
    _profile: string | undefined,
    mutateAndRefresh: () => Promise<T>,
  ): Promise<T> => {
    const key = "mithril-account";
    const previous = mutationQueues.get(key) ?? Promise.resolve();
    const task = previous.then(mutateAndRefresh);
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    mutationQueues.set(key, tail);
    try {
      return await task;
    } finally {
      if (mutationQueues.get(key) === tail) mutationQueues.delete(key);
    }
  };

  const refresh = async (profile?: string): Promise<void> => {
    try {
      await deps.refreshRuntime(profile);
    } catch {
      // Do not log an exception here: providers may attach request details.
      deps.onRefreshError?.(profile);
      throw new Error("Mithril runtime credential refresh failed");
    }
  };

  return {
    connect: (token, profile) =>
      runSerialized(profile, async () => {
        const result = await deps.connect(token, profile);
        if (result.status === "connected") await refresh(profile);
        return result;
      }),
    deviceLogin: (profile, onCode) =>
      runSerialized(profile, async () => {
        const result = await deps.deviceLogin(profile, onCode);
        if (result.status === "connected") await refresh(profile);
        return result;
      }),
    disconnect: (profile) =>
      runSerialized(profile, async () => {
        const result = deps.disconnect(profile);
        if (result.success) await refresh(profile);
        return result;
      }),
  };
}
