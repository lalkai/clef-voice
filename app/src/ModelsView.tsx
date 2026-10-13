import * as api from "./lib/api";
import { useState } from "react";
import { Search, ChevronDown } from "lucide-react";
import type { ModelInventory, ModelItem } from "./types";
import ModelManager from "./ModelManager";
import { modelDescriptions } from "./lib/models";
import { filterModels, isLocalModel, sortLocalModels, type LanguageFilter } from "./lib/modelFilters";

const groups: { id: ModelItem["group"]; title: string; subtitle: string }[] = [
  { id: "general", title: "Multilingual", subtitle: "Recognition across multiple languages" },
  { id: "english", title: "English only", subtitle: "For dictation in English" },
  { id: "specialized", title: "Specialized", subtitle: "Models tuned for specific languages" },
  { id: "legacy", title: "Earlier versions", subtitle: "Older Whisper models" },
];
const panel = "app-panel px-4";
export default function ModelsView({ inventory, showHeader = true, onDownload, compact = false }: { inventory: ModelInventory; showHeader?: boolean; onDownload?: (id: string) => Promise<unknown>; compact?: boolean }) {
  const [retryError, setRetryError] = useState("");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [language, setLanguage] = useState<LanguageFilter>("all");
  const filtered = filterModels(inventory.items, query, language, modelDescriptions);
  const local = sortLocalModels(filtered.filter(isLocalModel));
  const searching = !!query.trim() || language !== "all";
  const available = filtered.filter((model) => !isLocalModel(model));
  const visibleAvailable = compact && !showAll && !searching
    ? available.filter((model) => ["tiny", "base", "small", "large-v3-turbo"].includes(model.id))
    : available;
  const list = (items: ModelItem[]) => <ModelManager inventory={{ ...inventory, items }} onDownload={onDownload} compact={compact} />;
  return <div className="space-y-6">
    {inventory.connected === false && <div role="alert" className="text-[12px] text-amber-200/80">Engine unavailable. <button className="underline" onClick={() => void api.retryEngine().catch((error) => setRetryError(String(error)))}>Retry engine</button>{retryError && <p>{retryError}</p>}</div>}
    {showHeader && <div>
      <h2 className="text-lg font-semibold text-white/90">Models</h2>
      <p className="mt-1.5 text-[12px] text-white/40">Download once, then transcribe on your Mac.</p>
    </div>}
    <div className="flex gap-3 flex-wrap">
      <label className="flex min-w-[180px] flex-1 items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3">
        <Search size={14} className="text-white/30 shrink-0" />
        <input aria-label="Search models" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" className="w-full bg-transparent py-2.5 text-[12px] text-white/80 placeholder:text-white/30 outline-none" />
      </label>
      <select aria-label="Filter models by language coverage" value={language} onChange={(event) => setLanguage(event.target.value as LanguageFilter)} className="rounded-lg border border-white/[0.08] bg-[#1b1b20] px-3 py-2 text-[12px] text-white/65 outline-none">
        <option value="all">All models</option><option value="multilingual">Multilingual</option><option value="english">English only</option><option value="specialized">Specialized</option>
      </select>
    </div>
    {inventory.items.length === 0 ? <p role="status" className="text-[12px] text-white/40">Checking available models…</p> : filtered.length === 0 ? <p className="text-[12px] text-white/40">No models match your search.</p> : <>
      {local.length > 0 && <section>
        <h3 className="mb-2 text-[11.5px] font-medium text-white/45">On this Mac <span className="ml-1 text-white/25">{local.length}</span></h3>
        <div className={panel}>{list(local)}</div>
      </section>}
      {available.length > 0 && <section className="space-y-3">
        <h3 className="text-[11.5px] font-medium text-white/45">Available to download</h3>
        {groups.map((group) => {
          const items = visibleAvailable.filter((model) => model.group === group.id);
          if (!items.length) return null;
          const heading = <><span className="text-[12px] text-white/75">{group.title}</span><span className="ml-2 text-[11px] text-white/30">{items.length}</span></>;
          return group.id === "general" ? <div key={group.id} className={panel}>{!compact && <div className="pt-4">{heading}<p className="mt-1 text-[11px] text-white/35">{group.subtitle}</p></div>}{list(items)}</div> : <details key={`${group.id}-${searching}`} open={searching || items.some((model) => model.status === "failed")} className={`${panel} group`}>
            <summary className="flex cursor-pointer list-none items-center justify-between py-3.5 [&::-webkit-details-marker]:hidden"><span>{heading}</span><ChevronDown size={14} className="text-white/30 transition-transform group-open:rotate-180" /></summary>
            <p className="text-[11px] text-white/35">{group.subtitle}</p>{list(items)}
          </details>;
        })}
      </section>}
    </>}
    {compact && !searching && <button type="button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll} className="flex items-center gap-2 rounded-md py-1 text-[12px] text-white/50 hover:text-white/80 transition-colors">{showAll ? "Show fewer models" : "Browse all models"}<ChevronDown size={13} className={showAll ? "rotate-180" : ""} /></button>}
    {!compact && <p className="text-[11px] leading-relaxed text-white/30">File sizes are downloads, not memory usage. Quantized models (Q4 / Q5) use smaller files; compare results on your own speech before choosing.</p>}
  </div>;
}
