import type { DesktopBridge } from "../contracts/bridge";
declare global {
  interface Window {
    codexCoco: DesktopBridge;
  }
}
