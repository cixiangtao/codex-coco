import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@codex-coco/ui/components/dialog";
import type { GalleryItem } from "../contract";
import { labels, type Layer } from "./editor-types";

interface AppearanceImagePickerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  layer: Layer;
  selectedImage: string | null;
  gallery: GalleryItem[];
  busy: boolean;
  loading: boolean;
  error: string | null;
  onRetry(): void;
  onSelect(item: GalleryItem): void;
  onImport(): void;
  onRemove(id: string): void;
  canRemove: boolean;
  returnFocus(): HTMLElement | null;
}

/** Image choice stays scoped to the region that opened the picker; the page owns loading and edits. */
export function AppearanceImagePicker({
  open,
  onOpenChange,
  layer,
  selectedImage,
  gallery,
  busy,
  loading,
  error,
  onRetry,
  onSelect,
  onImport,
  onRemove,
  canRemove,
  returnFocus,
}: AppearanceImagePickerProps) {
  const groups = [
    { id: "builtin", title: "内置图片", items: gallery.filter((item) => item.builtin) },
    { id: "imported", title: "已导入", items: gallery.filter((item) => !item.builtin) },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="appearance-image-picker sm:max-w-[640px]" finalFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>为{labels[layer]}选择图片</DialogTitle>
          <DialogDescription>
            选中后回到当前区域继续调整，保存并应用后才会修改 Codex。
          </DialogDescription>
        </DialogHeader>
        <div className="appearance-image-picker-toolbar">
          <p>PNG、JPEG、WebP、GIF 或 AVIF，最大 25 MiB。</p>
          <Button variant="outline" disabled={busy || loading} onClick={onImport}>
            从电脑导入
          </Button>
        </div>
        <div className="appearance-image-picker-body" aria-busy={loading}>
          {loading ? (
            <output className="appearance-picker-state" aria-live="polite">
              正在载入可选图片…
            </output>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTitle>图片未能载入</AlertTitle>
              <AlertDescription>
                <p>{error}</p>
                <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>
                  重新载入
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            groups.map((group) => (
              <section className="appearance-image-section" key={group.id} aria-label={group.title}>
                <h3>{group.title}</h3>
                {group.items.length === 0 ? (
                  <p className="appearance-library-empty">
                    {group.id === "imported"
                      ? "还没有导入图片。可以从电脑选择一张喜欢的图片。"
                      : "暂无内置图片，可以从电脑导入。"}
                  </p>
                ) : (
                  <div className="appearance-gallery-grid">
                    {group.items.map((item) => (
                      <div className="appearance-gallery-item" key={item.id}>
                        <button
                          type="button"
                          className="appearance-gallery-image"
                          aria-pressed={selectedImage === item.id}
                          aria-label={`选择图片：${item.title}`}
                          disabled={busy}
                          onClick={() => onSelect(item)}
                        >
                          <img src={item.preview} alt={item.title} />
                          <span>{item.title}</span>
                          {selectedImage === item.id && (
                            <span className="appearance-gallery-selected">已选择</span>
                          )}
                        </button>
                        {!item.builtin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy || !canRemove || selectedImage === item.id}
                            aria-label={`删除图片副本：${item.title}`}
                            onClick={() => onRemove(item.id)}
                          >
                            删除副本
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))
          )}
        </div>
        {!loading && !error && gallery.some((item) => !item.builtin) && (
          <p className="appearance-picker-note">
            {canRemove
              ? "删除仅移除 Codex Coco 保存的副本；使用中的图片需要先从区域和预设中移除。"
              : "当前有未保存修改，请先保存或放弃修改，再删除图片副本。"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
