import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { profileHome, safeWriteFile } from "./utils";
import { installSkill, listInstalledSkills } from "./skills";
import { createProfile } from "./profiles";
import { writeSoul } from "./soul";
import { listMcpServers } from "./installer";
import {
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  getEnhancedPath,
  hermesCliArgs,
} from "./installer";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import type {
  RegistryKind,
  RegistrySource,
  RegistryArtifact,
  RegistryItem,
  RegistryCatalog,
  InstalledRegistry,
  RegistryDetail,
  RegistryDetailRow,
  ModelRegistry,
} from "../shared/registry";

export type {
  RegistryKind,
  RegistryItem,
  RegistryCatalog,
} from "../shared/registry";

/**
 * The "Discover" marketplace reads its catalog from a public GitHub repo:
 *   https://github.com/hermesonehq/hermes-registry
 *
 * `index.json` is a flat list of entries, each with a `type`
 * (agent|mcp|skill|workflow) and a `path` to its folder in the repo. "Set up"
 * actions download the entry's files into the active profile.
 */
interface RegistryLocation {
  repo: string;
  branch: string;
  rawBase: string;
  repoBase: string;
  treeUrl: string;
}

function registryLocation(repo: string, branch = "main"): RegistryLocation {
  return {
    repo,
    branch,
    rawBase: `https://raw.githubusercontent.com/${repo}/refs/heads/${branch}`,
    repoBase: `https://github.com/${repo}/tree/${branch}`,
    treeUrl: `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`,
  };
}

const REGISTRIES: Record<RegistrySource, RegistryLocation> = {
  hermes: registryLocation("fathah/hermes-registry"),
  mithril: registryLocation("mithril-lang/mithril-registry"),
};
const REGISTRY_RAW_BASE = REGISTRIES.hermes.rawBase;
// Icons are served by the registry web service (from its DB), not raw GitHub —
// e.g. https://registry.hermesone.org/registry-icon/mcp/aws/icon.svg.
const REGISTRY_ICON_BASE = "https://registry.hermesone.org/registry-icon";
const MODELS_URL = `${REGISTRY_RAW_BASE}/models.json`;

/** index.json entry shape. */
interface IndexEntry {
  id: string;
  type: "agent" | "mcp" | "skill" | "workflow" | "plugin" | "tool";
  category?: string;
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  author?: string | { name?: string };
  license?: string;
  platforms?: string[];
  path?: string;
  source?: string;
  /** Repo-relative path to the entry's icon, e.g. "mcp/ableton/icon.svg". */
  icon?: string;
  installable?: boolean;
  permissions?: string[];
  artifact?: RegistryArtifact;
  requirements?: { commands?: string[] };
  tools?: string[];
  compatibility?: { platforms?: string[] } | null;
}

/** Per-entry manifest.json (mcp / agent / workflow). */
interface EntryManifest {
  description?: string;
  // Matches the engine's accepted transports. "sse" must be preserved in the
  // written config — the engine only selects its SSE client when it sees it.
  transport?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  permissions?: string[];
  entry?: string;
  requires?: string[];
  model?: string;
  tools?: string[];
  license?: string;
  compatibility?: { hermes?: string; desktop?: string } | null;
  artifact?: RegistryArtifact;
  requirements?: { commands?: string[] };
}

const TYPE_TO_KIND: Partial<Record<IndexEntry["type"], RegistryKind>> = {
  skill: "skills",
  mcp: "mcps",
  agent: "agents",
  workflow: "workflows",
  plugin: "plugins",
};

// Short-lived cache so flipping between Discover sub-tabs doesn't refetch.
// Covers the raw.githubusercontent fetches (index + models), which are
// CDN-backed and not subject to the api.github.com rate limit — so this stays
// short to keep the catalog/model list fresh. The rate-limited git-tree fetch
// caches separately for far longer (see TREE_CACHE_TTL_MS).
let cache: { at: number; data: RegistryCatalog } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

function authorName(author: IndexEntry["author"]): string | undefined {
  if (!author) return undefined;
  return typeof author === "string" ? author : author.name;
}

