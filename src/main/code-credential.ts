import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, isAbsolute, join } from "node:path";
import { existsSync } from "node:fs";
import { getConfigValue, readEnv } from "./config";
const execute = promisify(execFile);
/** Resolve only the initiating profile's configured Mithril secret, never ambient keys. */
export async function codeCredential(profile?: string): Promise<string | null> {
  const configured =
    getConfigValue("secrets.onepassword.enabled", profile) === "true";
  const reference = getConfigValue(
    "secrets.onepassword.env.MITHRIL_API_KEY",
    profile,
  );
  if (configured && reference) {
    if (!/^op:\/\/[^\r\n]+$/.test(reference) || reference.length > 2048)
      return null;
    const binary =
      getConfigValue("secrets.onepassword.binary_path", profile) ||
      [
        "/opt/homebrew/bin/op",
        "/usr/local/bin/op",
        "/usr/bin/op",
        ...(process.env.ProgramFiles
          ? [join(process.env.ProgramFiles, "1Password CLI", "op.exe")]
          : []),
      ].find(existsSync) ||
      "";
    if (!isAbsolute(binary) || !["op", "op.exe"].includes(basename(binary)))
      return null;
    const account = getConfigValue("secrets.onepassword.account", profile);
    try {
      const { stdout } = await execute(
        binary,
        [
          "read",
          reference,
          "--no-newline",
          ...(account ? ["--account", account] : []),
        ],
        {
          timeout: 20000,
          maxBuffer: 4096,
          windowsHide: true,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            SystemRoot: process.env.SystemRoot,
          },
        },
      );
      const token = stdout.trim();
      return /^mf_[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    } catch {
      return null;
    }
  }
  const token = readEnv(profile).MITHRIL_API_KEY;
  return token && /^mf_[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
