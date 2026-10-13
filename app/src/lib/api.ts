import { appConfig } from "./appConfig.generated";

import type {
  HistoryItem,
  ModelInventory,
  Language,
  OptionItem,
  PermissionsPayload,
  Settings,
  Stats,
} from "../types";

export type BridgeMethod =
  | "retryEngine"
  | "cancelDownload"
  | "getSetupState"
  | "completeSetup"
  | "copyText"
  | "getState"
  | "getSettings"
  | "updateSettings"
  | "loadModel"
  | "getModels"
  | "downloadModel"
  | "deleteModel"
  | "getLanguages"
  | "getModelSizes"
  | "getHotkeys"
  | "recordHotkey"
  | "checkPermissions"
  | "requestAccessibility"
  | "requestMicrophone"
  | "getHistory"
  | "getStats"
  | "clearHistory"
  | "deleteHistoryItem"
  | "toggleDictation"
  | "setHistoryFavorite";

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
  selectedLanguages: [],
  modelSize: appConfig.defaultModel,
  ...appConfig.settingsDefaults,
  vadThreshold: appConfig.defaultVadThreshold,
  customVocabulary: [...appConfig.settingsDefaults.customVocabulary],
};

let mockHistory: HistoryItem[] = [
  {
    id: "h1",
    timestamp: "10:42 AM",
    text: "สวัสดีครับ ลองทดสอบการถอดเสียงภาษาไทยกับศัพท์ technical ด้วย ClefVoice",
    charCount: 65,
    wordCount: 11,
    wpm: 145,
    processingSeconds: 0.8,
    model: "base",
  },
  {
    id: "h2",
    timestamp: "10:35 AM",
    text: "Refactor settings page using React and Tailwind CSS for ClefVoice prototype.",
    charCount: 77,
    wordCount: 11,
    wpm: 152,
    processingSeconds: 1.2,
    model: "large-v3-turbo",
  },
  {
    id: "h3",
    timestamp: "09:15 AM",
    text: "Use History to copy the transcript when the target app does not accept pasting.",
    charCount: 97,
    wordCount: 13,
    wpm: 155,
  },
].map((item) => ({ ...item, charCount: Array.from(item.text).length }));

