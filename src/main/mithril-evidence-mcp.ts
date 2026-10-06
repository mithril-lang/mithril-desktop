/**
 * One-click registration of the Mithril evidence-vault MCP server (evidence_* and packet_* tools) in the
 * Capabilities → MCP tab. The server itself is `mcp/mithril-fund/server.py` in mithril-lang/mithril-agent;
 * it talks to https://api.mithril.fund/v1/evidence and /v1/packets with the user's `mf_` token.
 *
 * The token never touches config.yaml: the entry stores the reference `${MITHRIL_API_KEY}`, which the agent
 * expands from the environment that the secure-env overlay fills in memory (see mithril-sync.ts).
 */
import { existsSync } from "fs";
import { join } from "path";
import { HERMES_PYTHON, HERMES_REPO } from "./installer";
import { readMithrilToken } from "./mithril-token-store";
import {
  addMcpServer,
  listMcpServers,
  type McpOperationResult,
  type McpServerInput,
} from "./mcp-servers";
import { isRemoteMode } from "./hermes";

export const MITHRIL_EVIDENCE_MCP_NAME = "mithril-evidence";

export function mithrilEvidenceServerScript(
  repo: string = HERMES_REPO,
): string {
  return join(repo, "mcp", "mithril-fund", "server.py");
}

/** The MCP entry to write. Pure, so the shape is testable. */
export function mithrilEvidenceServerInput(
  python: string = HERMES_PYTHON,
  script: string = mithrilEvidenceServerScript(),
): McpServerInput {
  return {
    name: MITHRIL_EVIDENCE_MCP_NAME,
    type: "stdio",
    command: python,
    args: [script],
    env: { MITHRIL_API_TOKEN: "${MITHRIL_API_KEY}" },
  };
}

export async function installMithrilEvidenceMcp(
  profile?: string,
): Promise<McpOperationResult> {
  if (isRemoteMode()) {
    return {
      success: false,
      error:
        "The evidence tools are added on this computer only. Switch to the local agent first.",
    };
  }
  if (!readMithrilToken(profile)) {
    return {
      success: false,
      error: "Connect your Mithril account first (Settings → Mithril).",
    };
  }
  const script = mithrilEvidenceServerScript();
  if (!existsSync(script)) {
    return {
      success: false,
      error:
        "This agent install does not include the Mithril evidence tools (mcp/mithril-fund/server.py). Update the Mithril agent, then try again.",
    };
  }
  const existing = await listMcpServers(profile);
  if (existing.some((s) => s.name === MITHRIL_EVIDENCE_MCP_NAME)) {
    return { success: false, error: "The evidence tools are already added." };
  }
  return addMcpServer(
    mithrilEvidenceServerInput(HERMES_PYTHON, script),
    profile,
  );
}
