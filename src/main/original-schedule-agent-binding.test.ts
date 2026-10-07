import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  bindOriginalScheduleAgent,
  prepareOriginalScheduleAgent,
  type OriginalScheduleAgentBinding,
  type OriginalScheduleAgentRuntime,
} from "./original-schedule-agent-binding";
const roots: string[] = [];
afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const request: OriginalScheduleAgentBinding = {
  owner: "account_a",
  profile: "a",
  sourceRevision: 2,
  sourceDigest: "a".repeat(64),
  authorityRevision: 3,
  nativeVersion: "b".repeat(64),
};
function runtime(mode = "ok"): OriginalScheduleAgentRuntime {
  const cwd = mkdtempSync(join(tmpdir(), "mithril-agent-binding-"));
  roots.push(cwd);
  const script = join(cwd, "peer.cjs");
  const peer = `let text='';process.stdin.on('data',v=>text+=v);process.stdin.on('end',()=>{
    const envelope=JSON.parse(text);const {owner}=envelope;const binding=envelope.binding||envelope.prepare;
    const args=process.argv.slice(2);
    const expected=envelope.prepare ? '-p,'+binding.profile+',--stdin' : '-p,'+binding.profile+',mithril-schedule-custody,--stdin';
    if(args.join(',')!==expected)process.exit(2);
    const receipt={owner,...binding,bindingDigest:'c'.repeat(64)};
    if(process.env.MODE==='foreign')receipt.profile='b';
    if(process.env.MODE==='extra')receipt.token='synthetic-secret';
    if(process.env.MODE==='lost'){process.stderr.write('synthetic-secret');process.exit(1);}
    if(process.env.MODE==='oversize'){process.stdout.write('x'.repeat(10000));return;}
    process.stdout.write(JSON.stringify({ok:true,receipt}));
  });`;
  writeFileSync(script, peer);
  const bootstrapDir = join(cwd, "plugins", "mithril-schedules");
  mkdirSync(bootstrapDir, { recursive: true });
  writeFileSync(join(bootstrapDir, "bootstrap.py"), peer);
  return {
    executable: process.execPath,
    cliArgs: [script],
    cwd,
    env: { MODE: mode },
  };
}
// @lat: [[cloud-workspace-tests#Original schedule Agent binding bridge]]
it("binds exact source/profile through bounded stdin and guards account changes around a real child", async () => {
  const calls: string[] = [];
  const guard = async (): Promise<void> => {
    calls.push("guard");
  };
  for (const profile of ["a", "b", "a"]) {
    await expect(
      bindOriginalScheduleAgent({ ...request, profile }, runtime(), guard),
    ).resolves.toEqual({ bindingDigest: "c".repeat(64) });
  }
  expect(calls).toHaveLength(6);
  let checked = 0;
  await expect(
    bindOriginalScheduleAgent(request, runtime(), async () => {
      if (++checked === 2) throw Error("Account changed");
    }),
  ).rejects.toThrow("Account changed");
});
// @lat: [[cloud-workspace-tests#Original schedule Agent binding refusal]]
it("refuses foreign, enlarged, lost receipts and malformed source anchors without exposing child output", async () => {
  for (const mode of ["foreign", "extra", "lost", "oversize"]) {
    await expect(
      bindOriginalScheduleAgent(request, runtime(mode), async () => {}),
    ).rejects.toThrow(/^Original schedule execution binding unconfirmed$/);
  }
  let calls = 0;
  for (const input of [
    { ...request, sourceRevision: 0 },
    { ...request, profile: "../b" },
    { ...request, sourceDigest: "wrong" },
    { ...request, token: "synthetic-secret" },
  ]) {
    await expect(
      bindOriginalScheduleAgent(input, runtime(), async () => {
        calls++;
      }),
    ).rejects.toThrow(/^Original schedule execution binding unconfirmed$/);
  }
  expect(calls).toBe(0);
});

// @lat: [[cloud-workspace-tests#Original schedule Agent preparation]]
it("guards both absent and existing original sources through the same bounded child without selecting execution", async () => {
  for (const nativeVersion of [null, request.nativeVersion]) {
    await expect(
      prepareOriginalScheduleAgent(
        { owner: request.owner, profile: request.profile, nativeVersion },
        runtime(),
        async () => {},
      ),
    ).resolves.toEqual({ bindingDigest: "c".repeat(64) });
    for (const mode of ["foreign", "extra", "lost", "oversize"]) {
      await expect(
        prepareOriginalScheduleAgent(
          { owner: request.owner, profile: request.profile, nativeVersion },
          runtime(mode),
          async () => {},
        ),
      ).rejects.toThrow(/^Original schedule execution binding unconfirmed$/);
    }
  }
});
