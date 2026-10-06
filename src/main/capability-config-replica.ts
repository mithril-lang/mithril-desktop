import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, lstatSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { MEMORY_FILE_TRANSACTION } from "./memory-file-lock";
import {
  capabilityId,
  validCapabilityData,
  type CapabilityData,
  type SharedMcp,
} from "@mithril/workspace/capability-data";
import {
  repositoryFingerprint,
  type JsonValue,
} from "@mithril/workspace/repository";
import type {
  ReplicaRecord,
  ReplicaResult,
  ReplicaWrite,
} from "@mithril/workspace/replica-sync";
const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
export function capabilityRecord(body: CapabilityData): ReplicaRecord {
  return {
    collection: "capability",
    id: capabilityId(body.profile),
    body: body as unknown as JsonValue,
    deleted: false,
    version: digest(
      repositoryFingerprint({
        body: body as unknown as JsonValue,
        deleted: false,
      }),
    ),
  };
}
interface Block {
  start: number;
  end: number;
}
function block(
  lines: string[],
  name: string,
  indent: number,
  start = 0,
  end = lines.length,
): Block | null {
  const re = new RegExp(`^${" ".repeat(indent)}${name}:\\s*(?:#.*)?$`);
  const matches = lines
    .map((line, index) =>
      re.test(line) && index >= start && index < end ? index : -1,
    )
    .filter((index) => index >= 0);
  if (matches.length > 1) throw Error("Capability configuration needs review");
  if (!matches.length) return null;
  const first = matches[0];
  let last = first + 1;
  for (; last < end; last++)
    if (
      lines[last].trim() &&
      !lines[last].trimStart().startsWith("#") &&
      (lines[last].match(/^ */)?.[0].length ?? 0) <= indent
    )
      break;
  return { start: first, end: last };
}
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
/** Preserve unrelated YAML, native credentials, unknown server fields and other platforms. No CLI is invoked. */
export function planCapabilityConfig(
  raw: string,
  source: CapabilityData,
  target: CapabilityData,
): string {
  if (
    !validCapabilityData(source) ||
    !validCapabilityData(target) ||
    source.profile !== target.profile
  )
    throw Error("Unsupported Capability configuration");
  if (!equal(source.skills, target.skills))
    throw Error("Skill file reconciliation is required");
  if (
    !equal(
      source.toolsets.map(({ key, label, description }) => ({
        key,
        label,
        description,
      })),
      target.toolsets.map(({ key, label, description }) => ({
        key,
        label,
        description,
      })),
    )
  )
    throw Error("Toolset catalog changed; review required");
  const lines = raw.split("\n");
  if (!equal(source.toolsets, target.toolsets)) {
    let parent = block(lines, "platform_toolsets", 0);
    if (!parent) {
      if (/^platform_toolsets\s*:/m.test(raw))
        throw Error("Unsupported toolset configuration");
      lines.push("platform_toolsets:");
      parent = { start: lines.length - 1, end: lines.length };
    }
    let cli = block(lines, "cli", 2, parent.start + 1, parent.end);
    // Explicit empty CLI arrays are accepted; other inline/aliased forms remain untouched.
    if (!cli) {
      const inline = lines.findIndex(
        (line, index) =>
          index > parent!.start &&
          index < parent!.end &&
          /^ {2}cli:\s*\[\]\s*(?:#.*)?$/.test(line),
      );
      if (inline >= 0) cli = { start: inline, end: inline + 1 };
      else if (
        lines
          .slice(parent.start + 1, parent.end)
          .some((line) => /^\s+cli\s*:/.test(line))
      )
        throw Error("Unsupported toolset configuration");
    }
    const known = new Set(source.toolsets.map((row) => row.key));
    const unknown: string[] = [],
      comments: string[] = [];
    for (const line of cli ? lines.slice(cli.start + 1, cli.end) : []) {
      if (!line.trim() || line.trimStart().startsWith("#")) {
        comments.push(line);
        continue;
      }
      const key = /^\s+-\s+([A-Za-z0-9_-]+)\s*(?:#.*)?$/.exec(line)?.[1];
      if (!key) throw Error("Unsupported toolset configuration");
      if (!known.has(key)) unknown.push(key);
    }
    const enabled = [
      ...new Set([
        ...unknown,
        ...target.toolsets.filter((row) => row.enabled).map((row) => row.key),
      ]),
    ].sort();
    const replacement = [
      enabled.length ? "  cli:" : "  cli: []",
      ...enabled.map((key) => `    - ${key}`),
      ...comments,
    ];
    lines.splice(
      cli?.start ?? parent.end,
      cli ? cli.end - cli.start : 0,
      ...replacement,
    );
  }
  const before = new Map(source.mcps.map((row) => [row.name, row]));
  const after = new Map(target.mcps.map((row) => [row.name, row]));
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(name),
      next = after.get(name);
    if (equal(old, next)) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name))
      throw Error("Unsupported MCP name");
    let parent = block(lines, "mcp_servers", 0);
    if (!parent) {
      const empty = lines.findIndex((line) =>
        /^mcp_servers:\s*\{\}\s*(?:#.*)?$/.test(line),
      );
      if (empty >= 0) {
        lines[empty] = "mcp_servers:";
        parent = block(lines, "mcp_servers", 0)!;
      } else {
        if (lines.some((line) => /^mcp_servers\s*:/.test(line)))
          throw Error("Unsupported MCP configuration");
        if (old) throw Error("MCP source changed before writing");
        lines.push("mcp_servers:");
        parent = { start: lines.length - 1, end: lines.length };
      }
    }
    const server = block(lines, name, 2, parent.start + 1, parent.end);
    if (!!old !== !!server) throw Error("MCP source changed before writing");
    if (!next) {
      if (server) lines.splice(server.start, server.end - server.start);
      const remaining = block(lines, "mcp_servers", 0)!;
      if (
        lines
          .slice(remaining.start + 1, remaining.end)
          .every((line) => !line.trim() || line.trimStart().startsWith("#"))
      ) {
        const comment = lines[remaining.start].indexOf("#");
        lines[remaining.start] =
          "mcp_servers: {}" +
          (comment >= 0 ? " " + lines[remaining.start].slice(comment) : "");
      }
      continue;
    }
    if (
      !equal(old?.envKeys ?? [], next.envKeys) ||
      !!old?.authConfigured !== next.authConfigured
    )
      throw Error("MCP credential references require review");
    const descriptor = (row: SharedMcp | undefined): unknown =>
      row && {
        type: row.type,
        transport: row.transport,
        url: row.url,
        command: row.command,
        args: row.args,
        detail: row.detail,
        tools: row.tools,
      };
    const changed = !equal(descriptor(old), descriptor(next));
    let content = server
      ? lines.slice(server.start, server.end)
      : [`  ${name}:`];
    if (changed) {
      if (
        [next.command ?? "", next.url ?? "", ...next.args].some((value) =>
          [...value].some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
          ),
        )
      )
        throw Error("Unsupported MCP control characters");
      if (old && (old.authConfigured || old.envKeys.length))
        throw Error("MCP credentials cannot be redirected automatically");
      if (
        next.type !== next.transport ||
        !["http", "stdio"].includes(next.type)
      )
        throw Error("Unsupported MCP transport");
      if (!equal(old?.tools, next.tools))
        throw Error("MCP tool metadata requires inspection");
      if (next.type === "http") {
        const url = new URL(next.url ?? "");
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          next.command ||
          next.args.length ||
          next.detail !== next.url
        )
          throw Error("Unsupported MCP URL");
      } else if (
        !next.command ||
        next.url ||
        next.detail !== next.command ||
        [next.command, ...next.args].some((value) =>
          /^(?:\/|[A-Za-z]:[\\/]|~[\\/])/.test(value),
        )
      )
        throw Error("MCP device paths require review");
      const kept = [content[0]];
      for (let i = 1; i < content.length; ) {
        const field = /^ {4}([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(
          content[i],
        );
        if (!field) {
          if (content[i].trim() && !content[i].trimStart().startsWith("#"))
            throw Error("Unsupported MCP configuration");
          kept.push(content[i++]);
          continue;
        }
        let end = i + 1;
        while (end < content.length && !/^ {4}\S/.test(content[end])) end++;
        if (!["url", "command", "args", "enabled"].includes(field[1])) {
          // Unknown config or aliases may contain hidden auth; never redirect them.
          if (
            !["env", "auth", "tools"].includes(field[1]) ||
            (field[1] === "env" && field[2].trim()) ||
            (field[1] === "auth" && field[2].trim())
          )
            throw Error("MCP configuration requires review before redirecting");
          kept.push(...content.slice(i, end));
        }
        i = end;
      }
      content = [
        ...kept,
        ...(next.type === "http"
          ? [`    url: ${JSON.stringify(next.url)}`]
          : [
              `    command: ${JSON.stringify(next.command)}`,
              ...(next.args.length
                ? [
                    "    args:",
                    ...next.args.map((arg) => `      - ${JSON.stringify(arg)}`),
                  ]
                : []),
            ]),
      ];
    }
    const enabledIndex = content.findIndex((line) =>
      /^ {4}enabled\s*:/.test(line),
    );
    if (enabledIndex >= 0)
      content[enabledIndex] = `    enabled: ${next.enabled}`;
    else content.push(`    enabled: ${next.enabled}`);
    lines.splice(
      server?.start ?? parent.end,
      server ? server.end - server.start : 0,
      ...content,
    );
  }
  const output = lines.join("\n");
  if (Buffer.byteLength(output) > 1048576)
    throw Error("Capability configuration is too large");
  return output;
}
const transaction =
  MEMORY_FILE_TRANSACTION.slice(
    0,
    MEMORY_FILE_TRANSACTION.indexOf("  config=read"),
  ).replace(
    "(('MEMORY.md.lock',dfd),('USER.md.lock',dfd),('SOUL.md.lock',hfd))",
    "(('config.yaml.lock',hfd),)",
  ) +
  String.raw`
  name='secret.mithril-capability-receipt-'+p['operationId']+'.json'
  text=read(name,dfd,8388608);receipt=json.loads(text) if text else None
  if receipt:
   if receipt['fingerprint']!=p['fingerprint']:raise ValueError('operation')
   if receipt['state']=='complete':print(json.dumps({'success':True}));sys.exit(0)
  current=read('config.yaml',hfd)
  if receipt is None:
   if not p['sourceMatches']:raise ValueError('conflict')
   if not p['planReady']:raise ValueError('unavailable')
   if hashlib.sha256(current.encode('utf-8')).hexdigest()!=p['expectedDigest']:raise ValueError('conflict')
   receipt={'fingerprint':p['fingerprint'],'state':'pending','before':current,'after':p['content']}
   write(name,json.dumps(receipt,ensure_ascii=False))
  if current!=receipt['after']:
   if current!=receipt['before']:raise ValueError('conflict')
   write('config.yaml',receipt['after'],hfd)
  receipt['state']='complete';write(name,json.dumps(receipt,ensure_ascii=False))
 print(json.dumps({'success':True}))
` +
  MEMORY_FILE_TRANSACTION.slice(
    MEMORY_FILE_TRANSACTION.indexOf("except Exception as error:"),
  );
