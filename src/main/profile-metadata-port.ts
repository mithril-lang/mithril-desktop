import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import {
  repositoryFingerprint,
  type JsonValue,
} from "@mithril/workspace/repository";
import type { CapabilityResourceTransport } from "@mithril/workspace/capability-resources";
import {
  uploadProfileMetadata,
  downloadProfileMetadata,
  validProfileMetadataPointer,
} from "@mithril/workspace/profile-resources";
import type {
  ReplicaRecord,
  ReplicaWrite,
  ReplicaResult,
} from "@mithril/workspace/replica-sync";
import { readProfileMetadataFile } from "./profile-meta-files";
import { ProfileMetadataReplica } from "./profile-metadata-replica";
const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const same = (a: Buffer | null, b: Buffer | null): boolean =>
  a === null ? b === null : b !== null && a.equals(b);

/** Fixed original metadata source; guards fence every await and native restoration. */
// @lat: [[cloud-workspace#Original profile metadata replica port (draft)]]
export class ProfileMetadataPort {
  readonly id: string;
  private readonly journal: ProfileMetadataReplica;
  constructor(
    private scope: {
      owner: string;
      profile: string;
      root: string;
      replicaId: string;
    },
    directory: string,
    private resources: CapabilityResourceTransport,
    private guard: () => Promise<void>,
  ) {
    this.scope = Object.freeze({ ...scope });
    this.id = `profile-metadata-${scope.profile}`;
    this.journal = new ProfileMetadataReplica(directory, scope);
  }
  private profilePresent(): boolean {
    try {
      const info = lstatSync(this.scope.root);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw Error("Unsafe original profile directory");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  private async capture(): Promise<{
    bytes: Buffer | null;
    record: ReplicaRecord | null;
  }> {
    await this.guard();
    if (!this.profilePresent()) return { bytes: null, record: null };
    this.journal.recover();
    const bytes = readProfileMetadataFile(this.scope.root);
    if (bytes === null) {
      const last = this.journal.latest();
      return { bytes, record: last?.deleted ? last : null };
    }
    const pointer = await uploadProfileMetadata(
      this.resources,
      this.scope.owner,
      this.scope.profile,
      bytes,
    );
    await this.guard();
    if (!same(bytes, readProfileMetadataFile(this.scope.root)))
      throw Error("Profile metadata changed during upload");
    const body = pointer as unknown as JsonValue;
    return {
      bytes,
      record: {
        collection: "profile",
        id: this.id,
        body,
        deleted: false,
        version: hash(repositoryFingerprint({ body, deleted: false })),
      },
    };
  }
  async snapshot(): Promise<ReplicaRecord | null> {
    return (await this.capture()).record;
  }
  async apply(write: ReplicaWrite): Promise<ReplicaResult> {
    if (
      write.document.collection !== "profile" ||
      write.document.id !== this.id
    )
      throw Error("Foreign profile metadata operation");
    const result = (
      status: ReplicaResult["status"],
      record: ReplicaRecord | null,
    ): ReplicaResult => ({
      schemaVersion: 1,
      userId: this.scope.owner,
      replicaId: this.scope.replicaId,
      status,
      record,
    });
    const fingerprint = hash(
      JSON.stringify([this.scope.owner, this.scope.replicaId, write]),
    );
    await this.guard();
    if (!write.document.deleted && !this.profilePresent())
      return result("deferred", null);
    if (this.profilePresent()) this.journal.recover();
    const receipt = this.journal.receipt(write.operationId, fingerprint);
    if (receipt) return result("applied", receipt);
    const local = await this.capture();
    if (
      (local.record?.version ?? null) !== write.expectedVersion ||
      (local.record === null) !== (write.expectedRecord === null) ||
      (local.record &&
        write.expectedRecord &&
        repositoryFingerprint(local.record) !==
          repositoryFingerprint(write.expectedRecord))
    )
      return result("conflict", local.record);
    let target: Uint8Array | null = null;
    if (!write.document.deleted) {
      if (
        !validProfileMetadataPointer(write.document.body) ||
        write.document.body.profile !== this.scope.profile
      )
        throw Error("Invalid profile metadata target");
      target = await downloadProfileMetadata(
        this.resources,
        this.scope.owner,
        write.document.body,
      );
    }
    await this.guard();
    if (!write.document.deleted && !this.profilePresent())
      return result("deferred", null);
    if (!same(local.bytes, readProfileMetadataFile(this.scope.root)))
      return result("conflict", await this.snapshot());
    const record: ReplicaRecord = {
      collection: "profile",
      id: this.id,
      body: write.document.body,
      deleted: write.document.deleted,
      version: hash(repositoryFingerprint(write.document)),
    };
    return result(
      "applied",
      this.journal.apply(
        write.operationId,
        fingerprint,
        local.bytes,
        target,
        record,
      ),
    );
  }
}
