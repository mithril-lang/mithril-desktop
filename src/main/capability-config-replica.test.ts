import {
  mkdtempSync,
  realpathSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  statSync,
  symlinkSync,
} from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it } from "vitest";
import {
  applyCapabilityConfigReplica,
  capabilityRecord,
  planCapabilityConfig,
} from "./capability-config-replica";
import type { CapabilityData } from "@mithril/workspace/capability-data";
import type {
  ReplicaResult,
  ReplicaWrite,
} from "@mithril/workspace/replica-sync";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const raw =
  'model:\n  api_key: PRIVATE_MODEL_KEY\nplatform_toolsets:\n  cli:\n    - web\n    - future_tool\n  telegram:\n    - memory\nmcp_servers:\n  evidence:\n    url: "https://example.com/mcp"\n    auth: "PRIVATE_MCP_KEY"\n    enabled: true\n    timeout: 31\nnetwork:\n  proxy: unchanged\n';
interface Fixture {
  root: string;
  source: CapabilityData;
  next: CapabilityData;
  write: ReplicaWrite;
  hash(value: string): string;
  apply(
    input?: ReplicaWrite,
    state?: CapabilityData,
    captured?: string,
  ): ReplicaResult;
}
function fixture(): Fixture {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-capability-config-")),
  );
  roots.push(root);
  writeFileSync(join(root, "config.yaml"), raw);
  const source: CapabilityData = {
    format: "mithril-capability-v1",
    profile: "default",
    toolsets: [
      { key: "web", label: "Web", description: "Search", enabled: true },
      {
        key: "terminal",
        label: "Terminal",
        description: "Execute",
        enabled: false,
      },
    ],
    mcps: [
      {
        name: "evidence",
        type: "http",
        transport: "http",
        enabled: true,
        detail: "https://example.com/mcp",
        url: "https://example.com/mcp",
        args: [],
        envKeys: [],
        authConfigured: true,
      },
    ],
    skills: [
      {
        name: "evidence",
        category: "research",
        description: "Unchanged",
        content: "Exact SKILL.md",
      },
    ],
  };
  const next = structuredClone(source);
  next.toolsets[0].enabled = false;
  next.toolsets[1].enabled = true;
  next.mcps[0].enabled = false;
  const expected = capabilityRecord(source);
  const write: ReplicaWrite = {
    operationId: "capability-change",
    document: {
      collection: "capability",
      id: expected.id,
      revision: 2,
      body: next as never,
      deleted: false,
      updatedAt: 1,
    },
    expectedRecord: expected,
    expectedVersion: expected.version,
  };
  const hash = (value: string): string =>
    createHash("sha256").update(value).digest("hex");
  const apply = (
    input = write,
    state = source,
    captured = hash(raw),
  ): ReplicaResult =>
    applyCapabilityConfigReplica(
      root,
      "owner",
      "device",
      "/usr/bin/python3",
      state,
      input,
      captured,
    );
  return { root, source, next, write, apply, hash };
}
// @lat: [[cloud-workspace#Cloud workspace#Rich repository implementation in progress#Capability configuration writeback (draft)]]
it("updates cloud toolsets and existing MCP state without touching credentials, unknown fields or other platforms", () => {
  const f = fixture();
  expect(f.apply().status).toBe("applied");
  const changed = readFileSync(join(f.root, "config.yaml"), "utf8");
  expect(changed).toContain("    - terminal");
  expect(changed).not.toContain("    - web\n");
  for (const retained of [
    "PRIVATE_MODEL_KEY",
    "PRIVATE_MCP_KEY",
    "    - future_tool",
    "  telegram:\n    - memory",
    "    timeout: 31",
    "network:\n  proxy: unchanged",
  ])
    expect(changed).toContain(retained);
  expect(changed).toContain("    enabled: false");
  const receipt = readdirSync(join(f.root, "memories")).find((file) =>
    file.startsWith("secret.mithril-capability-receipt-"),
  )!;
  expect(receipt).toBeTruthy();
  if (process.platform !== "win32")
    expect(statSync(join(f.root, "memories", receipt)).mode & 0o777).toBe(
      0o600,
    );
});
it("retries a completed receipt without overwriting newer native changes and rejects reused operation IDs", () => {
  const f = fixture();
  expect(f.apply().status).toBe("applied");
  const newer = readFileSync(join(f.root, "config.yaml"), "utf8").replace(
    "proxy: unchanged",
    "proxy: newer",
  );
  writeFileSync(join(f.root, "config.yaml"), newer);
  expect(f.apply(f.write, f.next, f.hash(newer)).status).toBe("applied");
  expect(readFileSync(join(f.root, "config.yaml"), "utf8")).toBe(newer);
  const changed = structuredClone(f.write);
  (changed.document.body as unknown as CapabilityData).toolsets[0].enabled =
    true;
  expect(() => f.apply(changed, f.next, f.hash(newer))).toThrow(
    "Capability operation was reused",
  );
});
it("detects source/config races and preserves config on unsupported skill or credential changes", () => {
  const f = fixture();
  writeFileSync(join(f.root, "config.yaml"), raw + "# concurrent edit\n");
  expect(f.apply().status).toBe("conflict");
  expect(readFileSync(join(f.root, "config.yaml"), "utf8")).toBe(
    raw + "# concurrent edit\n",
  );
  const next = structuredClone(f.source);
  next.skills[0].content = "Different source";
  expect(() => planCapabilityConfig(raw, f.source, next)).toThrow(
    "Skill file reconciliation",
  );
  next.skills = f.source.skills;
  next.mcps[0].url = next.mcps[0].detail = "https://other.example/mcp";
  expect(() => planCapabilityConfig(raw, f.source, next)).toThrow(
    "credentials cannot be redirected",
  );
  next.mcps[0].envKeys = ["NEW_KEY"];
  expect(() => planCapabilityConfig(raw, f.source, next)).toThrow(
    "credential references",
  );
});
it("adds, edits and removes public MCP descriptors while retaining unrelated config", () => {
  const f = fixture(),
    source = structuredClone(f.source);
  source.mcps = [];
  const clean =
    raw.slice(0, raw.indexOf("mcp_servers:")) +
    "network:\n  proxy: unchanged\n";
  const next = structuredClone(source);
  next.mcps.push({
    name: "public",
    type: "stdio",
    transport: "stdio",
    command: "node",
    args: ["script.js", 'a \\"quote\\"'],
    detail: "node",
    enabled: true,
    envKeys: [],
    authConfigured: false,
  });
  const added = planCapabilityConfig(clean, source, next);
  expect(added).toContain('    command: "node"');
  expect(added).toContain("PRIVATE_MODEL_KEY");
  const edited = structuredClone(next);
  edited.mcps[0].command = edited.mcps[0].detail = "python3";
  const updated = planCapabilityConfig(added, next, edited);
  expect(updated).toContain('    command: "python3"');
  const removed = planCapabilityConfig(updated, edited, source);
  expect(removed).not.toContain("  public:");
  expect(removed).toContain("network:\n  proxy: unchanged");
});
it("rejects symlinks and unsupported inline/aliased configuration without mutation", () => {
  const f = fixture();
  expect(() =>
    planCapabilityConfig(
      raw.replace("  cli:\n    - web\n    - future_tool", "  cli: [web]"),
      f.source,
      f.next,
    ),
  ).toThrow("Unsupported toolset");
  const alias = structuredClone(f.source);
  alias.mcps[0].authConfigured = false;
  const target = structuredClone(alias);
  target.mcps[0].url = target.mcps[0].detail = "https://new.example/mcp";
  expect(() =>
    planCapabilityConfig(
      raw.replace('auth: "PRIVATE_MCP_KEY"', "env: *private"),
      alias,
      target,
    ),
  ).toThrow("requires review");
  const outside = join(f.root, "outside.yaml");
  writeFileSync(outside, raw);
  rmSync(join(f.root, "config.yaml"));
  symlinkSync(outside, join(f.root, "config.yaml"));
  expect(f.apply().status).toBe("deferred");
  expect(readFileSync(outside, "utf8")).toBe(raw);
});

