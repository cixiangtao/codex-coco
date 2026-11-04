import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../apps/desktop/node_modules/electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Menu: { buildFromTemplate: vi.fn(() => ({})) },
    screen: Object.assign(new EventEmitter(), {
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    }),
    Tray: class extends EventEmitter {
      setToolTip() {}
      setTitle() {}
      setIgnoreDoubleClickEvents() {}
      getBounds() {
        return { x: 0, y: 0, width: 24, height: 24 };
      }
      destroy() {}
    },
  };
});
vi.mock("../apps/desktop/src/desktop/main/tray-icon", () => ({ createTrayIcon: () => ({}) }));
vi.mock("../apps/desktop/src/desktop/main/tray-animation", () => ({
  TrayAnimation: class {
    stop() {}
  },
}));

const { MenuBarController } = await import("../apps/desktop/src/desktop/main/menu-bar");
type NativeWindow = Parameters<InstanceType<typeof MenuBarController>["rendererReady"]>[0];

/** Reproduces panels whose native visibility changes without show/hide events. */
class SilentPanel extends EventEmitter {
  visible = false;
  destroyed = false;
  show = vi.fn(() => {
    this.visible = true;
  });
  hide = vi.fn(() => {
    this.visible = false;
  });
  focus = vi.fn();
  setBounds = vi.fn();
  isVisible() {
    return this.visible;
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
    this.visible = false;
    this.emit("closed");
  }
  get native() {
    // Only the BrowserWindow lifecycle used by the controller is represented by this double.
    return this as unknown as NativeWindow;
  }
}

const controllers: InstanceType<typeof MenuBarController>[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});
function setup() {
  const panels: SilentPanel[] = [];
  const visibilityChanged = vi.fn<(window: NativeWindow, visible: boolean) => void>();
  const controller = new MenuBarController({
    createGlance: () => {
      const panel = new SilentPanel();
      panels.push(panel);
      return panel.native;
    },
    visibilityChanged,
    openMain: vi.fn(),
    quit: vi.fn(),
    unavailable: vi.fn(),
  });
  controllers.push(controller);
  return { controller, panels, visibilityChanged };
}

it("reports explicit opening and closing when native show/hide events are absent", () => {
  const { controller, panels, visibilityChanged } = setup();
  controller.toggle();
  const panel = panels[0]!;
  expect(visibilityChanged).not.toHaveBeenCalled();
  controller.rendererReady(panel.native);
  expect(visibilityChanged).toHaveBeenLastCalledWith(panel.native, true);
  controller.toggle();
  expect(visibilityChanged).toHaveBeenLastCalledWith(panel.native, false);
  controller.toggle();
  expect(visibilityChanged).toHaveBeenLastCalledWith(panel.native, true);
  controller.hide();
  expect(visibilityChanged.mock.calls.map(([, visible]) => visible)).toEqual([
    true,
    false,
    true,
    false,
  ]);
  expect(panels).toHaveLength(1);
});

it("does not reopen a cancelled request when the renderer becomes ready", () => {
  const { controller, panels, visibilityChanged } = setup();
  controller.toggle();
  controller.toggle();
  const panel = panels[0]!;
  controller.rendererReady(panel.native);
  expect(panel.isVisible()).toBe(false);
  expect(panel.show).not.toHaveBeenCalled();
  expect(visibilityChanged).toHaveBeenCalledExactlyOnceWith(panel.native, false);
  controller.toggle();
  expect(visibilityChanged).toHaveBeenLastCalledWith(panel.native, true);
});

it("ignores a destroyed panel's late readiness and reports a recreated panel", () => {
  const { controller, panels, visibilityChanged } = setup();
  controller.toggle();
  const previous = panels[0]!;
  previous.destroy();
  controller.rendererReady(previous.native);
  expect(visibilityChanged).not.toHaveBeenCalled();
  controller.toggle();
  const current = panels[1]!;
  controller.rendererReady(previous.native);
  expect(current.isVisible()).toBe(false);
  controller.rendererReady(current.native);
  expect(visibilityChanged).toHaveBeenCalledExactlyOnceWith(current.native, true);
  controller.rendererReady(current.native);
  expect(visibilityChanged).toHaveBeenLastCalledWith(current.native, true);
  expect(panels).toHaveLength(2);
});

it("reports the actual final visibility when focus handling closes the panel", () => {
  const { controller, panels, visibilityChanged } = setup();
  controller.toggle();
  const panel = panels[0]!;
  panel.focus.mockImplementation(() => panel.hide());
  controller.rendererReady(panel.native);
  expect(panel.isVisible()).toBe(false);
  expect(visibilityChanged).toHaveBeenCalledExactlyOnceWith(panel.native, false);
});
