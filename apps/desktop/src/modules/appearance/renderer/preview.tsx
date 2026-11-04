/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Two-axis positioning has separate native ranges below. */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@codex-coco/ui/components/card";
import { Badge } from "@codex-coco/ui/components/badge";
import type { AppearanceConfig } from "../contract";
import { illustrationPosition, previewGeometry as geometry } from "../contract";
import { labels, type Layer } from "./editor-types";
/** One logical canvas scales image width, blur and surfaces together. No target writes. */
export function AppearancePreview({
  value,
  images,
  onChange,
  selected,
}: {
  value: AppearanceConfig;
  images: Partial<Record<Layer, string>>;
  onChange(value: AppearanceConfig): void;
  selected: Layer;
}) {
  const [scale, setScale] = useState(0.5);
  const root = useRef<HTMLDivElement>(null);
  const surfaces = useRef<Partial<Record<Layer, HTMLDivElement | null>>>({});
  const drag = useRef<{
    pointer: number;
    layer: Layer;
    x: number;
    y: number;
    initialX: number;
    initialY: number;
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / geometry.width);
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    drag.current = null;
  }, [selected]);
  const layerStyle = (layer: Layer): CSSProperties => ({
    backgroundImage: value[layer].enabled && images[layer] ? `url("${images[layer]}")` : "none",
    backgroundSize: layer === "wallpaper" ? value.wallpaper.fit : `${value[layer].size}px auto`,
    backgroundPosition:
      layer === "wallpaper"
        ? `${value[layer].x}% ${value[layer].y}%`
        : illustrationPosition(value[layer].x, value[layer].y),
    backgroundRepeat: "no-repeat",
    ...(layer === "wallpaper"
      ? {}
      : { opacity: value[layer].opacity, filter: `blur(${value[layer].blur}px)` }),
  });
  const paper = `color-mix(in srgb, var(--background) ${value.wallpaper.enabled && images.wallpaper ? (1 - value.wallpaper.transparency) * 100 : 100}%, transparent)`;
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <Card className="appearance-preview-card" aria-label="布景交互预览">
      <CardHeader>
        <div>
          <CardTitle>布景预览</CardTitle>
          <CardDescription>正在编辑{labels[selected]}</CardDescription>
        </div>
        <Badge>草稿预览</Badge>
      </CardHeader>
      <CardContent className="appearance-preview-content">
        <div
          ref={root}
          role="slider"
          tabIndex={0}
          aria-label={`${labels[selected]}拖动定位`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value[selected].x}
          aria-valuetext={`水平 ${value[selected].x}%，垂直 ${value[selected].y}%`}
          className="appearance-preview-canvas relative touch-none overflow-hidden rounded-xl border outline-offset-4"
          style={{ aspectRatio: `${geometry.width}/${geometry.height}` }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const bounds = surfaces.current[selected]?.getBoundingClientRect();
            if (
              !bounds ||
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              return;
            drag.current = {
              pointer: event.pointerId,
              layer: selected,
              x: event.clientX,
              y: event.clientY,
              initialX: value[selected].x,
              initialY: value[selected].y,
              width: bounds.width,
              height: bounds.height,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start || start.pointer !== event.pointerId) return;
            const clamp = (number: number) => Math.round(Math.max(0, Math.min(100, number)));
            onChange({
              ...value,
              [start.layer]: {
                ...value[start.layer],
                x: clamp(start.initialX + ((event.clientX - start.x) / start.width) * 100),
                y: clamp(start.initialY + ((event.clientY - start.y) / start.height) * 100),
              },
            });
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={() => {
            drag.current = null;
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
            className="pointer-events-none absolute origin-top-left bg-background text-foreground"
            style={{ width: geometry.width, height: geometry.height, transform: `scale(${scale})` }}
          >
            <div
              ref={(el) => {
                surfaces.current.wallpaper = el;
              }}
              data-preview-surface="wallpaper"
              data-selected={selected === "wallpaper"}
              className="absolute inset-0"
              style={layerStyle("wallpaper")}
            />
            <div className="absolute left-4 top-3 text-sm">Codex</div>
            <div
              ref={(el) => {
                surfaces.current.sidebar = el;
              }}
              data-preview-surface="sidebar"
              data-selected={selected === "sidebar"}
              className="absolute bottom-0 overflow-hidden border-r"
              style={{
                left: geometry.rail,
                top: geometry.titlebar,
                width: geometry.sidebar,
                backgroundColor: paper,
              }}
            >
              <div className="absolute inset-0" style={layerStyle("sidebar")} />
              <div className="relative p-5 text-sm">
                新聊天
                <br />
                <br />
                项目
                <br />
                <br />
                最近
              </div>
            </div>
            <div
              ref={(el) => {
                surfaces.current.main = el;
              }}
              data-preview-surface="main"
              data-selected={selected === "main"}
              className="absolute bottom-0 right-0 overflow-hidden rounded-tl-xl"
              style={{
                left: geometry.rail + geometry.sidebar,
                top: geometry.titlebar,
                backgroundColor: paper,
              }}
            >
              <div className="absolute inset-0" style={layerStyle("main")} />
              <div className="relative p-7 text-sm">今天做点什么？</div>
            </div>
          </div>
        </div>
        <p className="appearance-preview-note">
          在描边区域拖动图片，或聚焦预览后用方向键微调。实际效果随 Codex 窗口大小变化。
        </p>
      </CardContent>
    </Card>
  );
}
