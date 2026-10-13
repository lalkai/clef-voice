import { useEffect, useRef, useState } from "react";
import { Check, ArrowLeft, ArrowRight, Mic, ShieldCheck, RefreshCw, Loader2 } from "lucide-react";
import type { ModelInventory, PermissionsPayload } from "./types";
import ModelsView from "./ModelsView";
import BrandIcon from "./BrandIcon";
import { useAppStore } from "./lib/store";
import * as api from "./lib/api";
import { appConfig } from "./lib/appConfig.generated";

const secondaryButton = "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-white/50 hover:bg-white/[0.04] hover:text-white/80 disabled:opacity-35 disabled:cursor-not-allowed transition-colors";
const primaryButton = "app-primary-button setup-primary-button gap-2 px-4 py-2.5";

export default function FirstRunSetup({ permissions, inventory, onRecheck, onComplete }: {
  permissions: PermissionsPayload;
  inventory: ModelInventory;
  onRecheck: () => Promise<void>;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [requestedModel, setRequestedModel] = useState<string | null>(null);
  const operation = useRef(0);
  const generation = useRef(inventory.generation);
  useEffect(() => () => { operation.current++; }, []);
  const locked = pending !== null || requestedModel !== null;
  const status = useAppStore((s) => s.status);
  const statusMessage = useAppStore((s) => s.message);
  const modelErrorShown = step === 2 && inventory.connected !== false && !!statusMessage && inventory.items.some((model) => model.error === statusMessage);
  const permissionsReady = permissions.microphone && permissions.accessibility;
  const activeModel = inventory.items.find((model) => model.active && model.downloaded && model.status === "downloaded");
  const ready = permissionsReady && !!activeModel && !inventory.busy && status === "idle";
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void onRecheck().catch(() => setError("Could not check permissions. Please try again.")); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [onRecheck]);

  useEffect(() => {
    if (inventory.generation !== generation.current || inventory.connected === false) {
      generation.current = inventory.generation;
      operation.current++;
      setRequestedModel(null);
      setPending(null);
      setError("Engine connection changed. Please retry.");
    }
  }, [inventory.generation, inventory.connected]);

  const downloadAndUse = async (id: string) => {
    const token = ++operation.current;
    setError("");
    setRequestedModel(id);
    try {
      await api.downloadModel(id);
      if (operation.current !== token) return;
      await api.loadModel(id);
    } finally {
      if (operation.current === token) setRequestedModel(null);
    }
  };

  const perform = async (name: string, task: () => Promise<unknown>) => {
    setPending(name);
    setError("");
    try { await task(); }
    catch { setError("Could not complete this step. Please try again."); }
    finally { setPending(null); }
  };
  const finish = () => perform("finish", async () => {
    const token = operation.current;
    const completed = await api.completeSetup();
    if (operation.current !== token) return;
    if (completed !== true) {
      await onRecheck();
      setError("Check your permissions and wait for an active model before continuing.");
      return;
    }
    onComplete();
  });

  return <div className="flex h-full flex-col overflow-hidden bg-[#101012] text-[#d4d4d8] antialiased">
    <header className="shrink-0 border-b border-white/[0.06] px-6 pt-9 pb-5 sm:px-8">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3"><BrandIcon /><div><p className="text-[13px] font-semibold tracking-tight text-white/90">{appConfig.name}</p><p className="mt-0.5 text-[10px] text-white/35 tabular-nums">v{appConfig.version}</p></div></div>
        <nav aria-label="Setup progress" className="flex items-center gap-3 text-[11px]">
          {[{ number: 1, label: "Permissions" }, { number: 2, label: "Model" }].map((item) => <div key={item.number} aria-current={step === item.number ? "step" : undefined} className={`flex items-center gap-2 ${step === item.number ? "text-white/80" : "text-white/30"}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${step === item.number ? "border-violet-200/30 bg-violet-200/10 text-violet-100" : "border-white/10"}`}>{item.number === 1 && step === 2 ? <Check size={11} /> : item.number}</span><span>{item.label}</span>
          </div>)}
        </nav>
      </div>
    </header>
    <main className="min-h-0 flex flex-1 flex-col overflow-y-auto px-6 py-7 sm:px-8">
      <div key={step} className="setup-step mx-auto w-full max-w-2xl">
        <h1 className="text-[22px] font-semibold tracking-tight text-white/90">{step === 1 ? "Welcome to ClefVoice" : "Choose a model"}</h1>
        <p className="mt-2 mb-6 max-w-[570px] text-[13px] leading-relaxed text-white/45">{step === 1 ? "Two quick steps to start dictating on your Mac." : "Choose one to download and use. You can change models any time."}</p>
        {step === 1 ? <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11.5px] font-medium text-white/45">Permissions</span>
            <button type="button" className="inline-flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/70 disabled:opacity-35" disabled={locked} onClick={() => void perform("check", onRecheck)}>
              <RefreshCw size={12} className={pending === "check" ? "animate-spin" : ""} /> Check permissions
            </button>
          </div>
          <div className="app-panel divide-y divide-white/[0.06] px-4">
            {[
              { id: "microphone", label: "Microphone", description: "Record your voice when you choose.", icon: Mic, granted: permissions.microphone, request: api.requestMicrophone },
              { id: "accessibility", label: "Accessibility", description: "Use your shortcut and insert text into other apps.", icon: ShieldCheck, granted: permissions.accessibility, request: api.requestAccessibility },
            ].map((permission) => <div key={permission.id} className="flex flex-wrap items-center gap-3 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]"><permission.icon size={19} strokeWidth={1.6} className="text-white/60" /></div>
              <div className="min-w-[160px] flex-1"><h2 className="text-[14px] font-medium text-white/85">{permission.label}</h2><p className="mt-1 text-[12px] leading-relaxed text-white/40">{permission.description}</p></div>
              {permission.granted ? <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-emerald-300/75"><Check size={13} /> Granted</span> : <button aria-label={`Grant ${permission.label} access`} className="shrink-0 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3.5 py-2 text-[12px] text-white/80 hover:bg-white/[0.09] disabled:opacity-35 transition-colors" disabled={locked} onClick={() => void perform(permission.id, permission.request)}>{pending === permission.id ? <Loader2 size={14} className="animate-spin" /> : "Grant access"}</button>}
            </div>)}
          </div>
          <p className="mt-4 text-[11.5px] leading-relaxed text-white/35">If macOS opens System Settings, enable ClefVoice and come back here.</p>
          <div className="mt-8 flex items-center gap-2 text-[11.5px] text-white/35"><ShieldCheck size={14} strokeWidth={1.6} /><p>Speech processing stays on your Mac. No account required.</p></div>
        </> : <>
          {!permissionsReady && <p role="alert" className="mb-4 text-[11.5px] text-amber-200/80">Go back to review your permissions before finishing setup.</p>}
          <ModelsView inventory={{ ...inventory, busy: inventory.busy || requestedModel !== null }} showHeader={false} onDownload={downloadAndUse} compact />
        </>}
      </div>
    </main>
    <footer className="shrink-0 px-6 pb-5 sm:px-8">
      <div className="mx-auto w-full max-w-2xl border-t border-white/[0.06] pt-4">
        {(error || (status === "error" && !modelErrorShown)) && <p role="alert" className="mb-3 text-[12px] text-amber-200/80">{error || statusMessage || "The engine could not prepare the model. Please retry or choose another model."}</p>}
        {inventory.connected === false && <button className={secondaryButton} onClick={() => void perform("retry", api.retryEngine)}>Retry engine</button>}
        <div className="flex min-h-10 items-center justify-between gap-4">
          <div>
            {step === 2 ? <button type="button" className={secondaryButton} disabled={locked} onClick={() => { setError(""); setStep(1); }}><ArrowLeft size={13} /> Back</button> : null}
          </div>
          {step === 1 ? <button type="button" className={primaryButton} disabled={!permissionsReady || locked} onClick={() => { setError(""); setStep(2); }}>Continue <ArrowRight size={13} /></button>
            : <button type="button" className={primaryButton} disabled={!ready || locked} onClick={() => void finish()}>{pending === "finish" ? "Finishing…" : "Finish setup"}<ArrowRight size={13} /></button>}
        </div>
      </div>
    </footer>
  </div>;
}
