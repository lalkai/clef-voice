import type { ModelItem } from "../types";

export type LanguageFilter = "all" | "multilingual" | "english" | "specialized";
export function filterModels(items: ModelItem[], query: string, language: LanguageFilter, descriptions: Record<string, string>) {
  const search = query.trim().toLowerCase();
  return items.filter((model) => {
    const text = `${model.name} ${model.id} ${model.languageLabel} ${descriptions[model.id] ?? ""}`.toLowerCase();
    const allowed = model.languages;
    const matchesLanguage = language === "all"
      || (language === "multilingual" && allowed.length === 0)
      || (language === "english" && allowed.length === 1 && allowed[0] === "en")
      || (language === "specialized" && model.group === "specialized");
    return text.includes(search) && matchesLanguage;
  });
}
export function isLocalModel(model: ModelItem) {
  return model.present || model.downloaded || model.active || model.status === "downloading" || model.status === "loading";
}
export function sortLocalModels(items: ModelItem[]) {
  return [...items].sort((a, b) => Number(b.active) - Number(a.active));
}