function rawConfig(root: string): string {
  let path = resolve(join(root, "config.yaml"));
  for (;;) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink())
      throw Error("Unsafe Capability source");
    const parent = dirname(path);
    if (parent === path) break;
    path = parent;
  }
  const file = join(root, "config.yaml");
  if (!existsSync(file)) return "";
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 1048576)
    throw Error("Unsupported Capability source");
  const bytes = readFileSync(file);
  if (
    bytes.length > 1048576 ||
    !Buffer.from(bytes.toString("utf8")).equals(bytes)
  )
    throw Error("Unsupported Capability source");
  return bytes.toString("utf8");
}
export function applyCapabilityConfigReplica(
  root: string,
  userId: string,
  replicaId: string,
  python: string,
  source: CapabilityData,
  write: ReplicaWrite,
  sourceConfigDigest: string,
): ReplicaResult {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(write.operationId))
    throw Error("Invalid Capability operation");
  const observed = capabilityRecord(source);
  const result = (
    status: ReplicaResult["status"],
    record: ReplicaRecord = observed,
  ): ReplicaResult => ({ schemaVersion: 1, userId, replicaId, status, record });
  if (
    write.document.collection !== "capability" ||
    write.document.id !== observed.id ||
    write.document.deleted ||
    !validCapabilityData(write.document.body)
  )
    return result("deferred");
  const next = write.document.body;
  if (next.profile !== source.profile) return result("deferred");
  let raw: string;
  try {
    raw = rawConfig(root);
  } catch {
    return result("deferred");
  }
  let content = raw,
    planReady = false;
  try {
    content = planCapabilityConfig(raw, source, next);
    planReady = true;
  } catch {
    /* Retained receipts still recover safely. Unsupported new edits defer. */
  }
  const input = {
    home: root,
    operationId: write.operationId,
    fingerprint: digest(JSON.stringify([userId, replicaId, write])),
    expectedDigest: sourceConfigDigest,
    content,
    planReady,
    sourceMatches:
      (equal(write.expectedRecord, observed) &&
        write.expectedVersion === observed.version) ||
      repositoryFingerprint(write.document) === repositoryFingerprint(observed),
  };
  const execution = spawnSync(python, ["-I", "-c", transaction], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 2000,
    maxBuffer: 4096,
    windowsHide: true,
    env:
      process.platform === "win32"
        ? { SystemRoot: process.env.SystemRoot, PYTHONNOUSERSITE: "1" }
        : { PYTHONNOUSERSITE: "1" },
  });
  if (execution.error || execution.status !== 0) return result("deferred");
  let receipt: { success?: boolean; error?: string };
  try {
    receipt = JSON.parse(execution.stdout);
  } catch {
    return result("deferred");
  }
  if (receipt.error === "operation")
    throw Error("Capability operation was reused");
  if (receipt.error === "conflict") return result("conflict");
  return receipt.success
    ? result("applied", capabilityRecord(next))
    : result("deferred");
}
