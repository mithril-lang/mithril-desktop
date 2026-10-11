// @lat: [[e2ee-vault#Encrypted transport]]
import {
  newOpaqueId,
  sealSecret,
  openSecret,
  validateEnvelope,
  type Envelope,
  type VaultContext,
} from "@kotoba-lang/kagi/mithril-vault";
import { secretItem, type SecretItem } from "@kotoba-lang/kagitaba/secret-item";

const API = "https://api.mithril.fund";
export interface EncryptedVaultRecord {
  vaultId: string;
  itemId: string;
  revision: number;
  operationId: string;
  deleted: boolean;
  envelope: Envelope | null;
  createdAt: number;
}
export interface VaultSession {
  ownerId: string;
  token: string;
}
export class VaultClientError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export interface PendingVaultMutation {
  vaultId: string;
  itemId: string;
  operationId: string;
  expectedRevision: number;
  deleted: false;
  envelope: Envelope;
}
export interface VaultState {
  ownerId: string;
  vaultId: string;
  /** Must come from a trusted device/recovery process, never the sync server. */
  key: Uint8Array;
  records: Record<string, EncryptedVaultRecord>;
  pending?: Record<string, PendingVaultMutation>;
}
/** Main-process-only. The caller owns unlock, persistence and per-secret execution consent. */
export class KagiVaultClient {
  constructor(
    private state: VaultState,
    private session: () => Promise<VaultSession | null>,
    private persist: (state: VaultState) => void,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  private locked = false;
  lock(): void {
    this.locked = true;
    this.state.key.fill(0);
  }
  private async account(): Promise<VaultSession> {
    if (this.locked) throw new VaultClientError("vault_locked");
    const session = await this.session();
    if (
      !session ||
      session.ownerId !== this.state.ownerId ||
      !session.token.startsWith("mf_")
    )
      throw new VaultClientError("vault_account_mismatch");
    return session;
  }
  private context(itemId: string, revision: number): VaultContext {
    return {
      ownerId: this.state.ownerId,
      vaultId: this.state.vaultId,
      itemId,
      generation: revision,
    };
  }
  private async request(
    itemId: string,
    mutation?: object,
  ): Promise<EncryptedVaultRecord> {
    if (
      !/^[a-f0-9]{32}$/.test(itemId) ||
      !/^[a-f0-9]{32}$/.test(this.state.vaultId)
    )
      throw new VaultClientError("invalid_vault_id");
    const session = await this.account();
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${API}/v1/vault/${this.state.vaultId}/items/${itemId}`,
        {
          method: mutation ? "PUT" : "GET",
          redirect: "error",
          credentials: "omit",
          headers: {
            authorization: `Bearer ${session.token}`,
            ...(mutation ? { "content-type": "application/json" } : {}),
          },
          ...(mutation ? { body: JSON.stringify(mutation) } : {}),
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new VaultClientError(
        mutation ? "vault_write_uncertain" : "vault_transport_unavailable",
      );
    }
    await this.account(); // A response cannot be admitted after sign-out/account switch.
    if (!response.ok)
      throw new VaultClientError(
        response.status === 409 ? "vault_conflict" : "vault_request_rejected",
      );
    const reader = response.body?.getReader();
    if (!reader) throw new VaultClientError("invalid_vault_response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 34000) {
          await reader.cancel();
          throw new VaultClientError("invalid_vault_response");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(bytes);
    await this.account();
    if (text.length > 34000)
      throw new VaultClientError("invalid_vault_response");
    let row: EncryptedVaultRecord;
    try {
      row = JSON.parse(text);
    } catch {
      throw new VaultClientError("invalid_vault_response");
    }
    if (
      row.vaultId !== this.state.vaultId ||
      row.itemId !== itemId ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      typeof row.deleted !== "boolean" ||
      !/^[a-f0-9]{32}$/.test(row.operationId) ||
      !Number.isSafeInteger(row.createdAt) ||
      (row.deleted ? row.envelope !== null : !row.envelope)
    )
      throw new VaultClientError("invalid_vault_response");
    if (row.envelope) validateEnvelope(row.envelope);
    return row;
  }
  private accept(row: EncryptedVaultRecord): void {
    // An untrusted server can forge a plain deletion marker. Do not admit it
    // until the client protocol carries an authenticated encrypted tombstone.
    if (row.deleted)
      throw new VaultClientError("vault_authenticated_deletion_required");
    const previous = this.state.records[row.itemId];
    if (
      previous &&
      (row.revision < previous.revision ||
        (row.revision === previous.revision &&
          JSON.stringify(row) !== JSON.stringify(previous)))
    )
      throw new VaultClientError("vault_rollback_detected");
    if (!row.deleted)
      openSecret(
        this.state.key,
        this.context(row.itemId, row.revision),
        row.envelope!,
      );
    // Persist first. A failed disk write must not advance the in-memory floor.
    const pending = { ...this.state.pending };
    const operation = pending[row.itemId];
    if (
      operation &&
      row.operationId === operation.operationId &&
      JSON.stringify(row.envelope) === JSON.stringify(operation.envelope)
    )
      delete pending[row.itemId];
    const next = {
      ...this.state,
      pending,
      records: { ...this.state.records, [row.itemId]: row },
    };
    this.persist(next);
    this.state = next;
  }
  async pull(
    itemId: string,
  ): Promise<{ itemId: string; revision: number; deleted: boolean }> {
    const row = await this.request(itemId);
    this.accept(row);
    return { itemId: row.itemId, revision: row.revision, deleted: row.deleted };
  }
  async save(
    input: Omit<SecretItem, "format">,
  ): Promise<{ itemId: string; revision: number }> {
    await this.account();
    const item = secretItem(input);
    if (this.state.pending?.[item.id])
      throw new VaultClientError("vault_write_pending");
    const expectedRevision = this.state.records[item.id]?.revision ?? 0;
    const mutation: PendingVaultMutation = {
      vaultId: this.state.vaultId,
      itemId: item.id,
      operationId: newOpaqueId(),
      expectedRevision,
      deleted: false,
      envelope: sealSecret(
        this.state.key,
        this.context(item.id, expectedRevision + 1),
        item,
      ),
    };
    // Durable exact request precedes the network, so a lost reply can be replayed safely.
    const next = {
      ...this.state,
      pending: { ...this.state.pending, [item.id]: mutation },
    };
    this.persist(next);
    this.state = next;
    return this.retryPending(item.id);
  }
  async retryPending(
    itemId: string,
  ): Promise<{ itemId: string; revision: number }> {
    const mutation = this.state.pending?.[itemId];
    if (!mutation) throw new VaultClientError("vault_no_pending_write");
    const row = await this.request(itemId, mutation);
    if (
      row.operationId !== mutation.operationId ||
      row.revision !== mutation.expectedRevision + 1 ||
      row.deleted ||
      JSON.stringify(row.envelope) !== JSON.stringify(mutation.envelope)
    )
      throw new VaultClientError("invalid_vault_response");
    this.accept(row);
    return { itemId: row.itemId, revision: row.revision };
  }
  /** Caller must grant access to this item. No bulk environment injection. */
  async resolve(itemId: string, key: string): Promise<string | null> {
    await this.account();
    const row = this.state.records[itemId];
    if (!row || row.deleted || !row.envelope) return null;
    const item = openSecret(
      this.state.key,
      this.context(itemId, row.revision),
      row.envelope,
    );
    return item.key === key ? item.value : null;
  }
}
