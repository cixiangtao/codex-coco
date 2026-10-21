import { contextBridge, ipcRenderer } from "electron";
import { channels, type DesktopBridge } from "../../contracts/bridge";
import type { ModuleSnapshot } from "../../contracts/modules";
import type { SettingsSnapshot } from "../../contracts/settings";

const bridge: DesktopBridge = {
  modules: () => ipcRenderer.invoke(channels.modules),
  enableModule: (input) => ipcRenderer.invoke(channels.enableModule, input),
  saveModuleConfig: (input) => ipcRenderer.invoke(channels.saveModuleConfig, input),
  resetModuleConfig: (input) => ipcRenderer.invoke(channels.resetModuleConfig, input),
  runModuleOperation: (input) => ipcRenderer.invoke(channels.runModuleOperation, input),
  cancelModuleOperation: (input) => ipcRenderer.invoke(channels.cancelModuleOperation, input),
  onModuleChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: ModuleSnapshot) =>
      listener(snapshot);
    ipcRenderer.on(channels.moduleChanged, handler);
    return () => {
      ipcRenderer.removeListener(channels.moduleChanged, handler);
    };
  },
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
