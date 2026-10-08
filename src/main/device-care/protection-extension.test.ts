// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  link,
  readFile,
  realpath,
  writeFile,
  rm,
  readdir,
  symlink,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
const keyring = vi.hoisted(() => ({ available: true, backend: "keychain" }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => keyring.available,
    getSelectedStorageBackend: () => keyring.backend,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));
import { DeviceCareQuarantine } from "./quarantine";
import { DeviceCareMonitor } from "./monitor";
import { DeviceCareVendor, VISION_REGIONS } from "./vendor";
import type { ScanJob } from "../../shared/device-care";
let home: string, root: string, vault: DeviceCareQuarantine, file: string;
const job = (): ScanJob => ({
  id: "scan",
  state: "partial",
  root,
  startedAt: new Date().toISOString(),
  providerVersion: "ClamAV fixture",
  findings: [`${file}: Eicar-Test-Signature FOUND`],
  scannedFiles: 1,
  output: "",
});
beforeEach(async () => {
  keyring.available = true;
  keyring.backend = "keychain";
  home = await realpath(
    await mkdtemp(join(tmpdir(), "device-care-extension-")),
  );
  root = join(home, "selected");
  await mkdir(root);
  file = join(root, "test.txt");
  await writeFile(file, "inert fixture");
  vault = new DeviceCareQuarantine(join(home, "private"), async () => true);
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(home, { recursive: true, force: true });
});

