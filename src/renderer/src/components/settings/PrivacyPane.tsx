import VaultPane from "./VaultPane";
import { useState } from "react";
import {
  getMithrilMeasurementConsent,
  setMithrilMeasurementConsent,
} from "../../utils/mithril-client-days";
import { DesktopPrivacy } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import { setAnalyticsConsent } from "../../utils/analytics";
import { useSettings } from "./SettingsDataContext";
export default function PrivacyPane(): React.JSX.Element {
  const { analyticsEnabled, setAnalyticsEnabled } = useSettings();
  const i18n = useI18n();
  const [usage, setUsage] = useState(getMithrilMeasurementConsent);
  return (
    <>
      <DesktopPrivacy
        platform={{
          ...i18n,
          analyticsEnabled,
          setAnalyticsEnabled,
          setAnalyticsConsent,
        }}
      />
      <label className="flex gap-2 p-4 text-sm">
        <input
          type="checkbox"
          checked={usage}
          onChange={(event) => {
            setMithrilMeasurementConsent(event.target.checked);
            setUsage(event.target.checked);
          }}
        />
        {i18n.locale === "ja"
          ? "利用統計のため、端末種別とUTCの利用日をMithrilへ送信します。会話本文や端末識別子は送信しません。いつでも停止できます。"
          : "Share client type and UTC usage day with Mithril for usage statistics. No chat content or device identifier is sent. You can stop this at any time."}
      </label>
      <VaultPane />
    </>
  );
}
