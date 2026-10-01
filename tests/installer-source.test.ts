// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MITHRIL_AGENT_REPO_URL,
  PINNED_INSTALL_COMMIT,
} from "../src/main/installer-download";
import {
  UNIX_INSTALL_CMD,
  WINDOWS_INSTALL_CMD,
} from "../src/renderer/src/constants";

describe("Mithril Agent installer source", () => {
  it("keeps both manual platform fallbacks on the reviewed checkout", () => {
    for (const command of [UNIX_INSTALL_CMD, WINDOWS_INSTALL_CMD]) {
      expect(command).toContain(MITHRIL_AGENT_REPO_URL);
      expect(command).toContain(PINNED_INSTALL_COMMIT);
      expect(command).toContain(
        `mithril-lang/mithril-agent/${PINNED_INSTALL_COMMIT}/scripts/install.`,
      );
    }
  });
});
