import { spawn } from "node:child_process";
import { open, rename } from "node:fs/promises";
import { dirname, isAbsolute, win32 } from "node:path";

// Fixed program only. User-selected paths are JSON data on stdin, never code.
export const windowsArchiveMoveScript = `
$ErrorActionPreference = 'Stop'
try {
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
  $paths = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class MithrilArchiveMove {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool MoveFileExW(string source, string destination, uint flags);
}
'@
  if (![MithrilArchiveMove]::MoveFileExW($paths.source, $paths.destination, 9)) { exit 1 }
  exit 0
} catch { exit 1 }
`;

export function runWindowsArchiveMove(input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(windowsArchiveMoveScript, "utf16le").toString("base64"),
      ],
      { shell: false, windowsHide: true, stdio: ["pipe", "ignore", "ignore"] },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Archive destination replacement timed out"));
    }, 30_000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(Error("Archive destination replacement unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(Error("Archive destination replacement failed"));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** Caller has synced and closed the same-directory temporary file. */
export async function replaceArchiveDestination(
  source: string,
  destination: string,
  check: () => void,
  platform: NodeJS.Platform = process.platform,
  windowsMove: (input: string) => Promise<void> = runWindowsArchiveMove,
): Promise<void> {
  const paths = platform === "win32" ? win32 : { dirname, isAbsolute };
  if (
    !paths.isAbsolute(source) ||
    !paths.isAbsolute(destination) ||
    paths.dirname(source) !== paths.dirname(destination) ||
    source === destination
  )
    throw Error("Archive replacement requires a same-directory temporary file");
  check();
  if (platform === "win32") {
    // REPLACE_EXISTING | WRITE_THROUGH; no cross-volume copy or reboot delay.
    await windowsMove(JSON.stringify({ source, destination }));
  } else {
    await rename(source, destination);
    const parent = await open(dirname(destination), "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  }
  check();
}
