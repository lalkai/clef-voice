import { normalizeVocabulary, vocabularyError } from "./lib/vocabulary";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LayoutDashboard,
  Cpu,
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
import ModelsView from "./ModelsView";
import FirstRunSetup from "./FirstRunSetup";
import BrandIcon from "./BrandIcon";
import { modelLanguageSelection } from "./lib/modelLanguages";
import { audioOptionValue } from "./lib/audioSettings";
import { appConfig } from "./lib/appConfig.generated";
import type {
  HistoryItem,
  ModelInventory,
  Language,
  PermissionsPayload,
  Settings,
} from "./types";

type TabId = "dashboard" | "history" | "vocabulary" | "audio" | "models" | "preferences";
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
  const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);
  const [startupError, setStartupError] = useState("");
  const settingsRevision = useRef(0);
  const settingsMutationRevision = useRef(0);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [models, setModels] = useState<ModelInventory>({ items: [], busy: true });
  const modelsRevision = useRef(0);
  const permissionsRevision = useRef(0);
  const historyRevision = useRef(0);
  const statsRevision = useRef(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [permissions, setPermissions] =
    useState<PermissionsPayload>(emptyPermissions);
  const [selectedTab, setSelectedTab] = useState<TabId>("dashboard");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [notice, setNotice] = useState<{ message: string; text?: string }>({ message: "" });
  const copyRevision = useRef(0);

  const [stats, setStats] = useState<import("./types").Stats | null>(null);

  const appStatus = useAppStore((s) => s.status);
  const statusMessage = useAppStore((s) => s.message);

  const [isReady, setIsReady] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [progress, setProgress] = useState(15);

  const refreshData = async () => {
    try {
      setStartupError("");
      const statusRevision = useAppStore.getState().statusRevision;
      const settingsSnapshotRevision = settingsRevision.current;
      const modelsSnapshotRevision = modelsRevision.current;
      const permissionsSnapshotRevision = permissionsRevision.current;
      const [s, l, m, p, state, setup] = await Promise.all([
        api.getSettings(),
        api.getLanguages(),
        api.getModels(),
        api.checkPermissions(),
        api.getState(),
        api.getSetupState(),
      ]);
      if (!s || !setup) throw new Error("Startup state is unavailable");
      setSetupCompleted(setup.completed);

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
          customVocabulary: s.customVocabulary ?? [...appConfig.settingsDefaults.customVocabulary],
        });
      }
      setLanguages(l ?? []);
      if (m && modelsRevision.current === modelsSnapshotRevision) setModels(m);
      if (permissionsRevision.current === permissionsSnapshotRevision) setPermissions(p ?? emptyPermissions);
      const historySnapshotRevision = historyRevision.current;
      const statsSnapshotRevision = statsRevision.current;
      const [items, summary] = await Promise.all([
        api.getHistory(),
        api.getStats(),
      ]);
      if (items && historyRevision.current === historySnapshotRevision) setHistory(items);
      if (summary && statsRevision.current === statsSnapshotRevision) setStats(summary);
    } catch (e) {
      console.error("Failed to load data:", e);
      setStartupError("Could not load the app. Please try again.");
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

    const handleHistory = (e: any) => { historyRevision.current += 1; setHistory(e.detail); };
    const handleStats = (e: any) => { statsRevision.current += 1; setStats(e.detail); };
    const handleSettings = (e: any) => {
      settingsRevision.current += 1;
      setSettings(e.detail);
    };
    const handleModels = (e: CustomEvent<ModelInventory>) => {
      modelsRevision.current += 1;
      setModels(e.detail);
    };
    const handlePermissions = (e: any) => { permissionsRevision.current += 1; setPermissions(e.detail); };
    const handleNavigateTab = (e: any) => {
      const tab = e.detail?.tab;
      if (tab) setSelectedTab(tab);
    };

    const handleNotice = (event: Event) => setNotice((event as CustomEvent).detail);
    window.addEventListener("clefVoice:notice", handleNotice);
    window.addEventListener("clefVoice:history", handleHistory);
    window.addEventListener("clefVoice:stats", handleStats);
    window.addEventListener("clefVoice:settings", handleSettings);
    window.addEventListener("clefVoice:models", handleModels as EventListener);
    window.addEventListener("clefVoice:permissions", handlePermissions);
    window.addEventListener("clefVoice:navigateTab", handleNavigateTab);

    return () => {
      isMounted = false;
      window.removeEventListener("clefVoice:notice", handleNotice);
      window.removeEventListener("clefVoice:history", handleHistory);
      window.removeEventListener("clefVoice:stats", handleStats);
      window.removeEventListener("clefVoice:settings", handleSettings);
      window.removeEventListener("clefVoice:models", handleModels as EventListener);
      window.removeEventListener("clefVoice:permissions", handlePermissions);
      window.removeEventListener("clefVoice:navigateTab", handleNavigateTab);
    };
  }, []);

  const recheckPermissions = useCallback(async () => {
    const revision = permissionsRevision.current;
    const current = await api.checkPermissions();
    if (current && permissionsRevision.current === revision) {
      permissionsRevision.current += 1;
      setPermissions(current);
    }
  }, []);

  const saveSettings = (patch: Partial<Settings>) => {
    if (!settings) return;
    const mutation = ++settingsMutationRevision.current;
    settingsRevision.current += 1;
    setSettings(current => current ? { ...current, ...patch } : current);
    setSettingsError("");
    void api.updateSettings(patch).catch(async (error) => {
      if (settingsMutationRevision.current !== mutation) return;
      setSettingsError(error instanceof Error ? error.message : "Could not save settings. Please retry.");
      const snapshotRevision = settingsRevision.current;
      try {
        const current = await api.getSettings();
        if (current && settingsMutationRevision.current === mutation && settingsRevision.current === snapshotRevision) {
          settingsRevision.current += 1;
          setSettings(current);
        }
      } catch {
        if (settingsMutationRevision.current === mutation) setSettingsError("Could not reconnect to settings. Retry when the engine is available.");
      }
    });
  };

  if (startupError && (!settings || setupCompleted === null)) {
    return <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#101012] text-white/70">
      <p role="alert">{startupError}</p>
      <button onClick={() => void refreshData()} className="rounded-lg border border-white/10 px-4 py-2">Retry</button>
    </div>;
  }
  if (!settings || setupCompleted === null) {
    return <StartupLoadingScreen progress={progress} isFadingOut={false} />;
  }
  if (!setupCompleted) {
    return <FirstRunSetup permissions={permissions} inventory={models}
      onComplete={() => setSetupCompleted(true)} onRecheck={recheckPermissions} />;
  }

  const missingPermission = !permissions.microphone
    ? "Microphone access needed"
    : !permissions.accessibility
      ? "Accessibility access needed"
      : null;
  const hasActiveModel = models.items.some((model) => model.active && model.downloaded && model.status === "downloaded");
  const footerMessage =
    appStatus === "idle" && missingPermission
      ? missingPermission
      : appStatus === "idle" && !hasActiveModel
        ? "Choose a model"
      : appStatus === "error" ? statusMessage
        : appStatus === "recording" ? "Recording"
        : appStatus === "transcribing" ? "Transcribing"
        : appStatus === "downloading" ? "Downloading model"
        : appStatus === "loading" ? "Preparing model"
        : "";
  const copyItem = async (id: string, text: string) => {
    const revision = ++copyRevision.current;
    setCopyError("");
    setCopiedId(null);
    try {
      await api.copyText(text);
      if (copyRevision.current !== revision) return;
      setCopiedId(id);
      setTimeout(() => {
        if (copyRevision.current === revision) setCopiedId(null);
      }, 1400);
    } catch {
      if (copyRevision.current === revision) {
        setCopyError("Could not copy text. Please try again.");
      }
    }
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
      id: "models",
      label: "Models",
      icon: <Cpu size={14} strokeWidth={1.8} />,
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
              <BrandIcon />
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
        <div role="status" aria-label={footerMessage || "Engine ready"} className="px-5 flex items-center gap-2 text-[11px] text-white/35">
          <span
            className={`w-[5px] h-[5px] rounded-full ${appStatus === "recording" ? "bg-red-400 animate-pulse" : appStatus === "idle" && !missingPermission && hasActiveModel ? "bg-emerald-500/80" : "bg-amber-400 animate-pulse"}`}
          />
          {appStatus === "idle" && (missingPermission || !hasActiveModel) ? (
            <button
              type="button"
              onClick={() => setSelectedTab(missingPermission ? "preferences" : "models")}
              className="truncate text-left hover:text-white/70 transition-colors"
              title={missingPermission ? `${footerMessage}. Open Preferences to grant access.` : "Open Models to download or use a model."}
            >
              {footerMessage}
            </button>
          ) : footerMessage ? (
            <span className="truncate" title={footerMessage}>
              {footerMessage}
            </span>
          ) : null}
          {models.connected === false && <button onClick={() => void api.retryEngine().catch((error) => setNotice({ message: String(error) }))} className="shrink-0 text-white/60 hover:text-white">Retry</button>}
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

            {notice.message && <div role="alert" className="mb-3 flex items-center gap-3 text-[11.5px] text-amber-200">
              <span>{notice.message}</span>
              {notice.text && <button onClick={() => void api.copyText(notice.text!).then(() => setNotice({ message: "" })).catch((error) => setCopyError(String(error)))}>Copy latest</button>}
              <button onClick={() => setNotice({ message: "" })}>Dismiss</button>
            </div>}
            {settingsError && (selectedTab === "preferences" || selectedTab === "audio" || selectedTab === "vocabulary") && <p role="alert" className="mb-3 text-[11.5px] text-amber-200">{settingsError}</p>}
            {copyError && (selectedTab === "dashboard" || selectedTab === "history") && (
              <p role="alert" className="mb-3 text-[11.5px] text-amber-200">{copyError}</p>
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
                  setNotice({ message: "" });
                  void api.setHistoryFavorite(id, favorite).catch((error) => setNotice({ message: String(error) }));
                }}
                onDelete={(id) => {
                  setNotice({ message: "" });
                  void api.deleteHistoryItem(id).catch((error) => setNotice({ message: String(error) }));
                }}
                onClear={() => {
                  setNotice({ message: "" });
                  void api.clearHistory().catch((error) => setNotice({ message: String(error) }));
                }}
              />
            )}
            {selectedTab === "vocabulary" && (
              <VocabularyView settings={settings} onSave={saveSettings} />
            )}
            {selectedTab === "models" && <ModelsView inventory={models} />}
            {selectedTab === "audio" && (
              <VoiceAudioView settings={settings} onSave={saveSettings} />
            )}
            {selectedTab === "preferences" && (
              <PreferencesView
                settings={settings}
                languages={languages}
                inventory={models}
                permissions={permissions}
                onSave={saveSettings}
                onRecheck={() => void recheckPermissions()}
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
  const [wordError, setWordError] = useState("");

  const addWord = () => {
    const w = word.trim();
    if (!w || settings.customVocabulary.includes(w)) return;
    const words = normalizeVocabulary([...settings.customVocabulary, w]);
    const error = vocabularyError(words);
    setWordError(error);
    if (error) return;
    onSave({ customVocabulary: words });
    setWord("");
  };

  return (
    <div className="space-y-8">
      {vocabularyError(settings.customVocabulary) && <div role="alert" className="text-[11.5px] text-amber-200">
        {vocabularyError(settings.customVocabulary)} Existing vocabulary is preserved, but only hints within the limit are used. <button className="underline" onClick={() => onSave({ customVocabulary: [] })}>Clear custom words</button>
      </div>}
      {wordError && <p role="alert" className="text-[11.5px] text-amber-200">{wordError}</p>}
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
  inventory,
  permissions,
  onSave,
  onRecheck,
}: {
  settings: Settings;
  languages: Language[];
  inventory: ModelInventory;
  permissions: PermissionsPayload;
  onSave: (p: Partial<Settings>) => void;
  onRecheck: () => void;
}) {
  const status = useAppStore((s) => s.status);
  const dictationBusy = status === "recording" || status === "transcribing";
  const [isRecordingShortcut, setRecordingShortcut] = useState(false);
  const [shortcutError, setShortcutError] = useState("");
  const recordShortcut = async () => {
    setRecordingShortcut(true);
    setShortcutError("");
    try {
      const shortcut = await api.recordHotkey();
      if (shortcut?.value) {
        onSave({ hotkey: shortcut.value, hotkeyLabel: shortcut.label });
      }
    } catch {
      setShortcutError("Could not record the shortcut. Please try again.");
    } finally { setRecordingShortcut(false); }
  };
  const [langOpen, setLangOpen] = useState(false);

  const activeModel = inventory.items.find((model) => model.active && model.downloaded);
  const languageSelection = modelLanguageSelection(activeModel, languages, settings.selectedLanguages ?? []);
  const langLabel = () => {
    if (!activeModel) return "Choose a model first";
    const list = languageSelection.selected;
    if (list.length === 0) return "Auto Detect";
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
        </SettingsGroup>
      </section>

      {/* Engine */}
      <section>
        <SectionHead>Engine</SectionHead>
        <SettingsGroup>
          <Row label="Hotkey" sub="Hold to speak, release to transcribe">
            <div className="flex items-center gap-2">
              <kbd aria-label="Current dictation shortcut" className="rounded-md border border-white/[0.09] bg-white/[0.03] px-2.5 py-1 text-[11.5px] font-sans text-white/80">
                {settings.hotkeyLabel || settings.hotkey}
              </kbd>
            <button type="button" disabled={isRecordingShortcut || dictationBusy || !window.clefVoice} title={!window.clefVoice ? "Shortcut recording is available in the macOS app" : dictationBusy ? "Finish dictation before changing your shortcut" : "Press keys to choose your shortcut"} onClick={() => void recordShortcut()} className="rounded-lg border border-white/[0.07] bg-white/[0.04] px-3 py-1 text-[11.5px] text-white/70 hover:bg-white/[0.07] disabled:opacity-35">{isRecordingShortcut ? "Listening…" : "Record shortcut"}</button>
            </div>
          </Row>
          {shortcutError && <p role="alert" className="px-4 py-2 text-[11.5px] text-amber-200">{shortcutError}</p>}
          <Row
            label="Languages"
            sub={languageSelection.fixed ? `${activeModel?.name} uses ${langLabel()}` : "One language is fixed; multiple selections use automatic detection"}
          >
            <button
              type="button"
              aria-label="Transcription languages"
              aria-haspopup="dialog"
              disabled={!activeModel || languageSelection.fixed}
              onClick={() => setLangOpen(true)}
              className="bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.07] rounded-lg px-3 py-1 text-[11.5px] text-white/80 flex items-center gap-1.5 cursor-pointer transition-colors disabled:cursor-default disabled:opacity-60"
            >
              <span className="truncate max-w-[140px]">{langLabel()}</span>
              {!languageSelection.fixed && activeModel && <ChevronDown size={12} className="text-white/35" />}
            </button>
          </Row>
        </SettingsGroup>
      </section>

      <LanguageModal
        isOpen={langOpen && !!activeModel && !languageSelection.fixed}
        languages={languageSelection.available}
        selectedCodes={languageSelection.selected}
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
                ? "Automatic language detection"
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
              sub="Detect the spoken language automatically"
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

        <p className="px-4 py-2 text-[10.5px] leading-relaxed text-white/40">Multiple selections use automatic detection. Whisper does not limit detection to the selected languages.</p>
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
        <BrandIcon />

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
