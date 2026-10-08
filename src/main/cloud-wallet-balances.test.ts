import { expect, it, vi } from "vitest";
import { readCloudWalletBalances } from "./cloud-wallet-balances";
import {
  publicWalletDescriptor,
  walletDescriptorId,
} from "@mithril/workspace/wallet-descriptors";
import type { RepositoryPage } from "@mithril/workspace/repository";
const address = "0x1234567890abcdef1234567890abcdef12345678";
async function fixture(): Promise<{
  page: RepositoryPage;
  balances: ReturnType<typeof vi.fn>;
  ports: Parameters<typeof readCloudWalletBalances>[2];
}> {
  const descriptor = publicWalletDescriptor("research", {
    id: "primary",
    name: "Primary",
    address,
    network: "base",
    createdAt: 1,
    imported: false,
  });
  const page: RepositoryPage = {
    schemaVersion: 1,
    userId: "alice",
    nextAfter: null,
    documents: [
      {
        collection: "profile",
        id: await walletDescriptorId("research", "primary"),
        revision: 1,
        updatedAt: 1,
        deleted: false,
        body: descriptor as unknown as import("@mithril/workspace/repository").JsonValue,
      },
    ],
  };
  const balances = vi.fn().mockResolvedValue({
    address,
    fetchedAt: 1,
    balances: [
      {
        tokenId: "eth",
        symbol: "ETH",
        raw: "0",
        formatted: "0",
        formattedFull: "0",
      },
    ],
  });
  return {
    page,
    balances,
    ports: {
      owner: "alice",
      guard: () => {},
      page: vi.fn(async () => page),
      balances,
    },
  };
}
// @lat: [[cloud-workspace-tests#Canonical wallet balance resolution]]
it("resolves this profile's descriptor across pages and uses its stable identity for the canonical read", async () => {
  const f = await fixture();
  f.ports.page = vi
    .fn()
    .mockResolvedValueOnce({ ...f.page, documents: [], nextAfter: "other" })
    .mockResolvedValue(f.page);
  expect(
    await readCloudWalletBalances("research", address, f.ports),
  ).toMatchObject({ address, balances: [{ raw: "0" }] });
  expect(f.balances).toHaveBeenCalledWith(f.page.documents[0].id);
  expect(f.ports.page).toHaveBeenLastCalledWith("other");
});
// @lat: [[cloud-workspace-tests#Canonical wallet scope rejection]]
it("refuses another profile, owner, tombstone or forged descriptor identity before a balance read", async () => {
  const f = await fixture();
  await expect(
    readCloudWalletBalances("other", address, f.ports),
  ).rejects.toThrow("synchronization pending");
  f.page.userId = "bob";
  await expect(
    readCloudWalletBalances("research", address, f.ports),
  ).rejects.toThrow("owner mismatch");
  f.page.userId = "alice";
  f.page.documents[0].deleted = true;
  await expect(
    readCloudWalletBalances("research", address, f.ports),
  ).rejects.toThrow("synchronization pending");
  f.page.documents[0].deleted = false;
  f.page.documents[0].id = "wallet-" + "0".repeat(64);
  await expect(
    readCloudWalletBalances("research", address, f.ports),
  ).rejects.toThrow("identity mismatch");
  expect(f.balances).not.toHaveBeenCalled();
});
// @lat: [[cloud-workspace-tests#Canonical wallet response fencing]]
it("discards a changed account and mismatched balance address without replacing unknown amounts with zero", async () => {
  const f = await fixture();
  f.balances.mockResolvedValue({
    address: "0x0000000000000000000000000000000000000001",
    fetchedAt: 1,
    balances: [],
  });
  await expect(
    readCloudWalletBalances("research", address, f.ports),
  ).rejects.toThrow("address mismatch");
  f.balances.mockImplementation(async () => {
    f.ports.guard = () => {
      throw Error("Account changed");
    };
    return { address, fetchedAt: 1, balances: [] };
  });
  await expect(
    readCloudWalletBalances("research", address, f.ports),
  ).rejects.toThrow("Account changed");
});
