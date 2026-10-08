import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { captureWalletSource, restoreWalletSource } from "./wallet-source";
const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);
function fixture(): {
  directory: string;
  path: string;
  wallet: {
    id: string;
    name: string;
    address: string;
    network: string;
    createdAt: number;
    imported: boolean;
    encryptedRecoveryPhrase: string;
  };
  save: (wallets: unknown[]) => void;
} {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-wallet-source-")),
  );
  directories.push(directory);
  const path = join(directory, "wallets.json");
  const wallet = {
    id: "primary",
    name: "Primary",
    address: "0x1234567890abcdef1234567890abcdef12345678",
    network: "base",
    createdAt: 1,
    imported: false,
    encryptedRecoveryPhrase: "private-ciphertext",
  };
  const save = (wallets: unknown[]): void =>
    writeFileSync(path, JSON.stringify({ version: 1, wallets }));
  return { directory, path, wallet, save };
}
// @lat: [[cloud-workspace-tests#Wallet source snapshot]]
it("projects one original snapshot and excludes ciphertext, refusing malformed or duplicate records", () => {
  const f = fixture();
  expect(captureWalletSource(f.path, () => {})).toEqual([]);
  f.save([f.wallet]);
  expect(captureWalletSource(f.path, () => {})).toEqual([
    {
      id: "primary",
      name: "Primary",
      address: f.wallet.address,
      network: "base",
      createdAt: 1,
      imported: false,
    },
  ]);
  f.save([f.wallet, f.wallet]);
  expect(() => captureWalletSource(f.path, () => {})).toThrow(
    "Invalid wallet source",
  );
  f.save([{ ...f.wallet, unexpectedSecret: "secret" }]);
  expect(() => captureWalletSource(f.path, () => {})).toThrow(
    "Invalid wallet source",
  );
});

// @lat: [[cloud-workspace-tests#Wallet original custody preservation]]
it("restores only the name, preserving exact native ciphertext and other records while refusing identity changes and concurrent edits", () => {
  const f = fixture();
  f.save([f.wallet, { ...f.wallet, id: "other", name: "Other" }]);
  const [before] = captureWalletSource(f.path, () => {});
  restoreWalletSource(
    f.path,
    before,
    { ...before, name: "Web rename" },
    () => {},
  );
  expect(JSON.parse(readFileSync(f.path, "utf8")).wallets).toEqual([
    { ...f.wallet, name: "Web rename" },
    { ...f.wallet, id: "other", name: "Other" },
  ]);
  const exact = readFileSync(f.path);
  expect(() =>
    restoreWalletSource(
      f.path,
      { ...before, name: "Web rename" },
      { ...before, address: "0x0000000000000000000000000000000000000001" },
      () => {},
    ),
  ).toThrow("cannot replace native identity");
  expect(() =>
    restoreWalletSource(
      f.path,
      before,
      { ...before, name: "Stale edit" },
      () => {},
    ),
  ).toThrow("source conflict");
  expect(readFileSync(f.path)).toEqual(exact);
  let calls = 0;
  expect(() =>
    restoreWalletSource(
      f.path,
      { ...before, name: "Web rename" },
      { ...before, name: "Late cloud" },
      () => {
        if (++calls === 3) f.save([{ ...f.wallet, name: "Native edit" }]);
      },
    ),
  ).toThrow("source conflict");
  expect(captureWalletSource(f.path, () => {})[0].name).toBe("Native edit");
  expect(readdirSync(f.directory)).toEqual(["wallets.json"]);
});
// @lat: [[cloud-workspace-tests#Wallet source replacement fencing]]
it("refuses dangling links and account or file replacement after reading instead of publishing an empty source", () => {
  const f = fixture();
  symlinkSync(join(f.directory, "absent.json"), f.path);
  expect(() => captureWalletSource(f.path, () => {})).toThrow(
    "Unsupported wallet source",
  );
  rmSync(f.path);
  f.save([f.wallet]);
  let calls = 0;
  expect(() =>
    captureWalletSource(f.path, () => {
      if (++calls === 2) throw Error("Account changed");
    }),
  ).toThrow("Account changed");
  calls = 0;
  expect(() =>
    captureWalletSource(f.path, () => {
      if (++calls === 2) {
        rmSync(f.path);
        f.save([]);
      }
    }),
  ).toThrow("Wallet source changed");
});
