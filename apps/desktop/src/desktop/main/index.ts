import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  dialog,
  nativeImage,
} from "electron";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { DiagnosticLog } from "../../application/diagnostics";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SettingsError, SettingsStore } from "../../application/settings-store";
import { ModuleError, ModuleHost } from "../../application/module-host";
import { registeredModules } from "../../modules/registry";
import { channels, type Result } from "../../contracts/bridge";
import { resolveTheme } from "@codex-coco/ui/theme/resolve";
import { MenuBarController } from "./menu-bar";
import { buildGlanceItems } from "../../application/glance";
import { openMainPageSchema, type WindowContext, type MainPage } from "../../contracts/windows";
import type { GlanceSnapshot } from "../../contracts/glance";
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
const contexts = new Map<number, WindowContext>();
let lastMainId: number | undefined;
let menuBar: MenuBarController | undefined;
let glance: GlanceSnapshot = { revision: 0, items: buildGlanceItems([]) };
const definitions = registeredModules(
  !app.isPackaged && process.env.CODEX_COCO_FIXTURES === "1",
  () => new Worker(join(here, "foundation-worker.js"), { stdout: true, stderr: true }),
  {
    directory: join(app.getPath("userData"), "appearance-assets"),
    pickImage: async () => {
      const result = await dialog.showOpenDialog({
        title: "导入 Codex 布景图片",
        properties: ["openFile"],
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] }],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    thumbnail: (data) => {
      const image = nativeImage.createFromDataURL(data);
      if (image.isEmpty()) return null;
      const preview = image.resize({ width: 480, quality: "good" }).toDataURL();
      return preview.length < 400_000 ? preview : null;
    },
  },
);
const diagnostics = new DiagnosticLog(join(app.getPath("userData"), "diagnostics"), {
  modules: definitions.map((definition) => ({
    id: definition.id,
    operations: Object.keys(definition.operations),
  })),
});
const modules = new ModuleHost(
  definitions,
  join(app.getPath("userData"), "modules"),
  2500,
  diagnostics,
);
const windowStarts = new Map<number, number>();
let store: SettingsStore;
let quitting = false;

function createWindow(context: WindowContext = { kind: "main", page: "appearance" }) {
  const began = performance.now();
  const theme = store.getSnapshot().settings.theme;
  const mode =
    theme.mode === "system" ? (nativeTheme.shouldUseDarkColors ? "dark" : "light") : theme.mode;
  const win = new BrowserWindow({
    title: "Codex Coco",
    ...(context.kind === "main"
      ? {
          width: 980,
          height: 800,
          minWidth: 720,
          minHeight: 640,
          ...(process.platform === "darwin"
            ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 18 } }
            : {}),
        }
      : {
          width: 360,
          height: 420,
          frame: false,
          resizable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
        }),
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
  contexts.set(contentsId, context);
  if (context.kind === "main")
    win.on("focus", () => {
      lastMainId = contentsId;
    });
  windowStarts.set(contentsId, began);
  win.on("closed", () => {
    windows.delete(contentsId);
    contexts.delete(contentsId);
    if (lastMainId === contentsId) lastMainId = undefined;
    windowStarts.delete(contentsId);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedPage(url, entryUrl)) event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  win.webContents.session.setPermissionCheckHandler(() => false);
  void win.loadURL(entryUrl).catch(() => {
    diagnostics.record({
      event: "app.failure",
      outcome: "error",
      errorCode: "RENDERER_LOAD_FAILED",
    });
    win.destroy();
  });
  return win;
}

/** Reuses the last focused main window; pending navigation is replayed after renderer readiness. */
function openMain(page?: MainPage) {
  if (quitting) return;
  const mains = [...windows.values()].filter(
    (win) => contexts.get(win.webContents.id)?.kind === "main",
  );
  const existing = mains.find((win) => win.webContents.id === lastMainId) ?? mains[0];
  menuBar?.hide();
  if (!existing) {
    createWindow({ kind: "main", page: page ?? "appearance" });
    return;
  }
  if (page) {
    contexts.set(existing.webContents.id, { kind: "main", page });
    existing.webContents.send(channels.navigate, page);
  }
  if (!windowStarts.has(existing.webContents.id)) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
  }
}

function updateGlance() {
  const items = buildGlanceItems(modules.snapshots(), modules.glanceDetails());
  if (JSON.stringify(items) === JSON.stringify(glance.items)) return;
  glance = { revision: glance.revision + 1, items };
  for (const win of windows.values()) {
    if (!win.isDestroyed() && contexts.get(win.webContents.id)?.kind === "glance")
      win.webContents.send(channels.glanceChanged, glance);
  }
}

