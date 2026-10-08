import { lstatSync } from "node:fs";
import {
  memoryFileId,
  memoryFileKinds,
  validMemoryFile,
} from "@mithril/workspace/memory-files";
import type { RepositoryDocument } from "@mithril/workspace/repository";
import type { ReplicaRecord } from "@mithril/workspace/replica-sync";
import type { ProfileMetadataSource } from "./profile-metadata-inventory";
import { memoryReplicaSnapshot } from "./memory-replica-files";

/** Cloud content cannot choose a path or recreate a missing original profile. */
export function profileMemorySource(
  sources: ProfileMetadataSource[],
  document: RepositoryDocument,
): ProfileMetadataSource | undefined {
  if (document.collection !== "memory" || !validMemoryFile(document.body))
    return undefined;
  const body = document.body;
  const source = sources.find(
    (row) =>
      row.present &&
      row.profile === body.profile &&
      document.id === memoryFileId(row.profile, body.kind),
  );
  if (!source) return undefined;
  try {
    const info = lstatSync(source.root);
    return info.isDirectory() && !info.isSymbolicLink() ? source : undefined;
  } catch {
    return undefined;
  }
}

/** Inventory is owner-bound before any original Memory file is read. */
// @lat: [[cloud-workspace#All-profile Memory source inventory (draft)]]
export function profileMemoryInventory(sources: ProfileMetadataSource[]): {
  documents: ReplicaRecord[];
  ids: string[];
  warnings: string[];
} {
  const documents: ReplicaRecord[] = [],
    ids: string[] = [],
    warnings: string[] = [];
  for (const source of sources) {
    if (!source.present) continue;
    try {
      const before = lstatSync(source.root);
      if (!before.isDirectory() || before.isSymbolicLink())
        throw Error("Profile unavailable");
      const rows = memoryReplicaSnapshot(source.root, source.profile);
      const after = lstatSync(source.root);
      if (
        !after.isDirectory() ||
        after.isSymbolicLink() ||
        before.ino !== after.ino ||
        before.dev !== after.dev
      )
        throw Error("Profile changed during Memory capture");
      documents.push(...rows);
      ids.push(
        ...memoryFileKinds.map((kind) => memoryFileId(source.profile, kind)),
      );
    } catch {
      warnings.push(
        `Profile ${source.profile} Memory source is unavailable; original files are retained`,
      );
    }
  }
  return { documents, ids, warnings };
}