function toItem(e: IndexEntry, registry: RegistrySource): RegistryItem {
  const location = REGISTRIES[registry];
  const platforms = e.platforms ?? e.compatibility?.platforms;
  const currentPlatform =
    process.platform === "darwin"
      ? "macos"
      : process.platform === "win32"
        ? "windows"
        : process.platform;
  const platformCompatible =
    !platforms?.length || platforms.includes(currentPlatform);
  return {
    id: e.id,
    name: e.name || e.id,
    description: e.description || "",
    author: authorName(e.author),
    category: e.category,
    tags: e.tags,
    version: e.version,
    license: e.license,
    platforms,
    path: e.path,
    homepage: e.path ? `${location.repoBase}/${e.path}` : undefined,
    // Resolve the repo-relative icon path to the registry service's icon URL,
    // loaded as an <img> on a white tile — see the registry web UI's EntryIcon.
    icon:
      registry === "hermes" && e.icon
        ? `${REGISTRY_ICON_BASE}/${e.icon}`
        : undefined,
    registry,
    installable:
      e.type !== "tool" &&
      e.installable !== false &&
      platformCompatible &&
      (e.type !== "plugin" || e.artifact?.format === "git"),
    permissions: e.permissions,
    artifact: e.artifact,
    requirements: e.requirements,
    tools: e.tools,
  };
}

/**
 * Fetch and normalise the community catalog. Network/parse failures resolve to
 * an empty catalog (with `error` set) rather than throwing, so the screen can
 * render an empty state instead of crashing.
 */
export async function fetchRegistry(
  force = false,
): Promise<RegistryCatalog & { error?: string }> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  const data: RegistryCatalog = {
    skills: [],
    mcps: [],
    agents: [],
    workflows: [],
    plugins: [],
  };
  const results = await Promise.allSettled(
    (Object.keys(REGISTRIES) as RegistrySource[]).map(async (registry) => {
      const res = await fetch(`${REGISTRIES[registry].rawBase}/index.json`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`${registry} registry returned ${res.status}`);
      }
      return {
        registry,
        raw: (await res.json()) as { entries?: IndexEntry[] },
      };
    }),
  );
  const errors: string[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      errors.push(
        result.reason instanceof Error
          ? result.reason.message
          : "Failed to load registry",
      );
      continue;
    }
    const { registry, raw } = result.value;
    for (const entry of raw.entries ?? []) {
      const kind = TYPE_TO_KIND[entry.type];
      if (!kind || !entry.id) continue;
      const item = toItem(entry, registry);
      // Desktop delegates plugin setup to Hermes' reviewed Git installer.
      // ZIP-only UI plugins use a different release flow and are not offered
      // as runnable agent plugins here.
      if (kind === "plugins" && !item.installable) continue;
      if (!data[kind].some((existing) => existing.id === item.id)) {
        data[kind].push(item);
      }
    }
  }
  if (results.every((result) => result.status === "rejected")) {
    return { ...data, error: errors.join("; ") };
  }
  cache = { at: Date.now(), data };
  return errors.length ? { ...data, error: errors.join("; ") } : data;
}

// Short-lived cache for the model catalog (models.json).
let modelCache: { at: number; data: ModelRegistry } | null = null;

/**
 * Fetch the curated model catalog (models.json) from the registry. Network /
 * parse failures resolve to an empty provider list (with `error` set) so the
 * Models screen can render a graceful empty state.
 */
export async function fetchModelRegistry(
  force = false,
): Promise<ModelRegistry> {
  if (!force && modelCache && Date.now() - modelCache.at < CACHE_TTL_MS) {
    return modelCache.data;
  }
  try {
    const res = await fetch(MODELS_URL, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { providers: [], error: `Registry returned ${res.status}` };
    }
    const raw = (await res.json()) as ModelRegistry;
    const data: ModelRegistry = {
      schemaVersion: raw.schemaVersion,
      generated: raw.generated,
      providerCount: raw.providerCount,
      modelCount: raw.modelCount,
      providers: Array.isArray(raw.providers) ? raw.providers : [],
    };
    modelCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    return {
      providers: [],
      error: err instanceof Error ? err.message : "Failed to load models",
    };
  }
}

