import type { Language, ModelItem } from "../types";

export function modelLanguageSelection(model: ModelItem | undefined, languages: Language[], configured: string[]) {
  if (!model) return { available: [], selected: [], fixed: false };
  const allowed = model.languages;
  const available = allowed.length ? languages.filter((language) => allowed.includes(language.code)) : languages;
  const fixed = allowed.length === 1;
  const selected = fixed ? [...allowed] : configured.filter((code) => available.some((language) => language.code === code));
  return { available, selected, fixed };
}
