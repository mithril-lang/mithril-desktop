import OriginalKanban from "@mithril/workspace/desktop-kanban";
import "@mithril/workspace/desktop-styles.css";
import { useI18n } from "../../components/useI18n";
export default function Kanban({
  profile,
  visible,
}: {
  profile?: string;
  visible?: boolean;
}) {
  const { t } = useI18n();
  return (
    <OriginalKanban
      api={window.hermesAPI}
      profile={profile}
      visible={visible}
      t={t}
    />
  );
}
