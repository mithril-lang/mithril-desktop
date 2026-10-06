import {
  MemoryProfile as SharedMemoryProfile,
  MemoryPlatform,
  type MemoryProfileProps,
} from "@mithril/workspace/desktop-memory";
import { useI18n } from "../../components/useI18n";
export function MemoryProfile(props: MemoryProfileProps): React.JSX.Element {
  const { t, locale } = useI18n();
  return (
    <MemoryPlatform api={window.hermesAPI} t={t} locale={locale}>
      <SharedMemoryProfile {...props} />
    </MemoryPlatform>
  );
}
