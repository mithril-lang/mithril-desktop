import { getConnectionConfig } from "./config";
// @lat: [[e2ee-vault#Native Vault UI]]
import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  KagiVaultController,
  transferFingerprint,
} from "./kagi-vault-controller";
import { readKagiVaultState, writeKagiVaultState } from "./kagi-vault-store";
import { setKagiVaultController } from "./kagi-vault-runtime";
import { readCloudAccountToken } from "./mithril-token-store";
import { inspectMithrilToken } from "./mithril-token";
import { getActiveProfileNameSync, normalizeProfileName } from "./utils";
import { showPasswordDialog } from "./askpass";
import type {
  VaultAction,
  VaultInput,
  VaultResult,
} from "../shared/kagi-vault";

export function registerKagiVaultIpc(
  trust: (event: IpcMainInvokeEvent) => void,
  window: () => BrowserWindow | null,
): void {
  const directory = join(app.getPath("userData"), "e2ee-vault");
  const path = (owner: string): string =>
    join(directory, `${createHash("sha256").update(owner).digest("hex")}.json`);
  const consent = async (detail: string): Promise<boolean> => {
    const result = await dialog.showMessageBox({
      type: "question",
      title: "E2EE Vault",
      message: detail,
      buttons: ["Cancel", "Continue"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1;
  };
  const controller = new KagiVaultController({
    session: async (profile) => {
      if (profile !== (normalizeProfileName(getActiveProfileNameSync()) || ""))
        return null;
      const token = readCloudAccountToken(profile);
      if (!token) return null;
      const account = await inspectMithrilToken(token);
      if (
        !account.ok ||
        !account.scopes.includes("vault:read") ||
        !account.scopes.includes("vault:write") ||
        token !== readCloudAccountToken(profile)
      )
        return null;
      return { ownerId: account.userId, token };
    },
    exists: (owner) => existsSync(path(owner)),
    read: (owner) => readKagiVaultState(path(owner), owner),
    write: (state) => {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeKagiVaultState(path(state.ownerId), state);
    },
    consent,
    canExecute: () => getConnectionConfig().mode === "local",
  });
  setKagiVaultController(controller);
  app.once("before-quit", () => controller.lock());
  const secret = async (message: string): Promise<string> =>
    (await showPasswordDialog(window(), message, {
      title: "E2EE Vault",
      heading: "Vault private input",
    })) ?? "";
  const save = async (name: string, value: unknown): Promise<boolean> => {
    const picked = await dialog.showSaveDialog({
      title: "Save encrypted Vault file",
      defaultPath: name,
      filters: [{ name: "Vault JSON", extensions: ["json"] }],
    });
    if (picked.canceled || !picked.filePath) return false;
    // Exclusive creation protects an existing recovery kit from accidental overwrite.
    writeFileSync(picked.filePath, JSON.stringify(value), {
      mode: 0o600,
      flag: "wx",
    });
    return true;
  };
  const load = async (): Promise<unknown> => {
    const picked = await dialog.showOpenDialog({
      title: "Open Vault file",
      properties: ["openFile"],
      filters: [{ name: "Vault JSON", extensions: ["json"] }],
    });
    if (picked.canceled || !picked.filePaths[0])
      throw Error("File selection cancelled.");
    if (statSync(picked.filePaths[0]).size > 34000000)
      throw Error("Vault file is too large.");
    return JSON.parse(readFileSync(picked.filePaths[0], "utf8"));
  };
  let busy = false;
  ipcMain.handle(
    "kagi-vault",
    async (
      event,
      action: VaultAction,
      input: VaultInput = {},
    ): Promise<VaultResult> => {
      trust(event);
      if (busy)
        return {
          ok: false,
          error: "A Vault operation is already in progress.",
        };
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (k) => !["itemId", "title", "key"].includes(k),
        ) ||
        Object.values(input).some(
          (v) => typeof v !== "string" || v.length > 256,
        )
      )
        return { ok: false, error: "Invalid Vault request." };
      busy = true;
      const profile = normalizeProfileName(getActiveProfileNameSync()) || "";
      try {
        switch (action) {
          case "status":
            break;
          case "create":
            await controller.create(profile);
            break;
          case "unlock":
            await controller.unlock(profile);
            break;
          case "lock":
            controller.lock();
            break;
          case "save": {
            const value = await secret(
              `Enter the value for ${input.title ?? ""} (${input.key ?? ""}). It stays outside the chat and settings renderer.`,
            );
            if (value)
              await controller.save(
                profile,
                input.title ?? "",
                input.key ?? "",
                value,
              );
            break;
          }
          case "sync":
            await controller.sync(profile);
            break;
          case "retry":
            await controller.retry(profile);
            break;
          case "request-device": {
            const request = await controller.requestDevice(profile);
            if (await save("mithril-device-request.json", request.request))
              await dialog.showMessageBox({
                title: "Device request fingerprint",
                message:
                  "Compare this FULL fingerprint on the approving device through a trusted channel.",
                detail: request.fingerprint,
              });
            else controller.lock();
            break;
          }
          case "approve-device": {
            const request = (await load()) as Parameters<
              typeof controller.approveDevice
            >[1];
            const fingerprint = await secret(
              "Enter the FULL 64-character request fingerprint shown on the NEW device. Obtain it directly from that device, not from the request file or sync server.",
            );
            const transfer = await controller.approveDevice(
              profile,
              request,
              fingerprint,
            );
            if (await save("mithril-device-transfer.json", transfer))
              await dialog.showMessageBox({
                title: "Approving device fingerprint",
                message:
                  "The NEW device must compare this FULL transfer fingerprint with this screen through a trusted channel.",
                detail: transferFingerprint(transfer),
              });
            break;
          }
          case "complete-device": {
            const transfer = (await load()) as Parameters<
              typeof controller.completeDevice
            >[1];
            const fingerprint = await secret(
              "Enter the FULL 64-character transfer fingerprint shown on the APPROVING device. Obtain it directly from that device, not from the transfer file.",
            );
            await controller.completeDevice(profile, transfer, fingerprint);
            break;
          }
          case "export-recovery": {
            if (
              !(await consent(
                "Export a recovery snapshot? Keep its code separate from the encrypted file. Anyone holding BOTH can open your vault. This backup detects rollback only up to its export time. Re-export after changes.",
              ))
            )
              break;
            const recovery = await controller.recovery(profile);
            if (await save("mithril-vault-recovery.json", recovery.package))
              await dialog.showMessageBox({
                title: "Store your recovery code separately",
                message:
                  "Write down this code now. Mithril cannot recover it. This code is shown only here.",
                detail: recovery.code,
                buttons: ["I have stored the code separately"],
                noLink: true,
              });
            break;
          }
          case "recover": {
            const file = (await load()) as Parameters<
              typeof controller.recover
            >[2];
            const code = await secret(
              "Enter your separately stored 64-character recovery code. Recovery requires the same Mithril account and a device with no existing vault.",
            );
            await controller.recover(profile, code, file);
            break;
          }
          case "grant":
            await controller.grant(profile, input.itemId ?? "");
            break;
          case "revoke":
            controller.revoke(input.itemId);
            break;
          default:
            throw Error("Unknown Vault action.");
        }
        return { ok: true, view: await controller.view(profile) };
      } catch {
        return {
          ok: false,
          error:
            "Vault operation refused. Check account scopes, keyring, pending writes, and trusted fingerprints. Existing Vault data was preserved.",
        };
      } finally {
        busy = false;
      }
    },
  );
}
