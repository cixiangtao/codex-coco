import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  snapshot: GlanceSnapshot;
}
interface ReorderContext {
  blocks: GlanceBlockId[];
  disabled: boolean;
  dragging: Drag | null;
  reducedMotion: boolean;
  move(id: GlanceBlockId, index: number): void;
}
const ReorderContext = createContext<ReorderContext | null>(null);
const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (listener: () => void) => {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const reducedMotionSnapshot = () => window.matchMedia(motionQuery).matches;

/** Full-width Cards move vertically and stay above the fixed footer while edge scrolling. */
const keepCardInViewport: Modifier = ({ transform, draggingNodeRect, scrollableAncestorRects }) => {
  const viewport = scrollableAncestorRects[0];
  if (!draggingNodeRect || !viewport || draggingNodeRect.height > viewport.height)
    return { ...transform, x: 0 };
  return {
    ...transform,
    x: 0,
    y: Math.min(
      Math.max(transform.y, viewport.top - draggingNodeRect.top),
      viewport.bottom - draggingNodeRect.bottom,
    ),
  };
};
const overlayModifiers = [keepCardInViewport];

/** Saves completed inline moves through the popover's permutation-only IPC, never module operations. */
export function GlanceReorder({
  snapshot,
  visible,
  busy,
  children,
  renderOverlay,
}: {
  snapshot: GlanceSnapshot;
  visible: boolean;
  busy: boolean;
  children(layout: GlanceLayout, snapshot: GlanceSnapshot): ReactNode;
  renderOverlay(id: GlanceBlockId, snapshot: GlanceSnapshot): ReactNode;
}) {
  const [draft, setDraft] = useState<Order | null>(null);
  const [drag, setDragging] = useState<Drag | null>(null);
  const dragging =
    drag && visible && !busy && snapshot.layoutEditable && drag.revision === snapshot.layoutRevision
      ? drag
      : null;
  const reducedMotion = useSyncExternalStore(subscribeMotion, reducedMotionSnapshot);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
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
  const interactionAllowed = useRef(false);
  useEffect(() => {
    interactionAllowed.current = !disabled;
  }, [disabled]);
  const stop = () => {
    setDragging(null);
  };
  useEffect(
    () =>
      window.codexCoco.onGlanceVisibilityChanged((visible) => {
        if (visible) return;
        interactionAllowed.current = false;
        setDragging(null);
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
      // The sensor receives Escape next; the window-level dismiss handler must ignore it.
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
    if (disabled || !interactionAllowed.current || saving.current) return;
    const source = base ?? { revision: snapshot.layoutRevision ?? 0, blocks };
    if (source.revision !== snapshot.layoutRevision) {
      setAnnouncement("组合已更新，请按最新内容重新拖动。");
      return;
    }
    const next = moveGlanceBlock(source.blocks, id, index);
    if (next.every((entry, position) => entry === source.blocks[position])) return;
    if (!base) focusAfterMove.current = id;
    void save({ revision: source.revision, blocks: next }, id);
  };
  // Constrain drops to the visible scroll viewport. Closest-center alone also accepts the toolbar.
  const collisionDetection: CollisionDetection = (args) => {
    const viewport = container.current?.closest(".glance-content")?.getBoundingClientRect();
    const pointer = args.pointerCoordinates;
    if (
      !viewport ||
      !pointer ||
      pointer.x < viewport.left ||
      pointer.x > viewport.right ||
      pointer.y < viewport.top ||
      pointer.y > viewport.bottom
    )
      return [];
    return closestCenter({
      ...args,
      collisionRect: {
        ...args.collisionRect,
        left: pointer.x,
        right: pointer.x,
        top: pointer.y,
        bottom: pointer.y,
        width: 0,
        height: 0,
      },
    });
  };
  const context: ReorderContext = { blocks, disabled, dragging, reducedMotion, move };
  return (
    <div ref={container} className="glance-reorder" aria-busy={pending}>
      {(error || (conflict && !pending)) && (
        <Alert variant="destructive">
          <AlertTitle>{conflict ? "组合已在主窗口更新" : "顺序未能保存"}</AlertTitle>
          <AlertDescription>
            <p>{conflict ? "请载入最新顺序后重新拖动，当前排列不会覆盖新组合。" : error}</p>
            <div className="flex gap-0.5">
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
        拖动卡片手柄，整张卡片移动，松手自动保存；Esc 取消。也可聚焦手柄，用上下方向键、Home 或 End
        排序。
      </p>
      <ReorderContext.Provider value={context}>
        <DndContext
          key={`${visible}:${busy}:${snapshot.layoutEditable}`}
          sensors={sensors}
          collisionDetection={collisionDetection}
          autoScroll={{
            enabled: dragging !== null,
            canScroll: (element) => element.classList.contains("glance-content"),
            threshold: { x: 0, y: 0.12 },
          }}
          accessibility={{
            restoreFocus: false,
            announcements: {
              onDragStart: () => undefined,
              onDragOver: () => undefined,
              onDragEnd: () => undefined,
              onDragCancel: () => undefined,
            },
          }}
          onDragStart={({ active }) => {
            if (disabled) return;
            const id = active.id as GlanceBlockId;
            setDragging({
              id,
              revision: snapshot.layoutRevision ?? 0,
              blocks: [...blocks],
              snapshot,
            });
            setAnnouncement(
              `正在移动${glanceBlocks.find((block) => block.id === id)!.title}，Esc 取消。`,
            );
          }}
          onDragCancel={() => {
            stop();
            setAnnouncement("已取消移动，顺序未改变。");
          }}
          onDragEnd={({ over }) => {
            if (dragging && over)
              move(dragging.id, dragging.blocks.indexOf(over.id as GlanceBlockId), dragging);
            else setAnnouncement("已取消移动，顺序未改变。");
            stop();
          }}
        >
          <SortableContext items={blocks} strategy={verticalListSortingStrategy}>
            {children({ blocks }, dragging?.snapshot ?? snapshot)}
          </SortableContext>
          {/* Synchronous optimistic placement avoids a second ghost flying back during IPC saves. */}
          <DragOverlay
            adjustScale={false}
            dropAnimation={null}
            modifiers={overlayModifiers}
            zIndex={20}
          >
            {dragging && visible && !disabled && dragging.revision === snapshot.layoutRevision ? (
              <div className="glance-card-overlay" data-drag-overlay inert aria-hidden="true">
                {renderOverlay(dragging.id, dragging.snapshot)}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </ReorderContext.Provider>
      <output className="sr-only" aria-live="polite">
        {announcement}
      </output>
    </div>
  );
}

/** The handle activates dragging; the complete Card provides its geometry and stable placeholder. */
export function GlanceSortableBlock({
  id,
  children,
}: {
  id: GlanceBlockId;
  children(handle: ReactNode): ReactNode;
}) {
  const order = useContext(ReorderContext);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({
    id,
    disabled: !order || order.disabled,
    transition: order?.reducedMotion
      ? null
      : { duration: 160, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  });
  const title = glanceBlocks.find((block) => block.id === id)!.title;
  const index = order?.blocks.indexOf(id) ?? -1;
  const handle =
    order && order.blocks.length > 1 ? (
      <Button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="glance-drag-handle"
        variant="ghost"
        size="icon-xs"
        data-sort-handle={id}
        aria-label={`拖动${title}排序`}
        title={`拖动整张卡片 · ${title}`}
        aria-describedby="glance-order-help"
        aria-description={`第 ${index + 1} 项，共 ${order.blocks.length} 项`}
        aria-keyshortcuts="ArrowUp ArrowDown Home End"
        disabled={order.disabled}
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
          if (!isSorting) order.move(id, target);
        }}
      >
        <GripVertical />
      </Button>
    ) : null;
  return (
    <div
      ref={setNodeRef}
      className={cn("glance-sortable", isDragging && order?.dragging && "glance-card-placeholder")}
      data-sort-id={id}
      data-dragging={isDragging && !!order?.dragging}
      style={{
        transform: order?.dragging ? CSS.Translate.toString(transform) : undefined,
        transition,
      }}
    >
      {children(handle)}
    </div>
  );
}
