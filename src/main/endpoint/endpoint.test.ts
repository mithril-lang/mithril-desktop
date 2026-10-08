// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import {
  mkdtemp,
  rm,
  writeFile,
  symlink,
  readFile,
  mkdir,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bundled from "../../../resources/endpoint/definitions.json";
import {
  DefinitionStore,
  validateDefinitions,
  verifyManifest,
  verifyPack,
} from "./definitions";
import { ConnectionDetector, FileChangeDetector, scanBytes } from "./detection";
import { parseLsof, parseNetstat, parseSs } from "./sensors";
import { EndpointRuntime, inside } from "./runtime";
const pack = validateDefinitions(bundled);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const directories: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "endpoint-test-"));
  directories.push(dir);
  return dir;
}
function signed(
  version = 2,
  expires = Date.now() + 86400000,
): { bytes: Buffer; envelope: { payload: string; signature: string } } {
  const bytes = Buffer.from(JSON.stringify({ ...pack, version }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const payload = JSON.stringify({
    schema: 1,
    version,
    expires: new Date(expires).toISOString(),
    size: bytes.length,
    sha256: digest,
    target: `packs/${digest}.json`,
  });
  return {
    bytes,
    envelope: {
      payload,
      signature: sign(null, Buffer.from(payload), privateKey).toString(
        "base64",
      ),
    },
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
describe("Signed definition admission", () => {
  it("verifies exact signed bytes and refuses tampering, expiry, rollback and another key", () => {
    const { bytes, envelope } = signed();
    const metadata = verifyManifest(envelope, 1, Date.now(), publicPem);
    expect(verifyPack(bytes, metadata).version).toBe(2);
    expect(() => verifyPack(Buffer.from("tampered"), metadata)).toThrow();
    expect(() =>
      verifyManifest(
        { ...envelope, payload: envelope.payload + " " },
        1,
        Date.now(),
        publicPem,
      ),
    ).toThrow();
    expect(() => verifyManifest(envelope, 3, Date.now(), publicPem)).toThrow();
    expect(() =>
      verifyManifest(
        signed(2, Date.now() - 1000).envelope,
        1,
        Date.now(),
        publicPem,
      ),
    ).toThrow();
    expect(() => verifyManifest(envelope, 1)).toThrow();
  });
  it("atomically caches a verified pack and retains it after bad downloads and restart", async () => {
    const dir = await scratch();
    const { bytes, envelope } = signed();
    const fetcher = vi.spyOn(globalThis, "fetch");
    fetcher
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope)))
      .mockResolvedValueOnce(new Response(bytes.toString("utf8")));
    const store = new DefinitionStore(dir, publicPem);
    await store.update();
    expect(store.pack.version).toBe(2);
    const cached = await readFile(join(dir, "current.json"), "utf8");
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify(signed(1).envelope)),
    );
    await expect(store.update()).rejects.toThrow();
    expect(await readFile(join(dir, "current.json"), "utf8")).toBe(cached);
    const restarted = new DefinitionStore(dir, publicPem);
    await restarted.load();
    expect(restarted.pack.version).toBe(2);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
    });
  });
  it("rejects oversized responses, changed content at the same version and malformed packs", async () => {
    const dir = await scratch();
    const store = new DefinitionStore(dir, publicPem);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("x".repeat(17000)),
    );
    await expect(store.update()).rejects.toThrow("limit");
    expect(() =>
      validateDefinitions({
        ...pack,
        content: [{ id: "bad", hex: "a", severity: "high", maxBytes: 3 }],
      }),
    ).toThrow();
    expect(() =>
      validateDefinitions({ ...pack, network: { ...pack.network, fanout: 1 } }),
    ).toThrow();
    const first = signed();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(first.envelope)))
      .mockResolvedValueOnce(new Response(first.bytes.toString("utf8")));
    await store.update();
    const payload = JSON.stringify({
      ...JSON.parse(first.envelope.payload),
      sha256: "a".repeat(64),
      target: `packs/${"a".repeat(64)}.json`,
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          payload,
          signature: sign(null, Buffer.from(payload), privateKey).toString(
            "base64",
          ),
        }),
      ),
    );
    await expect(store.update()).rejects.toThrow("Same definition version");
  });
});
describe("Bounded detection", () => {
  it("counts distinct changed paths per folder, ignoring duplicate notifications and other roots", () => {
    const detector = new FileChangeDetector();
    for (let i = 0; i < 500; i++)
      expect(detector.evaluate("one", "one/repeated", pack, 100000)).toBeNull();
    for (let i = 0; i < 199; i++)
      expect(
        detector.evaluate("two", `two/file-${i}`, pack, 100000),
      ).toBeNull();
    expect(
      detector.evaluate("two", "two/file-199", pack, 100000)?.subject,
    ).toBe("two");
    expect(detector.evaluate("two", "two/new", pack, 200000)).toBeNull();
  });
  it("finds literal content and does not claim clean for a non-match", () => {
    expect(
      scanBytes(Buffer.from("eval($_POST['input'])"), "sample.php", pack)[0]
        .rule,
    ).toBe("php-post-eval");
    expect(scanBytes(Buffer.from("ordinary text"), "sample.txt", pack)).toEqual(
      [],
    );
  });
  it("detects fanout and timing only when new contacts were observed", () => {
    const detector = new ConnectionDetector();
    const rows = Array.from({ length: 20 }, (_, i) => ({
      pid: 123,
      process: "sample",
      local: `127.0.0.1:${1000 + i}`,
      remote: `192.0.2.${i + 1}:443`,
      state: "ESTABLISHED",
    }));
    expect(
      detector
        .evaluate(rows, pack, 100000)
        .some((f) => f.rule === "connection-fanout"),
    ).toBe(true);
    const beacon = new ConnectionDetector();
    for (let i = 0; i < 4; i++) {
      expect(
        beacon.evaluate(
          [{ ...rows[0], local: `127.0.0.1:${2000 + i}` }],
          pack,
          100000 + i * 10000,
        ),
      ).toEqual([]);
    }
    expect(
      beacon.evaluate(
        [{ ...rows[0], local: "127.0.0.1:2004" }],
        pack,
        140000,
      )[0].rule,
    ).toBe("periodic-contact");
    expect(
      new ConnectionDetector().evaluate(
        [{ ...rows[0], state: "LISTEN" }],
        pack,
        100000,
      ),
    ).toEqual([]);
  });
  it("parses native socket formats, IPv6 and unknown process ownership", () => {
    expect(
      parseLsof(
        "p42\ncnode\nf7\nn[::1]:51000->[2001:db8::1]:443\nTST=ESTABLISHED\n",
      )[0],
    ).toMatchObject({ pid: 42, process: "node", remote: "[2001:db8::1]:443" });
    expect(
      parseNetstat(" TCP 127.0.0.1:5000 192.0.2.1:443 ESTABLISHED 42\n")[0].pid,
    ).toBe(42);
    expect(
      parseSs(
        'tcp ESTAB 0 0 127.0.0.1:5000 192.0.2.1:443 users:(("node",pid=42,fd=7))',
      )[0].pid,
    ).toBe(42);
    expect(
      parseSs("tcp ESTAB 0 0 [::1]:5000 [2001:db8::1]:443")[0].pid,
    ).toBeNull();
  });
  it("confines file access and refuses symlinks escaping the selected root", async () => {
    const dir = await scratch();
    await mkdir(join(dir, "root"));
    const root = await realpath(join(dir, "root"));
    const outside = join(dir, "outside");
    await writeFile(outside, "eval($_POST['x'])");
    await symlink(outside, join(root, "link"));
    const runtime = new EndpointRuntime(join(dir, "state"));
    expect(inside(root, outside)).toBe(false);
    await expect(runtime.scanFile(join(root, "link"), root)).rejects.toThrow(
      "outside",
    );
    await writeFile(join(root, "sample"), "eval($_POST['x'])");
    expect(
      (await runtime.scanFile(join(root, "sample"), root)).alerts[0].rule,
    ).toBe("php-post-eval");
    expect(runtime.status().running).toBe(false);
  });
  it("watches a selected real folder, resumes saved consent, and stops on revocation", async () => {
    const dir = await scratch();
    await mkdir(join(dir, "watched"));
    const root = await realpath(join(dir, "watched"));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline"));
    const runtime = new EndpointRuntime(join(dir, "state"));
    await runtime.initialize();
    await runtime.addFolder(root);
    await runtime.setEnabled(true);
    try {
      await writeFile(join(root, "sample.php"), "eval($_POST['fixture'])");
      await vi.waitFor(
        () =>
          expect(
            runtime.status().alerts.some((a) => a.rule === "php-post-eval"),
          ).toBe(true),
        { timeout: 5000 },
      );
      expect(runtime.status().running).toBe(true);
      runtime.stop();
      const restarted = new EndpointRuntime(join(dir, "state"));
      try {
        await restarted.initialize();
        expect(restarted.status().running).toBe(true);
        await restarted.setEnabled(false);
        expect(restarted.status().running).toBe(false);
        const stopped = new EndpointRuntime(join(dir, "state"));
        await stopped.initialize();
        expect(stopped.status().enabled).toBe(false);
        stopped.stop();
      } finally {
        restarted.stop();
      }
    } finally {
      runtime.stop();
    }
  });
});
