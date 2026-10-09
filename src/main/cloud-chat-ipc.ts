import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { CloudChat } from "./cloud-chat";

// @lat: [[cloud-workspace#Cloud workspace#Main process boundary#Cloud Chat IPC registration]]
export function registerCloudChatIPC(
  ipcMain: Pick<IpcMain, "handle">,
  trustedWorkspaceSender: (event: IpcMainInvokeEvent) => void,
  cloudChat: CloudChat,
): void {
  ipcMain.handle("cloud-chat-status", (event) => {
    trustedWorkspaceSender(event);
    return cloudChat.auth.status();
  });
  ipcMain.handle("cloud-chat-enable", (event) => {
    trustedWorkspaceSender(event);
    return cloudChat.auth.enable();
  });
  ipcMain.handle("cloud-chat-disable", (event) => {
    trustedWorkspaceSender(event);
    return cloudChat.auth.reset();
  });
  ipcMain.handle("cloud-chat-runtime", (event) => {
    trustedWorkspaceSender(event);
    return cloudChat.runtime();
  });
  ipcMain.handle("cloud-chat-models", (event) => {
    trustedWorkspaceSender(event);
    return cloudChat.models();
  });
  ipcMain.handle("cloud-chat-file-put", (event, owner, id, bytes) => {
    trustedWorkspaceSender(event);
    return cloudChat.historyFiles.forOwner(owner).put(id, bytes);
  });
  ipcMain.handle("cloud-chat-file-get", (event, owner, id, digest) => {
    trustedWorkspaceSender(event);
    return cloudChat.historyFiles.forOwner(owner).get(id, digest);
  });
  ipcMain.handle("cloud-chat-list", (event) => {
    trustedWorkspaceSender(event);
    return cloudChat.list();
  });
  ipcMain.handle("cloud-chat-events", (event, id, after) => {
    trustedWorkspaceSender(event);
    return cloudChat.events(id, after);
  });
  ipcMain.handle("cloud-chat-apply", (event, id, operation) => {
    trustedWorkspaceSender(event);
    return cloudChat.apply(id, operation);
  });
  ipcMain.handle("cloud-chat-gateway-selection", (event, request) => {
    trustedWorkspaceSender(event);
    return cloudChat.gatewaySelection(request);
  });
  ipcMain.handle("cloud-chat-gateway-review", (event, request) => {
    trustedWorkspaceSender(event);
    return cloudChat.reviewGateway(request);
  });
  ipcMain.handle("cloud-chat-native-consent-create", (event, request, body) => {
    trustedWorkspaceSender(event);
    return cloudChat.createNativeChildConsent(request, body);
  });
  ipcMain.handle("cloud-chat-native-consent-poll", (event, request) => {
    trustedWorkspaceSender(event);
    return cloudChat.pollNativeChildConsent(request);
  });
  ipcMain.handle("cloud-chat-native-consent-review", (event, request) => {
    trustedWorkspaceSender(event);
    return cloudChat.reviewNativeChildConsent(request);
  });
  ipcMain.handle("cloud-chat-native-consent-cancel", (event, request) => {
    trustedWorkspaceSender(event);
    return cloudChat.cancelNativeChildConsent(request);
  });
  ipcMain.handle("cloud-chat-native-consent-execute", (event, request) => {
    trustedWorkspaceSender(event);
    return cloudChat.executeNativeChildConsent(request);
  });
  ipcMain.handle("cloud-chat-browser-step", (event, id, body) => {
    trustedWorkspaceSender(event);
    return cloudChat.browserStep(id, body);
  });
  ipcMain.handle("cloud-chat-receipt", (event, id, operationId) => {
    trustedWorkspaceSender(event);
    return cloudChat.receipt(id, operationId);
  });
}
