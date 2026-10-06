// @lat: [[mithril-code#Mithril Code#Review and measurements]]
import { useMemo } from "react";
import { CodeWorkspace } from "@mithril/workspace/code-react";
import type { CodeTransport } from "@mithril/workspace/code";
import "@mithril/workspace/code-styles.css";
export default function Code({
  profile,
  locale,
}: {
  profile: string;
  locale: string;
}): React.JSX.Element {
  const transport = useMemo<CodeTransport>(
    () => ({
      native: true,
      async request<T>(path, body, credentials): Promise<T> {
        if (path === "/api/status") {
          const r = await window.hermesAPI.codeHarness("status", "", profile);
          if (!r.ok) throw Error(r.error);
          return r as T;
        }
        const r = await window.hermesAPI.codeApi(path, body, credentials);
        if (!r.ok) throw Error(r.error);
        return r.value as T;
      },
      async run(goal) {
        const r = await window.hermesAPI.codeHarness("run", goal, profile);
        if (!r.ok) throw Error(r.error);
        if (!("result" in r)) throw Error("invalid_runner_response");
        return r.result;
      },
    }),
    [profile],
  );
  return <CodeWorkspace key={profile} transport={transport} locale={locale} />;
}
