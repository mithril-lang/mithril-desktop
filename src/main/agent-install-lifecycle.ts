export interface AgentInstallProfile {
  id: string;
  /** A named profile served by the default multiplexer is not a process. */
  gatewayShared?: boolean;
}

export interface AgentInstallLifecycleDeps {
  isGatewayRunning: (profile?: string) => boolean;
  isDashboardRunning: (profile?: string) => boolean;
  stopGateway: (profile?: string) => Promise<boolean>;
  stopDashboard: (profile?: string) => Promise<boolean>;
  install: () => Promise<void>;
  restartGateway: (profile?: string) => Promise<boolean>;
  restartDashboard: (profile?: string) => Promise<boolean>;
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
  let operationError: unknown;
  try {
    for (const profile of dashboards) {
      // Once stop is signalled, restoration is required even if the bounded
      // exit wait times out: the process may exit immediately afterward.
      stoppedDashboards.push(profile);
      if (!(await deps.stopDashboard(profileArg(profile.id)))) {
        throw new Error(`Dashboard ${profile.id} did not stop`);
      }
    }
    for (const profile of gateways) {
      stoppedGateways.push(profile);
      if (!(await deps.stopGateway(profileArg(profile.id)))) {
        throw new Error(`Gateway ${profile.id} did not stop`);
      }
    }
    await deps.install();
  } catch (error) {
    operationError = error;
  }

  // Restore every captured process even when one restoration fails. The
  // original installer/stop error stays first and as `cause` so recovery
  // diagnostics cannot mask why maintenance failed.
  const restoreErrors: Error[] = [];
  for (const profile of stoppedGateways) {
    try {
      if (!(await deps.restartGateway(profileArg(profile.id)))) {
        throw new Error(`Gateway ${profile.id} did not restart`);
      }
    } catch (error) {
      restoreErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  for (const profile of stoppedDashboards) {
    try {
      if (!(await deps.restartDashboard(profileArg(profile.id)))) {
        throw new Error(`Dashboard ${profile.id} did not restart`);
      }
    } catch (error) {
      restoreErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  if (operationError && restoreErrors.length === 0) throw operationError;
  if (operationError || restoreErrors.length > 0) {
    const primary =
      operationError instanceof Error
        ? operationError
        : operationError
          ? new Error(String(operationError))
          : null;
    const combined = new AggregateError(
      [...(primary ? [primary] : []), ...restoreErrors],
      primary
        ? `${primary.message}; runtime restoration also failed: ${restoreErrors.map((error) => error.message).join("; ")}`
        : `Hermes Agent installed, but runtime restoration failed: ${restoreErrors.map((error) => error.message).join("; ")}`,
    );
    if (primary) Object.defineProperty(combined, "cause", { value: primary });
    throw combined;
  }
}
