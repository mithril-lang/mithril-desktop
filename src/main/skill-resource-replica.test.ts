import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  chmodSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { captureSkillResources } from "./skill-resource-snapshot";
import {
  applySkillResources,
  recoverSkillResources,
  assertSkillResourcesReady,
} from "./skill-resource-replica";
const roots: string[] = [];
function setup(): {
  root: string;
  remote: string;
  state: string;
  captures: string;
  capture: (root: string) => ReturnType<typeof captureSkillResources>;
} {
  const home = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-skill-replica-")),
  );
  roots.push(home);
  const root = join(home, "skills"),
    remote = join(home, "remote"),
    state = join(home, "receipts"),
    captures = join(home, "captures");
  mkdirSync(root);
  mkdirSync(remote);
  return {
    root,
    remote,
    state,
    captures,
    capture: (path) =>
      captureSkillResources(
        path,
        "/usr/bin/python3",
        captures,
        "capability-default",
      ),
  };
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Skill resource file transactions]]
it("applies original Skill paths, bytes and executable flags with private backups, preserving credentials and replaying without overwriting newer files", () => {
  const f = setup();
  mkdirSync(join(f.root, "research"));
  mkdirSync(join(f.remote, "research"));
  writeFileSync(join(f.root, "research", "SKILL.md"), "# Old\n");
  writeFileSync(join(f.root, "research", "remove.txt"), "original removal");
  writeFileSync(join(f.root, "research", ".env"), "PRIVATE_LOCAL");
  writeFileSync(join(f.remote, "research", "SKILL.md"), "# New\n");
  writeFileSync(
    join(f.remote, "research", "run.py"),
    "raise Exception('must never execute')\n",
  );
  chmodSync(join(f.remote, "research", "run.py"), 0o755);
  writeFileSync(
    join(f.remote, "research", "asset.bin"),
    new Uint8Array([0, 255, 13]),
  );
  const before = f.capture(f.root),
    after = f.capture(f.remote);
  expect(
    applySkillResources(
      f.root,
      "/usr/bin/python3",
      f.state,
      "op",
      "fingerprint",
      before,
      after,
    ),
  ).toBe("applied");
  expect(readFileSync(join(f.root, "research", "SKILL.md"), "utf8")).toBe(
    "# New\n",
  );
  expect(readFileSync(join(f.root, "research", ".env"), "utf8")).toBe(
    "PRIVATE_LOCAL",
  );
  expect(
    readFileSync(join(f.root, "research", "asset.bin")).equals(
      Buffer.from([0, 255, 13]),
    ),
  ).toBe(true);
  expect(
    statSync(join(f.root, "research", "run.py")).mode & 0o111,
  ).toBeTruthy();
  expect(() => readFileSync(join(f.root, "research", "remove.txt"))).toThrow();
  assertSkillResourcesReady(f.root, f.state);
  const state = join(f.state, readdirSync(f.state)[0]);
  expect(readdirSync(state).some((name) => name.endsWith(".json"))).toBe(true);
  const cache = join(
    state,
    readdirSync(state).find((name) => /^[a-f0-9]{64}$/.test(name))!,
  );
  expect(
    readdirSync(cache).filter((name) => name.startsWith("backup-")).length,
  ).toBe(2);
  writeFileSync(join(f.root, "research", "SKILL.md"), "# Newer native edit\n");
  expect(
    recoverSkillResources(
      f.root,
      "/usr/bin/python3",
      f.state,
      "op",
      "fingerprint",
    ),
  ).toBe("applied");
  expect(readFileSync(join(f.root, "research", "SKILL.md"), "utf8")).toBe(
    "# Newer native edit\n",
  );
  expect(() =>
    recoverSkillResources(
      f.root,
      "/usr/bin/python3",
      f.state,
      "op",
      "different",
    ),
  ).toThrow("reused");
  before.dispose();
  after.dispose();
});
it("conflicts with intervening native edits and refuses source symlinks without modifying originals", () => {
  const f = setup();
  writeFileSync(join(f.root, "SKILL.md"), "old");
  writeFileSync(join(f.remote, "SKILL.md"), "new");
  const before = f.capture(f.root),
    after = f.capture(f.remote);
  writeFileSync(join(f.root, "SKILL.md"), "native edit");
  expect(
    applySkillResources(
      f.root,
      "/usr/bin/python3",
      f.state,
      "op",
      "fp",
      before,
      after,
    ),
  ).toBe("conflict");
  expect(readFileSync(join(f.root, "SKILL.md"), "utf8")).toBe("native edit");
  assertSkillResourcesReady(f.root, f.state);
  rmSync(join(f.root, "SKILL.md"));
  symlinkSync(join(f.remote, "SKILL.md"), join(f.root, "SKILL.md"));
  expect(
    applySkillResources(
      f.root,
      "/usr/bin/python3",
      f.state,
      "second",
      "fp",
      before,
      after,
    ),
  ).toBe("deferred");
  expect(readFileSync(join(f.remote, "SKILL.md"), "utf8")).toBe("new");
  before.dispose();
  after.dispose();
});
it("recovers interrupted multi-file changes from before/after states and blocks snapshots until recovery completes", () => {
  const f = setup();
  for (const path of ["a.txt", "b.txt"]) {
    writeFileSync(join(f.root, path), "old " + path);
    writeFileSync(join(f.remote, path), "new " + path);
  }
  const before = f.capture(f.root),
    after = f.capture(f.remote);
  expect(
    applySkillResources(
      f.root,
      "/usr/bin/python3",
      f.state,
      "op",
      "fp",
      before,
      after,
    ),
  ).toBe("applied");
  const state = join(f.state, readdirSync(f.state)[0]);
  const receiptPath = join(
    state,
    readdirSync(state).find((name) => name.endsWith(".json"))!,
  );
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  receipt.state = "pending";
  writeFileSync(receiptPath, JSON.stringify(receipt));
  writeFileSync(join(f.root, "b.txt"), "old b.txt");
  expect(() => assertSkillResourcesReady(f.root, f.state)).toThrow(
    "recovery required",
  );
  expect(
    recoverSkillResources(f.root, "/usr/bin/python3", f.state, "op", "fp"),
  ).toBe("applied");
  expect(readFileSync(join(f.root, "b.txt"), "utf8")).toBe("new b.txt");
  assertSkillResourcesReady(f.root, f.state);
  receipt.state = "pending";
  writeFileSync(receiptPath, JSON.stringify(receipt));
  writeFileSync(join(f.root, "b.txt"), "another edit");
  expect(
    recoverSkillResources(f.root, "/usr/bin/python3", f.state, "op", "fp"),
  ).toBe("conflict");
  expect(readFileSync(join(f.root, "b.txt"), "utf8")).toBe("another edit");
  expect(() => assertSkillResourcesReady(f.root, f.state)).toThrow(
    "recovery required",
  );
  before.dispose();
  after.dispose();
});
it("supports tracked file/directory replacements while retaining untracked files in the replaced directory", () => {
  const f = setup();
  writeFileSync(join(f.root, "shape"), "old file");
  mkdirSync(join(f.remote, "shape"));
  writeFileSync(join(f.remote, "shape", "nested.txt"), "new nested");
  let before = f.capture(f.root),
    after = f.capture(f.remote);
  expect(
    applySkillResources(
      f.root,
      "/usr/bin/python3",
      f.state,
      "first",
      "fp",
      before,
      after,
    ),
  ).toBe("applied");
  before.dispose();
  after.dispose();
  rmSync(join(f.remote, "shape"), { recursive: true });
  writeFileSync(join(f.remote, "shape"), "new file");
  before = f.capture(f.root);
  after = f.capture(f.remote);
  writeFileSync(join(f.root, "shape", ".env"), "LOCAL_ONLY");
  expect(
    applySkillResources(
      f.root,
      "/usr/bin/python3",
      f.state,
      "second",
      "fp",
      before,
      after,
    ),
  ).toBe("conflict");
  expect(readFileSync(join(f.root, "shape", ".env"), "utf8")).toBe(
    "LOCAL_ONLY",
  );
  rmSync(join(f.root, "shape", ".env"));
  expect(
    recoverSkillResources(f.root, "/usr/bin/python3", f.state, "second", "fp"),
  ).toBe("applied");
  expect(readFileSync(join(f.root, "shape"), "utf8")).toBe("new file");
  before.dispose();
  after.dispose();
});

