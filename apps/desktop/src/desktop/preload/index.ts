import type { GlanceLayoutSnapshot } from "../../contracts/glance-layout";
import type { UpdateSnapshot } from "../../contracts/updates";
import type { MainPage } from "../../contracts/windows";
import type { GlanceSnapshot } from "../../contracts/glance";
import { contextBridge, ipcRenderer } from "electron";
import { channels, type DesktopBridge } from "../../contracts/bridge";
import type { ModuleSnapshot } from "../../contracts/modules";
import type { SettingsSnapshot } from "../../contracts/settings";

const bridge: DesktopBridge = {
  glanceLayout: () => ipcRenderer.invoke(channels.glanceLayout),
  saveGlanceLayout: (input) => ipcRenderer.invoke(channels.saveGlanceLayout, input),
  resetGlanceLayout: () => ipcRenderer.invoke(channels.resetGlanceLayout),
  glancePreview: () => ipcRenderer.invoke(channels.glancePreview),
  onGlanceLayoutChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: GlanceLayoutSnapshot) =>
      listener(snapshot);
    ipcRenderer.on(channels.glanceLayoutChanged, handler);
    return () => {
      ipcRenderer.removeListener(channels.glanceLayoutChanged, handler);
    };
  },
  updates: () => ipcRenderer.invoke(channels.updates),
  saveUpdatePreferences: (input) => ipcRenderer.invoke(channels.saveUpdatePreferences, input),
  updateAction: (input) => ipcRenderer.invoke(channels.updateAction, input),
  onUpdatesChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: UpdateSnapshot) =>
      listener(snapshot);
    ipcRenderer.on(channels.updatesChanged, handler);
    return () => {
      ipcRenderer.removeListener(channels.updatesChanged, handler);
    };
  },
  windowContext: () => ipcRenderer.invoke(channels.windowContext),
  openMainPage: (input) => ipcRenderer.invoke(channels.openMainPage, input),
  dismissGlance: () => ipcRenderer.invoke(channels.dismissGlance),
  onNavigate: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, page: MainPage) => listener(page);
    ipcRenderer.on(channels.navigate, handler);
    return () => {
      ipcRenderer.removeListener(channels.navigate, handler);
    };
  },
  glance: () => ipcRenderer.invoke(channels.glance),
  onGlanceChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: GlanceSnapshot) =>
      listener(snapshot);
    ipcRenderer.on(channels.glanceChanged, handler);
    return () => {
      ipcRenderer.removeListener(channels.glanceChanged, handler);
    };
  },
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
