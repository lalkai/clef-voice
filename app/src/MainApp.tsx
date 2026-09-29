import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LayoutDashboard,
  History as HistoryIcon,
  BookOpen,
  Sliders,
  Settings2,
  Check,
  Copy,
  Trash2,
  Search,
  ShieldCheck,
  ChevronDown,
  X,
  RefreshCw,
  Star,
} from "lucide-react";
import * as api from "./lib/api";
import DashboardView from "./Dashboard";
import { initEvents } from "./lib/events";
import { useAppStore } from "./lib/store";
import {
  filterHistory,
  formatProcessingTime,
  historyTimestamp,
} from "./lib/history";
import { modelDescriptions } from "./lib/models";
import { audioOptionValue } from "./lib/audioSettings";
import { appConfig } from "./lib/appConfig.generated";
import type {
  HistoryItem,
  Language,
  OptionItem,
  PermissionsPayload,
  Settings,
} from "./types";

type TabId = "dashboard" | "history" | "vocabulary" | "audio" | "preferences";
const appVersion = appConfig.version;
const emptyPermissions: PermissionsPayload = {
  microphone: false,
  accessibility: false,
  inputMonitoring: false,
};

// ─────────────────────────────────────────────────────────
// Root Shell
// ─────────────────────────────────────────────────────────

