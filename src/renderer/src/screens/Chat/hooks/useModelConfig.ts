import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MITHRIL_PROVIDER,
  MITHRIL_PROVIDER_URL,
  MITHRIL_PROVIDER_NAME,
  mithrilModelConfig,
  requireMithrilProvider,
  isMithrilProvider,
} from "../../../../../shared/mithril-provider-policy";
import { useDiscoveredModels } from "../../../hooks/useDiscoveredModels";
import { useI18n } from "../../../components/useI18n";
import type { ModelGroup } from "../types";

export function effectiveOverrideBaseUrl(
  provider: string,
  baseUrl: string,
): string {
  requireMithrilProvider(provider, baseUrl);
  return MITHRIL_PROVIDER_URL;
}
interface SavedModelForPicker {
  provider: string;
  model: string;
  name: string;
  baseUrl?: string;
}

interface UseModelConfigResult {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  reload: () => Promise<void>;
  selectModel: (
    provider: string,
    model: string,
    baseUrl: string,
    options?: { persist?: boolean },
  ) => Promise<void>;
}

export function useModelConfig(profile?: string): UseModelConfigResult {
  const { t } = useI18n();
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState(MITHRIL_PROVIDER);
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [savedModels, setSavedModels] = useState<SavedModelForPicker[]>([]);
  const loadSeqRef = useRef(0);
  const [discoveryRevision, setDiscoveryRevision] = useState(0);

  const mithrilDiscovery = useDiscoveredModels({
    provider: MITHRIL_PROVIDER,
    baseUrl: MITHRIL_PROVIDER_URL,
    profile,
    enabled: true,
    refreshToken: discoveryRevision,
  });

  const reload = useCallback(async (): Promise<void> => {
    setDiscoveryRevision((n) => n + 1);
    const seq = ++loadSeqRef.current;
    const [raw, savedModels] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
    ]);
    if (seq !== loadSeqRef.current) return;
    const mc = mithrilModelConfig(raw);
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);
    setSavedModels(
      savedModels.filter((m) => isMithrilProvider(m.provider, m.baseUrl)),
    );
  }, [profile]);

  // Initial load + reload whenever the profile changes (canonical
  // load-on-mount; setState happens inside `reload` via an awaited IPC call).
  useEffect(() => {
    reload();
  }, [reload]);

  const catalog = JSON.stringify(mithrilDiscovery.models);
  useEffect(() => {
    const ids = Array.from(new Set(JSON.parse(catalog) as string[]));
    setModelGroups(
      ids.length
        ? [
            {
              provider: MITHRIL_PROVIDER,
              providerLabel: MITHRIL_PROVIDER_NAME,
              models: ids.map((id) => ({
                provider: MITHRIL_PROVIDER,
                model: id,
                label: savedModels.find((m) => m.model === id)?.name || id,
                baseUrl: MITHRIL_PROVIDER_URL,
              })),
            },
          ]
        : [],
    );
  }, [catalog, savedModels]);

  useEffect(() => {
    return window.hermesAPI.onConnectionConfigChanged(() => {
      setModelGroups([]);
      void reload();
    });
  }, [reload]);

  useEffect(() => {
    return window.hermesAPI.onModelLibraryChanged(() => {
      void reload();
    });
  }, [reload]);

  const selectModel = useCallback(
    async (
      provider: string,
      model: string,
      baseUrl: string,
      { persist = true }: { persist?: boolean } = {},
    ): Promise<void> => {
      const effectiveBaseUrl = effectiveOverrideBaseUrl(provider, baseUrl);
      setCurrentModel(model);
      setCurrentProvider(provider);
      setCurrentBaseUrl(effectiveBaseUrl);
      // Session-only selection: update local state only, do not write to
      // config.yaml so the global default model is preserved (issue #688).
      // Advance the sequence counter so any in-flight reload() triggered by
      // onConnectionConfigChanged / onModelLibraryChanged cannot clobber the
      // session-scoped selection with the persisted value.
      if (!persist) {
        ++loadSeqRef.current;
        return;
      }
      const seq = ++loadSeqRef.current;
      try {
        await window.hermesAPI.setModelConfig(
          provider,
          model,
          effectiveBaseUrl,
          profile,
        );
        const mc = await window.hermesAPI.getModelConfig(profile);
        if (seq !== loadSeqRef.current) return;
        setCurrentModel(mc.model);
        setCurrentProvider(mc.provider);
        setCurrentBaseUrl(mc.baseUrl);
      } catch (err) {
        if (seq === loadSeqRef.current) await reload();
        throw err;
      }
    },
    [profile, reload],
  );

  const displayModel = useMemo(
    () =>
      currentModel
        ? currentModel.split("/").pop() || currentModel
        : currentProvider === "auto"
          ? t("chat.auto")
          : t("chat.noModel"),
    [currentModel, currentProvider, t],
  );

  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    modelGroups,
    displayModel,
    reload,
    selectModel,
  };
}
