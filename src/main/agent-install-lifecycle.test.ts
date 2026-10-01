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
      },
      stopDashboard: async (profile) => {
        order.push(`stop-dashboard:${profile ?? "default"}`);
      },
      install: async () => {
        order.push("install");
      },
      restartGateway: async (profile) => {
        order.push(`gateway:${profile ?? "default"}`);
      },
      restartDashboard: async (profile) => {
        order.push(`dashboard:${profile ?? "default"}`);
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

  it("restores only the stopped runtime topology when install fails", async () => {
    const stopGateway = vi.fn(async () => undefined);
    const stopDashboard = vi.fn(async () => undefined);
    const restartGateway = vi.fn();
    const restartDashboard = vi.fn();
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
});
