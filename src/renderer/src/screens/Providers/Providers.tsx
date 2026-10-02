import { useState } from "react";
import MithrilAccountSection from "../../components/MithrilAccountSection";
import { useModelConfig } from "../Chat/hooks/useModelConfig";
import { useI18n } from "../../components/useI18n";
import {
  MITHRIL_PROVIDER,
  MITHRIL_PROVIDER_URL,
} from "../../../../shared/mithril-provider-policy";

export default function Providers({
  profile,
  visible,
}: {
  profile?: string;
  visible?: boolean;
}): React.JSX.Element {
  const { locale } = useI18n();
  const ja = locale === "ja";
  const model = useModelConfig(profile);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const models = model.modelGroups.flatMap((group) => group.models);
  return (
    <div className="settings-container" hidden={visible === false}>
      <div className="settings-section">
        <h2 className="settings-header">Mithril Agent</h2>
        <p className="settings-section-hint">
          {ja
            ? "Mithril アカウントで Agent に接続します。モデルは Mithril の提供する一覧から選択できます。"
            : "Connect the agent with your Mithril account. Choose a model from the Mithril catalog."}
        </p>
      </div>
      <MithrilAccountSection profile={profile} />
      <div className="settings-section">
        <div className="settings-section-title settings-section-title-row">
          <label htmlFor="mithril-agent-model">{ja ? "モデル" : "Model"}</label>
          <div className="settings-section-title-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void model.reload()}
            >
              {ja ? "モデル一覧を更新" : "Refresh models"}
            </button>
          </div>
        </div>
        <select
          id="mithril-agent-model"
          className="input"
          aria-label={ja ? "モデル" : "Model"}
          value={model.currentModel}
          disabled={saving || models.length === 0}
          onChange={async (event) => {
            setSaving(true);
            setError("");
            try {
              await model.selectModel(
                MITHRIL_PROVIDER,
                event.target.value,
                MITHRIL_PROVIDER_URL,
              );
            } catch {
              setError(
                ja
                  ? "モデルを保存できませんでした。"
                  : "Could not save the model.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          {!models.some((m) => m.model === model.currentModel) && (
            <option value={model.currentModel} disabled>
              {model.displayModel}
            </option>
          )}
          {models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.label}
            </option>
          ))}
        </select>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