it("recovers after the real interpreter exits following the first atomic file replacement", () => {
  const f = setup();
  for (const path of ["a.txt", "b.txt"]) {
    writeFileSync(join(f.root, path), "old " + path);
    writeFileSync(join(f.remote, path), "new " + path);
  }
  const before = f.capture(f.root),
    after = f.capture(f.remote);
  const crashPython = join(f.captures, "crash-python");
  writeFileSync(
    crashPython,
    `#!/usr/bin/python3
import sys
script=sys.argv[3]
needle="     os.replace(tmp,leaf,src_dir_fd=dfd,dst_dir_fd=dfd);os.fsync(dfd)"
assert needle in script
exec(compile(script.replace(needle,needle+";os._exit(73)"),"<interrupted-skill-transaction>","exec"))
`,
    { mode: 0o700 },
  );
  expect(
    applySkillResources(
      f.root,
      crashPython,
      f.state,
      "crash",
      "fp",
      before,
      after,
    ),
  ).toBe("deferred");
  expect(readFileSync(join(f.root, "a.txt"), "utf8")).toBe("new a.txt");
  expect(readFileSync(join(f.root, "b.txt"), "utf8")).toBe("old b.txt");
  expect(() => assertSkillResourcesReady(f.root, f.state)).toThrow(
    "recovery required",
  );
  expect(
    recoverSkillResources(f.root, "/usr/bin/python3", f.state, "crash", "fp"),
  ).toBe("applied");
  expect(readFileSync(join(f.root, "b.txt"), "utf8")).toBe("new b.txt");
  assertSkillResourcesReady(f.root, f.state);
  before.dispose();
  after.dispose();
});

it("refuses a parent directory moved after capture instead of writing through a detached descriptor", () => {
  const f = setup();
  mkdirSync(join(f.root, "category"));
  mkdirSync(join(f.remote, "category"));
  writeFileSync(join(f.root, "category", "SKILL.md"), "old");
  writeFileSync(join(f.remote, "category", "SKILL.md"), "new");
  const before = f.capture(f.root),
    after = f.capture(f.remote);
  const movingPython = join(f.captures, "move-python");
  writeFileSync(
    movingPython,
    `#!/usr/bin/python3
import sys
script=sys.argv[3]
needle="     attached_parent(path,dfd)"
assert needle in script
script=script.replace(needle,"     os.rename('category','moved-category',src_dir_fd=rfd,dst_dir_fd=rfd)\\n"+needle,1)
exec(compile(script,"<moved-skill-parent>","exec"))
`,
    { mode: 0o700 },
  );
  expect(
    applySkillResources(
      f.root,
      movingPython,
      f.state,
      "move",
      "fp",
      before,
      after,
    ),
  ).toBe("conflict");
  expect(readFileSync(join(f.root, "moved-category", "SKILL.md"), "utf8")).toBe(
    "old",
  );
  expect(() => assertSkillResourcesReady(f.root, f.state)).toThrow(
    "recovery required",
  );
  before.dispose();
  after.dispose();
});
