import { useState, useCallback, useEffect, useRef } from "react";
import UploadZone from "./components/UploadZone";
import ProgressView from "./components/ProgressView";
import ResultsView from "./components/ResultsView";
import History from "./components/History";
import ThemeToggle from "./components/ThemeToggle";
import { submitYouTube, cancelJob as apiCancelJob, deleteJob, connectWebSocket } from "./api/client";
import {
  getHistory,
  addToHistory,
  removeFromHistory,
  findBySource,
  type HistoryEntry,
} from "./api/history";

type View = "home" | "processing" | "results" | "error";
type Theme = "dark" | "light";

interface BgJob {
  jobId: string;
  title: string;
  status: string;
  message: string;
  progress: number | null;
  startTime: number;
  sourceUrl?: string;
}

interface QueuedJob {
  url: string;
  model: string;
  title: string;
}

interface ReadyJob {
  jobId: string;
  title: string;
  stems: string[];
  analysis: Record<string, any>;
}

function getInitialTheme(): Theme {
  const saved = localStorage.getItem("stemsplitter_theme");
  if (saved === "light" || saved === "dark") return saved;
  return "dark";
}

interface ViewState {
  view: View;
  jobId: string;
  title: string;
  stems: string[];
  analysis: Record<string, any>;
}

function getSavedViewState(): ViewState | null {
  try {
    const raw = localStorage.getItem("stemsplitter_viewstate");
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (state.view === "results" && state.jobId && state.stems?.length > 0) {
      return state;
    }
  } catch {}
  return null;
}