function getMockStats(): Stats {
  const totalWords = mockHistory.reduce((sum, item) => sum + item.wordCount, 0);
  const totalMinutes = mockHistory.reduce((sum, item) => sum + (item.wpm > 0 ? item.wordCount / item.wpm : 0), 0);
  const speechWpm = totalMinutes > 0 ? Math.round(totalWords / totalMinutes) : 0;
  const timings = mockHistory.flatMap((item) => item.processingSeconds != null && Number.isFinite(item.processingSeconds) && item.processingSeconds >= 0 ? [item.processingSeconds] : []);
  return {
    totalWords,
    dictationCount: mockHistory.length,
    speechWpm,
    minutesSaved: speechWpm ? Math.max(0, Math.round(totalWords / appConfig.typingWpm - totalWords / speechWpm)) : 0,
    activeDays: mockHistory.length ? [new Date().getDay()] : [],
    averageProcessingSeconds: timings.length ? timings.reduce((sum, seconds) => sum + seconds, 0) / timings.length : undefined,
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

let mockModels: ModelInventory = {
  busy: false,
  items: appConfig.models.map((model) => ({
    id: model.id, name: model.displayName, sizeLabel: model.sizeLabel, group: model.group, languages: [...model.languages], languageLabel: model.languageLabel, quantization: model.quantization,
    status: model.id === appConfig.defaultModel ? "downloaded" : "not_downloaded",
    downloaded: model.id === appConfig.defaultModel, present: model.id === appConfig.defaultModel,
    active: model.id === appConfig.defaultModel, progress: 0, receivedBytes: 0, totalBytes: -1,
  })),
};
function emitMockModels() {
  window.dispatchEvent(new CustomEvent("clefVoice:models", { detail: structuredClone(mockModels) }));
}

const mockModelSizes: OptionItem[] = appConfig.models.map((model) => ({ value: model.id, label: model.label }));

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
  if (window.location?.protocol === "file:") {
    return Promise.reject(new Error("Native bridge unavailable. Reopen the app and try again."));
  }
  // Dev mode mock fallbacks
  switch (method) {
    case "getSetupState":
      return Promise.resolve({ completed: localStorage.getItem("clefVoice.setupCompleted") === "true" } as unknown as T);
    case "completeSetup":
      if (mockModels.busy || !mockModels.items.some((item) => item.active && item.downloaded && item.status === "downloaded")) {
        return Promise.resolve(false as unknown as T);
      }
      localStorage.setItem("clefVoice.setupCompleted", "true");
      return Promise.resolve(true as unknown as T);
    case "updateSettings":
      mockSettings = { ...mockSettings, ...(params?.settings as Partial<Settings>) };
      window.dispatchEvent(new CustomEvent("clefVoice:settings", { detail: structuredClone(mockSettings) }));
      return Promise.resolve(undefined);
    case "deleteHistoryItem":
      mockHistory = mockHistory.filter((item) => item.id !== params?.id);
      emitMockHistory();
      return Promise.resolve(undefined);
    case "clearHistory":
      mockHistory = [];
      emitMockHistory();
      return Promise.resolve(undefined);
    case "setHistoryFavorite":
      mockHistory = mockHistory.map((item) => item.id === params?.id
        ? { ...item, favorite: Boolean(params?.favorite) } : item);
      emitMockHistory();
      return Promise.resolve(undefined);
    case "getState":
      return Promise.resolve({ status: "idle", message: "Browser preview", progress: 0 } as unknown as T);
    case "getModels":
      return Promise.resolve(structuredClone(mockModels) as unknown as T);
    case "downloadModel": {
      const item = mockModels.items.find((item) => item.id === params?.size);
      if (!item) return Promise.reject(new Error("Unknown model."));
      if (mockModels.busy) return Promise.reject(new Error("Engine is busy."));
      const bytes = appConfig.models.find((model) => model.id === item.id)?.sizeBytes ?? -1;
      mockModels = { busy: true, items: mockModels.items.map((entry) => entry.id === item.id
        ? { ...entry, status: "downloading", receivedBytes: 0, totalBytes: bytes, progress: 0 } : entry) };
      emitMockModels();
      return new Promise<T | undefined>((resolve) => {
        setTimeout(() => {
          mockModels = { busy: false, items: mockModels.items.map((entry) => entry.id === item.id
            ? { ...entry, status: "downloaded", downloaded: true, present: true, progress: 1, receivedBytes: bytes } : entry) };
          emitMockModels();
          resolve(undefined);
        }, 700);
      });
    }
    case "deleteModel":
      mockModels = { ...mockModels, items: mockModels.items.map((item) => item.id === params?.size && !mockModels.busy
        ? { ...item, status: "not_downloaded", downloaded: false, present: false, active: false, progress: 0, receivedBytes: 0, totalBytes: -1 } : item) };
      emitMockModels();
      return Promise.resolve(undefined);
    case "loadModel": {
      const item = mockModels.items.find((item) => item.id === params?.size);
      if (mockModels.busy) return Promise.reject(new Error("Engine is busy."));
      if (!item?.downloaded) return Promise.reject(new Error("Download this model first."));
      {
        mockSettings = { ...mockSettings, modelSize: item.id };
        mockModels = { ...mockModels, items: mockModels.items.map((entry) => ({ ...entry, active: entry.id === item.id })) };
        window.dispatchEvent(new CustomEvent("clefVoice:settings", { detail: mockSettings }));
        emitMockModels();
      }
      return Promise.resolve(undefined);
    }
    case "getSettings":
      return Promise.resolve(structuredClone(mockSettings) as unknown as T);
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


export const getHistory = (): Promise<HistoryItem[] | undefined> => call<HistoryItem[]>("getHistory");
export const getStats = (): Promise<Stats | undefined> => call<Stats>("getStats");

export const clearHistory = (): Promise<void | undefined> => call<void>("clearHistory");
export const deleteHistoryItem = (id: string): Promise<void | undefined> =>
  call<void>("deleteHistoryItem", { id });

export const toggleDictation = (): Promise<void | undefined> => call<void>("toggleDictation");

export const setHistoryFavorite = (id: string, favorite: boolean): Promise<void | undefined> =>
  call<void>("setHistoryFavorite", { id, favorite });


export const getState = () => call<{ status: import("../types").AppStatus; message: string; progress: number }>("getState");

export const getModels = () => call<ModelInventory>("getModels");
export const downloadModel = (size: string) => call<void>("downloadModel", { size });
export const deleteModel = (size: string) => call<void>("deleteModel", { size });

export const recordHotkey = (): Promise<OptionItem | undefined> => call<OptionItem>("recordHotkey");

export const copyText = async (text: string): Promise<void> => {
  if (window.clefVoice?.call) {
    if (await call<boolean>("copyText", { text }) !== true) {
      throw new Error("Could not copy text");
    }
  } else {
    await navigator.clipboard.writeText(text);
  }
};

export const getSetupState = () => call<{ completed: boolean }>("getSetupState");
export const completeSetup = () => call<boolean>("completeSetup");

export const retryEngine = () => call<boolean>("retryEngine");
export const cancelDownload = () => call<boolean>("cancelDownload");
