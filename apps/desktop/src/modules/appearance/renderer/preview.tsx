/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Two-axis pointer positioning uses a composite slider; separate native ranges are also provided. */
import { useState, type CSSProperties } from "react";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import type { AppearanceConfig } from "../contract";
type Layer = "wallpaper" | "main" | "sidebar";
const labels = { wallpaper: "全局壁纸", main: "主面板插画", sidebar: "侧栏插画" };
/** Local composition only; dragging never writes to the target application. */
export function AppearancePreview({
  value,
  images,
  onChange,
}: {
  value: AppearanceConfig;
  images: Partial<Record<Layer, string>>;
  onChange(value: AppearanceConfig): void;
}) {
  const [selected, setSelected] = useState<Layer>("main");
  const layerStyle = (layer: Layer): CSSProperties => ({
    backgroundImage: value[layer].enabled && images[layer] ? `url("${images[layer]}")` : "none",
    backgroundSize: layer === "wallpaper" ? value.wallpaper.fit : `${value[layer].size / 2}px auto`,
    backgroundPosition: `${value[layer].x}% ${value[layer].y}%`,
    backgroundRepeat: "no-repeat",
    ...(layer === "wallpaper"
      ? {}
      : { opacity: value[layer].opacity, filter: `blur(${value[layer].blur / 2}px)` }),
  });
  return (
    <section className="flex flex-col gap-3" aria-label="布景交互预览">
      <h3>本地布景预览</h3>
      <ToggleGroup
        aria-label="预览定位图层"
        variant="outline"
        value={[selected]}
        onValueChange={(items) => {
          if (items[0] && Object.hasOwn(labels, items[0])) setSelected(items[0] as Layer);
        }}
      >
        {(["wallpaper", "main", "sidebar"] as const).map((layer) => (
          <ToggleGroupItem key={layer} value={layer}>
            {labels[layer]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${labels[selected]}拖动定位`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value[selected].x}
        aria-valuetext={`水平 ${value[selected].x}%，垂直 ${value[selected].y}%`}
        className="relative h-64 touch-none overflow-hidden rounded-xl border outline-offset-4"
        style={layerStyle("wallpaper")}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = Math.round(
            Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
          );
          const y = Math.round(
            Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)),
          );
          onChange({ ...value, [selected]: { ...value[selected], x, y } });
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          const axis =
            event.key === "ArrowLeft" || event.key === "ArrowRight"
              ? "x"
              : event.key === "ArrowUp" || event.key === "ArrowDown"
                ? "y"
                : null;
          if (!axis) return;
          event.preventDefault();
          const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
          onChange({
            ...value,
            [selected]: {
              ...value[selected],
              [axis]: Math.max(0, Math.min(100, value[selected][axis] + delta)),
            },
          });
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 grid grid-cols-[28%_1fr]"
          style={{
            backgroundColor: `rgba(250,250,250,${value.wallpaper.enabled ? 1 - value.wallpaper.transparency : 1})`,
          }}
        >
          <aside className="relative border-r">
            <div className="absolute inset-0" style={layerStyle("sidebar")} />
            <div className="relative p-4 text-xs text-neutral-600">
              Codex
              <br />
              <br />
              新聊天
              <br />
              <br />
              项目
              <br />
              <br />
              最近
            </div>
          </aside>
          <main className="relative">
            <div className="absolute inset-0" style={layerStyle("main")} />
            <div className="relative p-5 text-xs text-neutral-600">今天做点什么？</div>
          </main>
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        拖动或使用方向键调整{labels[selected]}
        位置。预览按比例模拟布局，实际效果以目标窗口验证为准；保存并应用后才修改 Codex。
      </p>
    </section>
  );
}
