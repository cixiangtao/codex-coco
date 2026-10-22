import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { Button } from "@codex-coco/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@codex-coco/ui/components/card";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import type { GlanceSnapshot } from "../../contracts/glance";
import { glanceBlocks, type GlanceBlockId } from "../../contracts/glance-layout";
import { refreshGlance } from "../client/glance";
import { moveGlanceBlock } from "../lib/glance-order";

/** Window-local permutation draft. Only an explicit completion reaches the restricted reorder IPC. */
export function GlanceOrderEditor({
  snapshot,
  onCancel,
  onDone,
}: {
  snapshot: GlanceSnapshot;
  onCancel(): void;
  onDone(): void;
}) {
  const [draft, setDraft] = useState(() => ({
    revision: snapshot.layoutRevision ?? 0,
    blocks: [...(snapshot.layout?.blocks ?? [])],
  }));
  const [dragging, setDragging] = useState<GlanceBlockId | null>(null);
  const [drop, setDrop] = useState<{ id: GlanceBlockId; after: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const focusAfterMove = useRef<GlanceBlockId | null>(null);
  const live = useRef(true);
  const content = useRef<HTMLElement>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const conflict = draft.revision !== snapshot.layoutRevision;
  const unavailable = snapshot.layoutEditable !== true;
  const disabled = pending || conflict || unavailable;
  useEffect(() => {
    if (!pending) return;
    const preventCancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", preventCancel, true);
    return () => window.removeEventListener("keydown", preventCancel, true);
  }, [pending]);
  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id) return;
    focusAfterMove.current = null;
    const handle = content.current?.querySelector<HTMLButtonElement>(`[data-sort-handle="${id}"]`);
    handle?.focus({ preventScroll: true });
    handle?.closest("li")?.scrollIntoView({ block: "nearest" });
  }, [draft]);
  const move = (id: GlanceBlockId, index: number, focus = false) => {
    const blocks = moveGlanceBlock(draft.blocks, id, index);
    if (blocks.every((entry, position) => entry === draft.blocks[position])) return;
    focusAfterMove.current = focus ? id : null;
    setDraft({ ...draft, blocks });
    setError("");
    setAnnouncement(
      `${glanceBlocks.find((block) => block.id === id)!.title}，已移至第 ${blocks.indexOf(id) + 1} 项，共 ${blocks.length} 项。`,
    );
  };
  async function save() {
    if (disabled || dragging) return;
    if (draft.blocks.every((id, index) => id === snapshot.layout?.blocks[index])) {
      onCancel();
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await window.codexCoco.reorderGlanceLayout({
        expectedRevision: draft.revision,
        blocks: draft.blocks,
      });
      if (result.ok) {
        await refreshGlance();
        if (live.current) onDone();
      } else {
        if (live.current) setError(result.error.message);
        if (result.error.code === "CONFLICT") await refreshGlance();
      }
    } catch {
      if (live.current) setError("顺序未能保存，草稿已保留，请重试。");
    } finally {
      if (live.current) setPending(false);
    }
  }
  return (
    <>
      <main ref={content} className="glance-content glance-order-content" aria-label="调整速览顺序">
        {(conflict || unavailable || error) && (
          <Alert variant="destructive">
            <AlertTitle>
              {unavailable ? "速览设置需要恢复" : conflict ? "组合已在主窗口更新" : "顺序未能保存"}
            </AlertTitle>
            <AlertDescription>
              <p>
                {unavailable
                  ? "请在主窗口恢复速览设置，当前草稿不会覆盖原文件。"
                  : conflict
                    ? "当前草稿已保留，请载入最新顺序后重新调整。"
                    : error}
              </p>
              {conflict && !unavailable && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setDraft({
                      revision: snapshot.layoutRevision ?? 0,
                      blocks: [...(snapshot.layout?.blocks ?? [])],
                    });
                    setDragging(null);
                    setDrop(null);
                    setError("");
                    setAnnouncement("已载入最新顺序。");
                  }}
                >
                  载入最新顺序
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        <Card density="compact" className="glance-order-card">
          <CardHeader>
            <CardTitle>调整顺序</CardTitle>
            <p id="glance-order-help">拖动手柄，或用方向键移动。完成后保存。</p>
          </CardHeader>
          <CardContent>
            <ol className="glance-order-list" aria-label="速览信息块顺序">
              {draft.blocks.map((id, index) => {
                const block = glanceBlocks.find((entry) => entry.id === id)!;
                return (
                  <li
                    key={id}
                    data-sort-id={id}
                    data-dragging={dragging === id}
                    data-drop={drop?.id === id ? (drop.after ? "after" : "before") : undefined}
                  >
                    <Button
                      variant="ghost"
                      className="glance-sort-handle"
                      data-sort-handle={id}
                      aria-label={`拖动${block.title}排序`}
                      aria-describedby="glance-order-help"
                      aria-description={`第 ${index + 1} 项，共 ${draft.blocks.length} 项`}
                      aria-keyshortcuts="ArrowUp ArrowDown Home End"
                      disabled={disabled}
                      draggable={!disabled}
                      onDragStart={(event) => {
                        if (disabled) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", id);
                        const row = event.currentTarget.closest("li");
                        if (row) event.dataTransfer.setDragImage(row, 20, 20);
                        setDragging(id);
                        setDrop(null);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDrop(null);
                      }}
                      onDragOver={(event) => {
                        if (!dragging || disabled) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setDrop(
                          dragging === id
                            ? null
                            : { id, after: event.clientY > bounds.top + bounds.height / 2 },
                        );
                        const scroller = content.current;
                        if (!scroller) return;
                        const viewport = scroller.getBoundingClientRect();
                        if (event.clientY < viewport.top + 28) scroller.scrollTop -= 12;
                        else if (event.clientY > viewport.bottom - 28) scroller.scrollTop += 12;
                      }}
                      onDrop={(event) => {
                        if (!dragging || disabled) return;
                        event.preventDefault();
                        if (dragging !== id && drop?.id === id) {
                          let target = index + (drop.after ? 1 : 0);
                          if (draft.blocks.indexOf(dragging) < target) target--;
                          move(dragging, target);
                        }
                        setDragging(null);
                        setDrop(null);
                      }}
                      onKeyDown={(event) => {
                        const target =
                          event.key === "ArrowUp"
                            ? index - 1
                            : event.key === "ArrowDown"
                              ? index + 1
                              : event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? draft.blocks.length - 1
                                  : null;
                        if (target !== null) {
                          event.preventDefault();
                          move(id, target, true);
                        }
                      }}
                    >
                      <GripVertical />
                      <span className="glance-sort-number" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span className="glance-sort-label">
                        <span>{block.title}</span>
                        <small>
                          {block.moduleId === "usage"
                            ? "用量"
                            : block.moduleId === "appearance"
                              ? "外观"
                              : "系统与菜单栏"}
                        </small>
                      </span>
                    </Button>
                    <div className="glance-editor-actions">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`上移${block.title}`}
                        disabled={disabled || index === 0}
                        onClick={() => move(id, index - 1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`下移${block.title}`}
                        disabled={disabled || index === draft.blocks.length - 1}
                        onClick={() => move(id, index + 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
        <output className="sr-only" aria-live="polite">
          {announcement}
        </output>
      </main>
      <footer className="glance-actions">
        <Button variant="ghost" disabled={pending} onClick={onCancel}>
          取消排序
        </Button>
        <Button
          disabled={disabled || dragging !== null}
          onClick={() => {
            void save();
          }}
        >
          {pending ? "正在保存…" : "完成排序"}
        </Button>
      </footer>
    </>
  );
}
