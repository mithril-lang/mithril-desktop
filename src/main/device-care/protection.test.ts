// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseEngineVersion, scanArguments, scanResult } from "./protection";

describe("bounded local scan adapter", () => {
  // @lat: [[device-care#Implementation verification#Limits scan authority]]
  it("passes hostile-looking paths as one argument and never grants deletion or upload", () => {
    const target = "/tmp/a;$(touch injected)";
    const args = scanArguments(target);
    expect(args.slice(-2)).toEqual(["--", target]);
    expect(args).toContain("--follow-dir-symlinks=0");
    expect(args).toContain("--cross-fs=no");
    expect(
      args.some((arg) => /--(remove|move|copy|database|submit)/.test(arg)),
    ).toBe(false);
  });
  // @lat: [[device-care#Implementation verification#Keeps partial scan coverage]]
  it("preserves bounded coverage, detections, engine failures, and cancellation", () => {
    const output = "/tmp/test: Eicar-Test-Signature FOUND\nScanned files: 4\n";
    expect(scanResult(1, output, false)).toEqual({
      state: "partial",
      findings: ["/tmp/test: Eicar-Test-Signature FOUND"],
      scannedFiles: 4,
    });
    expect(scanResult(0, "Scanned files: 4", false).state).toBe("partial");
    expect(scanResult(2, "", false).state).toBe("failed");
    expect(scanResult(null, output, true).state).toBe("cancelled");
  });
  it("reports missing signature date as unknown rather than fresh", () => {
    expect(parseEngineVersion("ClamAV 1.4.3").signatureDate).toBeNull();
    expect(
      parseEngineVersion("ClamAV 1.4.3/27801/Thu Oct 8 00:00:00 2026")
        .signatureDate,
    ).toBeTruthy();
  });
});
