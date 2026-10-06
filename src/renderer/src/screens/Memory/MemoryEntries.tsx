import {
  MemoryEntries as SharedMemoryEntries,
  MemoryPlatform,
  type MemoryEntriesProps,
} from "@mithril/workspace/desktop-memory";
import { useI18n } from "../../components/useI18n";
export function MemoryEntries(props: MemoryEntriesProps): React.JSX.Element {
  const { t, locale } = useI18n();
  return (
    <MemoryPlatform api={window.hermesAPI} t={t} locale={locale}>
      <SharedMemoryEntries {...props} />
    </MemoryPlatform>
  );
}
