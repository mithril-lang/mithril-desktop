// Electron sandbox preloads require CommonJS; this plain JS fixture has no TypeScript annotations.
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("hermesAPI", {
  cloudWorkspace: {
    enable: () => ipcRenderer.invoke("qa-enable"),
    getSnapshot: () => ipcRenderer.invoke("qa-snapshot"),
    applyOperations: (ops, owner) => ipcRenderer.invoke("qa-apply", ops, owner),
    localSync: {
      status: () => ipcRenderer.invoke("qa-status"),
      synchronize: () => ipcRenderer.invoke("qa-sync"),
      resolve: (id, choice) => ipcRenderer.invoke("qa-resolve", id, choice),
      onChanged: (cb) => {
        const run = () => cb();
        ipcRenderer.on("qa-changed", run);
        return () => ipcRenderer.removeListener("qa-changed", run);
      },
    },
  },
  onCloudWorkspaceAccountChanged: () => () => {},
});
