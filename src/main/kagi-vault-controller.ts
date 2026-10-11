// @lat: [[e2ee-vault#Device enrollment and recovery]]
import {
  newOpaqueId,
  newVaultKey,
  openSecret,
} from "@kotoba-lang/kagi/mithril-vault";
import {
  createDeviceRequest,
  sealDeviceTransfer,
  openDeviceTransfer,
  transferFingerprint,
  sealRecovery,
  openRecovery,
  type DeviceRequest,
  type DeviceTransfer,
  type RecoveryPackage,
} from "@kotoba-lang/kagi/mithril-transfer";
import {
  KagiVaultClient,
  type VaultState,
  type VaultSession,
} from "./kagi-vault-client";
import type { VaultView } from "../shared/kagi-vault";

interface Grant {
  itemId: string;
  key: string;
  profile: string;
  expiresAt: number;
}
export interface VaultDependencies {
  session(profile: string): Promise<VaultSession | null>;
  exists(ownerId: string): boolean;
  read(ownerId: string): VaultState | null;
  write(state: VaultState): void;
  consent(detail: string): Promise<boolean>;
  now?: () => number;
  canExecute?: (profile: string) => boolean;
  fetch?: typeof fetch;
}
/** Renderer never receives root keys, recovery codes, snapshots or secret values. */
export class KagiVaultController {
  private state: VaultState | null = null;
  private client: KagiVaultClient | null = null;
  private profile = "";
  private grants = new Map<string, Grant>();
  private enrollment: {
    request: DeviceRequest;
    privateKey: Uint8Array;
    profile: string;
  } | null = null;
  private epoch = 0;
  private grantEpoch = 0;
  constructor(private deps: VaultDependencies) {}
  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
  private async account(profile: string): Promise<VaultSession> {
    const session = await this.deps.session(profile);
    if (!session || !session.token.startsWith("mf_")) {
      this.lock();
      throw Error("Connect a Mithril account with vault scopes first.");
    }
    if (
      this.state &&
      (this.state.ownerId !== session.ownerId || this.profile !== profile)
    )
      this.lock();
    return session;
  }
  private attach(state: VaultState, profile: string): void {
    this.state = state;
    this.profile = profile;
    const epoch = ++this.epoch;
    this.client = new KagiVaultClient(
      state,
      async () => {
        const session = await this.account(profile);
        return this.epoch === epoch ? session : null;
      },
      (next) => {
        if (this.epoch !== epoch) throw Error("Vault locked.");
        this.deps.write(next);
        this.state = next;
      },
      this.deps.fetch,
    );
  }
  lock(): void {
    ++this.epoch;
    this.client?.lock();
    this.state?.key.fill(0);
    this.state = null;
    this.client = null;
    this.grants.clear();
    this.enrollment?.privateKey.fill(0);
    this.enrollment = null;
  }
  async view(profile: string): Promise<VaultView> {
    const session = await this.account(profile);
    if (!this.state)
      return {
        realm: session.realm,
        status: this.deps.exists(session.ownerId) ? "locked" : "absent",
        pendingWrites: 0,
        items: [],
      };
    return {
      realm: session.realm,
      status: "unlocked",
      vaultId: this.state.vaultId,
      pendingWrites: Object.keys(this.state.pending ?? {}).length,
      items: Object.values(this.state.records).map((row) => {
        const item = openSecret(
          this.state!.key,
          {
            ownerId: session.ownerId,
            vaultId: this.state!.vaultId,
            itemId: row.itemId,
            generation: row.revision,
          },
          row.envelope!,
        );
        const grant = this.grants.get(row.itemId);
        return {
          id: row.itemId,
          title: item.title,
          key: item.key,
          revision: row.revision,
          pending: !!this.state!.pending?.[row.itemId],
          granted: !!grant && grant.expiresAt > this.now(),
        };
      }),
    };
  }
  async create(profile: string): Promise<void> {
    const session = await this.account(profile);
    if (this.deps.exists(session.ownerId) || this.state)
      throw Error("A vault already exists on this device.");
    if (
      !(await this.deps.consent(
        "Create a new E2EE vault? Account login cannot recover the vault. Export and separately store a recovery code and encrypted backup.",
      ))
    )
      return;
    const current = await this.account(profile);
    if (
      current.ownerId !== session.ownerId ||
      this.deps.exists(session.ownerId)
    )
      throw Error("Account or vault changed.");
    const state = {
      ownerId: session.ownerId,
      vaultId: newOpaqueId(),
      key: newVaultKey(),
      records: {},
    };
    this.deps.write(state);
    this.attach(state, profile);
  }
  async unlock(profile: string): Promise<void> {
    const session = await this.account(profile);
    if (
      !(await this.deps.consent(
        "Unlock the E2EE vault using this device’s OS keyring?",
      ))
    )
      return;
    if ((await this.account(profile)).ownerId !== session.ownerId)
      throw Error("Account changed.");
    const state = this.deps.read(session.ownerId);
    if (!state) throw Error("No vault exists on this device.");
    this.validate(state, session.ownerId, true);
    this.lock();
    this.attach(state, profile);
  }
  private async unlocked(profile: string): Promise<KagiVaultClient> {
    await this.account(profile);
    if (!this.client || !this.state) throw Error("Unlock the vault first.");
    return this.client;
  }
  async save(
    profile: string,
    title: string,
    key: string,
    value: string,
  ): Promise<void> {
    const client = await this.unlocked(profile);
    await client.save({ id: newOpaqueId(), title, key, value });
  }
  async sync(profile: string): Promise<void> {
    const client = await this.unlocked(profile);
    for (const id of Object.keys(this.state!.records)) await client.pull(id);
  }
  async retry(profile: string): Promise<void> {
    const client = await this.unlocked(profile);
    for (const id of Object.keys(this.state!.pending ?? {}))
      await client.retryPending(id);
  }
  private snapshot(): string {
    if (!this.state || Object.keys(this.state.pending ?? {}).length)
      throw Error("Unlock and resolve pending writes first.");
    return JSON.stringify({
      ...this.state,
      key: Buffer.from(this.state.key).toString("hex"),
      pending: {},
    });
  }
  private validate(
    state: VaultState,
    ownerId: string,
    allowPending = false,
  ): void {
    if (
      !state ||
      state.ownerId !== ownerId ||
      !/^[a-f0-9]{32}$/.test(state.vaultId) ||
      !(state.key instanceof Uint8Array) ||
      state.key.length !== 32 ||
      !state.records ||
      typeof state.records !== "object" ||
      Array.isArray(state.records) ||
      Object.keys(state.records).length > 4096 ||
      (!allowPending && Object.keys(state.pending ?? {}).length)
    )
      throw Error("Invalid vault snapshot.");
    for (const [id, row] of Object.entries(state.records)) {
      if (
        id !== row.itemId ||
        row.vaultId !== state.vaultId ||
        row.deleted ||
        !row.envelope ||
        !Number.isSafeInteger(row.revision) ||
        row.revision < 1
      )
        throw Error("Invalid vault snapshot.");
      openSecret(
        state.key,
        {
          ownerId,
          vaultId: state.vaultId,
          itemId: id,
          generation: row.revision,
        },
        row.envelope,
      );
    }
  }
  private async importSnapshot(profile: string, text: string): Promise<void> {
    const session = await this.account(profile);
    if (
      this.state ||
      this.deps.exists(session.ownerId) ||
      text.length > 16777216
    )
      throw Error("Recovery requires a device without an existing vault.");
    const parsed = JSON.parse(text);
    if (typeof parsed.key !== "string" || !/^[a-f0-9]{64}$/.test(parsed.key))
      throw Error("Invalid vault snapshot.");
    const state: VaultState = {
      ownerId: parsed.ownerId,
      vaultId: parsed.vaultId,
      records: parsed.records,
      key: Buffer.from(parsed.key, "hex"),
      pending: parsed.pending,
    };
    try {
      this.validate(state, session.ownerId);
      this.deps.write(state);
      this.attach(state, profile);
    } catch (error) {
      state.key.fill(0);
      throw error;
    }
  }
  async requestDevice(
    profile: string,
  ): Promise<{ request: DeviceRequest; fingerprint: string }> {
    const session = await this.account(profile);
    if (this.deps.exists(session.ownerId) || this.state)
      throw Error("Device enrollment requires an empty device.");
    this.enrollment?.privateKey.fill(0);
    const request = createDeviceRequest(session.ownerId, this.now());
    this.enrollment = { ...request, profile };
    return { request: request.request, fingerprint: request.fingerprint };
  }
  async approveDevice(
    profile: string,
    request: DeviceRequest,
    fingerprint: string,
  ): Promise<DeviceTransfer> {
    await this.unlocked(profile);
    if (request.ownerId !== this.state!.ownerId)
      throw Error("Device account mismatch.");
    return sealDeviceTransfer(
      request,
      fingerprint,
      this.snapshot(),
      this.now(),
    );
  }
  async completeDevice(
    profile: string,
    transfer: DeviceTransfer,
    senderFingerprint: string,
  ): Promise<void> {
    if (!this.enrollment || this.enrollment.profile !== profile)
      throw Error("Create a fresh device request first.");
    const request = this.enrollment;
    this.enrollment = null; // consume even on rejection
    try {
      await this.importSnapshot(
        profile,
        openDeviceTransfer(
          request.privateKey,
          request.request,
          transfer,
          senderFingerprint,
          this.now(),
        ),
      );
    } finally {
      request.privateKey.fill(0);
    }
  }
  async recovery(profile: string): Promise<ReturnType<typeof sealRecovery>> {
    await this.unlocked(profile);
    return sealRecovery(this.snapshot());
  }
  async recover(
    profile: string,
    code: string,
    file: RecoveryPackage,
  ): Promise<void> {
    await this.importSnapshot(profile, openRecovery(code, file));
  }
  // @lat: [[e2ee-vault#Execution consent]]
  async grant(profile: string, itemId: string): Promise<void> {
    if (!this.deps.canExecute?.(profile))
      throw Error(
        "Choose a local connection before granting a credential disclosure.",
      );
    const view = await this.view(profile),
      item = view.items.find((row) => row.id === itemId);
    if (!item || !/^[A-Z][A-Z0-9_]{0,127}$/.test(item.key))
      throw Error("Invalid secret selection.");
    const epoch = this.epoch;
    if (
      !(await this.deps.consent(
        `Allow ONE secret request for ${item.key} (${item.title}) from the local Hermes gateway in profile ${profile || "default"} within ten minutes? The agent and its tools may see the value. Hermes credential capture stores it in profile .env/auth data and may expose it to subprocesses. Grant expiry or revocation does not erase those copies. Desktop does not grant a cloud executor or bulk Vault access.`,
      ))
    )
      return;
    await this.unlocked(profile);
    if (epoch !== this.epoch || !this.deps.canExecute?.(profile))
      throw Error("Vault or connection changed.");
    if (
      [...this.grants.values()].some(
        (g) =>
          g.profile === profile && g.key === item.key && g.itemId !== itemId,
      )
    )
      throw Error("Revoke the existing grant for this variable first.");
    this.grants.set(itemId, {
      itemId,
      key: item.key,
      profile,
      expiresAt: this.now() + 600000,
    });
  }
  revoke(itemId?: string): void {
    ++this.grantEpoch;
    if (itemId) this.grants.delete(itemId);
    else this.grants.clear();
  }
  async resolve(
    profile: string,
    key: string,
    sessionId: string,
  ): Promise<string | null> {
    if (!this.deps.canExecute?.(profile)) return null;
    const client = await this.unlocked(profile);
    const grant = [...this.grants.values()].find(
      (g) => g.profile === profile && g.key === key && g.expiresAt > this.now(),
    );
    if (!grant) return null;
    this.grants.delete(grant.itemId); // one-use and safe against concurrent requests
    const epoch = this.epoch;
    const grantEpoch = this.grantEpoch;
    if (
      !(await this.deps.consent(
        `Release ${key} to local Hermes session ${sessionId.slice(0, 128)} in profile ${profile || "default"} now? The agent and tools receive this secret. Hermes may persist it in .env/auth data; revoking this grant will not erase those copies.`,
      ))
    )
      return null;
    await this.unlocked(profile);
    if (
      !this.deps.canExecute?.(profile) ||
      epoch !== this.epoch ||
      grantEpoch !== this.grantEpoch ||
      grant.expiresAt <= this.now()
    )
      return null;
    const value = await client.resolve(grant.itemId, key);
    return this.deps.canExecute?.(profile) &&
      epoch === this.epoch &&
      grantEpoch === this.grantEpoch &&
      grant.expiresAt > this.now()
      ? value
      : null;
  }
}
export { transferFingerprint };