/**
 * Names already present in the active profile, per kind, so the UI can mark
 * catalog items as "Installed".
 */
export function listInstalledRegistry(profile?: string): InstalledRegistry {
  let skills: string[] = [];
  let mcps: string[] = [];
  let workflows: string[] = [];
  let plugins: string[] = [];
  try {
    skills = listInstalledSkills(profile).map((s) => s.name);
  } catch {
    /* ignore */
  }
  try {
    mcps = listMcpServers(profile).map((s) => s.name);
  } catch {
    /* ignore */
  }
  try {
    const dir = join(profileHome(profile), "workflows");
    if (existsSync(dir)) {
      // Workflows install as either <id>.<ext> files or <id>/ folders.
      workflows = readdirSync(dir).map((f) =>
        f.replace(/\.(js|mjs|ts|json)$/, ""),
      );
    }
  } catch {
    /* ignore */
  }
  try {
    const dir = join(profileHome(profile), "plugins");
    if (existsSync(dir)) {
      plugins = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name);
    }
  } catch {
    /* ignore */
  }
  return { skills, mcps, workflows, plugins };
}

export interface InstallResult {
  success: boolean;
  error?: string;
}

interface TrustedGitPlugin {
  id: string;
  source: string;
  commit: string;
}

export function validateGitPluginEntry(entry: IndexEntry): TrustedGitPlugin {
  if (
    entry.type !== "plugin" ||
    entry.installable === false ||
    entry.artifact?.format !== "git"
  ) {
    throw new Error("Registry entry is not an installable Git plugin");
  }
  const source = entry.artifact.url;
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error("Plugin source URL is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.username ||
    parsed.password ||
    (entry.source && entry.source !== source)
  ) {
    throw new Error(
      "Plugin source must be its reviewed public GitHub repository",
    );
  }
  const commit = entry.artifact.commit || "";
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("Plugin revision must be a full reviewed commit SHA");
  }
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(entry.id)) {
    throw new Error("Plugin id is invalid");
  }
  return { id: entry.id, source, commit };
}

