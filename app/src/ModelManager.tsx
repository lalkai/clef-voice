import { useRef, useState } from "react";
import { Download, Trash2, Check, Loader2, ChevronDown } from "lucide-react";
import type { ModelInventory, ModelItem } from "./types";
import * as api from "./lib/api";
import { modelDescriptions } from "./lib/models";
import { useAppStore } from "./lib/store";

export function formatModelBytes(bytes: number) {
  if (bytes < 0) return "";
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(2)} GB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}
const labels: Record<ModelItem["status"], string> = {
  unverified: "Not yet verified", checking: "Verifying…", not_downloaded: "Not downloaded", downloading: "Downloading",
  downloaded: "Downloaded", loading: "Loading…", failed: "Failed",
};
const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/70 hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors";

export default function ModelManager({ inventory, onDownload, compact = false }: { inventory: ModelInventory; onDownload?: (id: string) => Promise<unknown>; compact?: boolean }) {
  const status = useAppStore((s) => s.status);
  const busy = inventory.connected === false || inventory.busy || status === "recording" || status === "transcribing";
  const [requestError, setRequestError] = useState<{ modelID: string; message: string } | null>(null);
  const inFlight = useRef(false);
  const [requestPending, setRequestPending] = useState(false);
  const action = async (modelID: string, request: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRequestPending(true);
    setRequestError(null);
    try { await request(); } catch (error) { setRequestError({ modelID, message: error instanceof Error ? error.message : "Could not reach the engine. Please retry." }); }
    finally { inFlight.current = false; setRequestPending(false); }
  };
  return <div>
    {inventory.items.length === 0 && <p className="py-4 text-[12px] text-white/40">Checking available models…</p>}
    {inventory.items.map((model) => {
      const rowError = model.error || (requestError?.modelID === model.id ? requestError.message : "");
      const pending = ["checking", "downloading", "loading"].includes(model.status);
      const progress = Math.max(0, Math.min(1, model.progress));
      return <div key={model.id} className={`model-row py-4 border-b border-white/[0.06] last:border-0 ${model.active ? "model-row-selected" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[180px] flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[13px] font-medium text-white/85">{model.name}</h3>
              <span className="text-[10.5px] text-white/35">{model.sizeLabel}</span>
              {model.active && <span className="flex items-center gap-1 text-[10px] text-[#c5bedc]"><Check size={11} />{compact ? "Selected" : "Active"}</span>}
            </div>
            <p className="mt-1 max-w-[520px] text-[12px] text-white/45 leading-relaxed">{modelDescriptions[model.id]}</p>
            {!compact && <p className="mt-1.5 text-[10px] text-white/40">{model.languageLabel}<span className="mx-1.5 text-white/15">·</span><span title={model.quantization === "F16" ? "Unquantized model weights" : "Quantized model weights"}>{model.quantization}</span></p>}
            {compact && <details className="mt-2 group/model-details">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] text-white/35 hover:text-white/65 [&::-webkit-details-marker]:hidden">Details <ChevronDown size={11} className="transition-transform group-open/model-details:rotate-180" /></summary>
              <p className="mt-1 text-[11px] text-white/45">{model.languageLabel}<span className="mx-1.5 text-white/20">·</span>{model.quantization === "F16" ? "Full precision" : `${model.quantization} quantized`}</p>
            </details>}
            {(pending || (model.status === "failed" && !rowError)) && <div role="status" className={`mt-2 flex items-center gap-1.5 text-[10.5px] ${model.status === "failed" ? "text-amber-300/80" : "text-white/45"}`}>
              {pending && <Loader2 size={11} className="animate-spin" />}
              {labels[model.status]}{model.status === "downloading" && model.totalBytes > 0 && ` ${Math.round(progress * 100)}%`}
            </div>}
          </div>
          <div className="flex shrink-0 gap-2 pt-0.5">
            {inventory.cancelable && inventory.operationModel === model.id && <button className={buttonClass} onClick={() => void api.cancelDownload().catch((error) => setRequestError({ modelID: model.id, message: error instanceof Error ? error.message : "Could not cancel the download. Please retry." }))}>Cancel</button>}
            {!model.downloaded && model.status !== "unverified" && <button type="button" className={onDownload ? "app-primary-button gap-1.5 px-3 py-2" : buttonClass} disabled={busy || pending || requestPending} onClick={() => void action(model.id, () => onDownload ? onDownload(model.id) : api.downloadModel(model.id))} aria-label={`Download ${model.name}`}>
              <Download size={12} />{model.status === "failed" ? "Retry" : onDownload ? "Download & use" : "Download"}
            </button>}
            {(model.downloaded || model.status === "unverified") && !model.active && <button type="button" className="app-primary-button gap-1.5 px-3 py-2" disabled={busy || pending || requestPending} onClick={() => void action(model.id, () => api.loadModel(model.id))}>
              {model.status === "failed" ? "Retry use" : "Use model"}
            </button>}
            {model.present && <button type="button" className={buttonClass} disabled={busy || pending || requestPending} title={`Delete ${model.name}`} aria-label={`Delete ${model.name}`} onClick={() => void action(model.id, () => api.deleteModel(model.id))}><Trash2 size={12} /></button>}
          </div>
        </div>
        {model.status === "downloading" && <div className="mt-3">
          {model.totalBytes > 0 ? <div role="progressbar" aria-label={`Downloading ${model.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="h-1 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full bg-[#a9a2c4] transition-all" style={{ width: `${progress * 100}%` }} /></div> : <div className="h-1 rounded-full bg-white/[0.06] animate-pulse" />}
          <p className="mt-1.5 text-[10px] text-white/35">{formatModelBytes(model.receivedBytes)}{model.totalBytes > 0 && ` / ${formatModelBytes(model.totalBytes)}`}</p>
        </div>}
        {rowError && <p role="alert" className="mt-2 text-[11px] text-amber-300/75 leading-relaxed">{rowError}</p>}
      </div>;
    })}
  </div>;
}
