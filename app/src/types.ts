export type AppStatus = "idle" | "loading" | "downloading" | "recording" | "transcribing" | "error";

export interface Stats {
  totalWords: number;
  dictationCount: number;
  speechWpm: number;
  minutesSaved: number;
  activeDays: number[];
  averageProcessingSeconds?: number;
}

export interface PermissionsPayload {
  microphone: boolean;
  accessibility: boolean;
  inputMonitoring: boolean;
}

export interface HistoryItem {
  id: string;
  timestamp: string;
  text: string;
  charCount: number;
  wordCount: number;
  wpm: number;
  createdAt?: string;
  processingSeconds?: number;
  durationSeconds?: number;
  model?: string;
  favorite?: boolean;
}

export interface Settings {
  selectedLanguages: string[];
  modelSize: string;
  hotkey: string;
  hotkeyLabel?: string;
  vadEnabled: boolean;
  autoStopEnabled: boolean;
  autoStopSeconds: number;
  vadThreshold: number;
  removeFillerWords: boolean;
  autoCapitalize: boolean;
  customVocabulary: string[];
}

export interface OptionItem {
  value: string;
  label: string;
}

export interface Language {
  code: string;
  name: string;
}

export type ModelStatus = "unverified" | "checking" | "not_downloaded" | "downloading" | "downloaded" | "loading" | "failed";
export interface ModelItem {
  group: "general" | "english" | "specialized" | "legacy";
  languages: string[];
  languageLabel: string;
  quantization: string;
  id: string;
  name: string;
  sizeLabel: string;
  status: ModelStatus;
  downloaded: boolean;
  present: boolean;
  active: boolean;
  progress: number;
  receivedBytes: number;
  totalBytes: number;
  error?: string;
}
export interface ModelInventory { items: ModelItem[]; busy: boolean; connected?: boolean; generation?: number; cancelable?: boolean; operationModel?: string }
