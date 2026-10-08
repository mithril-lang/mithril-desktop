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
  MonitorStatus,
  QuarantineCandidate,
  QuarantineEntry,
  VendorReport,
  CleanupPlan,
  CleanupReceipt,
  DeviceCareHistoryEntry,
  ProtectionStatus,
  ScanJob,
  StorageReport,
} from "../../../../shared/device-care";
import "./device-care.css";
import StorageVisualization from "./StorageVisualization";
import type { RegistryCatalog } from "../../../../shared/registry";

import { formatBytes } from "./storage-format";
export { formatBytes } from "./storage-format";

export default function DeviceCare({
  profile = "default",
}: {
  profile?: string;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const text = (key: string): string => t(`deviceCare.${key}`);
  const [tab, setTab] = useState<
    "overview" | "protection" | "storage" | "history"
  >("overview");
  const [monitor, setMonitor] = useState<MonitorStatus | null>(null);
  const [quarantineReview, setQuarantineReview] = useState<
    QuarantineCandidate[]
  >([]);
  const [quarantineEntries, setQuarantineEntries] = useState<QuarantineEntry[]>(
    [],
  );
  const [vendor, setVendor] = useState<VendorReport | null>(null);
  const [region, setRegion] = useState("jp");
  const [token, setToken] = useState("");
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
    const [
      nextStatus,
      nextHistory,
      nextJob,
      nextRecovery,
      nextMonitor,
      nextQuarantine,
      nextVendor,
    ] = await Promise.all([
      api.status(),
      api.history(),
      api.scanJob(),
      api.recovery(),
      api.monitorStatus(),
      api.quarantineEntries(),
      api.vendorStatus(),
    ]);
    setStatus(nextStatus);
    setMonitor(nextMonitor);
    setQuarantineEntries(nextQuarantine);
    setVendor((prev) =>
      prev?.configured &&
      nextVendor.configured &&
      prev.region === nextVendor.region
        ? {
            ...nextVendor,
            alerts: prev.alerts,
            nextPage: prev.nextPage,
            observedAt: prev.observedAt,
          }
        : nextVendor,
    );
    setHistory(nextHistory);
    setJob(nextJob);
    setRecovery(nextRecovery);
  }, [api]);
  useEffect(() => {
    void refresh().catch((err) => setError(String(err)));
  }, [refresh]);
  useEffect(() => {
    if (job?.state !== "running" && !monitor?.enabled) return;
    const timer = setInterval(() => {
      void api
        .scanJob()
        .then((next) => {
          setJob(next);
          void api
            .monitorStatus()
            .then(setMonitor)
            .catch((err) => setError(String(err)));
          if (
            next?.state !== "running" &&
            (next?.id !== job?.id || next?.state !== job?.state)
          )
            void refresh().catch((err) => setError(String(err)));
        })
        .catch((err) => setError(String(err)));
    }, 1000);
    return () => clearInterval(timer);
  }, [api, job?.id, job?.state, monitor?.enabled, refresh]);
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
  const analyze = (scope: "temp" | "folder" | "home"): void => {
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
  const runStorageSkill = (): void => {
    void perform("analysis", async () => {
      setPlan(null);
      setReceipt(null);
      setSelected([]);
      if (!(await api.storageSkillStatus(profile))) {
        const catalog = (await window.hermesAPI.fetchRegistry(
          true,
        )) as RegistryCatalog;
        const skill = catalog.skills.find(
          (entry) =>
            entry.id === "mithril-diskspace-management" &&
            entry.registry === "mithril",
        );
        if (!skill) throw Error(text("cleanupSkillUnavailable"));
        const installed = await window.hermesAPI.installRegistryItem(
          "skills",
          skill,
          profile,
        );
        if (!installed.success)
          throw Error(installed.error || text("cleanupSkillUnavailable"));
      }
      const next = await api.runStorageSkill(profile);
      setReport(next);
      setTab("storage");
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
      <h3>{text("monitorTitle")}</h3>
      <p>{text("monitorNote")}</p>
      <p>
        {monitor?.enabled ? text("monitorOn") : text("monitorOff")}
        {monitor?.root && ` · ${monitor.root}`}
      </p>
      {monitor?.lastRun && (
        <p>
          {text("lastRun")}: {date(monitor.lastRun)}
        </p>
      )}
      {monitor?.error && <p role="alert">{monitor.error}</p>}
      <button
        className="btn btn-secondary"
        disabled={!!busy || (!monitor?.enabled && locked) || !status?.available}
        onClick={() =>
          void perform("monitor", async () => {
            setMonitor(
              monitor?.enabled
                ? await api.stopMonitor()
                : await api.startMonitor(),
            );
          })
        }
      >
        {monitor?.enabled ? text("stopMonitor") : text("startMonitor")}
      </button>
      <p>{text("scanNote")}</p>
      {!status?.available && <p>{text("setup")}</p>}
      <p className="device-care-note">{text("vendor")}</p>
      <div className="device-care-actions">
        <button
          className="btn btn-primary"
          disabled={locked || !status?.available}
          onClick={() =>
            void perform("scan", async () => {
              setQuarantineReview([]);
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
          {!!job.findings.length && job.state === "partial" && (
            <button
              className="btn btn-secondary"
              disabled={locked}
              onClick={() =>
                void perform("review", async () => {
                  setQuarantineReview(await api.reviewQuarantine());
                })
              }
            >
              {text("reviewQuarantine")}
            </button>
          )}
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
  const responses = (
    <section className="device-care-card">
      <h2>{text("quarantineTitle")}</h2>
      <p>{text("quarantineNote")}</p>
      {quarantineReview.map((item) => (
        <div key={item.id} className="device-care-result">
          <p className="device-care-path">{item.path}</p>
          <p>
            {item.signature} · {formatBytes(item.bytes)}
          </p>
          <p className="device-care-path">SHA-256: {item.digest}</p>
          <button
            className="btn btn-primary"
            disabled={locked}
            onClick={() =>
              void perform("quarantine", async () => {
                await api.quarantine(item.id);
                setQuarantineReview([]);
                await refresh();
              })
            }
          >
            {text("quarantineAction")}
          </button>
        </div>
      ))}
      {quarantineEntries.length ? (
        quarantineEntries.map((item) => (
          <div key={item.id} className="device-care-result">
            <strong>{item.name}</strong>
            <p>
              {item.signature} · {formatBytes(item.bytes)} ·{" "}
              {text(`quarantineState.${item.state}`)}
            </p>
            <button
              className="btn btn-secondary"
              disabled={locked || item.state === "restored"}
              onClick={() =>
                void perform("restore", async () => {
                  await api.restoreQuarantine(item.id);
                  await refresh();
                })
              }
            >
              {text("restoreAction")}
            </button>
          </div>
        ))
      ) : (
        <p>{text("noQuarantine")}</p>
      )}
      <h2>{text("vendorTitle")}</h2>
      <p>{text("consumerNote")}</p>
      <p>
        {vendor?.consumerInstalled
          ? text("consumerInstalled")
          : text("consumerMissing")}
      </p>
      <button
        className="btn btn-secondary"
        disabled={!!busy || !vendor?.consumerInstalled}
        onClick={() => void perform("consumer", () => api.openConsumer())}
      >
        {text("openConsumer")}
      </button>
      <h3>Trend Vision One</h3>
      <p>{text("visionNote")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const credential = token;
          setToken("");
          void perform("vendor", async () => {
            await api.configureVendor(region, credential);
            await refresh();
          });
        }}
      >
        <label>
          {text("region")}{" "}
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            disabled={!!busy}
          >
            {["jp", "us", "eu", "au", "sg", "in"].map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text("apiToken")}{" "}
          <input
            type="password"
            value={token}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setToken(event.target.value)}
            disabled={!!busy}
          />
        </label>
        <button
          type="submit"
          className="btn btn-secondary"
          disabled={!!busy || !token}
        >
          {text("saveVendor")}
        </button>
      </form>
      <p>
        {vendor?.configured
          ? `${text("configured")} · ${vendor.region?.toUpperCase()}`
          : text("notConfigured")}
      </p>
      <div className="device-care-actions">
        <button
          className="btn btn-secondary"
          disabled={!!busy || !vendor?.configured}
          onClick={() =>
            void perform("vendor", async () =>
              setVendor(await api.vendorAlerts()),
            )
          }
        >
          {text("readAlerts")}
        </button>
        <button
          className="btn btn-secondary"
          disabled={!!busy || !vendor?.configured}
          onClick={() =>
            void perform("vendor", async () => {
              await api.disconnectVendor();
              await refresh();
            })
          }
        >
          {text("disconnectVendor")}
        </button>
      </div>
      {vendor?.alerts.map((item) => (
        <div key={item.id} className="device-care-result">
          <strong>
            {item.id} · {item.severity}
          </strong>
          <p>{item.name}</p>
          <p>{item.updatedAt}</p>
        </div>
      ))}
      {vendor?.nextPage && <p>{text("moreAlerts")}</p>}
    </section>
  );
  const storage = (
    <section className="device-care-card">
      <h2>
        <HardDrive size={20} />
        {text("storage")}
      </h2>
      <p>{text("cleanupNote")}</p>
      <div className="device-care-result">
        <h3>{text("cleanupSkillTitle")}</h3>
        <p>{text("cleanupSkillNote")}</p>
        <p>{text("cleanupSkillScope")}</p>
        <code>mithril-diskspace-management</code>
        <div className="device-care-actions">
          <button
            className="btn btn-primary"
            disabled={locked}
            onClick={runStorageSkill}
          >
            {text("runCleanupSkill")}
          </button>
        </div>
      </div>
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
        <button
          className="btn btn-secondary"
          disabled={locked}
          onClick={() => analyze("home")}
        >
          {text("analyzeHome")}
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
          {report.workflow && (
            <div role="status">
              <strong>
                {report.workflow.name} · {report.workflow.version}
              </strong>
              <p>
                {text(
                  report.workflow.state === "nothing-eligible"
                    ? "cleanupSkillEmpty"
                    : "cleanupSkillReview",
                )}
              </p>
            </div>
          )}
          <StorageVisualization
            key={report.observedAt}
            report={report}
            disabled={locked}
            onAnalyzeNode={(id) => {
              void perform("analysis", async () => {
                setPlan(null);
                setReceipt(null);
                setSelected([]);
                setReport(await api.analyzeNode(id));
                await refresh();
              });
            }}
          />
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
      {(tab === "overview" || tab === "protection") && (
        <>
          {protection}
          {responses}
        </>
      )}
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
