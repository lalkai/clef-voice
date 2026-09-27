import type {
  HistoryItem,
  Language,
  OptionItem,
  PermissionsPayload,
  Settings,
  Stats,
} from "../types";

export type BridgeMethod =
  | "getState"
  | "getSettings"
  | "updateSettings"
  | "loadModel"
  | "getLanguages"
  | "getModelSizes"
  | "getHotkeys"
  | "checkPermissions"
  | "requestAccessibility"
  | "requestMicrophone"
  | "requestInputMonitoring"
  | "getHistory"
  | "getStats"
  | "clearHistory"
  | "deleteHistoryItem"
  | "toggleDictation";

declare global {
  interface Window {
    clefVoice?: {
      call: (method: BridgeMethod, params?: Record<string, unknown>) => Promise<unknown>;
      on: (type: string, cb: (payload: any) => void) => () => void;
    };
  }
}

// Fallback state for Browser Dev Mode
let mockSettings: Settings = {
  selectedLanguages: ["th", "en"],
  modelSize: "base",
  hotkey: "Fn",
  vadEnabled: true,
  autoStopEnabled: false,
  autoStopSeconds: 0.9,
  vadThreshold: 0.012,
  removeFillerWords: true,
  autoCapitalize: true,
  customVocabulary: ["ClefVoice", "Whisper", "Swift", "TailwindCSS", "Kubernetes", "Next.js"],
};

let mockHistory: HistoryItem[] = [
  {
    id: "h1",
    timestamp: "10:42 AM",
    text: "สวัสดีครับ ลองทดสอบระบบถอดความเสียงด้วย Whispr Flow UI บน macOS",
    charCount: 65,
    wordCount: 11,
    wpm: 145,
  },
  {
    id: "h2",
    timestamp: "10:35 AM",
    text: "Refactor settings page using React and Tailwind CSS for ClefVoice prototype.",
    charCount: 77,
    wordCount: 11,
    wpm: 152,
  },
  {
    id: "h3",
    timestamp: "09:15 AM",
    text: "Automatic text insertion at cursor location works seamlessly across all native applications.",
    charCount: 97,
    wordCount: 13,
    wpm: 155,
  },
];

function getMockStats(): Stats {
  const totalWords = mockHistory.reduce((sum, item) => sum + item.wordCount, 0);
  const totalMinutes = mockHistory.reduce((sum, item) => sum + (item.wpm > 0 ? item.wordCount / item.wpm : 0), 0);
  const speechWpm = totalMinutes > 0 ? Math.round(totalWords / totalMinutes) : 0;
  return {
    totalWords,
    dictationCount: mockHistory.length,
    speechWpm,
    minutesSaved: speechWpm ? Math.max(0, Math.round(totalWords / 40 - totalWords / speechWpm)) : 0,
    activeDays: mockHistory.length ? [new Date().getDay()] : [],
  };
}

function emitMockHistory() {
  window.dispatchEvent(new CustomEvent("clefVoice:history", { detail: mockHistory }));
  window.dispatchEvent(new CustomEvent("clefVoice:stats", { detail: getMockStats() }));
}

const mockLanguages: Language[] = [
  { code: "th", name: "Thai (ไทย)" },
  { code: "en", name: "English" },
  { code: "ja", name: "Japanese (日本語)" },
  { code: "zh", name: "Chinese (中文)" },
  { code: "es", name: "Spanish (Español)" },
  { code: "fr", name: "French (Français)" },
  { code: "de", name: "German (Deutsch)" },
];

const mockModelSizes: OptionItem[] = [
  { value: "tiny", label: "Tiny (~75 MB - Fast)" },
  { value: "base", label: "Base (~142 MB - Balanced)" },
  { value: "small", label: "Small (~466 MB - Accurate)" },
  { value: "large-v3-turbo", label: "Turbo (~1.5 GB - Best)" },
];

const mockHotkeys: OptionItem[] = [
  { value: "LeftControl", label: "⌃ Left Control (Hold to talk)" },
  { value: "Fn", label: "🌐 Fn Key (Hold to talk)" },
  { value: "LeftOption", label: "⌥ Left Option (Hold to talk)" },
  { value: "RightOption", label: "⌥ Right Option (Hold to talk)" },
];

function call<T>(method: BridgeMethod, params?: Record<string, unknown>): Promise<T | undefined> {
  if (window.clefVoice?.call) {
    return window.clefVoice.call(method, params).then((r) => r as T | undefined);
  }
  // Dev mode mock fallbacks
  switch (method) {
    case "updateSettings":
      mockSettings = { ...mockSettings, ...(params?.settings as Partial<Settings>) };
      return Promise.resolve(undefined);
    case "deleteHistoryItem":
      mockHistory = mockHistory.filter((item) => item.id !== params?.id);
      emitMockHistory();
      return Promise.resolve(undefined);
    case "clearHistory":
      mockHistory = [];
      emitMockHistory();
      return Promise.resolve(undefined);
    case "getState":
      return Promise.resolve({ status: "idle", message: "Browser preview", progress: 0 } as unknown as T);
    case "loadModel":
      mockSettings = { ...mockSettings, modelSize: String(params?.size) };
      window.dispatchEvent(new CustomEvent("clefVoice:settings", { detail: mockSettings }));
      return Promise.resolve(undefined);
    case "getSettings":
      return Promise.resolve(mockSettings as unknown as T);
    case "getLanguages":
      return Promise.resolve(mockLanguages as unknown as T);
    case "getModelSizes":
      return Promise.resolve(mockModelSizes as unknown as T);
    case "getHotkeys":
      return Promise.resolve(mockHotkeys as unknown as T);
    case "checkPermissions":
      return Promise.resolve({ microphone: true, accessibility: true, inputMonitoring: false } as unknown as T);
    case "getHistory":
      return Promise.resolve(mockHistory as unknown as T);
    case "getStats":
      return Promise.resolve(getMockStats() as unknown as T);
    default:
      return Promise.resolve(undefined);
  }
}

export const getSettings = (): Promise<Settings | undefined> => call<Settings>("getSettings");

export const updateSettings = (settings: Partial<Settings>): Promise<void | undefined> =>
  call<void>("updateSettings", { settings });

export const loadModel = (size: string): Promise<void | undefined> =>
  call<void>("loadModel", { size });

export const getLanguages = (): Promise<Language[] | undefined> => call<Language[]>("getLanguages");

export const getModelSizes = (): Promise<OptionItem[] | undefined> =>
  call<OptionItem[]>("getModelSizes");

export const getHotkeys = (): Promise<OptionItem[] | undefined> => call<OptionItem[]>("getHotkeys");

export const checkPermissions = (): Promise<PermissionsPayload | undefined> =>
  call<PermissionsPayload>("checkPermissions");

export const requestAccessibility = (): Promise<void | undefined> => call<void>("requestAccessibility");

export const requestMicrophone = (): Promise<void | undefined> => call<void>("requestMicrophone");

export const requestInputMonitoring = (): Promise<void | undefined> => call<void>("requestInputMonitoring");

export const getHistory = (): Promise<HistoryItem[] | undefined> => call<HistoryItem[]>("getHistory");
export const getStats = (): Promise<Stats | undefined> => call<Stats>("getStats");

export const clearHistory = (): Promise<void | undefined> => call<void>("clearHistory");
export const deleteHistoryItem = (id: string): Promise<void | undefined> =>
  call<void>("deleteHistoryItem", { id });

export const toggleDictation = (): Promise<void | undefined> => call<void>("toggleDictation");


export const getState = () => call<{ status: import("../types").AppStatus; message: string; progress: number }>("getState");
