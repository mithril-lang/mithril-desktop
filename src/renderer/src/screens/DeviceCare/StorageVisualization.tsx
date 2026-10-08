import { useState } from "react";
import type { StorageReport } from "../../../../shared/device-care";
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
export default function StorageVisualization({
  report,
}: {
  report: StorageReport;
}): React.JSX.Element {
  const { t } = useI18n();
  const text = (key: string): string => t(`deviceCare.${key}`);
  const [selected, setSelected] = useState<number | null>(null);
  const occupied = volumeShare(report.capacity, report.freeBytes);
  const groups = report.groups || [];
  const label = (index: number): string =>
    groups[index].kind === "folder"
      ? groups[index].name
      : text(groups[index].kind === "files" ? "rootFiles" : "otherGroups");
  const active = selected !== null ? groups[selected] : null;
  return (
    <section className="diskspace-visualization" aria-label={text("diskMap")}>
      <h3>{text("diskMap")}</h3>
      <div className="diskspace-volume">
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
          <p>
            {text("capacity")}: <strong>{formatBytes(report.capacity)}</strong>
          </p>
          <p>
            {text("free")}: <strong>{formatBytes(report.freeBytes)}</strong>
          </p>
          <p>{text("volumeNote")}</p>
        </div>
      </div>
      <h3>{text("folderMap")}</h3>
      <p>{text("mapNote")}</p>
      {report.status !== "complete" && (
        <p role="status">{text("partialMap")}</p>
      )}
      {groups.length ? (
        <>
          <div
            className="diskspace-stack"
            role="img"
            aria-label={groups
              .map(
                (group, index) =>
                  `${label(index)}: ${formatBytes(group.logicalBytes)}`,
              )
              .join("; ")}
          >
            {groups.map((group, index) => (
              <span
                key={`${group.kind}:${group.name}`}
                className={`diskspace-color-${index % 6}`}
                style={{
                  width: `${report.logicalBytes > 0 ? (group.logicalBytes / report.logicalBytes) * 100 : 0}%`,
                }}
              />
            ))}
          </div>
          <ul className="diskspace-groups">
            {groups.map((group, index) => (
              <li key={`${group.kind}:${group.name}`}>
                <button
                  className={`btn btn-secondary diskspace-group ${selected === index ? "diskspace-selected" : ""}`}
                  aria-pressed={selected === index}
                  onClick={() => setSelected(selected === index ? null : index)}
                >
                  <span
                    className={`diskspace-swatch diskspace-color-${index % 6}`}
                    aria-hidden="true"
                  />
                  <span className="diskspace-group-name">{label(index)}</span>
                  <strong>{formatBytes(group.logicalBytes)}</strong>
                  <span>
                    {report.logicalBytes > 0
                      ? (
                          (group.logicalBytes / report.logicalBytes) *
                          100
                        ).toFixed(1)
                      : "0.0"}
                    %
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {active && selected !== null && (
            <div className="device-care-result" aria-live="polite">
              <h4>{label(selected)}</h4>
              <p>
                {text("files")}: {active.files} · {text("logical")}:{" "}
                {formatBytes(active.logicalBytes)} · {text("allocated")}:{" "}
                {formatBytes(active.allocatedBytes)}
              </p>
              <p>{text("groupNote")}</p>
            </div>
          )}
        </>
      ) : (
        <p>{text("noMeasuredFiles")}</p>
      )}
      <p>{text("allocatedNote")}</p>
    </section>
  );
}
