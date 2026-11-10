import { contextBridge, ipcRenderer } from "electron";

// The only bridge between the web app and the desktop shell.
contextBridge.exposeInMainWorld("musikeDesktop", {
  platform: process.platform,
  setTheme: (theme: "dark" | "light") => ipcRenderer.send("musike:theme", theme),
  setLanguage: (lang: string) => ipcRenderer.send("musike:lang", lang),
  getDownloadPath: () => ipcRenderer.invoke("musike:download-path") as Promise<string>,
  chooseDownloadPath: () => ipcRenderer.invoke("musike:choose-download-path") as Promise<string | null>,
  onDownload: (callback: (update: { state: "complete" | "failed"; filename: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: { state: "complete" | "failed"; filename: string }) => callback(update);
    ipcRenderer.on("musike:download", listener);
    return () => ipcRenderer.removeListener("musike:download", listener);
  },
  retry: () => ipcRenderer.send("musike:retry"),
});
