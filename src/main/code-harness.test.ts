import { afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const fixture = vi.hoisted(() => ({ script: "", root: "" }));
vi.mock("./installer", () => ({
  HERMES_PYTHON: process.execPath,
  HERMES_REPO: fixture.root,
  hermesCliArgs: (args: string[]) => [fixture.script, ...args],
  getEnhancedPath: () => process.env.PATH,
}));
vi.mock("./utils", () => ({
  profileHome: (profile: string) => {
    if (!["a", "b"].includes(profile)) throw Error("bad profile");
    return join(fixture.root, profile);
  },
}));
vi.mock("./config", () => ({
  readEnv: (profile: string) => ({ CODE_RUNNER_TOKEN: profile.repeat(32) }),
}));
vi.mock("./process-options", () => ({ HIDDEN_SUBPROCESS_OPTIONS: {} }));
import { codeHarness } from "./code-harness";
import { parseCodeHarnessResponse } from "../shared/code-harness";

fixture.root = mkdtempSync(join(tmpdir(), "code-harness-native-"));
fixture.script = join(fixture.root, "fixture.cjs");
writeFileSync(
  fixture.script,
  `const assert=require('node:assert/strict'); const path=require('node:path');
const profile=path.basename(process.env.HERMES_HOME);assert.equal(process.env.CODE_RUNNER_TOKEN,profile.repeat(32));
assert.equal(process.env.OPENROUTER_API_KEY,undefined);assert.equal(process.argv[2],'mithril-code');
let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
assert.equal(JSON.parse(input).goal,process.argv[3]==='run'?'todo':'');
console.log(JSON.stringify({ok:true,ready:true,busy:false,template:'todo'}));});`,
);
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }));

it("runs the fixed CLI with stdin and the selected profile's secrets across A B A", async () => {
  // @lat: [[mithril-code#Mithril Code#Native execution]]
  const old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "unrelated-launch-profile-key";
  try {
    for (const profile of ["a", "b", "a"])
      expect(await codeHarness("status", "", profile)).toEqual({
        ok: true,
        ready: true,
        busy: false,
        template: "todo",
      });
    expect(await codeHarness("run", "", "a")).toEqual({
      ok: false,
      error: "invalid_goal",
    });
    expect(await codeHarness("status", "", "../foreign")).toEqual({
      ok: false,
      error: "invalid_profile",
    });
  } finally {
    if (old === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = old;
  }
});

it("does not admit unverified source or raw upstream errors", () => {
  expect(
    parseCodeHarnessResponse(
      JSON.stringify({
        ok: true,
        result: {
          format: "mithril.code-project/v1",
          verified: false,
          files: {},
        },
      }),
    ).ok,
  ).toBe(false);
  expect(
    parseCodeHarnessResponse(
      JSON.stringify({ ok: false, error: "Bearer sensitive-key" }),
    ),
  ).toEqual({ ok: false, error: "invalid_runner_response" });
});
