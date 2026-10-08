import { useMemo, useState } from "react";
import { ChevronRight, Folder, File, ArrowUpLeft, Search } from "lucide-react";
import type {
  StorageNode,
  StorageReport,
} from "../../../../shared/device-care";
import { useI18n } from "../../components/useI18n";
import { formatBytes } from "./storage-format";

export function volumeShare(
  capacity: number | null,
  available: number | null,
): number | null {
  if (
    capacity === null ||
    available === null ||
    !Number.isFinite(capacity) ||
    !Number.isFinite(available) ||
    capacity <= 0 ||
    available < 0 ||
    available > capacity
  )
    return null;
  return (capacity - available) / capacity;
}
export interface MapTile {
  node: StorageNode;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
}
// Balanced partition keeps small siblings legible without changing their measured area.
export function layoutTiles(nodes: StorageNode[]): MapTile[] {
  const items = nodes
    .filter((n) => n.logicalBytes > 0)
    .map((node, color) => ({ node, color }));
  const result: MapTile[] = [];
  const split = (
    list: typeof items,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void => {
    if (!list.length) return;
    if (list.length === 1) {
      result.push({ ...list[0], x, y, width, height });
      return;
    }
    const total = list.reduce((sum, item) => sum + item.node.logicalBytes, 0);
    let cut = 1,
      first = list[0].node.logicalBytes;
    while (
      cut < list.length - 1 &&
      first + list[cut].node.logicalBytes / 2 < total / 2
    )
      first += list[cut++].node.logicalBytes;
    const share = first / total;
    if (width >= height) {
      split(list.slice(0, cut), x, y, width * share, height);
      split(list.slice(cut), x + width * share, y, width * (1 - share), height);
    } else {
      split(list.slice(0, cut), x, y, width, height * share);
      split(
        list.slice(cut),
        x,
        y + height * share,
        width,
        height * (1 - share),
      );
    }
  };
  split(items, 0, 0, 100, 100);
  return result;
}
export function storageCategory(path: string): string {
  const value = path.replaceAll("\\", "/").toLowerCase();
  if (
    /(quarantine|recovery|credentials|\.git(?:\/|$)|\.hermes|backup|\.sqlite|\.db$)/.test(
      value,
    )
  )
    return "protected";
  if (/(?:^|\/)(?:node_modules|\.npm|\.yarn|vendor|\.venv)(?:\/|$)/.test(value))
    return "dependencies";
  if (/(?:^|\/)(?:cache|caches|\.cache)(?:\/|$)/.test(value)) return "cache";
  if (/(?:^|\/)(?:logs?)(?:\/|$)|\.log$/.test(value)) return "logs";
  if (/\.(?:gguf|safetensors|pt|onnx)$|(?:^|\/)models?(?:\/|$)/.test(value))
    return "models";
  if (/(?:^|\/)downloads(?:\/|$)|\.(?:zip|dmg|iso)$/.test(value))
    return "downloads";
  return "unknown";
}
export default function StorageVisualization({
  report,
  onAnalyzeNode,
  disabled = false,
}: {
  report: StorageReport;
  onAnalyzeNode?: (id: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const text = (key: string): string => t(`deviceCare.${key}`);
  const data = useMemo(() => {
    const root: StorageNode = {
      id: "root",
      parentId: null,
      name: report.root.split(/[\\/]/).filter(Boolean).at(-1) || report.root,
      kind: "folder",
      logicalBytes: report.logicalBytes,
      allocatedBytes: report.allocatedBytes,
      files: report.files,
    };
    const nodes: StorageNode[] = report.tree?.length
      ? report.tree
      : [
          root,
          ...report.groups.map((g, i) => ({
            ...g,
            id: String(i),
            parentId: root.id,
            name:
              g.kind === "folder"
                ? g.name
                : text(g.kind === "files" ? "rootFiles" : "otherGroups"),
            kind: "folder" as const,
          })),
        ];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const children = new Map<string, StorageNode[]>();
    for (const node of nodes)
      if (node.parentId) {
        const list = children.get(node.parentId) || [];
        list.push(node);
        children.set(node.parentId, list);
      }
    for (const list of children.values())
      list.sort(
        (a, b) =>
          b.logicalBytes - a.logicalBytes || a.name.localeCompare(b.name),
      );
    return { nodes, byId, children, root: nodes.find((n) => !n.parentId)! };
    // Translation is stable for the lifetime of this report-mounted view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);
  const [folderId, setFolderId] = useState(data.root.id);
  const [selected, setSelected] = useState<string | null>(null);
  const folder = data.byId.get(folderId)!;
  const active = selected ? data.byId.get(selected) || folder : folder;
  const ancestors: StorageNode[] = [];
  let ancestor: StorageNode | undefined = folder;
  while (ancestor) {
    ancestors.unshift(ancestor);
    ancestor = ancestor.parentId ? data.byId.get(ancestor.parentId) : undefined;
  }
  const children = data.children.get(folderId) || [];
  const visible = children.slice(0, 24);
  const remainder = children.slice(24);
  const other: StorageNode = {
    id: "other",
    parentId: folderId,
    name: text("otherGroups"),
    kind: "file",
    logicalBytes: remainder.reduce((s, n) => s + n.logicalBytes, 0),
    allocatedBytes: 0,
    files: 0,
  };
  const tiles = layoutTiles(remainder.length ? [...visible, other] : visible);
  const enter = (node: StorageNode): void => {
    setSelected(node.id);
    if (node.kind === "folder" && data.children.has(node.id))
      setFolderId(node.id);
  };
  const relativePath = (node: StorageNode): string => {
    const parts = [node.name];
    let current = node.parentId ? data.byId.get(node.parentId) : undefined;
    while (current?.parentId) {
      parts.unshift(current.name);
      current = data.byId.get(current.parentId);
    }
    return parts.join("/");
  };
  const largest = data.nodes
    .filter(
      (n) =>
        n.kind === "file" &&
        n.logicalBytes > 0 &&
        (() => {
          let current = data.byId.get(n.parentId || "");
          while (current) {
            if (current.id === folderId) return true;
            current = current.parentId
              ? data.byId.get(current.parentId)
              : undefined;
          }
          return false;
        })(),
    )
    .sort((a, b) => b.logicalBytes - a.logicalBytes)
    .slice(0, 8);
  const occupied = volumeShare(report.capacity, report.freeBytes);
  const category = storageCategory(`${report.root}/${relativePath(active)}`);
  return (
    <section className="diskspace-visualization" aria-label={text("diskMap")}>
      <div className="diskspace-volume diskspace-hero">
        {occupied !== null ? (
          <svg
            viewBox="0 0 120 120"
            role="img"
            aria-label={`${text("occupied")}: ${(occupied * 100).toFixed(1)}%; ${text("free")}: ${formatBytes(report.freeBytes)}`}
          >
            <circle cx="60" cy="60" r="44" className="diskspace-ring-base" />
            <circle
              cx="60"
              cy="60"
              r="44"
              className="diskspace-ring-used"
              pathLength="100"
              strokeDasharray={`${occupied * 100} 100`}
              transform="rotate(-90 60 60)"
            />
            <text x="60" y="58" textAnchor="middle">
              {(occupied * 100).toFixed(1)}%
            </text>
            <text
              x="60"
              y="75"
              textAnchor="middle"
              className="diskspace-ring-label"
            >
              {text("occupiedShort")}
            </text>
          </svg>
        ) : (
          <p>{text("unknown")}</p>
        )}
        <div>
          <span className="diskspace-eyebrow">{text("diskMap")}</span>
          <h3 className="diskspace-free">
            {formatBytes(report.freeBytes)} <small>{text("free")}</small>
          </h3>
          <p>
            {text("capacity")}: <strong>{formatBytes(report.capacity)}</strong>
          </p>
          <p>{text("volumeNote")}</p>
        </div>
      </div>
      <div className="diskspace-map-heading">
        <div>
          <h3>{text("folderMap")}</h3>
          <p>{text("mapNote")}</p>
        </div>
        <span className="diskspace-badge">
          {text(report.status === "complete" ? "measured" : "partialShort")}
        </span>
      </div>
      {report.status !== "complete" && (
        <p role="status" className="diskspace-coverage">
          {text("partialMap")}
        </p>
      )}
      <nav className="diskspace-breadcrumb" aria-label={text("folderTrail")}>
        {ancestors.map((node) => (
          <button
            key={node.id}
            className="btn btn-secondary"
            aria-current={node.id === folderId ? "location" : undefined}
            onClick={() => {
              setFolderId(node.id);
              setSelected(null);
            }}
          >
            {node === data.root ? (
              <Folder size={14} />
            ) : (
              <ChevronRight size={14} />
            )}{" "}
            {node.name}
          </button>
        ))}
      </nav>
      <div className="diskspace-explorer">
        <div>
          <div className="diskspace-map" aria-label={text("folderMap")}>
            {tiles.length ? (
              tiles.map((tile) => (
                <button
                  key={tile.node.id}
                  className={`diskspace-tile diskspace-color-${tile.color % 6} ${selected === tile.node.id ? "diskspace-selected" : ""}`}
                  style={{
                    left: `${tile.x}%`,
                    top: `${tile.y}%`,
                    width: `${tile.width}%`,
                    height: `${tile.height}%`,
                  }}
                  disabled={tile.node.id === "other"}
                  aria-pressed={selected === tile.node.id}
                  aria-label={`${tile.node.name}: ${formatBytes(tile.node.logicalBytes)}`}
                  title={`${tile.node.name}\n${formatBytes(tile.node.logicalBytes)}`}
                  onClick={() => enter(tile.node)}
                >
                  <span>
                    {tile.node.kind === "folder" ? (
                      <Folder size={15} />
                    ) : (
                      <File size={15} />
                    )}{" "}
                    {tile.node.name}
                  </span>
                  <strong>{formatBytes(tile.node.logicalBytes)}</strong>
                </button>
              ))
            ) : (
              <p>{text("noMeasuredFiles")}</p>
            )}
          </div>
          <div className="diskspace-map-footer">
            <span>
              {formatBytes(folder.logicalBytes)} ·{" "}
              {folder.files.toLocaleString()} {text("files")}
            </span>
            {folder.parentId && (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setFolderId(folder.parentId!);
                  setSelected(null);
                }}
              >
                <ArrowUpLeft size={14} />
                {text("upFolder")}
              </button>
            )}
          </div>
          <ul className="diskspace-groups">
            {children.slice(0, 48).map((node, index) => (
              <li key={node.id}>
                <button
                  className={`btn btn-secondary diskspace-group ${selected === node.id ? "diskspace-selected" : ""}`}
                  aria-pressed={selected === node.id}
                  onClick={() => enter(node)}
                >
                  <span
                    className={`diskspace-swatch diskspace-color-${index % 6}`}
                  />
                  <span className="diskspace-group-name">{node.name}</span>
                  <strong>{formatBytes(node.logicalBytes)}</strong>
                  <span>
                    {folder.logicalBytes > 0
                      ? (
                          (node.logicalBytes / folder.logicalBytes) *
                          100
                        ).toFixed(1)
                      : "0.0"}
                    %
                  </span>
                  {node.kind === "folder" && <ChevronRight size={14} />}
                </button>
              </li>
            ))}
          </ul>
          {children.length > 48 && <p>{text("moreFolders")}</p>}
        </div>
        <aside className="diskspace-inspector">
          <span className="diskspace-eyebrow">{text("selected")}</span>
          <h3>{active.name}</h3>
          <strong className="diskspace-inspector-size">
            {formatBytes(active.logicalBytes)}
          </strong>
          <p>
            {text("allocated")}: {formatBytes(active.allocatedBytes)} ·{" "}
            {active.files} {text("files")}
          </p>
          {report.tree && active.kind === "folder" && onAnalyzeNode && (
            <button
              className="btn btn-primary"
              disabled={disabled}
              onClick={() => onAnalyzeNode(active.id)}
            >
              <Search size={15} />
              {text("inspectFolder")}
            </button>
          )}
          <div className="diskspace-cause">
            <h4>{text("causeTitle")}</h4>
            <p>{text(`cause.${category}`)}</p>
            <small>{text("causeNote")}</small>
          </div>
          <p className="device-care-note">{text("groupNote")}</p>
          <h4>{text("largest")}</h4>
          <ol className="diskspace-largest">
            {largest.map((node) => (
              <li key={node.id}>
                <button
                  onClick={() => setSelected(node.id)}
                  title={relativePath(node)}
                >
                  <span>{relativePath(node)}</span>
                  <strong>{formatBytes(node.logicalBytes)}</strong>
                </button>
              </li>
            ))}
          </ol>
          <div className="diskspace-registry">
            <h4>{text("registryWorkflow")}</h4>
            <p>{text("registryWorkflowNote")}</p>
            <code>mithril-diskspace-management</code>
          </div>
        </aside>
      </div>
      <p className="device-care-note">{text("allocatedNote")}</p>
    </section>
  );
}
