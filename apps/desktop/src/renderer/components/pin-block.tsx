import { useState } from "react";
import { Pin, PinOff } from "lucide-react";
import { Button } from "@codex-coco/ui/components/button";
import { glanceBlocks, type GlanceBlockId } from "../../contracts/glance-layout";
import { useGlanceLayout, acceptGlanceLayout } from "../client/glance-layout";

/** Adds a public block preference; never enables a module or starts a source read. */
export function PinBlockButton({ id }: { id: GlanceBlockId }) {
  const saved = useGlanceLayout();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const selected = saved?.value.blocks.includes(id) ?? false;
  const title = glanceBlocks.find((block) => block.id === id)!.title;
  return (
    <span className="pin-block-control">
      <Button
        variant="ghost"
        size="icon-xs"
        className="pin-block-button"
        data-pinned={selected}
        aria-label={`${selected ? "从速览移除" : "添加到速览："}${title}`}
        title={message || (selected ? "从速览移除" : "添加到速览")}
        disabled={pending || !saved || !["ok", "missing"].includes(saved.health)}
        onClick={async () => {
          if (!saved) return;
          setPending(true);
          setMessage("");
          try {
            const result = await window.codexCoco.saveGlanceLayout({
              expectedRevision: saved.revision,
              value: {
                blocks: selected
                  ? saved.value.blocks.filter((block) => block !== id)
                  : [...saved.value.blocks, id],
              },
            });
            if (result.ok) acceptGlanceLayout(result.value);
            else setMessage(result.error.message);
          } catch {
            setMessage("速览设置未能保存，请重试。");
          } finally {
            setPending(false);
          }
        }}
      >
        {selected ? <PinOff /> : <Pin />}
      </Button>
      <output aria-live="polite" className="sr-only">
        {message}
      </output>
    </span>
  );
}