it("recovers an interrupted receipt after config replacement without repeating the write", () => {
  const f = fixture();
  expect(f.apply().status).toBe("applied");
  const file = join(
    f.root,
    "memories",
    readdirSync(join(f.root, "memories")).find((name) =>
      name.startsWith("secret.mithril-capability-receipt-"),
    )!,
  );
  const receipt = JSON.parse(readFileSync(file, "utf8"));
  receipt.state = "pending";
  writeFileSync(file, JSON.stringify(receipt));
  const current = readFileSync(join(f.root, "config.yaml"), "utf8"),
    modified = statSync(join(f.root, "config.yaml")).mtimeMs;
  expect(f.apply(f.write, f.next, f.hash(current)).status).toBe("applied");
  expect(statSync(join(f.root, "config.yaml")).mtimeMs).toBe(modified);
  expect(JSON.parse(readFileSync(file, "utf8")).state).toBe("complete");
});

it("acknowledges an already matching native descriptor without rewriting config", () => {
  const f = fixture(),
    input = structuredClone(f.write);
  input.document.body = f.source as never;
  input.expectedRecord = null;
  input.expectedVersion = null;
  const modified = statSync(join(f.root, "config.yaml")).mtimeMs;
  expect(f.apply(input).status).toBe("applied");
  expect(statSync(join(f.root, "config.yaml")).mtimeMs).toBe(modified);
});

it("uses an empty MCP mapping after deleting the last server and can add to it again", () => {
  const f = fixture(),
    target = structuredClone(f.source);
  target.mcps = [];
  const removed = planCapabilityConfig(raw, f.source, target);
  expect(removed).toContain("mcp_servers: {}");
  const next = structuredClone(target);
  next.mcps = [
    {
      name: "public",
      type: "http",
      transport: "http",
      enabled: true,
      detail: "https://public.example/mcp",
      url: "https://public.example/mcp",
      args: [],
      envKeys: [],
      authConfigured: false,
    },
  ];
  const restored = planCapabilityConfig(removed, target, next);
  expect(restored).toContain('    url: "https://public.example/mcp"');
  expect(restored).toContain("PRIVATE_MODEL_KEY");
});

it("retains aggregate tombstones and other profiles and rejects stale replica versions", () => {
  const f = fixture(),
    deleted = structuredClone(f.write);
  deleted.document.deleted = true;
  expect(f.apply(deleted).status).toBe("deferred");
  const other = structuredClone(f.write);
  (other.document.body as unknown as CapabilityData).profile = "other-profile";
  expect(f.apply(other).status).toBe("deferred");
  const stale = structuredClone(f.write);
  stale.expectedRecord!.version = stale.expectedVersion = "stale";
  expect(f.apply(stale).status).toBe("conflict");
  expect(readFileSync(join(f.root, "config.yaml"), "utf8")).toBe(raw);
});