function registerIpc() {
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    windows.has(event.sender.id) &&
    event.senderFrame === event.sender.mainFrame &&
    isTrustedPage(event.senderFrame?.url ?? "", entryUrl);
  function handle<T>(
    channel: string,
    operation: (input: unknown, correlationId: string, window: BrowserWindow) => T | Promise<T>,
    scope: "main" | "glance" | "all" = "main",
  ) {
    ipcMain.handle(channel, async (event, input: unknown): Promise<Result<T>> => {
      const correlationId = randomUUID();
      const began = performance.now();
      const record = (errorCode?: string) =>
        diagnostics.record({
          event: "ipc.complete",
          action: channel,
          correlationId,
          outcome: errorCode ? "error" : "ok",
          durationMs: performance.now() - began,
          ...(errorCode ? { errorCode } : {}),
        });
      if (!trusted(event) || (scope !== "all" && contexts.get(event.sender.id)?.kind !== scope)) {
        record("FORBIDDEN");
        return {
          ok: false,
          error: { code: "FORBIDDEN", message: "此页面没有操作权限。", correlationId },
        };
      }
      try {
        const value = await operation(input, correlationId, windows.get(event.sender.id)!);
        record();
        return { ok: true, value };
      } catch (error) {
        if (error instanceof SettingsError || error instanceof ModuleError) {
          record(error.code);
          return { ok: false, error: { code: error.code, message: error.message, correlationId } };
        }
        record("STORAGE_ERROR");
        return {
          ok: false,
          error: {
            code: "STORAGE_ERROR",
            message: "操作未能完成，请检查磁盘权限后重试。",
            correlationId,
          },
        };
      }
    });
  }
  handle(
    channels.windowContext,
    (input, _correlationId, window) => {
      if (input !== undefined) throw new SettingsError("INVALID_INPUT", "窗口请求无效。");
      return contexts.get(window.webContents.id)!;
    },
    "all",
  );
  handle(
    channels.glance,
    (input) => {
      if (input !== undefined) throw new SettingsError("INVALID_INPUT", "速览请求无效。");
      return glance;
    },
    "glance",
  );
  handle(
    channels.openMainPage,
    (input) => {
      const parsed = openMainPageSchema.safeParse(input);
      if (!parsed.success) throw new SettingsError("INVALID_INPUT", "页面跳转请求无效。");
      openMain(parsed.data.page);
    },
    "all",
  );
  handle(
    channels.dismissGlance,
    (input) => {
      if (input !== undefined) throw new SettingsError("INVALID_INPUT", "收起请求无效。");
      menuBar?.hide();
    },
    "glance",
  );
  handle(channels.modules, (input) => {
    if (input !== undefined) throw new ModuleError("INVALID_INPUT", "模块列表请求无效。");
    return modules.snapshots();
  });
  handle(channels.enableModule, (input) => modules.setEnabled(input));
  handle(channels.saveModuleConfig, (input) => modules.saveConfig(input));
  handle(channels.resetModuleConfig, (input) => modules.resetConfig(input));
  handle(channels.runModuleOperation, (input, correlationId) => modules.run(input, correlationId));
  handle(channels.cancelModuleOperation, (input) => modules.cancel(input));
  modules.subscribe((snapshot) => {
    updateGlance();
    for (const win of windows.values()) {
      if (!win.isDestroyed() && contexts.get(win.webContents.id)?.kind === "main")
        win.webContents.send(channels.moduleChanged, snapshot);
    }
  });
  handle(
    channels.bootstrap,
    (input) => {
      if (input !== undefined) throw new SettingsError("INVALID_INPUT", "启动请求无效。");
      return store.getSnapshot();
    },
    "all",
  );
  handle(channels.saveTheme, (input) => store.saveTheme(input));
  handle(channels.resetSettings, (input) => {
    if (input !== undefined) throw new SettingsError("INVALID_INPUT", "恢复请求无效。");
    return store.reset();
  });
  ipcMain.on(channels.rendererReady, (event) => {
    if (!trusted(event)) return;
    const began = windowStarts.get(event.sender.id);
    if (began === undefined) return;
    windowStarts.delete(event.sender.id);
    const window = windows.get(event.sender.id)!;
    const context = contexts.get(event.sender.id)!;
    if (context.kind === "glance") menuBar?.rendererReady(window);
    else {
      window.webContents.send(channels.navigate, context.page);
      window.show();
    }
    diagnostics.record({
      event: "window.ready",
      outcome: "ok",
      durationMs: performance.now() - began,
    });
  });
  store.subscribe((snapshot) => {
    for (const win of windows.values()) {
      if (!win.isDestroyed()) win.webContents.send(channels.settingsChanged, snapshot);
    }
  });
}

async function start() {
  const began = performance.now();
  diagnostics.record({ event: "app.start" });
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
  await modules.load();
  updateGlance();
  registerIpc();
  menuBar = new MenuBarController({
    createGlance: () => createWindow({ kind: "glance" }),
    openMain,
    quit: () => app.quit(),
    unavailable: () =>
      diagnostics.record({ event: "app.failure", outcome: "error", errorCode: "TRAY_UNAVAILABLE" }),
  });
  diagnostics.record({ event: "app.ready", outcome: "ok", durationMs: performance.now() - began });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Codex Coco",
        submenu: [
          { role: "about", label: "关于 Codex Coco" },
          {
            label: "显示或收起速览",
            accelerator: "CmdOrCtrl+Shift+M",
            click: () => menuBar?.toggle(),
          },
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
  app.on("activate", () => openMain());
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !quitting) app.quit();
});
app.on("before-quit", (event) => {
  if (quitting || !store) return;
  event.preventDefault();
  quitting = true;
  menuBar?.dispose();
  void Promise.all([modules.shutdown(), store.flush()])
    .then(async ([statuses]) => {
      const incomplete = statuses.some((status) => status.phase === "error");
      diagnostics.record({
        event: "app.shutdown",
        outcome: incomplete ? "error" : "ok",
        ...(incomplete ? { errorCode: "MODULE_STOP_FAILED" } : {}),
      });
      await diagnostics.close();
      app.quit();
    })
    .catch(async () => {
      diagnostics.record({ event: "app.failure", outcome: "error", errorCode: "SHUTDOWN_FAILED" });
      await diagnostics.close();
      app.exit(1);
    });
});
app.on("second-instance", () => {
  if (store) openMain();
});
if (!app.requestSingleInstanceLock()) app.quit();
else
  void start().catch(async () => {
    diagnostics.record({ event: "app.failure", outcome: "error", errorCode: "STARTUP_FAILED" });
    await diagnostics.close();
    dialog.showErrorBox(
      "Codex Coco 无法启动",
      "无法读取应用设置或初始化桌面环境。原文件已保留，请检查目录权限后重试。",
    );
    app.exit(1);
  });
