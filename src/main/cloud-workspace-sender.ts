import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { isAllowedAppNavigationUrl } from "./security";

export function assertCloudWorkspaceSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow | null,
  rendererHtmlPath: string,
  devServerUrl?: string,
): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !event.senderFrame ||
    !isAllowedAppNavigationUrl(
      event.senderFrame.url,
      rendererHtmlPath,
      devServerUrl,
    )
  ) {
    throw new Error("Workspace IPC requires the trusted Desktop main frame");
  }
}
