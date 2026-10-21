import { contextBridge, ipcRenderer } from "electron";
import { channels, type DesktopBridge } from "../../contracts/bridge";
import type { SettingsSnapshot } from "../../contracts/settings";

const bridge: DesktopBridge = {
  ready: () => ipcRenderer.send(channels.rendererReady),
  bootstrap: () => ipcRenderer.invoke(channels.bootstrap),
  saveTheme: (input) => ipcRenderer.invoke(channels.saveTheme, input),
  resetSettings: () => ipcRenderer.invoke(channels.resetSettings),
  onSettingsChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: SettingsSnapshot) =>
      listener(snapshot);
    ipcRenderer.on(channels.settingsChanged, handler);
    return () => {
      ipcRenderer.removeListener(channels.settingsChanged, handler);
    };
  },
};
contextBridge.exposeInMainWorld("codexCoco", Object.freeze(bridge));
