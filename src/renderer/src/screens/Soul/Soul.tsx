import {
  Soul as SharedSoul,
  MemoryPlatform,
} from "@mithril/workspace/desktop-memory";
import { useI18n } from "../../components/useI18n";
import "@mithril/workspace/desktop-styles.css";
export default function Soul({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  return (
    <MemoryPlatform api={window.hermesAPI} t={t} locale={locale}>
      <SharedSoul profile={profile} />
    </MemoryPlatform>
  );
}
