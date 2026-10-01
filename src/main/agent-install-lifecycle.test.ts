import { describe, expect, it, vi } from "vitest";
import {
  agentInstallBusy,
  installAgentAndRestoreRuntimes,
} from "./agent-install-lifecycle";

describe("installAgentAndRestoreRuntimes", () => {
  // @lat: [[desktop-security#Runtime security#Agent checkout migration]]
  it("defers for active Desktop, cron, or dashboard work across profiles", () => {
    const profiles = [{ id: "default" }, { id: "worker" }];
    expect(
      agentInstallBusy(
        profiles,
        1,
        () => false,
        () => false,
      ),
    ).toBe(true);
    expect(
      agentInstallBusy(
        profiles,
        0,
        (profile) => profile === "worker",
        () => false,
      ),
    ).toBe(true);
    expect(
      agentInstallBusy(
        profiles,
        0,
        () => false,
        (profile) => profile === undefined,
      ),
    ).toBe(true);
    expect(
      agentInstallBusy(
        profiles,
        0,
        () => false,
        () => false,
      ),
    ).toBe(false);
  });

  it("restarts only processes that were running before a successful install", async () => {
    const order: string[] = [];
    const runningGateways = new Set(["default", "worker"]);
    const runningDashboards = new Set(["worker"]);
    const profiles = [
      { id: "default" },
      { id: "worker" },
      { id: "shared", gatewayShared: true },
      { id: "stopped" },
    ];

    await installAgentAndRestoreRuntimes(profiles, {
      isGatewayRunning: (profile) =>
        runningGateways.has(profile ?? "default") || profile === "shared",
      isDashboardRunning: (profile) =>
        runningDashboards.has(profile ?? "default"),
      stopGateway: async (profile) => {
        order.push(`stop-gateway:${profile ?? "default"}`);
        return true;
      },
      stopDashboard: async (profile) => {
        order.push(`stop-dashboard:${profile ?? "default"}`);
        return true;
      },
      install: async () => {
        order.push("install");
      },
      restartGateway: async (profile) => {
        order.push(`gateway:${profile ?? "default"}`);
        return true;
      },
      restartDashboard: async (profile) => {
        order.push(`dashboard:${profile ?? "default"}`);
        return true;
      },
    });

    expect(order).toEqual([
      "stop-dashboard:worker",
      "stop-gateway:default",
      "stop-gateway:worker",
      "install",
      "gateway:default",
      "gateway:worker",
      "dashboard:worker",
    ]);
  });

  it("does not begin installation until the captured runtime has exited", async () => {
    let releaseStop!: (value: boolean) => void;
    const stop = new Promise<boolean>((resolve) => {
      releaseStop = resolve;
    });
    const install = vi.fn(async () => undefined);
    const running = installAgentAndRestoreRuntimes([{ id: "default" }], {
      isGatewayRunning: () => true,
      isDashboardRunning: () => false,
      stopGateway: () => stop,
      stopDashboard: async () => true,
      install,
      restartGateway: async () => true,
      restartDashboard: async () => true,
    });
    await Promise.resolve();
    expect(install).not.toHaveBeenCalled();
    releaseStop(true);
    await running;
    expect(install).toHaveBeenCalledOnce();
  });

  it("restores only the stopped runtime topology when install fails", async () => {
    const stopGateway = vi.fn(async () => true);
    const stopDashboard = vi.fn(async () => true);
    const restartGateway = vi.fn(async () => true);
    const restartDashboard = vi.fn(async () => true);
    await expect(
      installAgentAndRestoreRuntimes([{ id: "default" }], {
        isGatewayRunning: () => true,
        isDashboardRunning: () => true,
        stopGateway,
        stopDashboard,
        install: async () => {
          throw new Error("checksum mismatch");
        },
        restartGateway,
        restartDashboard,
      }),
    ).rejects.toThrow("checksum mismatch");
    expect(stopGateway).toHaveBeenCalledOnce();
    expect(stopDashboard).toHaveBeenCalledOnce();
    expect(restartGateway).toHaveBeenCalledOnce();
    expect(restartDashboard).toHaveBeenCalledOnce();
  });

  it("attempts every restore and preserves the installer error", async () => {
    const installerError = new Error("installer failed at checkout");
    const restartGateway = vi.fn(async () => false);
    const restartDashboard = vi.fn(async () => {
      throw new Error("dashboard launch failed");
    });
    let caught: unknown;
    try {
      await installAgentAndRestoreRuntimes(
        [{ id: "default" }, { id: "worker" }],
        {
          isGatewayRunning: () => true,
          isDashboardRunning: () => true,
          stopGateway: async () => true,
          stopDashboard: async () => true,
          install: async () => {
            throw installerError;
          },
          restartGateway,
          restartDashboard,
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(restartGateway).toHaveBeenCalledTimes(2);
    expect(restartDashboard).toHaveBeenCalledTimes(2);
    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors[0]).toBe(installerError);
    expect((aggregate as Error & { cause?: unknown }).cause).toBe(
      installerError,
    );
    expect(aggregate.message).toContain("installer failed at checkout");
    expect(aggregate.message).toContain("Gateway default did not restart");
    expect(aggregate.message).toContain("dashboard launch failed");
  });

  it("reports restoration failure after an otherwise successful install", async () => {
    await expect(
      installAgentAndRestoreRuntimes([{ id: "default" }], {
        isGatewayRunning: () => true,
        isDashboardRunning: () => false,
        stopGateway: async () => true,
        stopDashboard: async () => true,
        install: async () => undefined,
        restartGateway: async () => false,
        restartDashboard: async () => true,
      }),
    ).rejects.toThrow(
      "Hermes Agent installed, but runtime restoration failed: Gateway default did not restart",
    );
  });

  it("restores a runtime whose stop was signalled but exit timed out", async () => {
    const install = vi.fn();
    const restartGateway = vi.fn(async () => true);
    await expect(
      installAgentAndRestoreRuntimes([{ id: "default" }], {
        isGatewayRunning: () => true,
        isDashboardRunning: () => false,
        stopGateway: async () => false,
        stopDashboard: async () => true,
        install,
        restartGateway,
        restartDashboard: async () => true,
      }),
    ).rejects.toThrow("Gateway default did not stop");
    expect(install).not.toHaveBeenCalled();
    expect(restartGateway).toHaveBeenCalledOnce();
  });
});
