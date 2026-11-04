import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { FieldLabel } from "@codex-coco/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import { SettingsGroup, SettingsRow } from "@codex-coco/ui/components/settings-group";
import { Switch } from "@codex-coco/ui/components/switch";
import type { AppearanceConfig } from "../contract";
import { labels, type Layer } from "./editor-types";

export function AppearanceLayerEditor({
  draft,
  layer,
  preview,
  imageTitle,
  enabled,
  busy,
  update,
  onImport,
  onChoose,
}: {
  draft: AppearanceConfig;
  layer: Layer;
  preview: string | undefined;
  imageTitle: string | undefined;
  enabled: boolean;
  busy: boolean;
  update(value: AppearanceConfig): void;
  onImport(layer: Layer): void;
  onChoose(): void;
}) {
  return (
    <SettingsGroup
      title={labels[layer]}
      className="appearance-layer-editor"
      description={
        draft[layer].enabled ? "选图与参数只影响当前区域。" : "当前区域已关闭，选图后会自动开启。"
      }
    >
      <SettingsRow>
        <FieldLabel htmlFor={`appearance-${layer}-enabled`}>显示这个区域的布景</FieldLabel>
        <Switch
          id={`appearance-${layer}-enabled`}
          checked={draft[layer].enabled}
          onCheckedChange={(checked) =>
            update({ ...draft, [layer]: { ...draft[layer], enabled: checked } })
          }
        />
      </SettingsRow>
      <SettingsRow layout="stacked">
        <button
          type="button"
          className="appearance-image-choice"
          disabled={!enabled || busy}
          aria-label={`选择${labels[layer]}图片`}
          onClick={onChoose}
        >
          <div className="appearance-image-thumbnail">
            {preview ? (
              <img src={preview} alt={`${labels[layer]}图片预览`} />
            ) : (
              <span>{draft[layer].image ? "图片预览" : "选择图片"}</span>
            )}
          </div>
          <span className="appearance-image-caption">
            <strong>
              {draft[layer].image ? (imageTitle ?? "已选图片") : "为这个区域添加图片"}
            </strong>
            <span>{draft[layer].image ? "更换图片" : "浏览内置图片与已导入图片"}</span>
          </span>
        </button>
        <div className="appearance-image-actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={!enabled || busy}
            onClick={() => onImport(layer)}
          >
            导入{labels[layer]}
          </Button>
          {draft[layer].image && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                update({ ...draft, [layer]: { ...draft[layer], image: null, enabled: false } })
              }
            >
              清除图片
            </Button>
          )}
        </div>
      </SettingsRow>
      <div className="appearance-layer-fields grid grid-cols-2">
        {(["x", "y"] as const).map((axis) => (
          <SettingsRow layout="stacked" key={axis}>
            <FieldLabel htmlFor={`${layer}-${axis}`}>
              {axis === "x" ? "水平位置" : "垂直位置"} {draft[layer][axis]}%
            </FieldLabel>
            <Input
              id={`${layer}-${axis}`}
              type="range"
              min={0}
              max={100}
              value={draft[layer][axis]}
              onChange={(e) =>
                update({
                  ...draft,
                  [layer]: { ...draft[layer], [axis]: e.target.valueAsNumber },
                })
              }
            />
          </SettingsRow>
        ))}
        {layer === "wallpaper" ? (
          <>
            <SettingsRow layout="stacked">
              <FieldLabel>图片适配</FieldLabel>
              <ToggleGroup
                aria-label="壁纸适配"
                value={[draft.wallpaper.fit]}
                onValueChange={(values) => {
                  if (values[0] === "cover" || values[0] === "contain")
                    update({ ...draft, wallpaper: { ...draft.wallpaper, fit: values[0] } });
                }}
                variant="outline"
              >
                <ToggleGroupItem value="cover">铺满</ToggleGroupItem>
                <ToggleGroupItem value="contain">完整显示</ToggleGroupItem>
              </ToggleGroup>
            </SettingsRow>
            <SettingsRow layout="stacked">
              <FieldLabel htmlFor="wallpaper-transparency">
                面板透明度 {Math.round(draft.wallpaper.transparency * 100)}%
              </FieldLabel>
              <Input
                id="wallpaper-transparency"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={draft.wallpaper.transparency}
                onChange={(e) =>
                  update({
                    ...draft,
                    wallpaper: { ...draft.wallpaper, transparency: e.target.valueAsNumber },
                  })
                }
              />
            </SettingsRow>
          </>
        ) : (
          (
            [
              { key: "size", title: "插画宽度", min: 80, max: 1200, step: 1 },
              { key: "blur", title: "模糊程度", min: 0, max: 30, step: 1 },
              { key: "opacity", title: "不透明度", min: 0, max: 1, step: 0.01 },
            ] as const
          ).map(({ key, title, min, max, step }) => (
            <SettingsRow layout="stacked" key={key}>
              <FieldLabel htmlFor={`${layer}-${key}`}>
                {title}{" "}
                {key === "opacity"
                  ? `${Math.round(draft[layer][key] * 100)}%`
                  : `${draft[layer][key]} px`}
              </FieldLabel>
              <Input
                id={`${layer}-${key}`}
                type="range"
                min={min}
                max={max}
                step={step}
                value={draft[layer][key]}
                onChange={(e) =>
                  update({
                    ...draft,
                    [layer]: { ...draft[layer], [key]: e.target.valueAsNumber },
                  })
                }
              />
            </SettingsRow>
          ))
        )}
      </div>
    </SettingsGroup>
  );
}
