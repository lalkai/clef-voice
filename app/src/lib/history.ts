import type { HistoryItem } from "../types";

export function filterHistory(items: HistoryItem[], query: string, favoritesOnly: boolean): HistoryItem[] {
  const terms = query.normalize("NFC").toLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (favoritesOnly && !item.favorite) return false;
    const text = item.text.normalize("NFC").toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function historyTimestamp(item: HistoryItem): string {
  if (!item.createdAt) return item.timestamp;
  const date = new Date(item.createdAt);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() <= 1) return item.timestamp;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatProcessingTime(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(1)} s`;
}
