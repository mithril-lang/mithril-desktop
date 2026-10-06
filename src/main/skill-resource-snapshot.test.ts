import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  symlinkSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { digestBytes } from "@mithril/workspace/files";
import {
  captureSkillResources,
  publishSkillResources,
} from "./skill-resource-snapshot";
import { createCapabilityResourceTransport } from "@mithril/workspace/capability-resources";
const roots: string[] = [];
function fixture(): {
  home: string;
  root: string;
  state: string;
  skill: string;
  capture: () => ReturnType<typeof captureSkillResources>;
} {
  const home = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-skill-resource-test-")),
  );
  roots.push(home);
  const root = join(home, "skills"),
    state = join(home, "private-captures");
  const skill = join(root, "research", "actual-directory");
  mkdirSync(join(skill, "scripts"), { recursive: true });
  writeFileSync(
    join(skill, "SKILL.md"),
    "---\nname: Different display name\n---\nSee scripts/run.py\n",
  );
  const script = join(skill, "scripts", "run.py");
  writeFileSync(script, "raise Exception('must never execute')\n");
  chmodSync(script, 0o755);
  return {
    home,
    root,
    state,
    skill,
    capture: () =>
      captureSkillResources(
        root,
        "/usr/bin/python3",
        state,
        "capability-default",
      ),
  };
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Original Skill resource capture]]
it("captures original directory names, binary data, references and executable attributes without running scripts", async () => {
  const f = fixture();
  mkdirSync(join(f.skill, "assets"));
  const binary = new Uint8Array([0, 255, 1, 13]);
  writeFileSync(join(f.skill, "assets", "payload.bin"), binary);
  writeFileSync(join(f.skill, "assets", "参照資料.md"), "元の日本語資料\n");
  writeFileSync(join(f.skill, ".env"), "PRIVATE_TEST_CREDENTIAL");
  const before = readFileSync(join(f.skill, "scripts", "run.py"));
  const capture = f.capture();
  try {
    expect(capture.manifest.files.map((file) => file.path)).toEqual([
      "research/actual-directory/SKILL.md",
      "research/actual-directory/assets/payload.bin",
      "research/actual-directory/assets/参照資料.md",
      "research/actual-directory/scripts/run.py",
    ]);
    expect(capture.manifest.files.at(-1)?.executable).toBe(true);
    expect(capture.manifest.files[1].executable).toBe(false);
    expect(capture.readChunk(capture.manifest.files[1].chunks[0])).toEqual(
      binary,
    );
    expect(capture.excluded).toBe(1);
    expect(JSON.stringify(capture.manifest)).not.toContain(f.home);
    expect(JSON.stringify(capture.manifest)).not.toContain(
      "PRIVATE_TEST_CREDENTIAL",
    );
    expect(readFileSync(join(f.skill, "scripts", "run.py"))).toEqual(before);
    expect(() => capture.readChunk("f".repeat(64))).toThrow("Unknown");
    const again = f.capture();
    expect(again.digest).toBe(capture.digest);
    again.dispose();
  } finally {
    capture.dispose();
  }
  expect(readdirSync(f.state)).toEqual([]);
});
it("rejects symlink sources and invalid Markdown without uploading a partial tree", () => {
  const f = fixture();
  symlinkSync(join(f.home, "private-captures"), join(f.skill, "references"));
  expect(f.capture).toThrow("source requires review");
  expect(readdirSync(f.state)).toEqual([]);
  rmSync(join(f.skill, "references"));
  writeFileSync(join(f.skill, "SKILL.md"), new Uint8Array([255]));
  expect(f.capture).toThrow("source requires review");
  expect(readdirSync(f.state)).toEqual([]);
});
it("represents an absent Skills tree explicitly and retains originals on missing interpreters", () => {
  const f = fixture();
  rmSync(f.root, { recursive: true });
  const capture = f.capture();
  expect(capture.manifest.files).toEqual([]);
  capture.dispose();
  expect(() =>
    captureSkillResources(
      f.root,
      join(f.home, "missing-python"),
      f.state,
      "capability-default",
    ),
  ).toThrow("unavailable");
  expect(readdirSync(f.state)).toEqual([]);
});
it("uploads binary chunks before their immutable manifest and skips verified existing manifests", async () => {
  const f = fixture(),
    capture = f.capture();
  const objects = new Map<string, Uint8Array>(),
    writes: string[] = [];
  const transport = createCapabilityResourceTransport(async (path, init) => {
    expect(new Headers(init?.headers).get("x-mithril-workspace-owner")).toBe(
      "owner",
    );
    if (init?.method === "POST") {
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer()),
        digest = await digestBytes(bytes);
      objects.set(path + "/" + digest, bytes);
      writes.push(path);
      return Response.json({ digest, size: bytes.length });
    }
    const bytes = objects.get(path);
    if (init?.method === "HEAD")
      return bytes
        ? new Response(null, {
            headers: {
              "content-length": String(bytes.length),
              "x-mithril-resource-digest": path.split("/").at(-1)!,
            },
          })
        : new Response(null, { status: 404 });
    return bytes
      ? new Response(new Uint8Array(bytes))
      : new Response("", { status: 404 });
  }).forOwner("owner");
  try {
    expect(
      await publishSkillResources(capture, transport, async () => {}),
    ).toBe(capture.digest);
    expect(writes.at(-1)).toContain("/manifests");
    const count = writes.length;
    expect(
      await publishSkillResources(capture, transport, async () => {}),
    ).toBe(capture.digest);
    expect(writes).toHaveLength(count);
    writeFileSync(
      join(f.skill, "SKILL.md"),
      "# Changed Markdown; scripts stay unchanged\n",
    );
    const changed = f.capture();
    try {
      await publishSkillResources(changed, transport, async () => {});
      // The old script chunk is verified by HEAD, so only the changed Markdown and manifest are uploaded.
      expect(writes.filter((path) => path.endsWith("/chunks"))).toHaveLength(3);
    } finally {
      changed.dispose();
    }
    const afterChange = writes.length;
    await expect(
      publishSkillResources(capture, transport, async () => {
        throw Error("Account changed");
      }),
    ).rejects.toThrow("Account changed");
    expect(writes).toHaveLength(afterChange);
  } finally {
    capture.dispose();
  }
});

it("preserves multi-chunk binary resources and refuses changed private chunk staging", () => {
  const f = fixture();
  const binary = Buffer.alloc(8 * 1024 * 1024 + 3, 7);
  writeFileSync(join(f.skill, "large.bin"), binary);
  const capture = f.capture();
  try {
    const file = capture.manifest.files.find((file) =>
      file.path.endsWith("large.bin"),
    )!;
    expect(file.chunks).toHaveLength(2);
    expect(
      Buffer.concat(
        file.chunks.map((digest) => Buffer.from(capture.readChunk(digest))),
      ).equals(binary),
    ).toBe(true);
    const stage = join(f.state, readdirSync(f.state)[0]);
    writeFileSync(join(stage, file.chunks[0]), "tampered");
    expect(() => capture.readChunk(file.chunks[0])).toThrow("changed");
    expect(readFileSync(join(f.skill, "large.bin")).equals(binary)).toBe(true);
  } finally {
    capture.dispose();
  }
});
