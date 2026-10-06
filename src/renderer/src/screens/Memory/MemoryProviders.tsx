import {
  MemoryProviders as SharedMemoryProviders,
  MemoryPlatform,
  type MemoryProvidersProps,
} from "@mithril/workspace/desktop-memory";
import { useI18n } from "../../components/useI18n";
export function MemoryProviders(
  props: MemoryProvidersProps,
): React.JSX.Element {
  const { t, locale } = useI18n();
  return (
    <MemoryPlatform api={window.hermesAPI} t={t} locale={locale}>
      <SharedMemoryProviders {...props} />
    </MemoryPlatform>
  );
}
