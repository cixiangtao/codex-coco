const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const exact = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** Presentation only: an unknown count must never look like measured zero. */
export function formatTokens(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) || value < 0
    ? "—"
    : compact.format(value);
}

export function formatExactTokens(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) || value < 0
    ? "—"
    : exact.format(value);
}