export default function App() {
  const saved = getSavedViewState();
  const [view, setView] = useState<View>(saved?.view || "home");
  const [jobId, setJobId] = useState(saved?.jobId || "");
  const [title, setTitle] = useState(saved?.title || "");
  const [stems, setStems] = useState<string[]>(saved?.stems || []);
  const [analysis, setAnalysis] = useState<Record<string, any>>(saved?.analysis || {});
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>(getHistory());
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  // Multiple background jobs & queue
  const [bgJobs, setBgJobs] = useState<Record<string, BgJob>>({});
  const [jobQueue, setJobQueue] = useState<QueuedJob[]>([]);
  const [readyJobs, setReadyJobs] = useState<Record<string, ReadyJob>>(() => {
    try {
      const raw = localStorage.getItem("stemsplitter_readyjobs");
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);
  const bgWsRefs = useRef<Record<string, WebSocket>>({});
  const bgJobCountRef = useRef(0);
  const processQueueRef = useRef<() => void>(() => {});
  const viewRef = useRef<View>(view);
  viewRef.current = view;

  // Persist ready jobs
  useEffect(() => {
    if (Object.keys(readyJobs).length > 0) {
      localStorage.setItem("stemsplitter_readyjobs", JSON.stringify(readyJobs));
    } else {
      localStorage.removeItem("stemsplitter_readyjobs");
    }
  }, [readyJobs]);

  // Persist view state
  useEffect(() => {
    if (view === "results" && jobId && stems.length > 0) {
      localStorage.setItem("stemsplitter_viewstate", JSON.stringify({ view, jobId, title, stems, analysis }));
    } else {
      localStorage.removeItem("stemsplitter_viewstate");
    }
  }, [view, jobId, title, stems, analysis]);

  // Apply theme class to root
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("stemsplitter_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const refreshHistory = () => setHistory(getHistory());

  const viewResults = useCallback(
    (id: string, t: string, s: string[], a: Record<string, any> = {}) => {
      setJobId(id);
      setTitle(t);
      setStems(s);
      setAnalysis(a);
      setView("results");

      // Preserve sourceUrl from existing history entry
      const existing = getHistory().find((h) => h.jobId === id);
      addToHistory({
        jobId: id,
        title: t,
        stems: s,
        date: new Date().toLocaleDateString(),
        analysis: a,
        sourceUrl: existing?.sourceUrl,
      });
      refreshHistory();
    },
    []
  );

  const watchJob = useCallback(
    (id: string, jobTitle: string, sourceUrl?: string) => {
      setBgJobs((prev) => ({
        ...prev,
        [id]: { jobId: id, title: jobTitle, status: "starting", message: "", progress: null, startTime: Date.now(), sourceUrl },
      }));

      const ws = connectWebSocket(id, (data) => {
        if (data.status === "completed") {
          const completedTitle = data.title || jobTitle;
          setBgJobs((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          delete bgWsRefs.current[id];

          addToHistory({
            jobId: id,
            title: completedTitle,
            stems: data.stems,
            date: new Date().toLocaleDateString(),
            analysis: data.analysis || {},
            sourceUrl,
          });
          refreshHistory();

          // If user is watching this job, go straight to results
          if (viewRef.current === "processing") {
            viewResults(id, completedTitle, data.stems, data.analysis || {});
          } else {
            setReadyJobs((prev) => ({
              ...prev,
              [id]: { jobId: id, title: completedTitle, stems: data.stems, analysis: data.analysis || {} },
            }));
          }
          ws.close();
          // Process next queued job
          setTimeout(() => processQueueRef.current(), 0);
        } else if (data.status === "failed") {
          const msg = data.message || "Processing failed";
          if (msg === "Cancelled") {
            setBgJobs((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
          } else {
            setBgJobs((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
            setError(msg);
            setView("error");
          }
          delete bgWsRefs.current[id];
          ws.close();
          setTimeout(() => processQueueRef.current(), 0);
        } else {
          setBgJobs((prev) => {
            const existing = prev[id];
            if (!existing) return prev;
            return {
              ...prev,
              [id]: {
                ...existing,
                status: data.status,
                message: data.message || "",
                progress: data.progress ?? existing.progress,
                title: data.title || existing.title,
              },
            };
          });
        }
      });
      bgWsRefs.current[id] = ws;
    },
    []
  );

  const jobQueueRef = useRef<QueuedJob[]>([]);
  jobQueueRef.current = jobQueue;

  const processQueue = useCallback(async () => {
    const queue = jobQueueRef.current;
    if (queue.length === 0) return;
    if (bgJobCountRef.current > 0) return;
    const [next, ...rest] = queue;
    setJobQueue(rest);
    try {
      const res = await submitYouTube(next.url, next.model);
      watchJob(res.job_id, "Downloading...", next.url);
    } catch (e: any) {
      setError(e.message);
      setView("error");
    }
  }, [watchJob]);

  processQueueRef.current = processQueue;

  const addToQueue = (job: QueuedJob) => {
    setJobQueue((prev) => [...prev, job]);
  };

  const handleYouTube = async (url: string, model: string, queued = false) => {
    // Check in-progress jobs
    const inProgress = Object.values(bgJobs).find((j) => j.sourceUrl === url);
    if (inProgress) {
      const proceed = window.confirm("This URL is already being processed. Split again anyway?");
      if (!proceed) return;
    }
    const existing = findBySource(url);
    if (existing) {
      const proceed = window.confirm(
        `"${existing.title}" was already split from this URL on ${existing.date}. Split again?`
      );
      if (!proceed) return;
    }
    if (queued) {
      addToQueue({ url, model, title: url });
      return;
    }
    try {
      const res = await submitYouTube(url, model);
      watchJob(res.job_id, "Downloading...", url);
    } catch (e: any) {
      setError(e.message);
      setView("error");
    }
  };

  const cancelJob = (id: string) => {
    apiCancelJob(id).catch(() => {});
    const ws = bgWsRefs.current[id];
    if (ws) {
      ws.close();
      delete bgWsRefs.current[id];
    }
    setBgJobs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (view === "processing" && viewingJobId === id) {
      setView("home");
      setViewingJobId(null);
    }
  };

  const handleHistorySelect = (entry: HistoryEntry) => {
    setJobId(entry.jobId);
    setTitle(entry.title);
    setStems(entry.stems);
    setAnalysis(entry.analysis || {});
    setView("results");
  };

  const reset = () => {
    setView("home");
    setJobId("");
    setTitle("");
    setStems([]);
    setAnalysis({});
    setError("");
    setViewingJobId(null);
    refreshHistory();
  };

  const JOB_COLORS = [
    { bg: "bg-violet-600/20", border: "border-violet-500/40", hover: "hover:bg-violet-600/30", dot: "bg-violet-500", text: "text-violet-400" },
    { bg: "bg-cyan-600/20", border: "border-cyan-500/40", hover: "hover:bg-cyan-600/30", dot: "bg-cyan-500", text: "text-cyan-400" },
    { bg: "bg-orange-600/20", border: "border-orange-500/40", hover: "hover:bg-orange-600/30", dot: "bg-orange-500", text: "text-orange-400" },
    { bg: "bg-pink-600/20", border: "border-pink-500/40", hover: "hover:bg-pink-600/30", dot: "bg-pink-500", text: "text-pink-400" },
    { bg: "bg-emerald-600/20", border: "border-emerald-500/40", hover: "hover:bg-emerald-600/30", dot: "bg-emerald-500", text: "text-emerald-400" },
  ];

  const bgJobList = Object.values(bgJobs);
  bgJobCountRef.current = bgJobList.length;
  const readyJobList = Object.values(readyJobs);
  const hasHeaderItems = bgJobList.length > 0 || readyJobList.length > 0 || jobQueue.length > 0;

  const getEta = (job: BgJob): string => {
    const isDownloading = job.status === "downloading";
    const sepProgress = job.progress != null && job.progress >= 0 ? job.progress : 0;
    const totalPct = isDownloading ? Math.min(sepProgress, 10) : 10 + sepProgress * 0.9;
    if (totalPct < 5) return "";
    const elapsed = (Date.now() - job.startTime) / 1000;
    const rate = totalPct / elapsed;
    const remaining = (100 - totalPct) / rate;
    if (remaining < 60) return "~1m";
    const mins = Math.ceil(remaining / 60);
    return `~${mins}m`;
  };

  return (
    <div className="min-h-screen bg-primary text-primary flex flex-col transition-colors duration-300">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <button
            onClick={reset}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center text-lg text-white">
              {"\u{1F39B}"}
            </div>
            <span className="text-xl font-bold tracking-tight">
              Stem<span className="text-violet-400">Splitter</span>
            </span>
          </button>
          <div className="flex items-center gap-4">
            {hasHeaderItems ? (
              <div className="flex items-center gap-2">
                {/* Ready jobs */}
                {readyJobList.map((rj) => (
                  <div key={rj.jobId} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600/20 border border-emerald-500/40">
                    <span className="text-sm shrink-0">{"\u2714"}</span>
                    <div className="flex flex-col items-start">
                      <span className="text-xs text-primary font-semibold max-w-[120px] truncate">
                        {rj.title}
                      </span>
                      <span className="text-[10px] text-emerald-400">Ready</span>
                    </div>
                    <div className="flex flex-col gap-0.5 ml-1">
                      <button
                        onClick={() => {
                          viewResults(rj.jobId, rj.title, rj.stems, rj.analysis);
                          setReadyJobs((prev) => { const next = { ...prev }; delete next[rj.jobId]; return next; });
                        }}
                        className="px-2 py-0.5 rounded text-[11px] text-emerald-400 hover:bg-emerald-500/20 transition-colors font-medium"
                      >
                        View
                      </button>
                      <button
                        onClick={() => setReadyJobs((prev) => { const next = { ...prev }; delete next[rj.jobId]; return next; })}
                        className="px-2 py-0.5 rounded text-[11px] text-muted hover:text-secondary hover:bg-control-hover transition-colors font-medium"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
                {/* Active jobs */}
                {bgJobList.map((job, idx) => {
                  const c = JOB_COLORS[idx % JOB_COLORS.length];
                  return (
                  <div key={job.jobId} className="flex items-center gap-1">
                    <button
                      onClick={() => { setViewingJobId(job.jobId); setView("processing"); }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl ${c.bg} border ${c.border} ${c.hover} transition-colors`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${c.dot} animate-pulse shrink-0`} />
                      <div className="flex flex-col items-start">
                        <span className="text-xs text-primary font-semibold max-w-[120px] truncate">
                          {job.title}
                        </span>
                        <span className={`text-[10px] ${c.text}`}>
                          {job.status === "downloading" ? "Downloading" : "Separating"}
                          {job.progress != null && job.progress > 0 && ` ${job.progress}%`}
                          {(() => { const eta = getEta(job); return eta ? ` \u00B7 ${eta}` : ""; })()}
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={() => cancelJob(job.jobId)}
                      className="px-2 py-1.5 rounded-lg flex items-center gap-1 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors font-medium"
                      title="Cancel processing"
                    >
                      {"\u2715"} Cancel
                    </button>
                  </div>
                  );
                })}
                {/* Queued jobs */}
                {jobQueue.map((qj, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-control border border-border">
                      <span className="text-xs text-muted">#{idx + 1}</span>
                      <div className="flex flex-col items-start">
                        <span className="text-xs text-secondary font-semibold max-w-[120px] truncate">
                          {qj.title}
                        </span>
                        <span className="text-[10px] text-muted">Queued</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setJobQueue((prev) => prev.filter((_, i) => i !== idx))}
                      className="px-2 py-1.5 rounded-lg text-xs text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors font-medium"
                      title="Remove from queue"
                    >
                      {"\u2715"}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted hidden sm:block">
                Separate any song into individual stems
              </p>
            )}
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-6 py-16 flex-1 w-full">
        {view === "home" && (
          <div className="space-y-12">
            <div className="text-center space-y-4">
              <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">
                Split any song into
                <br />
                <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                  individual stems
                </span>
              </h1>
              <p className="text-xl text-secondary max-w-xl mx-auto">
                Paste a YouTube link to separate stems, detect chords,
                tempo, key &mdash; and mix it all in your browser.
              </p>
            </div>

            <UploadZone
              onYouTube={handleYouTube}
              disabled={false}
              hasActiveJobs={bgJobList.length > 0}
              queueCount={jobQueue.length}
            />

            {/* Feature cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto pt-8">
              {[
                { icon: "\u{1F3A4}", label: "Vocals", desc: "Isolated voice track" },
                { icon: "\u{1F941}", label: "Drums", desc: "Percussion separated" },
                { icon: "\u{1F3B8}", label: "Bass & More", desc: "Every instrument" },
              ].map((f) => (
                <div
                  key={f.label}
                  className="bg-surface border border-border rounded-xl p-5 text-center"
                >
                  <div className="text-3xl mb-2">{f.icon}</div>
                  <p className="font-medium text-primary">{f.label}</p>
                  <p className="text-sm text-muted">{f.desc}</p>
                </div>
              ))}
            </div>

            <History
              entries={history}
              onSelect={handleHistorySelect}
              onUpdate={refreshHistory}
            />
          </div>
        )}

        {view === "processing" && (() => {
          const job = viewingJobId ? bgJobs[viewingJobId] : bgJobList[0];
          if (!job) return null;
          return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-6">
              <ProgressView
                status={job.status}
                message={job.message}
                progress={job.progress}
                title={job.title}
              />
              <div className="flex flex-col items-center gap-3">
                <button
                  onClick={() => setView("home")}
                  className="text-sm text-secondary hover:text-primary transition-colors"
                >
                  Continue browsing &mdash; we'll notify you when it's ready
                </button>
                <button
                  onClick={() => cancelJob(job.jobId)}
                  className="text-sm text-red-400/70 hover:text-red-400 transition-colors font-medium"
                >
                  {"\u2715"} Cancel
                </button>
              </div>
            </div>
          );
        })()}

        {view === "results" && (
          <ResultsView
            jobId={jobId}
            title={title}
            stems={stems}
            analysis={analysis}
            onReset={reset}
            onDelete={() => {
              const proceed = window.confirm(`Delete "${title}"? This will remove it from history and delete all stems from the server. This cannot be undone.`);
              if (!proceed) return;
              deleteJob(jobId).catch(() => {});
              removeFromHistory(jobId);
              localStorage.removeItem(`stemsplitter_mixer_${jobId}`);
              refreshHistory();
              reset();
            }}
          />
        )}

        {view === "error" && (
          <div className="text-center space-y-6 py-20">
            <div className="text-5xl">{"\u{1F635}"}</div>
            <h2 className="text-2xl font-semibold text-primary">
              Something went wrong
            </h2>
            <p className="text-secondary max-w-md mx-auto">{error}</p>
            <button
              onClick={reset}
              className="px-8 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition-all font-medium"
            >
              Try Again
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-auto">
        <div className="max-w-5xl mx-auto px-6 py-4 text-center text-sm text-muted">
          Powered with <span className="text-red-500">&hearts;</span> by <a href="https://github.com/adefossez/demucs" target="_blank" rel="noopener noreferrer" className="text-secondary hover:text-primary transition-colors">Demucs</a> &middot; <a href="https://github.com/librosa/librosa" target="_blank" rel="noopener noreferrer" className="text-secondary hover:text-primary transition-colors">librosa</a> &middot; <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener noreferrer" className="text-secondary hover:text-primary transition-colors">yt-dlp</a>
        </div>
      </footer>
    </div>
  );
}
