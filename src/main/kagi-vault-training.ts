// @lat: [[e2ee-vault#Isolated training realm]]
import {
  openSync,
  readFileSync,
  fstatSync,
  closeSync,
  constants,
} from "node:fs";
import { VAULT_TRAINING_ORIGIN, type VaultSession } from "./kagi-vault-client";
/** Explicit private, main-process-only test account. Never modifies general API routing. */
export async function trainingVaultSession(): Promise<VaultSession | null> {
  const path = process.env.MITHRIL_VAULT_TRAINING_SESSION_FILE;
  if (!path) return null;
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (
      !st.isFile() ||
      st.mode & 0o077 ||
      st.uid !== process.getuid?.() ||
      st.size > 4096
    )
      return null;
    const s = JSON.parse(readFileSync(fd, "utf8"));
    if (
      s.realm !== "vault-training-v1" ||
      s.origin !== VAULT_TRAINING_ORIGIN ||
      !/^training-[a-f0-9]{32}$/.test(s.ownerId) ||
      !/^mf_training[A-Za-z0-9_-]{35}$/.test(s.token) ||
      !Number.isSafeInteger(s.expiresAt) ||
      s.expiresAt <= Date.now() / 1000 ||
      s.expiresAt > Date.now() / 1000 + 604800
    )
      return null;
    const response = await fetch(VAULT_TRAINING_ORIGIN + "/v1/me", {
      headers: { authorization: "Bearer " + s.token },
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(15000),
    });
    if (
      !response.ok ||
      response.headers.get("X-Mithril-Realm") !== "vault-training-v1"
    )
      return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    let text = "";
    let size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 4096) {
          await reader.cancel();
          return null;
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const body = JSON.parse(text);
    if (
      body.realm !== s.realm ||
      body.via !== "api_token" ||
      body.user?.id !== s.ownerId ||
      !Array.isArray(body.scopes) ||
      !body.scopes.includes("vault:read") ||
      !body.scopes.includes("vault:write") ||
      body.scopes.some(
        (scope: string) => !["vault:read", "vault:write"].includes(scope),
      )
    )
      return null;
    return { ownerId: s.ownerId, token: s.token, realm: "vault-training-v1" };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
