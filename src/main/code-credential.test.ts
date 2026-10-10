import { afterEach, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => {
  const execFile = Object.assign(() => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: execute,
  });
  return { execFile, default: { execFile } };
});
const config = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock("./config", () => ({
  getConfigValue: (key: string, profile: string) =>
    config.values[profile + ":" + key] ?? null,
  readEnv: (profile: string) => ({
    MITHRIL_API_KEY: profile === "a" ? "mf_" + "a".repeat(43) : undefined,
  }),
}));
import { codeCredential } from "./code-credential";
const binary = join(tmpdir(), "op");
afterEach(() => {
  config.values = {};
  execute.mockReset();
});
it("resolves the selected profile's explicitly configured vault reference without forwarding ambient credentials", async () => {
  execute.mockResolvedValue({ stdout: "mf_" + "v".repeat(43) });
  config.values = {
    "a:secrets.onepassword.enabled": "true",
    "a:secrets.onepassword.env.MITHRIL_API_KEY":
      "op://vault/profile/MITHRIL_API_KEY",
    "a:secrets.onepassword.binary_path": binary,
    "a:secrets.onepassword.account": "owner",
  };
  expect(await codeCredential("a")).toBe("mf_" + "v".repeat(43));
  expect(await codeCredential("b")).toBeNull();
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0]).toMatchObject([
    binary,
    [
      "read",
      "op://vault/profile/MITHRIL_API_KEY",
      "--no-newline",
      "--account",
      "owner",
    ],
    { timeout: 20000, maxBuffer: 4096 },
  ]);
  expect(execute.mock.calls[0][2].env).not.toHaveProperty("MITHRIL_API_KEY");
  expect(execute.mock.calls[0][2].env).not.toHaveProperty(
    "OP_SERVICE_ACCOUNT_TOKEN",
  );
  config.values["a:secrets.onepassword.binary_path"] = join(
    tmpdir(),
    "untrusted",
  );
  expect(await codeCredential("a")).toBeNull();
  config.values["a:secrets.onepassword.binary_path"] = binary;
  config.values["a:secrets.onepassword.env.MITHRIL_API_KEY"] =
    "https://foreign.example/secret";
  expect(await codeCredential("a")).toBeNull();
});
it("retains only the selected profile's secure store key when no vault is configured", async () => {
  expect(await codeCredential("a")).toBe("mf_" + "a".repeat(43));
  expect(await codeCredential("b")).toBeNull();
});
