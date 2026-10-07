import { validMetadataProfile } from "@mithril/workspace/profile-resources";
import {
  validWalletDescriptor,
  walletDescriptorId,
} from "@mithril/workspace/wallet-descriptors";
import type { RepositoryPage } from "@mithril/workspace/repository";
import type { TokenBalancesResponse } from "@mithril/workspace/desktop-wallet-types";

/** Resolve only this account/profile's stable public descriptor before a canonical API read. */
export async function readCloudWalletBalances(
  profile: string,
  address: string,
  ports: {
    owner: string;
    guard(): void;
    page(after?: string): Promise<RepositoryPage>;
    balances(id: string): Promise<TokenBalancesResponse>;
  },
): Promise<TokenBalancesResponse> {
  if (!validMetadataProfile(profile) || !/^0x[a-fA-F0-9]{40}$/.test(address))
    throw Error("Invalid wallet balance request");
  ports.guard();
  let after: string | undefined;
  let id: string | undefined;
  for (let count = 0; count < 100; count++) {
    const page = await ports.page(after);
    ports.guard();
    if (page.userId !== ports.owner || page.schemaVersion !== 1)
      throw Error("Wallet owner mismatch");
    for (const row of page.documents) {
      if (
        row.collection !== "profile" ||
        !row.id.startsWith("wallet-") ||
        row.deleted
      )
        continue;
      if (!validWalletDescriptor(row.body))
        throw Error("Invalid wallet descriptor");
      if (
        row.id !==
        (await walletDescriptorId(row.body.profile, row.body.wallet.id))
      )
        throw Error("Wallet descriptor identity mismatch");
      ports.guard();
      if (
        row.body.profile === profile &&
        row.body.wallet.address.toLowerCase() === address.toLowerCase()
      ) {
        if (id && id !== row.id) throw Error("Ambiguous wallet identity");
        id = row.id;
      }
    }
    if (!page.nextAfter) {
      if (!id) throw Error("Wallet synchronization pending");
      const result = await ports.balances(id);
      ports.guard();
      if (result.address.toLowerCase() !== address.toLowerCase())
        throw Error("Wallet balance address mismatch");
      return result;
    }
    if (page.nextAfter === after) throw Error("Invalid wallet pagination");
    after = page.nextAfter;
  }
  throw Error("Wallet inventory exceeds supported capacity");
}
