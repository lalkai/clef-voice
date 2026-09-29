import type { HistoryItem } from "../types";

function localDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function activityWeeks(items: HistoryItem[], now = new Date()) {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.createdAt) continue;
    const date = new Date(item.createdAt);
    if (!Number.isFinite(date.getTime()) || date.getFullYear() <= 1 || date > now) continue;
    const key = localDay(date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - start.getDay() - 11 * 7);
  return Array.from({ length: 12 }, (_, week) => Array.from({ length: 7 }, (_, day) => {
    const date = new Date(start);
    date.setDate(start.getDate() + week * 7 + day);
    return { date, count: counts.get(localDay(date)) || 0, future: date > now };
  }));
}

export function modelUsage(items: HistoryItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const model = item.model || "Unknown";
    counts.set(model, (counts.get(model) || 0) + 1);
  }
  return [...counts].map(([model, count]) => ({ model, count, percent: items.length ? count / items.length * 100 : 0 }))
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
}
