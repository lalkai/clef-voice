import { ArrowRight, Check, Copy, Settings2 } from "lucide-react";
import { appConfig } from "./lib/appConfig.generated";
import { modelNames } from "./lib/models";
import { activityWeeks, modelUsage } from "./lib/dashboard";
import { formatProcessingTime, historyTimestamp } from "./lib/history";
import type { HistoryItem, Stats } from "./types";

const typingWpm = appConfig.typingWpm;
const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const activityColors = ["#29292f", "#414153", "#62617e", "#8986a9", "#b3aed0"];

export default function Dashboard({ history, stats, onNavigate, onCopy, copiedId }: {
  history: HistoryItem[];
  stats: Stats;
  onNavigate: (tab: "history" | "preferences") => void;
  onCopy: (id: string, text: string) => void;
  copiedId: string | null;
}) {
  const wpm = stats.speechWpm;
  const speedScale = Math.max(typingWpm, wpm);
  const weeks = activityWeeks(history);
  const days = weeks.flat().filter((day) => day.count > 0).length;
  const usage = modelUsage(history);
  const recent = history.slice(0, 3);

  return (
    <div className="insights">
      <header className="insights-header">
        <h1>Overview</h1>
        <button className="insights-link" onClick={() => onNavigate("preferences")} type="button">
          <Settings2 size={13} /> Settings
        </button>
      </header>

      <section className="insights-hero">
        <div className="insights-speed-summary">
          <div>
            <h2 className="insights-label">Dictation speed</h2>
            <p className="insights-speed-number">{stats.dictationCount ? wpm : "—"}<span>wpm</span></p>
            <p className="insights-speed-ratio" title={`Compared with an assumed typing speed of ${typingWpm} wpm. Thai word counts are approximate.`}>
              <strong>{stats.dictationCount ? `${(wpm / typingWpm).toFixed(1)}×` : "—"}</strong> typing speed
            </p>
          </div>
          <div className="insights-comparison" aria-label={`Voice ${wpm} wpm, assumed typing speed ${typingWpm} wpm`}>
            <div className="insights-comparison-heading"><span>Voice</span><b>{stats.dictationCount ? wpm : "—"} wpm</b></div>
            <div className="insights-bar-track"><i style={{ width: `${Math.max(0, wpm) / speedScale * 100}%` }} /></div>
            <div className="insights-comparison-heading"><span>Typing</span><b>{typingWpm} wpm</b></div>
            <div className="insights-bar-track"><i className="insights-typing-bar" style={{ width: `${typingWpm / speedScale * 100}%` }} /></div>
            <p className="insights-footnote">{typingWpm} wpm typing baseline · Estimated</p>
          </div>
        </div>
        <div className="insights-metrics">
          <div title="Average of measured sessions, from the engine handling stop until the transcript is ready. Excludes History saving and pasting.">
            <span>Avg. transcription</span><strong>{formatProcessingTime(stats.averageProcessingSeconds)}</strong>
          </div>
          <div><span>Words dictated</span><strong>{stats.totalWords.toLocaleString()}</strong></div>
          <div title={`Estimated against typing at ${typingWpm} wpm.`}><span>Time saved</span><strong>{Math.max(0, stats.minutesSaved)}<small> min</small></strong></div>
        </div>
      </section>

      <div className="insights-charts">
        <section className="insights-activity">
          <div className="insights-card-heading"><h2>Activity</h2><span>{days} active days</span></div>
          <div className="insights-calendar-range">
            <span>{weeks[0][0].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span>Today</span>
          </div>
          <div className="insights-calendar">
            <div className="insights-calendar-days">
              {dayNames.map((day, i) => <span key={day}>{i % 2 === 1 ? day.slice(0, 3) : ""}</span>)}
            </div>
            {weeks.map((week, i) => <div className="insights-calendar-week" key={i}>
              {week.map(({ date, count, future }) => {
                const label = `${date.toLocaleDateString()}: ${future ? "upcoming" : `${count} dictations`}`;
                const level = count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4;
                return <span key={date.getTime()} role="img" aria-label={label} title={label}
                  style={{ background: future ? "transparent" : activityColors[level], opacity: future ? 0.25 : 1 }} />;
              })}
            </div>)}
          </div>
          <div className="insights-calendar-footer">
            <span>12 weeks · Saved History</span>
            <div className="insights-calendar-legend">
              <span>Less</span>{activityColors.map((color) => <i key={color} style={{ background: color }} />)}<span>More</span>
            </div>
          </div>
        </section>

        <section className="insights-model-section">
          <div className="insights-card-heading"><h2>Models</h2><span>{history.length} sessions</span></div>
          {usage.length === 0 ? <p className="insights-empty">No model history yet.</p> : <div className="insights-models">
            {usage.map((item) => <div className="insights-model-row" key={item.model}>
              <div><span>{modelNames[item.model] || item.model}</span><strong>{Math.round(item.percent)}%</strong></div>
              <div className="insights-model-track"><i style={{ width: `${item.percent}%` }} /></div>
            </div>)}
          </div>}
          <p className="insights-footnote">Based on saved dictations</p>
        </section>
      </div>

      <section className="insights-recent">
        <div className="insights-card-heading">
          <h2>Recent dictations</h2>
          {history.length > 0 && <button className="insights-link" type="button" onClick={() => onNavigate("history")}>View all <ArrowRight size={12} /></button>}
        </div>
        {recent.length === 0 ? <p className="insights-empty">No dictations yet.</p> : recent.map((item) => <div className="insights-recent-row" key={item.id}>
          <div>
            <p className="insights-transcript">{item.text}</p>
            <span className="insights-footnote">{historyTimestamp(item)} · {item.wordCount} {item.wordCount === 1 ? "word" : "words"}{item.processingSeconds != null ? ` · ${formatProcessingTime(item.processingSeconds)}` : ""}</span>
          </div>
          <button className="insights-copy" type="button" aria-label={copiedId === item.id ? "Copied dictation" : "Copy dictation"} onClick={() => onCopy(item.id, item.text)}>
            {copiedId === item.id ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>)}
      </section>
    </div>
  );
}
