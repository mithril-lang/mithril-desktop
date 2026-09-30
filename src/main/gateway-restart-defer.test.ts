// @vitest-environment node
// @lat: [[office-cron-presence#Cron presence#Tests]]

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./utils", () => ({
  profilePaths: (profile?: string) => ({
    home: `/tmp/hermes/${profile ?? "default"}`,
    envFile: "",
    configFile: "",
  }),
  activeStateDbPath: (profile?: string) =>
    `/tmp/hermes/${profile ?? "default"}/state.db`,
}));

import {
  cronBusy,
  cronBusyStrict,
  dashboardTurnBusy,
  resetGatewayRestartDeferrals,
  restartGatewayWhenIdle,
  restartMithrilRuntimeWhenIdle,
} from "./gateway-restart-defer";

beforeEach(() => resetGatewayRestartDeferrals());

/** A clock and a sleep that advance together, so a 10-minute cap is a
 *  handful of arithmetic rather than ten minutes of test. */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
} {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("cronBusy", () => {
  it("asks the profile's own cron directory", () => {
    const seen: string[] = [];
    expect(
      cronBusy("work", (dir) => {
        seen.push(dir);
        return 2;
      }),
    ).toBe(true);
    expect(seen).toEqual(["/tmp/hermes/work/cron"]);
    expect(cronBusy("work", () => 0)).toBe(false);
  });

  it("reads an unreadable executions.db as idle — one broken file must not freeze every restart", () => {
    expect(
      cronBusy("work", () => {
        throw new Error("EACCES");
      }),
    ).toBe(false);
  });
});

describe("cronBusyStrict", () => {
  it("treats a missing database or legacy missing table as idle", () => {
    expect(cronBusyStrict("work", vi.fn(), () => false)).toBe(false);
    expect(
      cronBusyStrict(
        "work",
        () => {
          throw new Error("no such table: executions");
        },
        () => true,
      ),
    ).toBe(false);
  });

  it("treats an unreadable database as busy and preserves work", () => {
    expect(
      cronBusyStrict(
        "work",
        () => {
          throw new Error("database is locked");
        },
        () => true,
      ),
    ).toBe(true);
  });
});

describe("dashboardTurnBusy", () => {
  it("checks unexpired leases in the profile's state database", () => {
    const seen: string[] = [];
    expect(
      dashboardTurnBusy(
        "work",
        (path, nowSeconds) => {
          seen.push(path);
          expect(nowSeconds).toBeGreaterThan(0);
          return 1;
        },
        () => true,
      ),
    ).toBe(true);
    expect(seen).toEqual(["/tmp/hermes/work/state.db"]);
  });

  it("does not freeze refreshes when an old database lacks the lease table", () => {
    expect(
      dashboardTurnBusy(
        "work",
        () => {
          throw new Error("no such table: session_turn_leases");
        },
        () => true,
      ),
    ).toBe(false);
  });

  it("treats an unreadable existing lease database as busy", () => {
    expect(
      dashboardTurnBusy(
        "work",
        () => {
          throw new Error("database is locked");
        },
        () => true,
      ),
    ).toBe(true);
  });
});

describe("restartGatewayWhenIdle", () => {
  it("restarts at once when nothing is running", async () => {
    const restarts: (string | undefined)[] = [];
    const r = await restartGatewayWhenIdle(
      "work",
      async (p) => {
        restarts.push(p);
      },
      { busy: () => false },
    );
    expect(r).toEqual({ restarted: true, reason: "idle", waitedMs: 0 });
    expect(restarts).toEqual(["work"]);
  });

  it("waits for the in-flight job, then restarts — the run is not killed", async () => {
    const clock = fakeClock();
    const restarts: string[] = [];
    let polls = 0;
    const r = await restartGatewayWhenIdle(
      "work",
      async () => {
        restarts.push(`at ${clock.now()}`);
      },
      {
        busy: () => ++polls <= 3, // busy for the first three reads
        pollMs: 15_000,
        maxWaitMs: 600_000,
        sleep: clock.sleep,
        now: clock.now,
      },
    );
    expect(r.reason).toBe("waited");
    expect(r.waitedMs).toBe(45_000);
    expect(restarts).toEqual(["at 45000"]);
  });

  it("restarts anyway once the cap expires — a stale credential is its own failure", async () => {
    const clock = fakeClock();
    let restarted = 0;
    const r = await restartGatewayWhenIdle(
      "work",
      async () => {
        restarted += 1;
      },
      {
        busy: () => true, // never idle
        pollMs: 15_000,
        maxWaitMs: 60_000,
        sleep: clock.sleep,
        now: clock.now,
      },
    );
    expect(r).toMatchObject({ restarted: true, reason: "timeout" });
    expect(r.waitedMs).toBeGreaterThanOrEqual(60_000);
    expect(restarted).toBe(1);
  });

  it("a burst of credential writes queues ONE deferral per profile", async () => {
    const clock = fakeClock();
    let restarted = 0;
    let polls = 0;
    const opts = {
      busy: () => ++polls <= 2,
      pollMs: 15_000,
      maxWaitMs: 600_000,
      sleep: clock.sleep,
      now: clock.now,
    };
    const restart = async (): Promise<void> => {
      restarted += 1;
    };
    const a = restartGatewayWhenIdle("work", restart, opts);
    const b = restartGatewayWhenIdle("work", restart, opts);
    const c = restartGatewayWhenIdle("work", restart, opts);
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(restarted).toBe(1);
    expect(ra).toBe(rb);
    expect(rb).toBe(rc);
  });

  it("holds one deferral per profile, not one for the whole app", async () => {
    const restarts: string[] = [];
    const restart = async (p?: string): Promise<void> => {
      restarts.push(p ?? "default");
    };
    await Promise.all([
      restartGatewayWhenIdle("a", restart, { busy: () => false }),
      restartGatewayWhenIdle("b", restart, { busy: () => false }),
    ]);
    expect(restarts.sort()).toEqual(["a", "b"]);
  });

  it("does not let an overlapping gateway-only write omit a Mithril dashboard refresh", async () => {
    const restarts: string[] = [];
    await Promise.all([
      restartGatewayWhenIdle(
        "work",
        async () => {
          restarts.push("gateway");
        },
        { busy: () => false },
      ),
      restartMithrilRuntimeWhenIdle(
        "work",
        async () => {
          restarts.push("mithril-runtime");
        },
        { busy: () => false },
      ),
    ]);
    expect(restarts.sort()).toEqual(["gateway", "mithril-runtime"]);
  });

  it("never force-restarts a Mithril runtime that remains busy", async () => {
    const clock = fakeClock();
    let restarted = 0;
    const result = await restartMithrilRuntimeWhenIdle(
      "work",
      async () => {
        restarted += 1;
      },
      {
        busy: () => true,
        pollMs: 10,
        maxWaitMs: 30,
        sleep: clock.sleep,
        now: clock.now,
      },
    );
    expect(result).toEqual({ restarted: false, reason: "busy", waitedMs: 30 });
    expect(restarted).toBe(0);
  });

  it("lets the next write defer again once the first finished", async () => {
    let restarted = 0;
    const restart = async (): Promise<void> => {
      restarted += 1;
    };
    await restartGatewayWhenIdle("work", restart, { busy: () => false });
    await restartGatewayWhenIdle("work", restart, { busy: () => false });
    expect(restarted).toBe(2);
  });
});
