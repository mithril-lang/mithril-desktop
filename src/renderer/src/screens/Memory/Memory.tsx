import { DesktopMemory } from "@mithril/workspace/desktop-memory";
import { useI18n } from "../../components/useI18n";
import "@mithril/workspace/desktop-styles.css";
export default function Memory({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  return (
    <DesktopMemory
      api={window.hermesAPI}
      t={t}
      locale={locale}
      profile={profile}
    />
  );
}