async function trustedPlugin(item: RegistryItem): Promise<TrustedGitPlugin> {
  if (item.registry !== "mithril") {
    throw new Error("Plugin is not from the Mithril Registry");
  }
  const registry = item.registry;
  const res = await fetch(`${REGISTRIES[registry].rawBase}/index.json`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Registry returned ${res.status}`);
  const raw = (await res.json()) as { entries?: IndexEntry[] };
  const entry = raw.entries?.find(
    (candidate) => candidate.type === "plugin" && candidate.id === item.id,
  );
  if (!entry) throw new Error("Plugin is no longer present in the registry");
  const trusted = validateGitPluginEntry(entry);
  const platform =
    process.platform === "darwin"
      ? "macos"
      : process.platform === "win32"
        ? "windows"
        : "linux";
  const supported = entry.compatibility?.platforms;
  if (supported?.length && !supported.includes(platform)) {
    throw new Error(`Plugin does not support ${platform}`);
  }
  return trusted;
}

function pluginCliError(err: unknown): string {
  if (!(err instanceof Error)) return "Plugin install failed";
  const detail = err as Error & {
    stdout?: Buffer | string;
    stderr?: Buffer | string;
  };
  const output = [detail.stderr, detail.stdout]
    .map((value) => (value ? value.toString().trim() : ""))
    .filter(Boolean)
    .join("\n");
  return output || err.message;
}

async function installPlugin(
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  try {
    // Resolve the id again from the fixed registry URL. Never execute artifact
    // coordinates supplied by the renderer process.
    const plugin = await trustedPlugin(item);
    const args = hermesCliArgs([
      "plugins",
      "install",
      plugin.source,
      "--ref",
      plugin.commit,
      "--enable",
    ]);
    if (profile && profile !== "default") {
      args.splice(process.platform === "win32" ? 2 : 1, 0, "-p", profile);
    }
    execFileSync(HERMES_PYTHON, args, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: "pipe",
      timeout: 10 * 60 * 1000,
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: pluginCliError(err) };
  }
}

async function tryFetchText(
  path: string,
  registry: RegistrySource = "hermes",
): Promise<string> {
  try {
    const res = await fetch(`${REGISTRIES[registry].rawBase}/${path}`);
    if (!res.ok) return "";
    const text = await res.text();
    return text.trim() ? text : "";
  } catch {
    return "";
  }
}

/** Build a structured spec (lead + labeled rows) from an entry's manifest. */
function buildSpec(
  kind: RegistryKind,
  item: RegistryItem,
  m: EntryManifest | null,
): RegistryDetail {
  const rows: RegistryDetailRow[] = [];

  if (kind === "mcps" && m) {
    rows.push({
      label: "Transport",
      value: m.transport || (m.url ? "http" : "stdio"),
    });
    if (m.url) rows.push({ label: "URL", value: m.url, mono: true });
    if (m.command) {
      rows.push({
        label: "Command",
        value: [m.command, ...(m.args ?? [])].join(" "),
        mono: true,
      });
    }
    if (m.env && Object.keys(m.env).length) {
      rows.push({ label: "Environment", chips: Object.keys(m.env) });
    }
    if (m.permissions?.length) {
      rows.push({ label: "Permissions", chips: m.permissions });
    }
  } else if (kind === "agents" && m) {
    if (m.model) rows.push({ label: "Model", value: m.model, mono: true });
    if (m.tools?.length) rows.push({ label: "Tools", chips: m.tools });
  } else if (kind === "workflows" && m) {
    if (m.entry) rows.push({ label: "Entry", value: m.entry, mono: true });
    if (m.requires?.length) rows.push({ label: "Requires", chips: m.requires });
  } else if (kind === "plugins") {
    if (item.tools?.length) rows.push({ label: "Tools", chips: item.tools });
    if (item.permissions?.length) {
      rows.push({ label: "Permissions", chips: item.permissions });
    }
    if (item.requirements?.commands?.length) {
      rows.push({
        label: "Required commands",
        chips: item.requirements.commands,
      });
    }
    if (item.artifact?.commit) {
      rows.push({
        label: "Reviewed commit",
        value: item.artifact.commit,
        mono: true,
      });
    }
  }

  if (item.category) rows.push({ label: "Category", value: item.category });
  if (item.platforms?.length) {
    rows.push({ label: "Platforms", chips: item.platforms });
  }
  if (item.tags?.length) rows.push({ label: "Tags", chips: item.tags });
  const license = m?.license || item.license;
  if (license) rows.push({ label: "License", value: license });
  if (item.author) rows.push({ label: "Author", value: item.author });
  if (item.version) rows.push({ label: "Version", value: item.version });
  const compat = m?.compatibility;
  if (compat?.hermes) {
    rows.push({ label: "Requires Hermes", value: compat.hermes, mono: true });
  }

  return { description: m?.description || item.description || "", rows };
}

/**
 * Detail for an item's modal. For skills, the prose doc (SKILL.md/README) is
 * the content. For mcp/agent/workflow we always build the structured spec from
 * the manifest and attach a prose doc (AGENT.md/README) as extra context when
 * present — so the modal is never just a one-line description.
 */
export async function fetchRegistryDetail(
  kind: RegistryKind,
  item: RegistryItem,
): Promise<RegistryDetail> {
  if (!item.path) return { description: item.description || "" };
  const registry = item.registry || "hermes";

  if (kind === "skills") {
    for (const file of ["SKILL.md", "README.md"]) {
      const text = await tryFetchText(`${item.path}/${file}`, registry);
      if (text) return { markdown: text };
    }
    return { description: item.description || "" };
  }

  const m = await fetchManifest(item.path, registry);
  const detail = buildSpec(kind, item, m);
  const docFile = kind === "agents" ? "AGENT.md" : "README.md";
  const doc = await tryFetchText(`${item.path}/${docFile}`, registry);
  if (doc) detail.markdown = doc;
  return detail;
}

async function fetchManifest(
  path: string,
  registry: RegistrySource = "hermes",
): Promise<EntryManifest | null> {
  try {
    const res = await fetch(
      `${REGISTRIES[registry].rawBase}/${path}/manifest.json`,
    );
    if (!res.ok) return null;
    return (await res.json()) as EntryManifest;
  } catch {
    return null;
  }
}

/** One blob in the repo's recursive git tree. */
interface TreeBlob {
  path: string;
  type: string;
}
const treeCaches = new Map<RegistrySource, { at: number; blobs: TreeBlob[] }>();
// The recursive git tree is fetched from api.github.com, which rate-limits
// anonymous callers at 60 req/h (token auth below raises that ceiling). Cache
// it far longer than the CDN-backed raw fetches to keep that pressure low.
const TREE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** All file paths under a folder, via the cached recursive git tree. */
async function listFolderFiles(
  folder: string,
  registry: RegistrySource,
): Promise<string[]> {
  let treeCache = treeCaches.get(registry);
  if (!treeCache || Date.now() - treeCache.at >= TREE_CACHE_TTL_MS) {
    // Use GITHUB_TOKEN / GH_TOKEN when available to avoid anonymous
    // rate limits (60 req/h) on api.github.com.  Authenticated requests
    // get 5 000 req/h instead.
    const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (ghToken) headers.Authorization = `Bearer ${ghToken}`;
    const res = await fetch(REGISTRIES[registry].treeUrl, { headers });
    if (!res.ok) throw new Error(`Tree fetch failed (${res.status})`);
    const json = (await res.json()) as { tree?: TreeBlob[] };
    treeCache = { at: Date.now(), blobs: json.tree ?? [] };
    treeCaches.set(registry, treeCache);
  }
  const prefix = `${folder}/`;
  return treeCache.blobs
    .filter((b) => b.type === "blob" && b.path.startsWith(prefix))
    .map((b) => b.path);
}

/** Download every file under an entry's repo folder into a local directory. */
async function downloadFolder(
  repoFolder: string,
  destDir: string,
  registry: RegistrySource,
): Promise<InstallResult> {
  const files = await listFolderFiles(repoFolder, registry);
  if (files.length === 0) {
    return { success: false, error: "No files found for this entry" };
  }
  for (const file of files) {
    const rel = file.slice(repoFolder.length + 1);
    const res = await fetch(`${REGISTRIES[registry].rawBase}/${file}`);
    if (!res.ok) return { success: false, error: `Fetch failed: ${rel}` };
    const body = await res.text();
    safeWriteFile(join(destDir, rel), body);
  }
  return { success: true };
}

/** Quote a string for single-line YAML if it needs it. */
function yamlScalar(value: string): string {
  return /[:#{}[\],&*?|<>=!%@`"']/.test(value) || value.trim() !== value
    ? JSON.stringify(value)
    : value;
}

/**
 * Render one MCP server (from its manifest) as an indented YAML block, in the
 * exact shape the engine's config loader expects (see hermes-agent
 * `tools/mcp_tool.py`): a remote server is keyed by `url` (+ optional
 * `transport: sse` and `headers`); a local server by `command` (+ `args`,
 * `env`). The engine discriminates purely on the presence of `url`.
 */
function renderMcpYaml(id: string, m: EntryManifest): string {
  const lines: string[] = [`  ${id}:`];
  // Remote when the manifest carries a URL or declares an http/sse transport;
  // otherwise it's a stdio (subprocess) server.
  const remote = !!m.url || m.transport === "http" || m.transport === "sse";
  if (remote) {
    if (m.url) lines.push(`    url: ${yamlScalar(m.url)}`);
    // The engine only uses its SSE client when transport is explicitly "sse";
    // streamable-HTTP is the default, so we omit transport otherwise.
    if (m.transport === "sse") lines.push(`    transport: sse`);
    if (m.headers && Object.keys(m.headers).length) {
      lines.push(`    headers:`);
      for (const [k, v] of Object.entries(m.headers)) {
        lines.push(`      ${k}: ${yamlScalar(String(v))}`);
      }
    }
  } else {
    if (m.command) lines.push(`    command: ${yamlScalar(m.command)}`);
    if (m.args?.length) {
      lines.push(`    args:`);
      for (const a of m.args) lines.push(`      - ${yamlScalar(String(a))}`);
    }
    if (m.env && Object.keys(m.env).length) {
      lines.push(`    env:`);
      for (const [k, v] of Object.entries(m.env)) {
        lines.push(`      ${k}: ${yamlScalar(String(v))}`);
      }
    }
  }
  lines.push(`    enabled: true`);
  return lines.join("\n") + "\n";
}

/**
 * Add an MCP server entry under `mcp_servers:` in the profile's config.yaml.
 * Mirrors the regex-based reader in installer.ts — no YAML lib is available,
 * so we splice text directly.
 */
async function installMcp(
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  if (!item.path) return { success: false, error: "MCP entry has no path" };
  const m = await fetchManifest(item.path, item.registry || "hermes");
  if (!m || (!m.url && !m.command)) {
    return { success: false, error: "MCP manifest has no connection config" };
  }

  const configPath = join(profileHome(profile), "config.yaml");
  let content = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const block = renderMcpYaml(item.id, m);
  const sectionRe = /^mcp_servers:\s*\n/m;

  if (sectionRe.test(content)) {
    if (new RegExp(`^[ ]{2}${item.id}:\\s*$`, "m").test(content)) {
      return { success: false, error: "Already configured" };
    }
    content = content.replace(sectionRe, (mm) => mm + block);
  } else {
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += `mcp_servers:\n${block}`;
  }

  try {
    safeWriteFile(configPath, content);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to write config",
    };
  }
}

