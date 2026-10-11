import type { KagiVaultController } from "./kagi-vault-controller";
let controller: KagiVaultController | null = null;
export function setKagiVaultController(value: KagiVaultController): void {
  controller = value;
}
/** Only the local gateway's targeted secret.request path can consume grants. */
export async function resolveGrantedVaultSecret(
  profile: string,
  key: string,
  sessionId: string,
): Promise<string | null> {
  try {
    return (await controller?.resolve(profile, key, sessionId)) ?? null;
  } catch {
    return null;
  }
}
