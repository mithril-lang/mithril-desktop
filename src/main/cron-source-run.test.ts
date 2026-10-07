// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { OriginalScheduleAgentRuntime } from "./original-schedule-agent-binding";
import {
  callOriginalCronRun,
  callOriginalCronInspect,
  parseOriginalCronInspectResult,
  parseOriginalCronRunResult,
  validOriginalCronRunRequest,
  type OriginalCronRunRequest,
} from "./cron-source-run";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const request: OriginalCronRunRequest = {
  owner: "alice",
  profile: "default",
  operationId: "run-one",
  jobId: "job_one",
  expectedVersion: "a".repeat(64),
};
function peer(
  mode = "completed",
  command = "source-run",
): OriginalScheduleAgentRuntime {
  const cwd = mkdtempSync(join(tmpdir(), "mithril-source-run-"));
  roots.push(cwd);
  const path = join(cwd, "peer.cjs");
  writeFileSync(
    path,
    `let text='';process.stdin.on('data',v=>text+=v);process.stdin.on('end',()=>{
    const request=JSON.parse(text);
    if(process.argv.slice(2).join(',')!== '-p,'+request.profile+',cron,'+process.env.COMMAND)process.exit(2);
    const receipt={...request,status:process.env.MODE};
    if(process.env.MODE==='foreign')receipt.owner='bob';
    if(process.env.MODE==='extra')receipt.secret='synthetic-private';
    if(process.env.MODE==='lost'){process.stderr.write('synthetic-private');process.exit(1);}
    if(process.env.MODE==='oversize'){process.stdout.write('x'.repeat(70000));return;}
    process.stdout.write(JSON.stringify({success:true,receipt}));
  });`,
  );
  return {
    executable: process.execPath,
    cliArgs: [path],
    cwd,
    env: { MODE: mode, COMMAND: command },
  };
}
// @lat: [[cloud-workspace-tests#Original manual execution receipt boundary]]
it("correlates exact native receipts and never converts an unknown or rejected attempt into completion", async () => {
  for (const status of ["completed", "rejected", "unknown"] as const) {
    let checks = 0;
    const result = await callOriginalCronRun(
      request,
      peer(status),
      async () => {
        checks++;
      },
    );
    expect(result).toEqual({ success: true, receipt: { ...request, status } });
    expect(checks).toBe(2);
  }
  for (const mode of ["foreign", "extra", "lost", "oversize"])
    expect(
      await callOriginalCronRun(request, peer(mode), async () => {}),
    ).toEqual({
      success: false,
      error: "Schedule execution result unconfirmed",
    });
});
it("refuses scope changes, unexpected authority and malformed native output without leaking it", async () => {
  expect(validOriginalCronRunRequest({ ...request, executor: "web" })).toBe(
    false,
  );
  expect(
    validOriginalCronRunRequest({ ...request, expectedVersion: null }),
  ).toBe(false);
  for (const key of Object.keys(request)) {
    const receipt = { ...request, status: "completed", [key]: "foreign" };
    expect(
      parseOriginalCronRunResult(
        JSON.stringify({ success: true, receipt }),
        request,
      ).success,
    ).toBe(false);
  }
  expect(
    parseOriginalCronRunResult("Traceback /private/secret", request),
  ).toEqual({
    success: false,
    error: "Schedule execution result unconfirmed",
  });
  let checks = 0;
  expect(
    await callOriginalCronRun(request, peer(), async () => {
      if (++checks === 2) throw Error("account changed");
    }),
  ).toEqual({ success: false, error: "Schedule execution result unconfirmed" });
  expect(checks).toBe(2);
  expect(
    await callOriginalCronRun(request, peer(), async () => {
      throw Error("account changed");
    }),
  ).toEqual({
    success: false,
    error: "Schedule execution result unconfirmed",
  });
});

