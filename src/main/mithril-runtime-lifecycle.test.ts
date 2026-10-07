import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMithrilRuntimeLifecycle,
  planMithrilRuntimeRefresh,
} from "./mithril-runtime-lifecycle";
import type { MithrilAccountConnectResult } from "../shared/account";

const connected: MithrilAccountConnectResult = {
  status: "connected",
  protection: "keychain",
  account: {
    userId: "dummy-user",
    accountUrl: "https://console.mithril.fund/account",
    live: true,
    scopes: ["inference"],
    balanceMicroUsd: null,
  },
};

describe("Mithril runtime credential lifecycle", () => {
  const connect = vi.fn();
  const deviceLogin = vi.fn();
  const disconnect = vi.fn();
  const refreshRuntime = vi.fn().mockResolvedValue(undefined);
  const onRefreshError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    connect.mockResolvedValue(connected);
    deviceLogin.mockResolvedValue(connected);
    disconnect.mockReturnValue({ success: true });
    refreshRuntime.mockResolvedValue(undefined);
  });

  const lifecycle = (): ReturnType<typeof createMithrilRuntimeLifecycle> =>
    createMithrilRuntimeLifecycle({
      connect,
      deviceLogin,
      disconnect,
      refreshRuntime,
      onRefreshError,
    });

  // @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account#Runtime credential refresh]]
  it("refreshes the same profile after browser, device, manual, and disconnect mutations", async () => {
    const subject = lifecycle();
    await subject.connect(`mf_${"x".repeat(43)}`, "profile-a");
    await subject.deviceLogin("profile-b", vi.fn());
    await subject.disconnect("profile-c");
    expect(refreshRuntime).toHaveBeenCalledTimes(3);
    expect(refreshRuntime.mock.calls.map(([profile]) => profile)).toEqual([
      "profile-a",
      "profile-b",
      "profile-c",
    ]);
  });

  it("does not disturb Hermes when connect is refused, cancelled, or storage fails", async () => {
    connect.mockResolvedValue({ status: "refused", error: "invalid" });
    deviceLogin.mockResolvedValue({
      status: "refused",
      error: "device_cancelled",
    });
    disconnect.mockReturnValue({ success: false });
    const subject = lifecycle();
    await subject.connect("dummy", "profile-a");
    await subject.deviceLogin("profile-b", vi.fn());
    await subject.disconnect("profile-c");
    expect(refreshRuntime).not.toHaveBeenCalled();
  });

  it("reports refresh failure without exposing its exception", async () => {
    refreshRuntime.mockRejectedValue(
      new Error("dummy secret must never reach the callback"),
    );
    await expect(
      lifecycle().connect(`mf_${"x".repeat(43)}`, "profile-a"),
    ).rejects.toThrow("Mithril runtime credential refresh failed");
    expect(onRefreshError).toHaveBeenCalledWith("profile-a");
    expect(onRefreshError.mock.calls.flat()).not.toContain(
      "dummy secret must never reach the callback",
    );
  });

  it("does not report connected until the runtime is refreshed", async () => {
    let finishRefresh: (() => void) | undefined;
    refreshRuntime.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    let settled = false;
    const pending = lifecycle()
      .connect(`mf_${"x".repeat(43)}`, "profile-a")
      .then(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(refreshRuntime).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    finishRefresh?.();
    await pending;
    expect(settled).toBe(true);
  });

  it("serializes repeated mutations and refreshes the final credential too", async () => {
    let finishFirstConnect: (() => void) | undefined;
    connect
      .mockImplementationOnce(
        () =>
          new Promise<MithrilAccountConnectResult>((resolve) => {
            finishFirstConnect = () => resolve(connected);
          }),
      )
      .mockResolvedValueOnce(connected);
    const subject = lifecycle();
    const first = subject.connect("dummy-one", "profile-a");
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    const second = subject.connect("dummy-two", "profile-a");
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(1);
    finishFirstConnect?.();
    await Promise.all([first, second]);
    expect(connect.mock.calls.map(([token]) => token)).toEqual([
      "dummy-one",
      "dummy-two",
    ]);
    expect(refreshRuntime).toHaveBeenCalledTimes(2);
  });

  it("does not let a slow connect overtake a later disconnect from another profile", async () => {
    let finishConnect: (() => void) | undefined;
    connect.mockImplementationOnce(
      () =>
        new Promise<MithrilAccountConnectResult>((resolve) => {
          finishConnect = () => resolve(connected);
        }),
    );
    const subject = lifecycle();
    const connecting = subject.connect("dummy", "profile-a");
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    const disconnecting = subject.disconnect("profile-b");
    await Promise.resolve();
    expect(disconnect).not.toHaveBeenCalled();
    finishConnect?.();
    await Promise.all([connecting, disconnecting]);
    expect(disconnect).toHaveBeenCalledWith("profile-b");
    expect(refreshRuntime).toHaveBeenCalledTimes(2);
  });
});

describe("Mithril runtime refresh planning", () => {
  it("restarts a standalone profile gateway and dashboard", () => {
    expect(planMithrilRuntimeRefresh("profile-a", false, [])).toEqual({
      restartGateway: true,
      gatewayProfile: "profile-a",
      affectedProfiles: ["profile-a"],
    });
  });

  it("restarts the default multiplexer and waits for every served profile", () => {
    expect(
      planMithrilRuntimeRefresh("default", true, ["profile-a", "profile-b"]),
    ).toEqual({
      restartGateway: true,
      gatewayProfile: "default",
      affectedProfiles: ["default", "profile-a", "profile-b"],
    });
  });

  it("does not restart a shared multiplexer for one named credential", () => {
    expect(
      planMithrilRuntimeRefresh("profile-a", true, ["profile-a", "profile-b"]),
    ).toEqual({
      restartGateway: false,
      gatewayProfile: "default",
      affectedProfiles: ["default", "profile-a", "profile-b"],
    });
  });
});
