// @vitest-environment node
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  MITHRIL_AGENT_REPO_URL,
  PINNED_INSTALL_COMMIT,
  PINNED_INSTALL_URL,
  PINNED_WINDOWS_INSTALL_URL,
} from "../src/main/installer-download";

describe("Mithril Agent installer source", () => {
  it("pins both verified bootstraps and exposes no renderer pipe-to-shell fallback", () => {
    expect(MITHRIL_AGENT_REPO_URL).toBe(
      "https://github.com/mithril-lang/mithril-agent.git",
    );
    expect(PINNED_INSTALL_URL).toContain(PINNED_INSTALL_COMMIT);
    expect(PINNED_WINDOWS_INSTALL_URL).toContain(PINNED_INSTALL_COMMIT);

    const rendererSources = [
      "src/renderer/src/constants.ts",
      "src/renderer/src/screens/Welcome/Welcome.tsx",
    ]
      .map((file) => readFileSync(join(process.cwd(), file), "utf8"))
      .join("\n");
    expect(rendererSources).not.toMatch(/curl\s[^\n]*\|\s*(?:ba)?sh/i);
    expect(rendererSources).not.toMatch(/\birm\b|Invoke-RestMethod/i);
    expect(rendererSources).not.toContain("raw.githubusercontent.com");
  });
});