// Explicit local qualification uses the actual Agent checkout/interpreter, not a fake CLI.
const checkout = process.env.MITHRIL_AGENT_SOURCE_RUN_CHECKOUT;
const python = process.env.MITHRIL_AGENT_SOURCE_RUN_PYTHON;
// @lat: [[cloud-workspace-tests#Original manual execution actual Agent qualification]]
it.skipIf(!checkout || !python)(
  "executes and replays original scripts through the real Native port in A-B-A homes",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "mithril-run-agent-real-"));
    roots.push(root);
    for (const [index, name] of ["a", "b", "a"].entries()) {
      const home = join(root, name);
      mkdirSync(join(home, "scripts"), { recursive: true });
      const script = join(home, "scripts", "effect.py");
      writeFileSync(
        script,
        "from pathlib import Path\nwith Path('effects.txt').open('a') as f: f.write('effect\\n')\nprint('native original run')\n",
      );
      const env = {
        PATH: process.env.PATH,
        HERMES_HOME: home,
        HERMES_TIMEZONE: "UTC",
        PYTHONNOUSERSITE: "1",
      };
      const job = JSON.parse(
        execFileSync(
          python!,
          [
            "-c",
            "import json,sys; from cron.jobs import create_job; print(json.dumps(create_job(prompt=None,schedule='2h',script=sys.argv[1],workdir=sys.argv[2],no_agent=True,deliver='local')))",
            script,
            home,
          ],
          { cwd: checkout!, env, encoding: "utf8", timeout: 30000 },
        ),
      );
      const source = join(home, "cron", "jobs.json");
      const input = {
        ...request,
        operationId: `actual-${index}`,
        jobId: job.id,
        expectedVersion: createHash("sha256")
          .update(readFileSync(source))
          .digest("hex"),
      };
      const runtime = {
        executable: python!,
        cliArgs: [join(checkout!, "hermes")],
        cwd: checkout!,
        env,
      };
      const initial = readFileSync(source);
      expect(
        await callOriginalCronInspect(input, runtime, async () => {}),
      ).toEqual({
        success: true,
        receipt: { ...input, status: "absent" },
      });
      expect(readFileSync(source)).toEqual(initial);
      const result = await callOriginalCronRun(input, runtime, async () => {});
      expect(result).toEqual({
        success: true,
        receipt: { ...input, status: "completed" },
      });
      const updated = readFileSync(source);
      const effects = readFileSync(join(home, "effects.txt"));
      const ledger = readFileSync(join(home, "cron", "executions.db"));
      expect(
        await callOriginalCronInspect(input, runtime, async () => {}),
      ).toEqual(result);
      expect(readFileSync(join(home, "cron", "executions.db"))).toEqual(ledger);
      expect(readFileSync(join(home, "effects.txt"))).toEqual(effects);
      expect(await callOriginalCronRun(input, runtime, async () => {})).toEqual(
        result,
      );
      expect(readFileSync(source)).toEqual(updated);
      expect(
        readFileSync(join(home, "effects.txt"), "utf8").trim().split("\n"),
      ).toHaveLength(index === 2 ? 2 : 1);
      const stale = { ...input, operationId: `stale-${index}` };
      expect(await callOriginalCronRun(stale, runtime, async () => {})).toEqual(
        {
          success: true,
          receipt: { ...stale, status: "rejected" },
        },
      );
      expect(readFileSync(source)).toEqual(updated);
    }
  },
  45000,
);

// @lat: [[cloud-workspace-tests#Original manual read-only native receipt boundary]]
it("uses the bounded status command and admits absent only as inspection data", async () => {
  for (const status of ["absent", "unknown", "completed", "rejected"]) {
    const result = await callOriginalCronInspect(
      request,
      peer(status, "source-run-status"),
      async () => {},
    );
    expect(result).toEqual({ success: true, receipt: { ...request, status } });
  }
  expect(
    parseOriginalCronRunResult(
      JSON.stringify({
        success: true,
        receipt: { ...request, status: "absent" },
      }),
      request,
    ).success,
  ).toBe(false);
  expect(
    parseOriginalCronInspectResult(
      JSON.stringify({
        success: true,
        receipt: { ...request, status: "pending" },
      }),
      request,
    ).success,
  ).toBe(false);
  for (const mode of ["foreign", "extra", "lost", "oversize"])
    expect(
      (
        await callOriginalCronInspect(
          request,
          peer(mode, "source-run-status"),
          async () => {},
        )
      ).success,
    ).toBe(false);
  let checks = 0;
  expect(
    (
      await callOriginalCronInspect(
        request,
        peer("completed", "source-run-status"),
        async () => {
          if (++checks === 2) throw Error("account changed");
        },
      )
    ).success,
  ).toBe(false);
  expect(checks).toBe(2);
});
