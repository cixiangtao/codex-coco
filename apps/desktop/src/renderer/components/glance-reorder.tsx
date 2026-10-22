import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "cn";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import type { GlanceSnapshot } from "../../contracts/glance";
import {
  defaultGlanceLayout,
  glanceBlocks,
  type GlanceBlockId,
  type GlanceLayout,
} from "../../contracts/glance-layout";
import { refreshGlance } from "../client/glance";
import { moveGlanceBlock } from "../lib/glance-order";

interface Order {
  revision: number;
  blocks: GlanceBlockId[];
}
interface Drag extends Order {
  id: GlanceBlockId;
}
interface Drop {
  id: GlanceBlockId;
  after: boolean;
}
interface ReorderContext {
  blocks: GlanceBlockId[];
  disabled: boolean;
  dragging: Drag | null;
  drop: Drop | null;
  start(id: GlanceBlockId): void;
  stop(): void;
  over(drop: Drop): void;
  commit(drop: Drop): void;
  move(id: GlanceBlockId, index: number): void;
}
const ReorderContext = createContext<ReorderContext | null>(null);

/** Saves completed inline moves through the popover's permutation-only IPC, never module operations. */
export function GlanceReorder({
  snapshot,
  visible,
  busy,
  children,
}: {
  snapshot: GlanceSnapshot;
  visible: boolean;
  busy: boolean;
  children(layout: GlanceLayout): ReactNode;
}) {
  const [draft, setDraft] = useState<Order | null>(null);
  const [dragging, setDragging] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const saving = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const focusAfterMove = useRef<GlanceBlockId | null>(null);
  // A successful move stays optimistic only until its public projection catches up.
  const activeDraft =
    draft && (pending || error || draft.revision > (snapshot.layoutRevision ?? -1)) ? draft : null;
  const blocks = activeDraft?.blocks ?? snapshot.layout?.blocks ?? defaultGlanceLayout.blocks;
  const conflict = activeDraft !== null && activeDraft.revision !== snapshot.layoutRevision;
  const disabled =
    !visible ||
    busy ||
    pending ||
    !!error ||
    conflict ||
    snapshot.layoutEditable !== true ||
    blocks.length < 2;
  const stop = () => {
    setDragging(null);
    setDrop(null);
  };
  useEffect(
    () =>
      window.codexCoco.onGlanceVisibilityChanged((visible) => {
        if (visible) return;
        setDragging(null);
        setDrop(null);
        if (!saving.current) {
          setDraft(null);
          setError("");
        }
      }),
    [],
  );
  useEffect(() => {
    if (!dragging) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setDragging(null);
      setDrop(null);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [dragging]);
  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id || pending) return;
    focusAfterMove.current = null;
    const handle = container.current?.querySelector<HTMLButtonElement>(
      `[data-sort-handle="${id}"]`,
    );
    handle?.focus({ preventScroll: true });
    handle?.scrollIntoView({ block: "nearest" });
  }, [blocks, pending]);
  async function save(order: Order, id?: GlanceBlockId) {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setError("");
    setDraft(order);
    setAnnouncement("正在保存速览顺序。");
    try {
      const result = await window.codexCoco.reorderGlanceLayout({
        expectedRevision: order.revision,
        blocks: order.blocks,
      });
      if (result.ok) {
        setDraft({ revision: result.value.revision, blocks: result.value.value.blocks });
        setAnnouncement(
          id
            ? `${glanceBlocks.find((block) => block.id === id)!.title}已移至第 ${order.blocks.indexOf(id) + 1} 项，顺序已保存。`
            : "速览顺序已保存。",
        );
        await refreshGlance();
      } else {
        setError(result.error.message);
        if (result.error.code === "CONFLICT") await refreshGlance();
      }
    } catch {
      setError("顺序未能保存，请重试或恢复已保存的顺序。");
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  const move = (id: GlanceBlockId, index: number, base?: Order) => {
    if (disabled || saving.current) return;
    const source = base ?? { revision: snapshot.layoutRevision ?? 0, blocks };
    if (source.revision !== snapshot.layoutRevision) {
      setAnnouncement("组合已更新，请按最新内容重新拖动。");
      return;
    }
    const next = moveGlanceBlock(source.blocks, id, index);
    if (next.every((entry, position) => entry === source.blocks[position])) return;
    focusAfterMove.current = id;
    void save({ revision: source.revision, blocks: next }, id);
  };
  const context: ReorderContext = {
    blocks,
    disabled,
    dragging,
    drop,
    start(id) {
      if (!disabled) {
        setDragging({ id, revision: snapshot.layoutRevision ?? 0, blocks: [...blocks] });
        setDrop(null);
      }
    },
    stop,
    over(value) {
      setDrop(dragging?.id === value.id ? null : value);
    },
    commit(value) {
      if (dragging && dragging.id !== value.id) {
        let target = dragging.blocks.indexOf(value.id) + (value.after ? 1 : 0);
        if (dragging.blocks.indexOf(dragging.id) < target) target--;
        move(dragging.id, target, dragging);
      }
      stop();
    },
    move,
  };
  return (
    <div ref={container} className="glance-reorder" aria-busy={pending}>
      {(error || (conflict && !pending)) && (
        <Alert variant="destructive">
          <AlertTitle>{conflict ? "组合已在主窗口更新" : "顺序未能保存"}</AlertTitle>
          <AlertDescription>
            <p>{conflict ? "请载入最新顺序后重新拖动，当前排列不会覆盖新组合。" : error}</p>
            <div className="glance-editor-actions">
              {!conflict && draft && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || snapshot.layoutEditable !== true}
                  onClick={() => {
                    void save(draft);
                  }}
                >
                  重试保存
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  stop();
                  setDraft(null);
                  setError("");
                  setAnnouncement("已恢复最新保存的顺序。");
                }}
              >
                {conflict ? "载入最新顺序" : "恢复原顺序"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <p id="glance-order-help" className="sr-only">
        拖动信息块手柄后自动保存；也可聚焦手柄，用上下方向键、Home 或 End 排序。
      </p>
      <ReorderContext.Provider value={context}>{children({ blocks })}</ReorderContext.Provider>
      <output className="sr-only" aria-live="polite">
        {announcement}
      </output>
    </div>
  );
}

/** Keeps each real information block a drop target without making its links or data draggable. */
export function GlanceSortableBlock({
  id,
  className,
  children,
  tone,
  sortable = true,
}: {
  id: GlanceBlockId;
  className?: string;
  children: ReactNode | ((handle: ReactNode) => ReactNode);
  tone?: string;
  sortable?: boolean;
}) {
  const context = useContext(ReorderContext);
  const order = sortable ? context : null;
  const title = glanceBlocks.find((block) => block.id === id)!.title;
  const index = order?.blocks.indexOf(id) ?? -1;
  const handle =
    order && order.blocks.length > 1 ? (
      <Button
        className="glance-drag-handle"
        variant="ghost"
        size="icon-xs"
        data-sort-handle={id}
        aria-label={`拖动${title}排序`}
        title={`拖动${title}排序`}
        aria-describedby="glance-order-help"
        aria-description={`第 ${index + 1} 项，共 ${order.blocks.length} 项`}
        aria-keyshortcuts="ArrowUp ArrowDown Home End"
        disabled={order.disabled}
        draggable={!order.disabled}
        onDragStart={(event) => {
          if (order.disabled) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", id);
          const block = event.currentTarget.closest("[data-sort-id]");
          if (block) event.dataTransfer.setDragImage(block, 20, 20);
          order.start(id);
        }}
        onDragEnd={order.stop}
        onKeyDown={(event) => {
          const target =
            event.key === "ArrowUp"
              ? index - 1
              : event.key === "ArrowDown"
                ? index + 1
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? order.blocks.length - 1
                    : null;
          if (target === null) return;
          event.preventDefault();
          order.move(id, target);
        }}
      >
        <GripVertical />
      </Button>
    ) : null;
  return (
    <div
      className={cn(className, order && "glance-sortable")}
      data-tone={tone}
      data-sort-id={order ? id : undefined}
      data-dragging={order?.dragging?.id === id}
      data-drop={order?.drop?.id === id ? (order.drop.after ? "after" : "before") : undefined}
      onDragOver={(event) => {
        if (!order?.dragging || order.disabled) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const bounds = event.currentTarget.getBoundingClientRect();
        const horizontal = event.currentTarget.parentElement?.matches(
          ".glance-quota-grid, .glance-token-grid",
        );
        order.over({
          id,
          after: horizontal
            ? event.clientX > bounds.left + bounds.width / 2
            : event.clientY > bounds.top + bounds.height / 2,
        });
        const scroller = event.currentTarget.closest(".glance-content");
        if (!scroller) return;
        const viewport = scroller.getBoundingClientRect();
        if (event.clientY < viewport.top + 28) scroller.scrollTop -= 12;
        else if (event.clientY > viewport.bottom - 28) scroller.scrollTop += 12;
      }}
      onDrop={(event) => {
        if (!order?.dragging || order.disabled) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        const horizontal = event.currentTarget.parentElement?.matches(
          ".glance-quota-grid, .glance-token-grid",
        );
        order.commit({
          id,
          after: horizontal
            ? event.clientX > bounds.left + bounds.width / 2
            : event.clientY > bounds.top + bounds.height / 2,
        });
      }}
    >
      {typeof children === "function" ? (
        children(handle)
      ) : (
        <>
          {children}
          {handle}
        </>
      )}
    </div>
  );
}
