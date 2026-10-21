import type { AppearanceConfig } from "./contract";
import type { AppearanceAssets } from "./assets";
import { illustrationPosition } from "./contract";

export const styleId = "codex-coco-appearance";
const host = "data-codex-coco-host";
const surface = "data-codex-coco-surface";
const scope = ':root[data-codex-window-type="electron"]';
/** Stable surface attributes support the current client and the older Codex Skin layout. */
export async function buildAppearanceCss(config: AppearanceConfig, assets: AppearanceAssets) {
  const layers = (["wallpaper", "main", "sidebar"] as const).filter(
    (key) => config[key].enabled && config[key].image,
  );
  if (!layers.length) throw new Error("NO_IMAGES");
  const rules = [
    `/* codex-coco-layers:${layers.join(" ")} */`,
    `${scope} [${host}] { isolation:isolate !important; }
${scope} [data-codex-coco-static] { position:relative !important; }
${scope} [${surface}] { display:block !important; position:absolute !important; inset:0 !important; z-index:-1 !important; pointer-events:none !important; border-radius:inherit; background-repeat:no-repeat !important; clip-path:inset(0); }
${scope} [data-codex-coco-clear] { background-color:transparent !important; }
${scope} [data-codex-coco-clear]::after { background-color:transparent !important; }`,
  ];
  if (layers.includes("wallpaper")) {
    const layer = config.wallpaper;
    const image = await assets.dataUrl(layer.image!);
    rules.push(`${scope} body { isolation:isolate !important; }
${scope} [${surface}="wallpaper"] { position:fixed !important; border-radius:0; background-image:url("${image}") !important; background-size:${layer.fit} !important; background-position:${layer.x}% ${layer.y}% !important; }
${scope} [data-codex-coco-paper] { background-color:color-mix(in srgb, var(--color-surface, var(--codex-base-surface, Canvas)) ${(1 - layer.transparency) * 100}%, transparent) !important; }
${scope} [data-app-shell-workspace-row]::before, ${scope} [data-app-shell-main-content-top-fade]::before, ${scope} .app-shell-main-content-top-fade { background:transparent !important; }`);
  }
  for (const name of ["main", "sidebar"] as const) {
    if (!layers.includes(name)) continue;
    const layer = config[name];
    const image = await assets.dataUrl(layer.image!);
    rules.push(
      `${scope} [${surface}="${name}"] { background-image:url("${image}") !important; background-size:${layer.size}px auto !important; background-position:${illustrationPosition(layer.x, layer.y)} !important; filter:blur(${layer.blur}px); opacity:${layer.opacity}; clip-path:inset(0); }`,
    );
  }
  return rules.join("\n");
}
function cssHash(css: string) {
  let hash = 2166136261;
  for (let i = 0; i < css.length; i++) hash = Math.imul(hash ^ css.charCodeAt(i), 16777619);
  return String(hash >>> 0);
}
export const targetLocationExpression = `location.protocol==='app:' && location.hostname==='-' && location.pathname==='/index.html' && !location.href.includes('avatar-overlay')`;
/** Own nodes avoid replacing client pseudo-elements; all owned markers are disposable. */
export function injectionExpression(css: string) {
  return `(() => { if (!(${targetLocationExpression})) return false;
  window.__codexCocoAppearanceCleanup?.();
  const css=${JSON.stringify(css)}, layers=css.match(/codex-coco-layers:([^*]+)/)[1].trim().split(' ');
  const marked=new Map();
  const mark=(el,name,value='')=>{ if(!el)return; if(!marked.has(el))marked.set(el,new Map()); const previous=marked.get(el);if(!previous.has(name))previous.set(name,el.getAttribute(name)); if(el.getAttribute(name)!==value)el.setAttribute(name,value); };
  const top=(selector)=>Array.from(document.querySelectorAll(selector)).filter(el=>!el.parentElement?.closest(selector));
  const main=()=>{const roots=top('[data-app-shell-main-surface]');return roots.length?roots:top('[data-app-shell-main-content-layout], .app-shell-main-content-viewport');};
  const sidebar=()=>{const roots=top('[data-slate-sidebar-content]');return roots.length?roots:top('.app-shell-left-panel');};
  const nodes=new Map();
  const install=()=>{
    let s=document.getElementById(${JSON.stringify(styleId)}); if(!s){s=document.createElement('style');s.id=${JSON.stringify(styleId)};(document.head||document.documentElement).appendChild(s);} if(s.textContent!==css)s.textContent=css;
    for(const [el,attrs] of marked)for(const [name,value]of attrs)value===null?el.removeAttribute(name):el.setAttribute(name,value);marked.clear();
    const wanted=new Map();
    for(const name of layers)for(const el of name==='wallpaper'?[document.body]:name==='main'?main():sidebar()) {
      if(!el)continue;
      wanted.set(el,name);
      if(name!=='wallpaper') {mark(el,'${host}',name);if(getComputedStyle(el).position==='static')mark(el,'data-codex-coco-static');}
      if(layers.includes('wallpaper')) {
        for(let parent=el;parent&&parent!==document.documentElement;parent=parent.parentElement)mark(parent,'data-codex-coco-clear');
        if(name!=='wallpaper')mark(el,'data-codex-coco-paper');
      }
      if(name==='main')for(const child of el.querySelectorAll('[data-app-shell-main-content-layout],.app-shell-main-content-viewport'))mark(child,'data-codex-coco-clear');
      if(name==='sidebar')for(const child of el.querySelectorAll('.sidebar-navigation'))mark(child,'data-codex-coco-clear');
      let node=nodes.get(el);if(!node||node.getAttribute('${surface}')!==name){node?.remove();node=document.createElement('div');node.setAttribute('${surface}',name);node.setAttribute('aria-hidden','true');nodes.set(el,node);}if(node.parentElement!==el)el.prepend(node);
    }
    if(layers.includes('wallpaper')) {
      for(const el of [...main(),...sidebar(),...document.querySelectorAll('[data-app-shell-frame], [data-app-shell-page-surface], [data-app-shell-main-titlebar], header[data-app-shell-header-layout]')]) {
        for(let parent=el;parent&&parent!==document.documentElement;parent=parent.parentElement)mark(parent,'data-codex-coco-clear');
      }
      for(const el of document.querySelectorAll('[data-app-shell-main-content-layout],.app-shell-main-content-viewport'))mark(el,'data-codex-coco-clear');
      for(const el of [...main(),...sidebar()])mark(el,'data-codex-coco-paper');
    }
    for(const [el,node] of nodes)if(!wanted.has(el)){node.remove();nodes.delete(el);}
    for(const [el,attrs] of marked)if(!el.isConnected){for(const [name,value]of attrs)value===null?el.removeAttribute(name):el.setAttribute(name,value);marked.delete(el);}
  };
  install();window.__codexCocoAppearanceHash=${JSON.stringify(cssHash(css))};
  let timer;const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(install,120);});observer.observe(document.documentElement,{childList:true,subtree:true});
  window.__codexCocoAppearanceCleanup=()=>{observer.disconnect();clearTimeout(timer);for(const node of nodes.values())node.remove();for(const [el,attrs] of marked)for(const [name,value]of attrs)value===null?el.removeAttribute(name):el.setAttribute(name,value);document.getElementById(${JSON.stringify(styleId)})?.remove();};return true; })()`;
}
export const removalExpression = `(() => { window.__codexCocoAppearanceCleanup?.(); delete window.__codexCocoAppearanceCleanup; delete window.__codexCocoAppearanceHash; document.querySelectorAll('[${surface}]').forEach(el=>el.remove()); document.getElementById(${JSON.stringify(styleId)})?.remove(); return !document.getElementById(${JSON.stringify(styleId)}); })()`;
/** Verify one visible, non-interactive image per requested surface, including nested layouts. */
export function verificationExpression(css?: string) {
  return `(() => {
    const style=document.getElementById(${JSON.stringify(styleId)});if(!style?.textContent||document.documentElement.dataset.codexWindowType!=='electron')return false;
    let hash=2166136261;for(let i=0;i<style.textContent.length;i++)hash=Math.imul(hash^style.textContent.charCodeAt(i),16777619);
    if(String(hash>>>0)!==${css ? JSON.stringify(cssHash(css)) : "window.__codexCocoAppearanceHash"})return false;
    const layers=style.textContent.match(/codex-coco-layers:([^*]+)/)?.[1].trim().split(' ');if(!layers?.length)return false;
    for(const name of layers){
      const nodes=Array.from(document.querySelectorAll('[${surface}="'+name+'"]'));if(!nodes.length)return false;
      for(const node of nodes){const actual=getComputedStyle(node),rect=node.getBoundingClientRect();if(rect.width<=0||rect.height<=0||actual.backgroundImage==='none'||actual.pointerEvents!=='none'||actual.display==='none'||actual.visibility==='hidden')return false;
        if(name!=='wallpaper'){const bounds=node.parentElement.getBoundingClientRect();if(Math.abs(rect.left-bounds.left)>2||Math.abs(rect.top-bounds.top)>2||Math.abs(rect.width-node.parentElement.clientWidth)>2||Math.abs(rect.height-node.parentElement.clientHeight)>2)return false;}
      }
    }
    for(const rule of Array.from(style.sheet?.cssRules??[])) {
      if(!rule.selectorText?.includes('[${surface}=') || !rule.style)continue;
      for(const el of document.querySelectorAll(rule.selectorText)) {
        const actual=getComputedStyle(el);
        for(const property of ['background-image','background-size','background-position','opacity','filter','pointer-events','position']) {
          let expected=rule.style.getPropertyValue(property);if(property==='background-position' && expected){const probe=document.createElement('span');probe.hidden=true;probe.style.backgroundPosition=expected;document.body.append(probe);expected=getComputedStyle(probe).backgroundPosition;probe.remove();}if(expected && actual.getPropertyValue(property)!==expected)return false;
        }
      }
    }return true;
  })()`;
}
