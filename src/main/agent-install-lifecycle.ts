export interface AgentInstallProfile {
  id: string;
  /** A named profile served by the default multiplexer is not a process. */
  gatewayShared?: boolean;
}

export interface AgentInstallLifecycleDeps {
  isGatewayRunning: (profile?: string) => boolean;
  isDashboardRunning: (profile?: string) => boolean;
  stopGateway: (profile?: string) => Promise<void>;
  stopDashboard: (profile?: string) => Promise<void>;
  install: () => Promise<void>;
  restartGateway: (profile?: string) => Promise<unknown>;
  restartDashboard: (profile?: string) => Promise<unknown>;
}

export function agentInstallBusy(
  profiles: AgentInstallProfile[],
  activeRunCount: number,
  cronBusy: (profile?: string) => boolean,
  dashboardBusy: (profile?: string) => boolean,
): boolean {
  return (
    activeRunCount > 0 ||
    profiles.some((profile) => {
      const target = profileArg(profile.id);
      return cronBusy(target) || dashboardBusy(target);
    })
  );
}

function profileArg(id: string): string | undefined {
  return id === "default" ? undefined : id;
}

/**
 * Run the pinned installer after the caller has acquired its idle gate, then
 * recreate only runtime processes that were alive before the checkout moved.
 * The installer itself owns checkout stash/rescue and exact-revision pinning.
 */
export async function installAgentAndRestoreRuntimes(
  profiles: AgentInstallProfile[],
  deps: AgentInstallLifecycleDeps,
): Promise<void> {
  const gateways = profiles.filter(
    (profile) =>
      !profile.gatewayShared && deps.isGatewayRunning(profileArg(profile.id)),
  );
  const dashboards = profiles.filter((profile) =>
    deps.isDashboardRunning(profileArg(profile.id)),
  );

  const stoppedGateways: AgentInstallProfile[] = [];
  const stoppedDashboards: AgentInstallProfile[] = [];
  try {
    for (const profile of dashboards) {
      await deps.stopDashboard(profileArg(profile.id));
      stoppedDashboards.push(profile);
    }
    for (const profile of gateways) {
      await deps.stopGateway(profileArg(profile.id));
      stoppedGateways.push(profile);
    }
    await deps.install();
  } finally {
    // Restore the pre-maintenance topology even when installation fails. The
    // installer guarantees it does not claim success for a partial checkout;
    // leaving previously-running agents stopped would compound that failure.
    for (const profile of stoppedGateways) {
      await deps.restartGateway(profileArg(profile.id));
    }
    for (const profile of stoppedDashboards) {
      await deps.restartDashboard(profileArg(profile.id));
    }
  }
}
