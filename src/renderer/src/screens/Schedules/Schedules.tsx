import OriginalSchedules from "@mithril/workspace/desktop-schedules";
import "@mithril/workspace/desktop-styles.css";
import { useI18n } from "../../components/useI18n";
export default function Schedules({
  profile,
}: {
  profile?: string;
  visible?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  return <OriginalSchedules api={window.hermesAPI} profile={profile} t={t} />;
}
