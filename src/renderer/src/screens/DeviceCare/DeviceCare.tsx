import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  HardDrive,
  RefreshCw,
  FolderSearch,
  Trash2,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type {
  CleanupPlan,
  CleanupReceipt,
  DeviceCareHistoryEntry,
  ProtectionStatus,
  ScanJob,
  StorageReport,
} from "../../../../shared/device-care";
import "./device-care.css";

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const index = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][index]}`;
}

export default function DeviceCare(): React.JSX.Element {
  const { t, locale } = useI18n();
  const text = (key: string): string => t(`deviceCare.${key}`);
  const [tab, setTab] = useState<
    "overview" | "protection" | "storage" | "history"
  >("overview");
  const [status, setStatus] = useState<ProtectionStatus | null>(null);
  const [report, setReport] = useState<StorageReport | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState<CleanupPlan | null>(null);
  const [receipt, setReceipt] = useState<CleanupReceipt | null>(null);
  const [job, setJob] = useState<ScanJob | null>(null);
  const [history, setHistory] = useState<DeviceCareHistoryEntry[]>([]);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = window.hermesAPI.deviceCare;
  const date = (value: string): string =>
    new Date(value).toLocaleString(locale);
  const refresh = useCallback(async (): Promise<void> => {
    const [nextStatus, nextHistory, nextJob, nextRecovery] = await Promise.all([
      api.status(),
      api.history(),
      api.scanJob(),
      api.recovery(),
    ]);
    setStatus(nextStatus);
    setHistory(nextHistory);
    setJob(nextJob);
    setRecovery(nextRecovery);
  }, [api]);
  useEffect(() => {
    void refresh().catch((err) => setError(String(err)));
  }, [refresh]);
  useEffect(() => {
    if (job?.state !== "running") return;
    const timer = setInterval(() => {
      void api
        .scanJob()
        .then((next) => {
          setJob(next);
          if (next?.state !== "running")
            void refresh().catch((err) => setError(String(err)));
        })
        .catch((err) => setError(String(err)));
    }, 1000);
    return () => clearInterval(timer);
  }, [api, job?.state, refresh]);
  const perform = async (
    kind: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const analyze = (scope: "temp" | "folder"): void => {
    void perform("analysis", async () => {
      setPlan(null);
      setReceipt(null);
      setSelected([]);
      const next = await api.analyze(scope);
      if (next) {
        setReport(next);
        setTab("storage");
      }
      await refresh();
    });
  };
  const locked = !!busy || job?.state === "running";
  const facts = (items: [string, string | number][]): React.JSX.Element => (
    <dl className="device-care-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
  const protection = (
    <section className="device-care-card">
      <h2>
        <ShieldCheck size={20} />
        {text("protection")}
      </h2>
      {facts([
        [text("engine"), status?.version || text("missing")],
        [
          text("signature"),
          status?.signatureDate ? date(status.signatureDate) : text("unknown"),
        ],
      ])}
      <p>{text("resident")}</p>
      <p>{text("scanNote")}</p>
      {!status?.available && <p>{text("setup")}</p>}
      <p className="device-care-note">{text("vendor")}</p>
      <div className="device-care-actions">
        <button
          className="btn btn-primary"
          disabled={locked || !status?.available}
          onClick={() =>
            void perform("scan", async () => {
              setJob(await api.startScan());
            })
          }
        >
          <FolderSearch size={16} />
          {text("scan")}
        </button>
        {job?.state === "running" && (
          <button
            className="btn btn-secondary"
            onClick={() => void perform("cancel", () => api.cancelScan())}
          >
            {text("cancel")}
          </button>
        )}
      </div>
      {job && (
        <div className="device-care-result" aria-live="polite">
          <h3>{text(`state.${job.state}`)}</h3>
          <p className="device-care-path">{job.root}</p>
          <p>
            {text("scanned")}: {job.scannedFiles ?? "—"} · {job.providerVersion}
          </p>
          {job.findings.length > 0 ? (
            <>
              <h3>{text("findings")}</h3>
              <ul>
                {job.findings.map((finding, i) => (
                  <li key={i}>{finding}</li>
                ))}
              </ul>
            </>
          ) : job.state === "partial" || job.state === "complete" ? (
            <p>{text("noFindings")}</p>
          ) : null}
          {job.error && <p role="alert">{job.error}</p>}
          {job.output && (
            <details>
              <summary>{text("findings")}</summary>
              <pre>{job.output}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
  const storage = (
    <section className="device-care-card">
      <h2>
        <HardDrive size={20} />
        {text("storage")}
      </h2>
      <p>{text("cleanupNote")}</p>
      <div className="device-care-actions">
        <button
          className="btn btn-primary"
          disabled={locked}
          onClick={() => analyze("temp")}
        >
          {text("analyzeTemp")}
        </button>
        <button
          className="btn btn-secondary"
          disabled={locked}
          onClick={() => analyze("folder")}
        >
          {text("analyzeFolder")}
        </button>
        {busy === "analysis" && (
          <button
            className="btn btn-secondary"
            onClick={() =>
              void api.cancelAnalysis().catch((err) => setError(String(err)))
            }
          >
            {text("cancel")}
          </button>
        )}
      </div>
      {report ? (
        <div className="device-care-result" aria-live="polite">
          <p className="device-care-path">{report.root}</p>
          <p>
            {text(`state.${report.status}`)} · {date(report.observedAt)}
          </p>
          {facts([
            [text("capacity"), formatBytes(report.capacity)],
            [text("free"), formatBytes(report.freeBytes)],
            [text("logical"), formatBytes(report.logicalBytes)],
            [text("allocated"), formatBytes(report.allocatedBytes)],
            [text("files"), report.files],
            [text("skipped"), report.skipped],
          ])}
          {report.cleanupScope && (
            <>
              <h3>{text("candidates")}</h3>
              {report.candidates.length === 0 ? (
                <p>{text("empty")}</p>
              ) : (
                <>
                  <div className="device-care-candidates">
                    {report.candidates.map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(item.id)}
                          disabled={locked}
                          onChange={(event) => {
                            setPlan(null);
                            setSelected((prev) =>
                              event.target.checked
                                ? [...prev, item.id]
                                : prev.filter((id) => id !== item.id),
                            );
                          }}
                        />
                        <span>
                          {item.name}
                          <small>{date(item.modifiedAt)}</small>
                        </span>
                        <strong>{formatBytes(item.bytes)}</strong>
                      </label>
                    ))}
                  </div>
                  <button
                    className="btn btn-secondary"
                    disabled={locked || !selected.length}
                    onClick={() =>
                      void perform("plan", async () => {
                        setPlan(await api.plan(selected));
                      })
                    }
                  >
                    {text("plan")}
                  </button>
                </>
              )}
            </>
          )}
          <details>
            <summary>{text("largest")}</summary>
            <ul>
              {report.largest.map((item) => (
                <li key={item.name} className="device-care-path">
                  {item.name} · {formatBytes(item.bytes)}
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : (
        <p className="device-care-note">{text("noAnalysis")}</p>
      )}
      {plan && (
        <div className="device-care-result">
          <h3>
            {text("selected")}: {plan.items.length} · {formatBytes(plan.bytes)}
          </h3>
          <p>
            {text("expires")}: {date(plan.expiresAt)}
          </p>
          <ul>
            {plan.items.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
          <p className="device-care-path">SHA-256: {plan.digest}</p>
          <p>{text("trashNote")}</p>
          <button
            className="btn btn-primary"
            disabled={locked || Date.parse(plan.expiresAt) <= Date.now()}
            onClick={() =>
              void perform("cleanup", async () => {
                const pending = plan;
                setPlan(null);
                setReceipt(await api.execute(pending.id, pending.digest));
                setSelected([]);
                setReport(null);
                await refresh();
              })
            }
          >
            <Trash2 size={16} />
            {text("execute")}
          </button>
        </div>
      )}
      {receipt && (
        <div className="device-care-result" aria-live="polite">
          <h3>{text(`state.${receipt.status}`)}</h3>
          {facts([
            [text("moved"), receipt.moved],
            [text("skipped"), receipt.skipped],
            [text("failed"), receipt.failed],
            [text("bytesMoved"), formatBytes(receipt.movedBytes)],
            [text("before"), formatBytes(receipt.freeBytesBefore)],
            [text("after"), formatBytes(receipt.freeBytesAfter)],
          ])}
          <p>{text("trashNote")}</p>
        </div>
      )}
    </section>
  );
  return (
    <div className="device-care-page">
      <header className="device-care-header">
        <div>
          <h1>{text("title")}</h1>
          <p>{text("subtitle")}</p>
          <small>
            {text("local")}
            {status && ` · ${status.platform} · ${date(status.observedAt)}`}
          </small>
        </div>
        <button
          className="btn btn-secondary"
          disabled={locked}
          onClick={() => void perform("refresh", refresh)}
        >
          <RefreshCw size={16} />
          {text("refresh")}
        </button>
      </header>
      <nav className="device-care-tabs" aria-label={text("title")}>
        {(["overview", "protection", "storage", "history"] as const).map(
          (name) => (
            <button
              key={name}
              className={`btn ${tab === name ? "btn-primary" : "btn-secondary"}`}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => setTab(name)}
            >
              {text(name)}
            </button>
          ),
        )}
      </nav>
      {error && (
        <p className="device-care-error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">{text("loading")}</p>}
      {(tab === "overview" || tab === "protection") && protection}
      {(tab === "overview" || tab === "storage") && storage}
      {tab === "history" && (
        <section className="device-care-card">
          <h2>{text("history")}</h2>
          <p>{text("historyNote")}</p>
          <button
            className="btn btn-secondary"
            disabled={locked}
            onClick={() =>
              void perform("history", async () => {
                await api.clearHistory();
                await refresh();
              })
            }
          >
            {text("clear")}
          </button>
          {history.length ? (
            <ul className="device-care-history">
              {[...history].reverse().map((entry) => (
                <li key={entry.id}>
                  <strong>{text(`kind.${entry.kind}`)}</strong>
                  <span>
                    {text(`state.${entry.state}`)} · {date(entry.observedAt)}
                  </span>
                  <small>
                    {text("files")}: {entry.files} · {formatBytes(entry.bytes)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>{text("noHistory")}</p>
          )}
        </section>
      )}
      {recovery.length > 0 && (
        <section className="device-care-card">
          <h2>{text("recovery")}</h2>
          <p>{text("recoveryNote")}</p>
          <ul>
            {recovery.map((path) => (
              <li key={path} className="device-care-path">
                {path}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
