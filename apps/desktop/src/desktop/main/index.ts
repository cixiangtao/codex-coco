import { app, BrowserWindow, ipcMain, Menu, nativeTheme, net, protocol, dialog } from "electron";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SettingsError, SettingsStore } from "../../application/settings-store";
import { ModuleManager } from "../../application/modules";
import { moduleDefinitions } from "../../modules/registry";
import { channels, type Result } from "../../contracts/bridge";
import { resolveTheme } from "@codex-coco/ui/theme/resolve";
import { isTrustedPage } from "./security";

app.setName("Codex Coco");
// Isolate the rebuilt foundation from both the archived prototype and the source applications.
app.setPath(
  "userData",
  process.env.CODEX_COCO_DATA_DIR ?? join(app.getPath("appData"), "Codex Coco", "foundation"),
);
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(here, "../renderer");
const productionUrl = "app://codex-coco/index.html";
const developmentUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
if (developmentUrl) {
  const url = new URL(developmentUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error("INVALID_DEVELOPMENT_ORIGIN");
  }
}
const entryUrl = developmentUrl ?? productionUrl;
const windows = new Map<number, BrowserWindow>();
const modules = new ModuleManager(moduleDefinitions);
let store: SettingsStore;
let quitting = false;

function createWindow() {
  const theme = store.getSnapshot().settings.theme;
  const mode =
    theme.mode === "system" ? (nativeTheme.shouldUseDarkColors ? "dark" : "light") : theme.mode;
  const win = new BrowserWindow({
    title: "Codex Coco",
    width: 980,
    height: 800,
    minWidth: 720,
    minHeight: 640,
    show: false,
    backgroundColor: resolveTheme(theme, mode).background,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  const contentsId = win.webContents.id;
  windows.set(contentsId, win);
  win.on("closed", () => windows.delete(contentsId));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedPage(url, entryUrl)) event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  win.webContents.session.setPermissionCheckHandler(() => false);
  void win.loadURL(entryUrl).catch(() => {
    console.error("RENDERER_LOAD_FAILED");
    win.destroy();
  });
  return win;
}

function registerIpc() {
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    windows.has(event.sender.id) &&
    event.senderFrame === event.sender.mainFrame &&
    isTrustedPage(event.senderFrame?.url ?? "", entryUrl);
  function handle<T>(channel: string, operation: (input: unknown) => T | Promise<T>) {
    ipcMain.handle(channel, async (event, input: unknown): Promise<Result<T>> => {
      if (!trusted(event))
        return { ok: false, error: { code: "FORBIDDEN", message: "此页面没有操作权限。" } };
      try {
        return { ok: true, value: await operation(input) };
      } catch (error) {
        if (error instanceof SettingsError)
          return { ok: false, error: { code: error.code, message: error.message } };
        console.error("SETTINGS_OPERATION_FAILED");
        return {
          ok: false,
          error: { code: "STORAGE_ERROR", message: "设置未能保存，请检查磁盘权限后重试。" },
        };
      }
    });
  }
  handle(channels.bootstrap, (input) => {
    if (input !== undefined) throw new SettingsError("INVALID_INPUT", "启动请求无效。");
    return store.getSnapshot();
  });
  handle(channels.saveTheme, (input) => store.saveTheme(input));
  handle(channels.resetSettings, (input) => {
    if (input !== undefined) throw new SettingsError("INVALID_INPUT", "恢复请求无效。");
    return store.reset();
  });
  ipcMain.on(channels.rendererReady, (event) => {
    if (trusted(event)) windows.get(event.sender.id)?.show();
  });
  store.subscribe((snapshot) => {
    for (const win of windows.values()) {
      if (!win.isDestroyed()) win.webContents.send(channels.settingsChanged, snapshot);
    }
  });
}

async function start() {
  await app.whenReady();
  protocol.handle("app", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "codex-coco" || request.method !== "GET")
        return new Response(null, { status: 403 });
      const asset = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`);
      if (!asset.startsWith(rendererRoot + sep)) return new Response(null, { status: 403 });
      const response = await net.fetch(pathToFileURL(asset).toString());
      const headers = new Headers(response.headers);
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'",
      );
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  store = new SettingsStore(join(app.getPath("userData"), "settings.json"));
  await store.load();
  registerIpc();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Codex Coco",
        submenu: [
          { role: "about", label: "关于 Codex Coco" },
          { type: "separator" },
          { role: "quit", label: "退出 Codex Coco" },
        ],
      },
      {
        label: "文件",
        submenu: [
          {
            label: "新建窗口",
            accelerator: "CmdOrCtrl+N",
            click: () => {
              createWindow();
            },
          },
          { role: "close", label: "关闭窗口" },
        ],
      },
      { role: "editMenu", label: "编辑" },
      { role: "windowMenu", label: "窗口" },
    ]),
  );
  createWindow();
  app.on("activate", () => {
    if (windows.size === 0) createWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (quitting || !store) return;
  event.preventDefault();
  quitting = true;
  void Promise.all([modules.shutdown(), store.flush()])
    .then(([statuses]) => {
      if (statuses.some((status) => status.phase === "error"))
        console.error("MODULE_SHUTDOWN_INCOMPLETE");
      app.quit();
    })
    .catch(() => {
      console.error("SHUTDOWN_FAILED");
      app.exit(1);
    });
});
app.on("second-instance", () => {
  const existing = [...windows.values()][0];
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
  } else if (store) createWindow();
});
if (!app.requestSingleInstanceLock()) app.quit();
else
  void start().catch(() => {
    dialog.showErrorBox(
      "Codex Coco 无法启动",
      "无法读取应用设置或初始化桌面环境。原文件已保留，请检查目录权限后重试。",
    );
    app.exit(1);
  });
