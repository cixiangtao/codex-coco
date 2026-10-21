import { Menu, screen, Tray, type BrowserWindow } from "electron";
import type { GlanceSnapshot } from "../../contracts/glance";
import type { MainPage } from "../../contracts/windows";
import { glanceBounds } from "./glance-bounds";
import { createTrayIcon } from "./tray-icon";

interface MenuBarOptions {
  createGlance(): BrowserWindow;
  openMain(page?: MainPage): void;
  quit(): void;
  unavailable(): void;
}
/** Owns one lazy popover and the native tray, with no resident polling or business services. */
export class MenuBarController {
  private tray: Tray | undefined;
  private popover: BrowserWindow | undefined;
  private ready = false;
  private wanted = false;
  private disposed = false;
  private suppressTrayClickUntil = 0;
  private readonly reposition = () => {
    if (this.popover?.isVisible()) this.position(this.popover);
  };
  constructor(private readonly options: MenuBarOptions) {
    try {
      this.tray = new Tray(createTrayIcon());
      this.tray.setToolTip("Codex Coco");
      if (process.platform === "darwin") {
        this.tray.setTitle("Codex Coco");
        this.tray.setIgnoreDoubleClickEvents(true);
      }
      this.tray.on("click", () => {
        // A click on the tray first blurs the popover on macOS; do not immediately reopen it.
        const suppressed = performance.now() < this.suppressTrayClickUntil;
        this.suppressTrayClickUntil = 0;
        if (!suppressed) this.toggle();
      });
      const menu = Menu.buildFromTemplate([
        { label: "打开 Codex Coco", click: () => options.openMain() },
        { label: "用量", click: () => options.openMain("usage") },
        { label: "外观", click: () => options.openMain("appearance") },
        { label: "设置", click: () => options.openMain("settings") },
        { type: "separator" },
        { label: "退出 Codex Coco", click: options.quit },
      ]);
      this.tray.on("right-click", () => {
        this.hide();
        this.tray?.popUpContextMenu(menu);
      });
    } catch {
      this.tray?.destroy();
      this.tray = undefined;
      options.unavailable();
    }
    screen.on("display-metrics-changed", this.reposition);
    screen.on("display-removed", this.reposition);
  }
  updateSummary(snapshot: GlanceSnapshot) {
    if (!this.tray || process.platform !== "darwin") return;
    const usage = snapshot.items.find((item) => item.id === "usage");
    const suffix = usage?.phase === "running" ? usage.statusText : "";
    this.tray.setTitle(`Codex Coco${suffix ? ` · ${suffix}` : ""}`);
  }
  toggle() {
    if (this.disposed) return;
    if (this.wanted || this.popover?.isVisible()) {
      this.hide();
      return;
    }
    this.wanted = true;
    if (!this.popover || this.popover.isDestroyed()) {
      const window = this.options.createGlance();
      this.popover = window;
      this.ready = false;
      window.on("blur", () => {
        const point = screen.getCursorScreenPoint();
        const bounds = this.tray?.getBounds();
        if (
          bounds &&
          point.x >= bounds.x &&
          point.x <= bounds.x + bounds.width &&
          point.y >= bounds.y &&
          point.y <= bounds.y + bounds.height
        )
          this.suppressTrayClickUntil = performance.now() + 200;
        this.hide();
      });
      window.on("closed", () => {
        if (this.popover === window) {
          this.popover = undefined;
          this.ready = false;
          this.wanted = false;
        }
      });
    }
    if (this.ready) this.show();
  }
  /** A renderer handshake can arrive after the user has already cancelled opening. */
  rendererReady(window: BrowserWindow) {
    if (this.popover !== window || this.disposed) return;
    this.ready = true;
    if (this.wanted) this.show();
  }
  hide() {
    this.wanted = false;
    if (this.popover && !this.popover.isDestroyed() && this.popover.isVisible())
      this.popover.hide();
  }
  private position(window: BrowserWindow) {
    const bounds = this.tray?.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const anchor = bounds?.width ? bounds : { ...cursor, width: 0, height: 0 };
    const display = screen.getDisplayNearestPoint({
      x: Math.round(anchor.x + anchor.width / 2),
      y: Math.round(anchor.y),
    });
    window.setBounds(glanceBounds(anchor, display.workArea));
  }
  private show() {
    const window = this.popover;
    if (!window || window.isDestroyed()) return;
    this.position(window);
    window.show();
    window.focus();
  }
  dispose() {
    this.disposed = true;
    this.hide();
    screen.removeListener("display-metrics-changed", this.reposition);
    screen.removeListener("display-removed", this.reposition);
    this.tray?.destroy();
    this.tray = undefined;
  }
}