/** Download a registry skill's folder into <profile>/skills/<category>/<id>/. */
async function installRegistrySkill(
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  if (!item.path) return { success: false, error: "Skill entry has no path" };
  const category = item.category || "uncategorized";
  const dest = join(profileHome(profile), "skills", category, item.id);
  return downloadFolder(item.path, dest, item.registry || "hermes");
}

/** Download a workflow's folder into <profile>/workflows/<id>/. */
async function installWorkflow(
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  if (!item.path)
    return { success: false, error: "Workflow entry has no path" };
  const dest = join(profileHome(profile), "workflows", item.id);
  return downloadFolder(item.path, dest, item.registry || "hermes");
}

/**
 * Install a registry agent as a new profile. Cloning alone copies the default
 * persona, so the imported agent looked identical to default — the bug. We
 * fetch the agent's entry markdown (AGENT.md per the manifest) from the
 * registry and write it as the new profile's SOUL.md so the persona reflects
 * the published agent.
 */
async function installAgent(item: RegistryItem): Promise<InstallResult> {
  const created = createProfile(item.id, "default");
  if (!created.success) return created;
  if (item.path) {
    const m = await fetchManifest(item.path, item.registry || "hermes");
    const entry = m?.entry || "AGENT.md";
    const md = await tryFetchText(
      `${item.path}/${entry}`,
      item.registry || "hermes",
    );
    if (md && !writeSoul(md, item.id)) {
      return {
        success: false,
        error: "Failed to write agent persona (SOUL.md)",
      };
    }
  }
  return { success: true };
}

/**
 * Install/"set up" a catalog item into the active profile.
 *   - skill    → download the entry folder into <profile>/skills/<category>/<id>/
 *                (bundled skills, which carry `source` and no `path`, install
 *                via `hermes skills install <source>`)
 *   - mcp      → append the manifest's server to config.yaml `mcp_servers:`
 *   - agent    → clone a profile named after the agent and set its SOUL.md
 *                from the agent's AGENT.md
 *   - workflow → download the entry folder into <profile>/workflows/<id>/
 */
export async function installRegistryItem(
  kind: RegistryKind,
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  try {
    switch (kind) {
      case "skills":
        return item.path
          ? await installRegistrySkill(item, profile)
          : installSkill(item.source || item.id, profile);
      case "mcps":
        return await installMcp(item, profile);
      case "agents":
        return await installAgent(item);
      case "workflows":
        return await installWorkflow(item, profile);
      case "plugins":
        return await installPlugin(item, profile);
      default:
        return { success: false, error: "Unknown item kind" };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Install failed",
    };
  }
}
