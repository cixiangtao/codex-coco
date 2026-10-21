import type { AppearanceConfig } from "./contract";
import type { AppearanceAssets } from "./assets";

/** Codex selectors follow the MIT Codex Skin surface contract; all values are schema validated. */
export async function buildAppearanceCss(config: AppearanceConfig, assets: AppearanceAssets) {
  const rules: string[] = [];
  if (config.wallpaper.enabled && config.wallpaper.image) {
    const layer = config.wallpaper;
    const image = await assets.dataUrl(layer.image!);
    rules.push(`:root[data-codex-window-type="electron"] { --color-token-main-surface-primary: color-mix(in srgb, var(--codex-base-surface) ${(1 - layer.transparency) * 100}%, transparent) !important; }
:root[data-codex-window-type="electron"] body { background-image:url("${image}") !important; background-size:${layer.fit} !important; background-position:${layer.x}% ${layer.y}% !important; background-repeat:no-repeat !important; background-attachment:fixed !important; }
:root[data-codex-window-type="electron"] [data-app-shell-main-surface], :root[data-codex-window-type="electron"] [data-codex-terminal="true"], :root[data-codex-window-type="electron"] [data-codex-terminal="true"] .xterm-viewport { background-color:var(--color-token-main-surface-primary) !important; }
:root[data-codex-window-type="electron"] .app-shell-left-panel::after, :root[data-codex-window-type="electron"] .app-shell-main-content-top-fade { background:transparent !important; }`);
  }
  for (const surface of ["main", "sidebar"] as const) {
    const layer = config[surface];
    if (!layer.enabled || !layer.image) continue;
    const image = await assets.dataUrl(layer.image);
    const selectors = (
      surface === "main"
        ? ["[data-app-shell-main-surface]", ".app-shell-main-content-viewport"]
        : [".app-shell-left-panel"]
    ).map((s) => `:root[data-codex-window-type="electron"] ${s}`);
    rules.push(`${selectors.join(",")} { position:relative !important; isolation:isolate; }
${selectors.map((s) => `${s}::before`).join(",")} { content:""; position:absolute; inset:0; z-index:-1; pointer-events:none; background-image:url("${image}") !important; background-size:${layer.size}px auto !important; background-position:${layer.x}% ${layer.y}% !important; background-repeat:no-repeat !important; filter:blur(${layer.blur}px); opacity:${layer.opacity}; ${surface === "sidebar" ? "clip-path:inset(0);" : ""} }`);
  }
  if (!rules.length) throw new Error("NO_IMAGES");
  return rules.join("\n");
}
export const styleId = "codex-coco-appearance";
/** Installs only our style; the page observer repairs removal and is explicitly disposable. */
export function injectionExpression(css: string) {
  return `(() => { if (!location.href.startsWith('app://-/index.html') || location.href.includes('avatar-overlay')) return false;
  window.__codexCocoAppearanceCleanup?.();
  const install = () => { let s = document.getElementById(${JSON.stringify(styleId)}); if (!s) { s = document.createElement('style'); s.id = ${JSON.stringify(styleId)}; (document.head || document.documentElement).appendChild(s); } if(s.textContent !== ${JSON.stringify(css)}) s.textContent = ${JSON.stringify(css)}; };
  install(); let timer; const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(install,120); }); observer.observe(document.documentElement,{childList:true,subtree:true});
  window.__codexCocoAppearanceCleanup = () => { observer.disconnect(); clearTimeout(timer); }; return true; })()`;
}
export const removalExpression = `(() => { window.__codexCocoAppearanceCleanup?.(); delete window.__codexCocoAppearanceCleanup; document.getElementById(${JSON.stringify(styleId)})?.remove(); return !document.getElementById(${JSON.stringify(styleId)}); })()`;
export const verificationExpression = `Boolean(document.getElementById(${JSON.stringify(styleId)})?.textContent && document.documentElement.dataset.codexWindowType === 'electron')`;
