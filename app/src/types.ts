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