describe("encrypted local custody", () => {
  // @lat: [[device-care#Implementation verification#Encrypts and restores quarantine]]
  it("preserves digest-verified content, consumes approval, and restores without overwrite", async () => {
    const [review] = await vault.review(job());
    const entry = await vault.quarantine(review.id, async () => true);
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    const directory = join(
      home,
      "private",
      "device-care-quarantine",
      entry!.id,
    );
    expect(
      (await readFile(join(directory, "payload.enc"))).toString(),
    ).not.toContain("inert fixture");
    await expect(vault.quarantine(review.id, async () => true)).rejects.toThrow(
      "missing",
    );
    const destination = join(root, "restored.txt");
    await writeFile(destination, "existing");
    await expect(
      vault.restore(entry!.id, destination, async () => true),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(destination, "utf8")).toBe("existing");
    expect(
      await vault.restore(entry!.id, join(root, "new.txt"), async () => true),
    ).toBe(true);
    expect(await readFile(join(root, "new.txt"), "utf8")).toBe("inert fixture");
    expect((await vault.entries())[0].state).toBe("restored");
    expect(await readFile(join(directory, "payload.enc"))).toBeTruthy();
  });
  // @lat: [[device-care#Implementation verification#Rejects changed quarantine content]]
  it("refuses cancellation, changed files, hardlinks and symlink substitution", async () => {
    let [review] = await vault.review(job());
    expect(await vault.quarantine(review.id, async () => false)).toBeNull();
    expect(await readFile(file, "utf8")).toBe("inert fixture");
    [review] = await vault.review(job());
    await writeFile(file, "different bytes");
    await expect(vault.quarantine(review.id, async () => true)).rejects.toThrow(
      "changed",
    );
    [review] = await vault.review(job());
    await rm(file);
    await symlink(join(root, "other.txt"), file);
    await writeFile(join(root, "other.txt"), "protected");
    await expect(vault.quarantine(review.id, async () => true)).rejects.toThrow(
      "Symbolic",
    );
    expect(await readFile(join(root, "other.txt"), "utf8")).toBe("protected");
  });
  it("refuses hardlinked files and refuses tampered ciphertext after restart", async () => {
    await link(file, join(root, "linked.txt"));
    expect(await vault.review(job())).toEqual([]);
    await rm(join(root, "linked.txt"));
    const [review] = await vault.review(job());
    const entry = await vault.quarantine(review.id, async () => true);
    const restarted = new DeviceCareQuarantine(
      join(home, "private"),
      async () => true,
    );
    expect((await restarted.entries())[0].id).toBe(entry!.id);
    await writeFile(
      join(home, "private", "device-care-quarantine", entry!.id, "payload.enc"),
      "tampered",
    );
    await expect(
      restarted.restore(
        entry!.id,
        join(root, "restored.txt"),
        async () => true,
      ),
    ).rejects.toThrow();
    await expect(readFile(join(root, "restored.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("rejects an unconfirmed engine finding and preserves the original", async () => {
    vault = new DeviceCareQuarantine(join(home, "private"), async () => false);
    const [review] = await vault.review(job());
    await expect(vault.quarantine(review.id, async () => true)).rejects.toThrow(
      "did not confirm",
    );
    expect(await readFile(file, "utf8")).toBe("inert fixture");
    const names = await readdir(
      join(home, "private", "device-care-quarantine"),
    );
    expect(
      await readdir(join(home, "private", "device-care-quarantine", names[0])),
    ).not.toContain("verification.sample");
  });
  it("refuses weak keyrings, out-of-scope findings, and incomplete-inspection heuristics", async () => {
    keyring.backend = "basic_text";
    await expect(vault.review(job())).rejects.toThrow("keyring");
    keyring.backend = "keychain";
    expect(
      await vault.review({
        ...job(),
        findings: [
          `${file}: Heuristics.Limits.Exceeded FOUND`,
          "/outside: Eicar-Test-Signature FOUND",
        ],
      }),
    ).toEqual([]);
  });
});
describe("session background inspection", () => {
  // @lat: [[device-care#Implementation verification#Bounds session monitoring]]
  it("starts only explicitly, skips busy intervals, and stops future scans", async () => {
    vi.useFakeTimers();
    const scan = vi.fn().mockResolvedValue(null);
    const monitor = new DeviceCareMonitor(scan);
    expect(monitor.status().enabled).toBe(false);
    monitor.start(root);
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(monitor.status().error).toContain("skipped");
    await vi.advanceTimersByTimeAsync(60000);
    expect(scan).toHaveBeenCalledTimes(2);
    monitor.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(scan).toHaveBeenCalledTimes(2);
  });
  it("does not overlap scans or let a stopped generation overwrite status", async () => {
    let finish!: (value: ScanJob) => void;
    const scan = vi.fn(
      () =>
        new Promise<ScanJob>((resolve) => {
          finish = resolve;
        }),
    );
    const monitor = new DeviceCareMonitor(scan);
    monitor.start(root);
    await monitor.tick();
    expect(scan).toHaveBeenCalledTimes(1);
    monitor.stop();
    finish(job());
    await Promise.resolve();
    expect(monitor.status().lastRun).toBeNull();
  });
});
describe("bounded vendor read adapter", () => {
  // @lat: [[device-care#Implementation verification#Confines vendor credentials]]
  it("uses one official regional GET, refuses redirects, projects only bounded alerts and never follows nextLink", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "WB-1",
              severity: "high",
              model: "fixture",
              secret: "excluded",
            },
          ],
          nextLink: "https://attacker.invalid/page",
        }),
        { status: 200 },
      ),
    );
    const vendor = new DeviceCareVendor(home, request);
    await vendor.configure("jp", "fixture-token-123456789");
    const report = await vendor.alerts();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(
      `${VISION_REGIONS.jp}/v3.0/workbench/alerts`,
    );
    expect(request.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error",
    });
    expect(report.alerts).toEqual([
      { id: "WB-1", severity: "high", name: "fixture", updatedAt: "" },
    ]);
    expect(report.nextPage).toBe(true);
    await expect(
      vendor.configure("https://attacker.invalid", "fixture-token-123456789"),
    ).rejects.toThrow("region");
    await vendor.disconnect();
    expect((await vendor.status()).configured).toBe(false);
  });
  it("rejects bad responses and weak keyrings without echoing provider body or credentials", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response("private provider body", { status: 401 }),
      );
    const vendor = new DeviceCareVendor(home, request);
    await vendor.configure("us", "fixture-token-123456789");
    await expect(vendor.alerts()).rejects.toThrow("HTTP 401");
    request.mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(vendor.alerts()).rejects.toThrow("Invalid Vision");
    keyring.backend = "basic_text";
    await expect(
      vendor.configure("us", "fixture-token-123456789"),
    ).rejects.toThrow("keyring");
  });
});
