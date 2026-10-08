import { execFile } from "node:child_process";
import type { EndpointConnection } from "../../shared/endpoint-protection";

function capture(program: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      program,
      args,
      {
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
        env:
          process.platform === "win32"
            ? {
                SystemRoot: "C:\\Windows",
                WINDIR: "C:\\Windows",
                LC_ALL: "C",
                LANG: "C",
              }
            : { LC_ALL: "C", LANG: "C" },
      },
      (error, stdout) => {
        // lsof exits 1 when there are no visible Internet sockets.
        if (
          error &&
          !(program === "/usr/sbin/lsof" && error.code === 1 && !stdout)
        )
          reject(error);
        else resolve(stdout);
      },
    );
  });
}

export function parseLsof(text: string): EndpointConnection[] {
  const rows: EndpointConnection[] = [];
  let pid: number | null = null,
    name = "",
    remote = "",
    state = "",
    local = "";
  function flush(): void {
    if (local)
      rows.push({
        pid,
        process: name,
        local,
        remote,
        state: state || "UNKNOWN",
      });
    local = "";
    remote = "";
    state = "";
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      flush();
      pid = Number(line.slice(1)) || null;
    } else if (line.startsWith("c")) name = line.slice(1);
    else if (line.startsWith("f")) flush();
    else if (line.startsWith("n")) {
      const parts = line.slice(1).split("->");
      local = parts[0];
      remote = parts[1] || "";
    } else if (line.startsWith("TST=")) state = line.slice(4);
  }
  flush();
  return rows;
}

export function parseNetstat(text: string): EndpointConnection[] {
  const rows: EndpointConnection[] = [];
  for (const line of text.split(/\r?\n/)) {
    const v = line.trim().split(/\s+/);
    if (v[0] === "TCP" && v.length === 5)
      rows.push({
        pid: Number(v[4]) || null,
        process: "",
        local: v[1],
        remote: v[2],
        state: v[3],
      });
    if (v[0] === "UDP" && v.length === 4)
      rows.push({
        pid: Number(v[3]) || null,
        process: "",
        local: v[1],
        remote: v[2],
        state: "UNKNOWN",
      });
  }
  return rows;
}

export function parseSs(text: string): EndpointConnection[] {
  const rows: EndpointConnection[] = [];
  for (const line of text.split(/\r?\n/)) {
    const v = line.trim().split(/\s+/);
    if (!["tcp", "udp"].includes(v[0]) || v.length < 6) continue;
    const owner = /\("([^"\n]+)",pid=(\d+)/.exec(line);
    rows.push({
      pid: owner ? Number(owner[2]) : null,
      process: owner?.[1] || "",
      local: v[4],
      remote: v[5],
      state: v[1],
    });
  }
  return rows;
}

export function remoteHost(address: string): string | null {
  const host = address.startsWith("[")
    ? address.slice(1, address.indexOf("]"))
    : address.slice(0, address.lastIndexOf(":"));
  if (!host || ["*", "0.0.0.0", "::", "127.0.0.1", "::1"].includes(host))
    return null;
  return host;
}

export async function collectConnections(): Promise<{
  rows: EndpointConnection[];
  gaps: string[];
}> {
  let rows: EndpointConnection[];
  if (process.platform === "darwin")
    rows = parseLsof(await capture("/usr/sbin/lsof", ["-nP", "-i", "-FpcfnT"]));
  else if (process.platform === "win32")
    rows = parseNetstat(
      await capture("C:\\Windows\\System32\\netstat.exe", ["-ano"]),
    );
  else if (process.platform === "linux") {
    try {
      rows = parseSs(
        await capture("/usr/bin/ss", ["-H", "-t", "-u", "-n", "-a", "-p"]),
      );
    } catch {
      rows = parseSs(
        await capture("/usr/sbin/ss", ["-H", "-t", "-u", "-n", "-a", "-p"]),
      );
    }
  } else throw Error("Connection sensor is not supported on this platform");
  const gaps = [
    "Connection polling can miss activity shorter than five seconds.",
    "Visibility follows the app's OS permissions; connection data does not inspect packet contents.",
  ];
  if (rows.some((r) => !r.pid))
    gaps.push("Some sockets have no visible process owner.");
  if (rows.length > 2000)
    gaps.push("Connection inventory exceeded 2000 rows and was truncated.");
  return { rows: rows.slice(0, 2000), gaps };
}