export default function MainApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const settingsRevision = useRef(0);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [modelSizes, setModelSizes] = useState<OptionItem[]>([]);
  const [hotkeys, setHotkeys] = useState<OptionItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [permissions, setPermissions] =
    useState<PermissionsPayload>(emptyPermissions);
  const [selectedTab, setSelectedTab] = useState<TabId>("dashboard");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [stats, setStats] = useState<import("./types").Stats | null>(null);

  const appStatus = useAppStore((s) => s.status);
  const statusMessage = useAppStore((s) => s.message);
  const engineProgress = useAppStore((s) => s.progress);

  const [isReady, setIsReady] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [progress, setProgress] = useState(15);

  const refreshData = async () => {
    try {
      const statusRevision = useAppStore.getState().statusRevision;
      const settingsSnapshotRevision = settingsRevision.current;
      const [s, l, m, h, p, state] = await Promise.all([
        api.getSettings(),
        api.getLanguages(),
        api.getModelSizes(),
        api.getHotkeys(),
        api.checkPermissions(),
        api.getState(),
      ]);

      // Live engine events may arrive while these bridge requests are pending.
      // Do not put an older state snapshot back on screen afterwards.
      if (state && useAppStore.getState().statusRevision === statusRevision) {
        useAppStore.getState().setStatus(state.status, state.message);
        useAppStore.getState().setProgress(state.progress);
      }
      if (s && settingsRevision.current === settingsSnapshotRevision) {
        setSettings({
          ...s,
          vadThreshold: s.vadThreshold ?? appConfig.defaultVadThreshold,
          customVocabulary: s.customVocabulary ?? [
            "ClefVoice",
            "TypeScript",
            "TailwindCSS",
          ],
        });
      }
      setLanguages(l ?? []);
      setModelSizes(m ?? []);
      setHotkeys(h ?? []);
      setPermissions(p ?? emptyPermissions);
      const [items, summary] = await Promise.all([
        api.getHistory(),
        api.getStats(),
      ]);
      if (items) setHistory(items);
      if (summary) setStats(summary);
    } catch (e) {
      console.error("Failed to load data:", e);
    }
  };

  useEffect(() => {
    initEvents();
    let isMounted = true;

    const runStartup = async () => {
      setProgress(60);
      await refreshData();
      if (!isMounted) return;
      setProgress(100);
      setIsFadingOut(true);
      setTimeout(() => {
        if (isMounted) setIsReady(true);
      }, 150);
    };

    void runStartup();

    const handleHistory = (e: any) => setHistory(e.detail);
    const handleStats = (e: any) => setStats(e.detail);
    const handleSettings = (e: any) => {
      settingsRevision.current += 1;
      setSettings(e.detail);
    };
    const handlePermissions = (e: any) => setPermissions(e.detail);
    const handleNavigateTab = (e: any) => {
      const tab = e.detail?.tab;
      if (tab) setSelectedTab(tab);
    };

    window.addEventListener("clefVoice:history", handleHistory);
    window.addEventListener("clefVoice:stats", handleStats);
    window.addEventListener("clefVoice:settings", handleSettings);
    window.addEventListener("clefVoice:permissions", handlePermissions);
    window.addEventListener("clefVoice:navigateTab", handleNavigateTab);

    return () => {
      isMounted = false;
      window.removeEventListener("clefVoice:history", handleHistory);
      window.removeEventListener("clefVoice:stats", handleStats);
      window.removeEventListener("clefVoice:settings", handleSettings);
      window.removeEventListener("clefVoice:permissions", handlePermissions);
      window.removeEventListener("clefVoice:navigateTab", handleNavigateTab);
    };
  }, []);

  const saveSettings = (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    settingsRevision.current += 1;
    setSettings(next);
    void api.updateSettings(patch);
  };

  if (!settings) {
    return <StartupLoadingScreen progress={progress} isFadingOut={false} />;
  }

  const missingPermission = !permissions.microphone
    ? "Microphone access needed"
    : !permissions.accessibility
      ? "Accessibility access needed"
      : null;
  const footerMessage =
    appStatus === "idle" && missingPermission
      ? missingPermission
      : appStatus === "downloading"
        ? `${statusMessage} ${Math.round(engineProgress * 100)}%`
        : statusMessage;
  const copyItem = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1400);
  };

  const tabs: {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }[] = [
    {
      id: "dashboard",
      label: "Overview",
      icon: <LayoutDashboard size={14} strokeWidth={1.8} />,
    },
    {
      id: "history",
      label: "History",
      icon: <HistoryIcon size={14} strokeWidth={1.8} />,
      count: history.length,
    },
    {
      id: "vocabulary",
      label: "Vocabulary",
      icon: <BookOpen size={14} strokeWidth={1.8} />,
    },
    {
      id: "audio",
      label: "Voice & Audio",
      icon: <Sliders size={14} strokeWidth={1.8} />,
    },
    {
      id: "preferences",
      label: "Preferences",
      icon: <Settings2 size={14} strokeWidth={1.8} />,
    },
  ];

  return (
    <div className="flex h-full w-full bg-[#101012] text-[#d4d4d8] select-none text-[13px] antialiased overflow-hidden relative">
      {!isReady && (
        <StartupLoadingScreen progress={progress} isFadingOut={isFadingOut} />
      )}

      {/* ─── Sidebar ─── */}
      <aside className="w-[210px] bg-[#101012] border-r border-white/[0.06] flex flex-col justify-between pt-9 pb-3 shrink-0">
        <div>
          <div className="px-5 mb-5 mt-1 drag-region cursor-default">
            <div className="flex items-center gap-2.5 pointer-events-none">
              <AppIcon />
              <div>
                <span className="text-[13px] font-semibold text-white tracking-tight">
                  {appConfig.name}
                </span>
                <p
                  className="mt-0.5 text-[10px] tabular-nums text-white/35"
                  aria-label={`App version ${appVersion}`}
                >
                  v{appVersion}
                </p>
              </div>
            </div>
          </div>

          {/* Navigation items */}
          <nav className="px-2 flex flex-col gap-0.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTab(t.id)}
                className={`w-full flex items-center justify-between px-3 py-[7px] rounded-lg text-[12.5px] transition-colors text-left cursor-pointer whitespace-nowrap ${
                  selectedTab === t.id
                    ? "bg-white/[0.08] text-white font-medium"
                    : "text-white/50 hover:text-white/80 hover:bg-white/[0.03]"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={
                      selectedTab === t.id ? "text-white/90" : "text-white/35"
                    }
                  >
                    {t.icon}
                  </span>
                  {t.label}
                </span>
                {typeof t.count === "number" && t.count > 0 && (
                  <span className="text-[10px] tabular-nums text-white/30">
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Footer — engine status, minimal */}
        <div role="status" className="px-5 flex items-center gap-2 text-[11px] text-white/35">
          <span
            className={`w-[5px] h-[5px] rounded-full ${appStatus === "recording" ? "bg-red-400 animate-pulse" : appStatus === "idle" && !missingPermission ? "bg-emerald-500/80" : "bg-amber-400 animate-pulse"}`}
          />
          {appStatus === "idle" && missingPermission ? (
            <button
              type="button"
              onClick={() => setSelectedTab("preferences")}
              className="truncate text-left hover:text-white/70 transition-colors"
              title={`${footerMessage}. Open Preferences to grant access.`}
            >
              {footerMessage}
            </button>
          ) : (
            <span className="truncate" title={footerMessage}>
              {footerMessage}
            </span>
          )}
        </div>
      </aside>

      {/* ─── Main ─── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header bar */}
        <div className="h-12 shrink-0 drag-region" />

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div
            key={selectedTab}
            className={`${selectedTab === "dashboard" ? "" : "animate-view "}px-10 pb-10 max-w-4xl mx-auto w-full`}
          >
            {selectedTab !== "preferences" && missingPermission && (
              <div
                role="alert"
                className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-[11.5px] text-amber-200"
              >
                <span>
                  {!permissions.microphone
                    ? "Microphone access is needed to record your voice."
                    : "Accessibility access is needed to insert text into other apps."}
                </span>
                <button
                  type="button"
                  className="shrink-0 underline underline-offset-2 hover:text-amber-100"
                  onClick={() => setSelectedTab("preferences")}
                >
                  Review permissions
                </button>
              </div>
            )}

            {selectedTab === "dashboard" && stats && (
              <DashboardView
                history={history}
                stats={stats}
                onNavigate={setSelectedTab}
                onCopy={copyItem}
                copiedId={copiedId}
              />
            )}
            {selectedTab === "history" && (
              <HistoryView
                history={history}
                copiedId={copiedId}
                onCopy={copyItem}
                onFavorite={(id, favorite) => {
                  void api.setHistoryFavorite(id, favorite);
                }}
                onDelete={(id) => {
                  const previous = history;
                  setHistory((prev) => prev.filter((h) => h.id !== id));
                  void api.deleteHistoryItem(id)?.catch(() => {
                    setHistory(previous);
                  });
                }}
                onClear={() => {
                  const previous = history;
                  setHistory([]);
                  void api.clearHistory()?.catch(() => {
                    setHistory(previous);
                  });
                }}
              />
            )}
            {selectedTab === "vocabulary" && (
              <VocabularyView settings={settings} onSave={saveSettings} />
            )}
            {selectedTab === "audio" && (
              <VoiceAudioView settings={settings} onSave={saveSettings} />
            )}
            {selectedTab === "preferences" && (
              <PreferencesView
                settings={settings}
                languages={languages}
                modelSizes={modelSizes}
                hotkeys={hotkeys}
                permissions={permissions}
                onSave={saveSettings}
                onRecheck={() => {
                  void api.checkPermissions().then((p) => {
                    if (p) setPermissions(p);
                  });
                }}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// History
// ─────────────────────────────────────────────────────────

function HistoryView({
  history,
  copiedId,
  onCopy,
  onDelete,
  onClear,
  onFavorite,
}: {
  history: HistoryItem[];
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onFavorite: (id: string, favorite: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const filtered = filterHistory(history, q, favoritesOnly);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30"
          />
          <input
            type="text"
            placeholder="Search Thai or English words…"
            aria-label="Search history"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-white/90 placeholder:text-white/25 outline-none focus:border-white/15 transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={() => setFavoritesOnly(!favoritesOnly)}
          aria-pressed={favoritesOnly}
          className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] ${favoritesOnly ? "bg-amber-400/10 text-amber-300" : "text-white/40 hover:text-white/70"}`}
        >
          <Star size={12} /> Favorites
        </button>
        {history.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            title="Clear all saved transcripts, including favorites"
            className="text-[11px] text-white/30 hover:text-red-400 transition-colors cursor-pointer flex items-center gap-1"
          >
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-white/25 text-[12px]">
          {q.trim()
            ? `No results for "${q.trim()}"`
            : favoritesOnly
              ? "No favorites yet. Star a transcript to find it here."
              : "No transcriptions yet"}
        </p>
      ) : (
        <div className="space-y-1">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="group rounded-lg px-3 py-3 -mx-3 hover:bg-white/[0.03] transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-[12.5px] text-white/80 leading-relaxed select-text flex-1">
                  {item.text}
                </p>
                <button
                  type="button"
                  aria-label={
                    item.favorite ? "Remove from favorites" : "Add to favorites"
                  }
                  aria-pressed={Boolean(item.favorite)}
                  onClick={() => onFavorite(item.id, !item.favorite)}
                  className={`shrink-0 mt-0.5 ${item.favorite ? "text-amber-300" : "text-white/30 hover:text-amber-300"}`}
                >
                  <Star
                    size={13}
                    fill={item.favorite ? "currentColor" : "none"}
                  />
                </button>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                  <button
                    type="button"
                    aria-label="Copy transcript"
                    onClick={() => onCopy(item.id, item.text)}
                    className="text-white/40 hover:text-white cursor-pointer"
                  >
                    {copiedId === item.id ? (
                      <Check size={13} className="text-emerald-400" />
                    ) : (
                      <Copy size={13} />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Delete transcript"
                    onClick={() => onDelete(item.id)}
                    className="text-white/30 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <p className="text-[10.5px] text-white/25 mt-1.5 tabular-nums">
                {historyTimestamp(item)} · {item.wordCount} words ·{" "}
                {item.charCount} chars{" "}
                {item.wpm ? `· ${Math.round(item.wpm)} wpm` : ""}
                {item.model ? ` · ${item.model}` : ""}
                {item.processingSeconds != null
                  ? ` · ${formatProcessingTime(item.processingSeconds)} to transcript`
                  : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────

function VocabularyView({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (p: Partial<Settings>) => void;
}) {
  const [word, setWord] = useState("");

  const addWord = () => {
    const w = word.trim();
    if (!w || settings.customVocabulary.includes(w)) return;
    onSave({ customVocabulary: [...settings.customVocabulary, w] });
    setWord("");
  };

  return (
    <div className="space-y-8">
      {/* Custom words */}
      <section>
        <SectionHead>Custom Words</SectionHead>
        <SettingsGroup>
          <div className="py-4">
            <p className="text-[11.5px] text-white/35 mb-3 leading-relaxed">
              Give Whisper spelling hints for names and technical terms, including
              Thai words. This may improve recognition, but does not guarantee exact
              spelling.
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                aria-label="Custom word"
                placeholder="e.g. Kubernetes, ClefVoice, ขมิ้น"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addWord()}
                className="flex-1 bg-white/[0.04] border border-white/[0.07] rounded-lg px-3 py-1.5 text-[12px] text-white/90 placeholder:text-white/25 outline-none focus:border-white/15 transition-colors"
              />
              <button
                type="button"
                onClick={addWord}
                disabled={!word.trim()}
                className="px-3 py-1.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] disabled:opacity-25 text-white/85 text-[12px] font-medium transition-colors cursor-pointer"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {settings.customVocabulary.map((w) => (
                <span
                  key={w}
                  className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-md bg-white/[0.05] text-[11.5px] text-white/75"
                >
                  {w}
                  <button
                    type="button"
                    aria-label={`Remove ${w}`}
                    onClick={() =>
                      onSave({
                        customVocabulary: settings.customVocabulary.filter(
                          (v) => v !== w,
                        ),
                      })
                    }
                    className="text-white/30 hover:text-white/70 cursor-pointer p-0.5"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </SettingsGroup>
      </section>

      {/* Post-processing */}
      <section>
        <SectionHead>Post-processing</SectionHead>
        <SettingsGroup>
          <Row label="Remove filler words" sub="uh, um, เอ่อ, อ๋อ, แบบว่า">
            <Toggle
              label="Remove filler words"
              checked={settings.removeFillerWords}
              onChange={(v) => onSave({ removeFillerWords: v })}
            />
          </Row>
          <Row
            label="Auto-capitalize"
            sub="Capitalize the first letter of each sentence"
          >
            <Toggle
              label="Auto-capitalize"
              checked={settings.autoCapitalize}
              onChange={(v) => onSave({ autoCapitalize: v })}
            />
          </Row>
        </SettingsGroup>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Voice & Audio
// ─────────────────────────────────────────────────────────

function VoiceAudioView({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (p: Partial<Settings>) => void;
}) {
  const presets = [
    appConfig.vadLevels.high,
    appConfig.vadLevels.normal,
    appConfig.vadLevels.low,
  ] as const;
  const sensitivity = audioOptionValue(
    settings.vadThreshold ?? appConfig.defaultVadThreshold,
    presets,
  );
  const pause = audioOptionValue(
    settings.autoStopSeconds,
    [0.6, 0.9, 1.2, 1.5],
  );
  const sensitivityOptions = [
    { value: String(appConfig.vadLevels.high), label: "High" },
    { value: String(appConfig.vadLevels.normal), label: "Normal" },
    { value: String(appConfig.vadLevels.low), label: "Low" },
  ];
  const pauseOptions = [0.6, 0.9, 1.2, 1.5].map((seconds) => ({
    value: String(seconds),
    label: `${seconds}s`,
  }));
  if (!sensitivityOptions.some((option) => option.value === sensitivity)) {
    sensitivityOptions.push({
      value: sensitivity,
      label: `Custom (${sensitivity})`,
    });
  }
  if (!pauseOptions.some((option) => option.value === pause)) {
    pauseOptions.push({ value: pause, label: `Custom (${pause}s)` });
  }
  return (
    <div className="space-y-8">
      <section>
        <SectionHead>Voice Activity Detection</SectionHead>
        <SettingsGroup>
          <Row
            label="Silence trimming"
            sub="Strip silence before and after speech"
          >
            <Toggle
              label="Silence trimming"
              checked={settings.vadEnabled}
              onChange={(v) => onSave({ vadEnabled: v })}
            />
          </Row>
          <Row label="Sensitivity" sub="Energy threshold for voice detection">
            <Dropdown
              label="Sensitivity"
              value={sensitivity}
              onChange={(v) => onSave({ vadThreshold: Number(v) })}
              options={sensitivityOptions}
            />
          </Row>
          <Row label="Auto-stop" sub="End dictation after silence">
            <Toggle
              label="Auto-stop"
              checked={settings.autoStopEnabled}
              onChange={(v) => onSave({ autoStopEnabled: v })}
            />
          </Row>
          {settings.autoStopEnabled && (
            <Row
              label="Pause duration"
              sub="Seconds of silence before stopping"
            >
              <Dropdown
                label="Pause duration"
                value={pause}
                onChange={(v) => onSave({ autoStopSeconds: Number(v) })}
                options={pauseOptions}
              />
            </Row>
          )}
        </SettingsGroup>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Preferences
// ─────────────────────────────────────────────────────────

function PreferencesView({
  settings,
  languages,
  modelSizes,
  hotkeys,
  permissions,
  onSave,
  onRecheck,
}: {
  settings: Settings;
  languages: Language[];
  modelSizes: OptionItem[];
  hotkeys: OptionItem[];
  permissions: PermissionsPayload;
  onSave: (p: Partial<Settings>) => void;
  onRecheck: () => void;
}) {
  const modelStatus = useAppStore((s) => s.status);
  const modelBusy = [
    "loading",
    "downloading",
    "recording",
    "transcribing",
  ].includes(modelStatus);
  const [langOpen, setLangOpen] = useState(false);

  const langLabel = () => {
    const list = settings.selectedLanguages ?? [];
    if (list.length === 0) return "Auto";
    const matched = languages.filter((l) => list.includes(l.code));
    if (matched.length <= 2)
      return matched
        .map((l) => l.name.replace(/\s*\(.*?\)/, "").trim())
        .join(", ");
    return `${matched.length} languages`;
  };

  return (
    <div className="space-y-8">
      {/* Permissions */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <SectionHead className="mb-0">Permissions</SectionHead>
          <button
            type="button"
            onClick={onRecheck}
            className="text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer flex items-center gap-1"
          >
            <RefreshCw size={11} /> Check
          </button>
        </div>
        <SettingsGroup>
          <Row
            label="Accessibility"
            sub="Use the hotkey and paste text into apps"
          >
            <PermBadge
              granted={permissions.accessibility}
              onRequest={() => void api.requestAccessibility()}
            />
          </Row>
          <Row label="Microphone" sub="Capture audio for local processing">
            <PermBadge
              granted={permissions.microphone}
              onRequest={() => void api.requestMicrophone()}
            />
          </Row>
          <Row
            label="Input Monitoring"
            sub="Optional backup for hotkeys if Accessibility alone is insufficient"
          >
            <PermBadge
              granted={permissions.inputMonitoring}
              onRequest={() => void api.requestInputMonitoring()}
            />
          </Row>
        </SettingsGroup>
      </section>

      {/* Engine */}
      <section>
        <SectionHead>Engine</SectionHead>
        <SettingsGroup>
          <Row label="Hotkey" sub="Hold to speak, release to transcribe">
            <Dropdown
              label="Dictation hotkey"
              value={settings.hotkey}
              onChange={(v) => onSave({ hotkey: v })}
              options={hotkeys.map((h) => ({ value: h.value, label: h.label }))}
            />
          </Row>
          <div className="border-b border-white/[0.04] py-3">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[12.5px] text-white/85">Model</p>
              <Dropdown
                label="Whisper model"
                value={settings.modelSize}
                disabled={modelBusy}
                onChange={(value) => void api.loadModel(value)}
                options={modelSizes}
                wide
              />
            </div>
            {modelDescriptions[settings.modelSize] && (
              <p className="mt-2 max-w-[480px] text-[11px] text-white/40 leading-relaxed">
                {modelDescriptions[settings.modelSize]}
              </p>
            )}
            {modelStatus === "error" && (
              <button
                type="button"
                onClick={() => void api.loadModel(settings.modelSize)}
                className="mt-2 text-[11px] text-white/70 underline hover:text-white"
              >
                Retry model
              </button>
            )}
          </div>
          <Row
            label="Languages"
            sub="One language is fixed; multiple selections use automatic detection"
          >
            <button
              type="button"
              aria-label="Transcription languages"
              aria-haspopup="dialog"
              onClick={() => setLangOpen(true)}
              className="bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.07] rounded-lg px-3 py-1 text-[11.5px] text-white/80 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span className="truncate max-w-[140px]">{langLabel()}</span>
              <ChevronDown size={12} className="text-white/35" />
            </button>
          </Row>
        </SettingsGroup>
      </section>

      <LanguageModal
        isOpen={langOpen}
        languages={languages}
        selectedCodes={settings.selectedLanguages ?? []}
        onClose={() => setLangOpen(false)}
        onSave={(codes) => onSave({ selectedLanguages: codes })}
      />
    </div>
  );
}

function PermBadge({
  granted,
  onRequest,
}: {
  granted: boolean;
  onRequest: () => void;
}) {
  if (granted) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-400/90 font-medium">
        <ShieldCheck size={13} /> Granted
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onRequest}
      className="px-2.5 py-1 rounded-md bg-white/[0.07] hover:bg-white/[0.12] text-white/80 text-[11px] font-medium transition-colors cursor-pointer"
    >
      Grant
    </button>
  );
}

// ─────────────────────────────────────────────────────────
// Language Modal
// ─────────────────────────────────────────────────────────

function LanguageModal({
  isOpen,
  languages,
  selectedCodes,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  languages: Language[];
  selectedCodes: string[];
  onClose: () => void;
  onSave: (codes: string[]) => void;
}) {
  const [q, setQ] = useState("");
  if (!isOpen) return null;

  const isAuto = selectedCodes.length === 0;
  const filtered = languages.filter(
    (l) =>
      l.name.toLowerCase().includes(q.toLowerCase()) ||
      l.code.toLowerCase().includes(q.toLowerCase()),
  );

  const toggle = (code: string) => {
    const s = new Set(selectedCodes);
    s.has(code) ? s.delete(code) : s.add(code);
    onSave(Array.from(s));
  };

  const modalEl = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/35 animate-modal">
      <div className="fixed inset-0" onClick={onClose} />
      <div
        className="relative w-full max-w-[340px] bg-[#151518] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[440px] z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Head */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div>
            <p className="text-[13px] font-medium text-white/90">Languages</p>
            <p className="text-[10.5px] text-white/35 mt-0.5">
              {isAuto
                ? "Auto-detecting all"
                : `${selectedCodes.length} selected`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/35 hover:text-white/70 cursor-pointer p-1 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-white/[0.05]">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30"
            />
            <input
              type="text"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full bg-white/[0.05] border border-white/[0.07] rounded-md pl-7 pr-2 py-1 text-[11.5px] text-white/90 placeholder:text-white/25 outline-none focus:border-white/20"
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-1.5">
          {(!q || "auto".includes(q.toLowerCase())) && (
            <LangRow
              label="Auto Detect"
              sub="All languages"
              checked={isAuto}
              onClick={() => onSave([])}
            />
          )}
          {filtered.map((l) => (
            <LangRow
              key={l.code}
              label={l.name}
              checked={!isAuto && selectedCodes.includes(l.code)}
              onClick={() => toggle(l.code)}
            />
          ))}
          {filtered.length === 0 && q && (
            <p className="py-6 text-center text-[11px] text-white/25">
              No results
            </p>
          )}
        </div>

        {/* Foot */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-white/[0.06]">
          {!isAuto ? (
            <button
              type="button"
              onClick={() => onSave([])}
              className="text-[11px] text-white/30 hover:text-white/60 cursor-pointer transition-colors"
            >
              Reset to Auto
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-md bg-white/[0.1] hover:bg-white/[0.16] text-white/90 text-[11px] font-medium transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalEl, document.body);
}

function LangRow({
  label,
  sub,
  checked,
  onClick,
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md text-[11.5px] text-left transition-colors cursor-pointer ${
        checked
          ? "bg-white/[0.07] text-white"
          : "text-white/60 hover:bg-white/[0.03]"
      }`}
    >
      <span className="truncate">
        {label}
        {sub && <span className="text-white/30 ml-1.5">{sub}</span>}
      </span>
      <span
        className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
          checked ? "bg-white/90 border-white/90 text-black" : "border-white/15"
        }`}
      >
        {checked && <Check size={10} strokeWidth={3} />}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────
// Shared Primitives
// ─────────────────────────────────────────────────────────

function SectionHead({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3 className={`text-[11.5px] font-medium text-white/45 mb-2 ${className}`}>
      {children}
    </h3>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4">
      {children}
    </div>
  );
}

function AppIcon() {
  return (
    <div className="w-9 h-9 rounded-lg bg-white/[0.08] flex items-center justify-center shrink-0">
      <AppIconSvg className="w-6 h-6" />
    </div>
  );
}

function AppIconSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={className || "w-3.5 h-3.5"}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0 0 C1.02867187 0.89138672 1.02867187 0.89138672 2.078125 1.80078125 C2.82578125 2.40535156 3.5734375 3.00992188 4.34375 3.6328125 C22.25029465 18.58538635 31.84356613 42.04060459 34.078125 64.80078125 C34.35825116 69.89699178 34.36754845 74.99392776 34.33886719 80.09643555 C34.32811832 82.36469124 34.33884847 84.63215825 34.3515625 86.90039062 C34.36353865 98.57412593 33.06337439 109.66116013 30.140625 120.98828125 C29.82222656 122.23996094 29.50382812 123.49164063 29.17578125 124.78125 C27.00922523 132.84323105 24.51179136 140.68040727 21.390625 148.42578125 C21.04249756 149.29041992 20.69437012 150.15505859 20.33569336 151.04589844 C17.00190564 159.19332477 13.22504562 167.03950016 9.078125 174.80078125 C8.55847168 175.78208008 8.55847168 175.78208008 8.02832031 176.78320312 C-2.72609983 196.95389049 -16.44658782 215.52020234 -31.359375 232.8046875 C-33.67280913 235.50957161 -35.89649555 238.26372664 -38.109375 241.05078125 C-44.00456656 248.29344517 -50.52054934 254.96310332 -56.95654297 261.72216797 C-58.68230003 263.54739723 -60.38829679 265.38730055 -62.08203125 267.2421875 C-71.42080091 277.44846874 -81.23109161 287.17405403 -91.06152344 296.90356445 C-99.04224883 304.81054225 -99.04224883 304.81054225 -106.52563477 313.18579102 C-108.07779888 314.98113384 -109.72769136 316.63956604 -111.421875 318.30078125 C-115.13417753 321.96391421 -118.52646854 325.8448428 -121.921875 329.80078125 C-122.80542155 330.80909178 -123.68958266 331.81686399 -124.57421875 332.82421875 C-131.861906 341.16749055 -138.66519216 349.81274416 -145.31494141 358.67041016 C-146.88291528 360.74913091 -148.46799686 362.8135585 -150.05859375 364.875 C-156.48850802 373.25095731 -162.3208221 381.83622225 -167.76464844 390.88330078 C-168.85876643 392.69621274 -169.96941855 394.49769903 -171.0859375 396.296875 C-184.45136909 417.98486857 -196.44830707 440.60366842 -204.53515625 464.80859375 C-205.53838669 467.79050099 -206.68028851 470.68894166 -207.87890625 473.59765625 C-213.8806277 488.4670024 -217.24586342 504.34014133 -220.234375 520.05078125 C-220.47655762 521.30262207 -220.71874023 522.55446289 -220.96826172 523.84423828 C-224.13941174 541.19045129 -225.26303847 558.52478196 -225.18261719 576.14013672 C-225.1718503 578.9321854 -225.18262367 581.72359489 -225.1953125 584.515625 C-225.21418657 608.748206 -221.54066446 632.27358557 -215.921875 655.80078125 C-215.64980225 656.98438232 -215.37772949 658.1679834 -215.09741211 659.38745117 C-212.87250725 668.86016547 -209.9504624 677.80825231 -206.359375 686.86328125 C-206.09931671 687.52621185 -205.83925842 688.18914246 -205.57131958 688.87216187 C-187.79036651 734.11772808 -159.68904187 782.21292579 -113.921875 803.80078125 C-107.05801292 806.48278549 -100.26626589 808.22475059 -92.921875 808.80078125 C-94.22898437 808.23423828 -94.22898437 808.23423828 -95.5625 807.65625 C-111.1513647 800.45230495 -122.88772909 789.32080937 -129.9765625 773.4765625 C-133.59613819 763.23106933 -133.88679153 748.36345401 -129.921875 738.23828125 C-121.85404122 722.21560856 -110.40472535 713.07649556 -93.69140625 706.98828125 C-83.7807209 704.22785825 -70.64505027 704.53134228 -60.921875 707.80078125 C-59.90738281 708.13078125 -58.89289063 708.46078125 -57.84765625 708.80078125 C-41.42186587 714.60036345 -29.71378825 725.21695476 -21.921875 740.80078125 C-20.17288853 745.35170333 -18.98410582 750.04774842 -17.921875 754.80078125 C-17.72980469 755.62578125 -17.53773438 756.45078125 -17.33984375 757.30078125 C-14.36060262 775.12054127 -20.4768281 793.79726997 -29.921875 808.80078125 C-32.42771205 812.28649755 -35.10006676 815.56711145 -37.921875 818.80078125 C-38.44136719 819.41566406 -38.96085937 820.03054688 -39.49609375 820.6640625 C-47.51058536 829.44568429 -59.03726958 835.39384345 -69.921875 839.80078125 C-70.70691406 840.13980469 -71.49195313 840.47882812 -72.30078125 840.828125 C-98.11291601 850.40669662 -128.22860858 844.8539845 -152.5769043 833.92919922 C-171.22737032 825.25505467 -188.30901313 813.12286709 -203.921875 799.80078125 C-205.06470134 798.84326901 -206.20795576 797.88626754 -207.3515625 796.9296875 C-214.56579429 790.8600307 -221.35844874 784.57555218 -227.921875 777.80078125 C-230.42896982 775.27769221 -232.95035086 772.773082 -235.5 770.29296875 C-241.79111362 764.13062061 -247.50080026 757.75710436 -252.921875 750.80078125 C-253.41445801 750.17397461 -253.90704102 749.54716797 -254.41455078 748.90136719 C-279.81812503 716.51895888 -299.68292758 680.55965056 -310.921875 640.80078125 C-311.1276416 640.09099121 -311.3334082 639.38120117 -311.54541016 638.64990234 C-322.64035412 600.1153086 -325.50404747 558.55662071 -319.671875 518.86328125 C-319.56954559 518.16159821 -319.46721619 517.45991516 -319.36178589 516.73696899 C-317.84195407 506.5858121 -315.57099309 496.70895714 -312.921875 486.80078125 C-312.65842285 485.81247314 -312.3949707 484.82416504 -312.12353516 483.8059082 C-298.8275119 435.35780754 -272.14948864 392.82459631 -239.921875 354.80078125 C-239.36081055 354.13530273 -238.79974609 353.46982422 -238.22167969 352.78417969 C-231.88092499 345.28052395 -225.37409169 338.09642801 -218.3515625 331.2265625 C-215.59558791 328.47501874 -213.06062707 325.58730682 -210.52734375 322.6328125 C-206.07413708 317.55117277 -201.13554788 313.08514052 -196.0234375 308.68359375 C-193.73522389 306.63355851 -191.57926918 304.48783033 -189.421875 302.30078125 C-185.41436789 298.25245064 -181.25523437 294.49431575 -176.921875 290.80078125 C-175.42914063 289.50914062 -175.42914063 289.50914062 -173.90625 288.19140625 C-167.24912274 282.43827338 -160.52098299 276.77562039 -153.734375 271.17578125 C-153.00355713 270.5717749 -152.27273926 269.96776855 -151.51977539 269.34545898 C-150.83391357 268.78157471 -150.14805176 268.21769043 -149.44140625 267.63671875 C-148.83401611 267.1370459 -148.22662598 266.63737305 -147.60083008 266.12255859 C-146.09794599 264.93939523 -144.51336258 263.86177297 -142.921875 262.80078125 C-142.34401506 257.02218185 -143.5815797 251.57515235 -144.734375 245.92578125 C-145.10478291 244.03527689 -145.47456773 242.14465034 -145.84375 240.25390625 C-146.34744779 237.70360483 -146.85196449 235.15346882 -147.35742188 232.60351562 C-153.89290666 199.21076499 -155.5781106 164.74934732 -154.921875 130.80078125 C-154.90785645 129.9200293 -154.89383789 129.03927734 -154.87939453 128.13183594 C-154.0303507 85.64463215 -140.45823201 44.54199067 -111.921875 12.80078125 C-111.06722656 11.82044922 -111.06722656 11.82044922 -110.1953125 10.8203125 C-82.23040921 -19.36744207 -32.65146575 -27.27002047 0 0 Z"
        fill="#fff"
        transform="translate(541.921875,79.19921875)"
      />
      <path
        d="M 640.57 370.815 C 643.598 370.813 646.625 370.795 649.653 370.776 C 665.814 370.728 681.397 371.952 697.25 375.25 C 698.308 375.469 699.366 375.688 700.456 375.914 C 703.643 376.589 706.822 377.287 710 378 C 711.377 378.309 711.377 378.309 712.781 378.624 C 749.168 387.056 782.813 404.537 812.313 427.188 C 813.193 427.856 813.193 427.856 814.092 428.537 C 815.676 429.793 815.676 429.793 818 432 C 818 435.445 817.547 435.937 815.465 438.528 C 814.91 439.227 814.356 439.927 813.784 440.648 C 813.175 441.404 812.566 442.159 811.938 442.938 C 810.648 444.564 809.361 446.192 808.074 447.821 C 807.403 448.669 806.732 449.518 806.041 450.392 C 802.71 454.649 799.48 458.98 796.25 463.313 C 791.451 469.738 786.618 476.13 781.715 482.477 C 778.166 487.075 774.646 491.694 771.125 496.313 C 770.442 497.208 769.759 498.104 769.055 499.026 C 765.805 503.291 762.57 507.566 759.375 511.871 C 758.823 512.614 758.271 513.357 757.703 514.122 C 756.675 515.509 755.65 516.898 754.63 518.291 C 751.22 522.89 751.22 522.89 749 524 C 748.615 522.382 748.615 522.382 748.223 520.731 C 741.525 493.964 727.351 468.951 703.454 454.044 C 696.618 450.005 689.368 446.922 682 444 C 681.192 443.673 680.384 443.345 679.551 443.008 C 667.026 438.38 653.77 437.47 640.563 437.625 C 639.842 437.63 639.121 437.635 638.378 437.64 C 627.676 437.727 617.359 438.066 607 441 C 606.214 441.215 605.428 441.431 604.617 441.652 C 586.412 446.778 568.672 454.925 554 467 C 553.486 467.418 552.971 467.835 552.441 468.265 C 520.169 494.515 499.848 530.202 492 571 C 491.719 572.257 491.438 573.514 491.149 574.809 C 484.737 605.901 488.074 641.092 498 671 C 498.251 671.758 498.503 672.516 498.761 673.297 C 513.419 716.669 539.301 752.869 580.832 773.586 C 587.064 776.574 593.28 778.85 599.988 780.497 C 601.337 780.835 602.68 781.196 604.016 781.581 C 635.328 790.586 673.925 786.302 704 775 C 704.756 774.723 705.513 774.447 706.292 774.161 C 724.586 767.407 741.547 758.948 757 747 C 757.905 746.318 758.81 745.636 759.742 744.934 C 772.902 734.644 784.197 722.471 794 709 C 796.141 706.137 796.141 706.137 798 704 C 798.66 704 799.32 704 800 704 C 800.934 737.118 778.446 774.46 762 802 C 761.24 803.275 761.24 803.275 760.465 804.575 C 753.391 816.329 745.525 827.262 737 838 C 736.282 838.921 735.564 839.841 734.824 840.789 C 732.913 843.219 730.966 845.614 729 848 C 728.18 849.006 727.36 850.011 726.516 851.047 C 714.727 865.282 701.644 878.702 687 890 C 685.29 891.436 683.582 892.873 681.875 894.313 C 652.184 918.469 616.769 936.561 579.625 945.75 C 578.492 946.032 577.358 946.314 576.191 946.605 C 557.193 951.087 538.551 952.548 519.063 952.438 C 517.95 952.435 516.838 952.433 515.692 952.431 C 488.388 952.34 462.096 949.464 436 941 C 436 940.67 436 940.34 436 940 C 437.175 939.963 438.349 939.926 439.559 939.887 C 469.036 938.761 497.782 931.345 519.813 910.625 C 520.904 909.443 521.964 908.232 523 907 C 523.716 906.152 524.431 905.304 525.168 904.43 C 539.937 885.876 546.203 863.533 544 840 C 541.914 824.096 533.646 809.68 523 798 C 522.111 796.993 521.223 795.985 520.336 794.977 C 512.225 785.848 503.278 777.998 493.797 770.325 C 489.937 767.117 486.249 763.736 482.555 760.34 C 480.373 758.342 478.17 756.379 475.938 754.438 C 472.136 751.131 468.385 747.771 464.649 744.391 C 462.828 742.747 460.999 741.112 459.164 739.485 C 454.319 735.157 449.772 730.816 445.594 725.84 C 444.06 724.07 442.451 722.484 440.75 720.875 C 435.239 715.439 430.662 709.16 426 703 C 425.568 702.434 425.135 701.868 424.69 701.284 C 417.442 691.733 411.531 681.626 406 671 C 405.642 670.322 405.283 669.643 404.914 668.944 C 383.16 627.275 378.6 577.154 392.443 532.304 C 401.769 503.977 418.103 478.069 438 456 C 438.498 455.442 438.996 454.884 439.508 454.309 C 445.334 447.794 451.236 441.558 458 436 C 458.879 435.245 459.758 434.49 460.664 433.711 C 498.515 401.453 545.791 382.441 594.5 374.25 C 595.752 374.039 597.005 373.828 598.295 373.611 C 612.443 371.319 626.264 370.814 640.57 370.815 Z"
        fill="#fff"
      />
    </svg>
  );
}

function StartupLoadingScreen({
  progress,
  isFadingOut,
}: {
  progress: number;
  isFadingOut: boolean;
}) {
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#101012] text-white select-none transition-opacity duration-300 ease-out ${
        isFadingOut ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      {/* Top drag region for macOS window */}
      <div className="absolute top-0 left-0 right-0 h-12 drag-region" />

      <div className="flex flex-col items-center gap-5">
        {/* Clean monochrome app icon */}
        <div className="w-13 h-13 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <AppIconSvg className="w-6 h-6 fill-white" />
        </div>

        {/* Title */}
        <div className="text-center">
          <h1 className="text-[14.5px] font-semibold tracking-tight text-white/90">
            {appConfig.name}
          </h1>
        </div>

        {/* Minimal Progress Bar */}
        <div className="w-[160px] h-[3px] rounded-full bg-white/[0.07] overflow-hidden p-[0.5px] mt-1">
          <div
            className="h-full rounded-full bg-white/70 transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.04] last:border-0 gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-white/85">{label}</p>
        {sub && (
          <p className="text-[11px] text-white/30 mt-0.5 truncate">{sub}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-[30px] h-[18px] rounded-full transition-colors cursor-pointer ${
        checked ? "bg-white/70" : "bg-white/15"
      }`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full transition-transform ${
          checked ? "translate-x-[12px] bg-[#101012]" : "bg-white/60"
        }`}
      />
    </button>
  );
}

function Dropdown({
  value,
  onChange,
  options,
  label,
  disabled = false,
  wide = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-white/[0.04] border border-white/[0.07] rounded-lg px-2.5 py-1 text-[11.5px] text-white/80 outline-none cursor-pointer transition-colors hover:border-white/15 focus-visible:border-white/30 disabled:opacity-40 disabled:cursor-not-allowed ${wide ? "max-w-[260px]" : "max-w-[160px]"}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
