import { appConfig } from "./appConfig.generated";
export function normalizeVocabulary(words: string[]): string[] {
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))];
}
export function vocabularyError(words: string[]): string {
  const limits = appConfig.inputLimits;
  if (words.length > limits.vocabularyWords) return `Use at most ${limits.vocabularyWords} words.`;
  if (words.some((word) => Array.from(word).length > limits.wordCharacters)) return `Each word allows at most ${limits.wordCharacters} Unicode characters.`;
  if (words.reduce((sum, word) => sum + Array.from(word).length, 0) > limits.vocabularyCharacters) return `Use at most ${limits.vocabularyCharacters} Unicode characters in total.`;
  return "";
}
