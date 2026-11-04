import { glanceBlocks, type GlanceBlockId } from "../../contracts/glance-layout";

/** Presentation IDs never enter the persisted block-selection contract. */
export type GlanceCardId =
  | Exclude<GlanceBlockId, "usage.primary" | "usage.secondary">
  | "usage.quota";
export interface GlanceCardDefinition {
  id: GlanceCardId;
  blocks: GlanceBlockId[];
}

function cardId(id: GlanceBlockId): GlanceCardId {
  return id === "usage.primary" || id === "usage.secondary" ? "usage.quota" : id;
}

/** Quota windows form one stable Card at their first selected position, even in older split orders. */
export function glanceCards(blocks: readonly GlanceBlockId[]): GlanceCardDefinition[] {
  const cards: GlanceCardDefinition[] = [];
  for (const block of blocks) {
    const id = cardId(block);
    const card = cards.find((entry) => entry.id === id);
    if (card) card.blocks.push(block);
    else cards.push({ id, blocks: [block] });
  }
  return cards;
}

export function glanceCardTitle(id: GlanceCardId) {
  return id === "usage.quota" ? "订阅额度" : glanceBlocks.find((block) => block.id === id)!.title;
}

/** Moves whole Cards while preserving exactly the selected public IDs and their within-Card order. */
export function moveGlanceCard(blocks: readonly GlanceBlockId[], id: GlanceCardId, index: number) {
  const cards = glanceCards(blocks);
  const from = cards.findIndex((card) => card.id === id);
  if (from < 0 || !Number.isInteger(index)) return [...blocks];
  const to = Math.max(0, Math.min(index, cards.length - 1));
  if (from === to) return [...blocks];
  const [card] = cards.splice(from, 1);
  cards.splice(to, 0, card!);
  return cards.flatMap((entry) => entry.blocks);
}
