import { useRef, useState, useEffect, useCallback } from "react";
import { stemUrl } from "../api/client";
import { updateHistoryEntry } from "../api/history";
import Waveform from "./Waveform";
import PeakMeter from "./PeakMeter";
import ChordTimeline from "./ChordTimeline";

interface ChordEntry {
  time: number;
  chord: string;
}

interface Analysis {
  bpm?: number;
  key?: string;
  duration?: number;
  time_signature?: string;
  chords?: ChordEntry[];
}

interface Props {
  jobId: string;
  title: string;
  stems: string[];
  analysis?: Analysis;
  onReset: () => void;
  onDelete: () => void;
}

const STEM_COLORS: Record<string, string> = {
  vocals: "#a855f7",
  drums: "#f97316",
  bass: "#22c55e",
  guitar: "#eab308",
  piano: "#3b82f6",
  other: "#6366f1",
};

const STEM_ICONS: Record<string, string> = {
  vocals: "\u{1F3A4}",
  drums: "\u{1F941}",
  bass: "\u{1F3BC}",
  guitar: "\u{1F3B8}",
  piano: "\u{1F3B9}",
  other: "\u{1F3B6}",
};

const STEM_LABELS: Record<string, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  guitar: "Guitar",
  piano: "Piano",
  other: "Other",
};

const STEM_ORDER = ["vocals", "drums", "bass", "guitar", "piano", "other"];

const LABEL_PRESETS = ["Practice", "Cover", "Remix", "Live", "Karaoke", "Study", "Reference"];
const LABEL_COLORS: Record<string, string> = {
  Practice: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  Cover: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Remix: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
  Live: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  Karaoke: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  Study: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  Reference: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};
const DEFAULT_LABEL_STYLE = "bg-violet-500/15 text-violet-400 border-violet-500/30";

interface MixerSettings {
  enabled: Record<string, boolean>;
  volumes: Record<string, number>;
  order: string[];
  customNames: Record<string, string>;
  displayTitle: string;
  currentTime: number;
  duration: number;
  labels: string[];
}

function loadMixerSettings(jobId: string): MixerSettings | null {
  try {
    const raw = localStorage.getItem(`stemsplitter_mixer_${jobId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveMixerSettings(jobId: string, settings: MixerSettings) {
  localStorage.setItem(`stemsplitter_mixer_${jobId}`, JSON.stringify(settings));
}

export default function ResultsView({ jobId, title, stems, analysis, onReset, onDelete }: Props) {
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragOver, setDragOverStem] = useState<string | null>(null);
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [displayTitle, setDisplayTitle] = useState(title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [stemPeaks, setStemPeaks] = useState<Record<string, number[]>>({});
  const [loadedStems, setLoadedStems] = useState<Set<string>>(new Set());
  const editRef = useRef<HTMLInputElement>(null);
  const titleEditRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);

  useEffect(() => {
    initializedRef.current = false;
    const saved = loadMixerSettings(jobId);
    if (saved) {
      setOrder(saved.order.length === stems.length ? saved.order : [...stems].sort((a, b) => (STEM_ORDER.indexOf(a) ?? 99) - (STEM_ORDER.indexOf(b) ?? 99)));
      setEnabled(saved.enabled);
      setVolumes(saved.volumes);
      setCustomNames(saved.customNames);
      setDisplayTitle(saved.displayTitle || title);
      setLabels(saved.labels || []);
      if (saved.currentTime > 0) {
        setCurrentTime(saved.currentTime);
        pendingSeekRef.current = saved.currentTime;
      }
      if (saved.duration > 0) {
        setDuration(saved.duration);
      }
    } else {
      const sorted = [...stems].sort(
        (a, b) => (STEM_ORDER.indexOf(a) ?? 99) - (STEM_ORDER.indexOf(b) ?? 99)
      );
      setOrder(sorted);
      const allOn: Record<string, boolean> = {};
      for (const s of stems) allOn[s] = true;
      setEnabled(allOn);
      setVolumes({});
      setCustomNames({});
      setDisplayTitle(title);
      setLabels([]);
    }
    setLoadedStems(new Set());
    // Mark as initialized after state updates flush
    requestAnimationFrame(() => { initializedRef.current = true; });
  }, [stems, jobId]);

  useEffect(() => {
    for (const stem of stems) {
      const audio = audioRefs.current[stem];
      if (!audio) continue;
      const vol = volumes[stem] ?? 0.8;
      const on = enabled[stem] ?? false;
      audio.volume = on ? vol : 0;
    }
  }, [enabled, volumes, stems]);

  // Persist mixer settings (skip until initial load is done)
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    if (!initializedRef.current || order.length === 0) return;
    saveMixerSettings(jobId, { enabled, volumes, order, customNames, displayTitle, currentTime: currentTimeRef.current, duration: durationRef.current, labels });
    updateHistoryEntry(jobId, { labels, title: displayTitle });
  }, [jobId, enabled, volumes, order, customNames, displayTitle, labels]);

  // Save currentTime on unmount
  useEffect(() => {
    return () => {
      const saved = loadMixerSettings(jobId);
      if (saved) {
        saved.currentTime = currentTimeRef.current;
        saved.duration = durationRef.current;
        saveMixerSettings(jobId, saved);
      }
    };
  }, [jobId]);

  const sharedTimeRef = useRef(0);
  const lastStateUpdate = useRef(0);
  const updateTime = useCallback(() => {
    const first = Object.values(audioRefs.current).find(Boolean);
    if (first) {
      sharedTimeRef.current = first.currentTime;
      if (first.duration && !isNaN(first.duration) && first.duration !== durationRef.current) {
        setDuration(first.duration);
        durationRef.current = first.duration;
      }
      // Throttle state updates to ~4fps for UI elements (seek bar, time display)
      const now = performance.now();
      if (now - lastStateUpdate.current > 250) {
        setCurrentTime(first.currentTime);
        lastStateUpdate.current = now;
      }
    }
    timerRef.current = requestAnimationFrame(updateTime);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
    };
  }, []);

  const playAll = () => {
    pendingSeekRef.current = null;
    const allAudio = Object.values(audioRefs.current).filter(Boolean) as HTMLAudioElement[];
    allAudio.forEach((a) => a.play().catch(() => {}));
    setPlaying(true);
    if (timerRef.current) cancelAnimationFrame(timerRef.current);
    timerRef.current = requestAnimationFrame(updateTime);
  };

  const pauseAll = () => {
    const allAudio = Object.values(audioRefs.current).filter(Boolean) as HTMLAudioElement[];
    allAudio.forEach((a) => a.pause());
    setPlaying(false);
    if (timerRef.current) cancelAnimationFrame(timerRef.current);
  };

  const togglePlay = () => (playing ? pauseAll() : playAll());

  const seekAll = (time: number) => {
    pendingSeekRef.current = null;
    const allAudio = Object.values(audioRefs.current).filter(Boolean) as HTMLAudioElement[];
    allAudio.forEach((a) => (a.currentTime = time));
    setCurrentTime(time);
  };

  const handleSeekBar = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekAll(parseFloat(e.target.value));
  };

  const stopAll = () => {
    pauseAll();
    const allAudio = Object.values(audioRefs.current).filter(Boolean) as HTMLAudioElement[];
    allAudio.forEach((a) => (a.currentTime = 0));
    setCurrentTime(0);
  };

  const toggleStem = (stem: string) => {
    const willEnable = !(enabled[stem] ?? false);
    setEnabled((prev) => ({ ...prev, [stem]: willEnable }));
    if (willEnable && !playing) playAll();
  };

  const prevEnabled = useRef<Record<string, boolean> | null>(null);
  const soloStem = useRef<string | null>(null);

  const enableOnly = (stem: string) => {
    // If already soloing this stem, revert to previous state
    if (soloStem.current === stem && prevEnabled.current) {
      setEnabled(prevEnabled.current);
      prevEnabled.current = null;
      soloStem.current = null;
      return;
    }
    // Save current state before soloing
    prevEnabled.current = { ...enabled };
    soloStem.current = stem;
    const next: Record<string, boolean> = {};
    for (const s of stems) next[s] = s === stem;
    setEnabled(next);
    if (!playing) playAll();
  };

  const enableAll = () => {
    const next: Record<string, boolean> = {};
    for (const s of stems) next[s] = true;
    setEnabled(next);
  };

  const disableAll = () => setEnabled({});

  const setVolume = (stem: string, vol: number) => {
    setVolumes((v) => ({ ...v, [stem]: vol }));
  };

  const startEditing = (stem: string) => {
    setEditing(stem);
    setTimeout(() => editRef.current?.select(), 0);
  };

  const finishEditing = (stem: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== (STEM_LABELS[stem] || stem)) {
      setCustomNames((prev) => ({ ...prev, [stem]: trimmed }));
    } else if (!trimmed) {
      setCustomNames((prev) => {
        const next = { ...prev };
        delete next[stem];
        return next;
      });
    }
    setEditing(null);
  };

  const getStemName = (stem: string) => customNames[stem] || STEM_LABELS[stem] || stem;

  const handleDragStart = (stem: string) => setDragItem(stem);
  const handleDragEnter = (stem: string) => setDragOverStem(stem);

  const handleDragEnd = () => {
    if (dragItem && dragOver && dragItem !== dragOver) {
      setOrder((prev) => {
        const next = [...prev];
        const fromIdx = next.indexOf(dragItem);
        const toIdx = next.indexOf(dragOver);
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, dragItem);
        return next;
      });
    }
    setDragItem(null);
    setDragOverStem(null);
  };

  const formatTime = (t: number) => {
    if (!t || isNaN(t)) return "0:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const enabledCount = Object.values(enabled).filter(Boolean).length;
  const allStemsLoaded = loadedStems.size >= stems.length;
  const handleStemLoaded = useCallback((stem: string) => {
    setLoadedStems((prev) => new Set(prev).add(stem));
  }, []);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {stems.map((stem) => (
        <audio
          key={stem}
          ref={(el) => { audioRefs.current[stem] = el; }}
          src={stemUrl(jobId, stem)}
          preload="metadata"
          onEnded={() => setPlaying(false)}
          onLoadedData={(e) => {
            if (pendingSeekRef.current !== null) {
              e.currentTarget.currentTime = pendingSeekRef.current;
            }
          }}
        />
      ))}

      {/* Loading indicator */}
      {!allStemsLoaded && (
        <div className="flex items-center gap-3 px-5 py-4 rounded-xl bg-blue-500/10 border border-blue-500/40">
          <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin shrink-0" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-blue-400 dark:text-blue-300">
              Loading waveforms ({loadedStems.size}/{stems.length})
            </span>
            <span className="text-xs text-secondary">
              Playback is available while waveforms load
            </span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm text-violet-400 uppercase tracking-wider font-medium">
            Separation Complete
          </p>
          {editingTitle ? (
            <input
              ref={titleEditRef}
              type="text"
              defaultValue={displayTitle}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v) setDisplayTitle(v);
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = e.currentTarget.value.trim();
                  if (v) setDisplayTitle(v);
                  setEditingTitle(false);
                }
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="text-3xl font-bold text-primary bg-transparent border-b-2 border-violet-500 outline-none w-full py-0.5"
            />
          ) : (
            <h2
              className="text-3xl font-bold text-primary cursor-pointer hover:text-violet-400 transition-colors"
              onDoubleClick={() => {
                setEditingTitle(true);
                setTimeout(() => titleEditRef.current?.select(), 0);
              }}
              title="Double-click to rename"
            >
              {displayTitle}
            </h2>
          )}
          <p className="text-secondary">{stems.length} stems extracted</p>
        </div>

        {/* Labels */}
        <div className="flex flex-wrap items-center gap-2">
          {labels.map((label) => (
            <span
              key={label}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border cursor-pointer hover:opacity-70 transition-opacity ${LABEL_COLORS[label] || DEFAULT_LABEL_STYLE}`}
              onClick={() => setLabels((prev) => prev.filter((l) => l !== label))}
              title="Click to remove"
            >
              {label} {"\u00D7"}
            </span>
          ))}
          {showLabelPicker ? (
            <div className="flex items-center gap-2 flex-wrap">
              {LABEL_PRESETS.filter((p) => !labels.includes(p)).map((preset) => (
                <button
                  key={preset}
                  onClick={() => {
                    setLabels((prev) => [...prev, preset]);
                    setShowLabelPicker(false);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border hover:scale-105 transition-all ${LABEL_COLORS[preset]}`}
                >
                  {preset}
                </button>
              ))}
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = customLabel.trim();
                  if (trimmed && !labels.includes(trimmed)) {
                    setLabels((prev) => [...prev, trimmed]);
                  }
                  setCustomLabel("");
                  setShowLabelPicker(false);
                }}
              >
                <input
                  type="text"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Custom..."
                  className="px-2 py-1 rounded-lg text-xs bg-input border border-border text-primary placeholder-zinc-500 outline-none focus:border-violet-500 w-24"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Escape") setShowLabelPicker(false); }}
                />
              </form>
              <button
                onClick={() => setShowLabelPicker(false)}
                className="text-xs text-muted hover:text-secondary transition-colors"
              >
                {"\u2715"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowLabelPicker(true)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium border border-dashed border-border text-muted hover:text-secondary hover:border-violet-500/50 transition-all"
            >
              + Label
            </button>
          )}
        </div>

        {analysis && (analysis.bpm || analysis.key || analysis.time_signature) && (
          <div className="flex flex-wrap gap-3">
            {analysis.bpm && (
              <span className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm">
                <span className="text-muted mr-1.5">BPM</span>
                <span className="font-semibold text-primary">{analysis.bpm}</span>
              </span>
            )}
            {analysis.key && (
              <span className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm">
                <span className="text-muted mr-1.5">Key</span>
                <span className="font-semibold text-primary">{analysis.key}</span>
              </span>
            )}
            {analysis.time_signature && (
              <span className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm">
                <span className="text-muted mr-1.5">Time (est.)</span>
                <span className="font-semibold text-primary">{analysis.time_signature}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Master transport */}
      <div className="bg-surface border border-border rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-4">
          <button
            onClick={togglePlay}
            className="w-14 h-14 rounded-full bg-violet-600 hover:bg-violet-500 flex items-center justify-center text-white text-xl transition-all hover:scale-105 shadow-lg shadow-violet-600/30 shrink-0"
            title={playing ? "Pause" : "Play all stems"}
          >
            {playing ? "\u23F8" : "\u25B6"}
          </button>

          <button
            onClick={stopAll}
            className="w-10 h-10 rounded-full bg-control hover:bg-control-hover flex items-center justify-center text-control hover:text-control-hover transition-all shrink-0 border border-control"
            title="Restart from beginning"
          >
            {"\u21BA"}
          </button>

          <div className="flex-1 flex items-center gap-3">
            <span className="text-xs text-muted w-10 text-right font-mono">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={handleSeekBar}
              className="flex-1 h-2 accent-violet-500 cursor-pointer"
            />
            <span className="text-xs text-muted w-10 font-mono">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 pl-[3.75rem]">
          <button
            onClick={enableAll}
            className="text-xs px-3 py-1 rounded-lg bg-control hover:bg-control-hover text-control hover:text-control-hover border border-control transition-all"
          >
            All on
          </button>
          <button
            onClick={disableAll}
            className="text-xs px-3 py-1 rounded-lg bg-control hover:bg-control-hover text-control hover:text-control-hover border border-control transition-all"
          >
            All off
          </button>
          <span className="text-xs text-muted">
            {enabledCount} / {stems.length} active
          </span>
        </div>

        {analysis?.chords?.length > 0 && (
          <div className="pl-[3.75rem]">
            <ChordTimeline
              chords={analysis.chords}
              currentTime={currentTime}
              duration={duration}
            />
          </div>
        )}
      </div>

      {/* Stem mixer */}
      <div className="space-y-2">
        {order.map((stem) => {
          const color = STEM_COLORS[stem] || "#6366f1";
          const icon = STEM_ICONS[stem] || "\u{1F3B6}";
          const isOn = enabled[stem] ?? false;
          const vol = volumes[stem] ?? 0.8;
          const isDragging = dragItem === stem;
          const isDropTarget = dragOver === stem && dragItem !== stem;

          return (
            <div
              key={stem}
              draggable
              onDragStart={() => handleDragStart(stem)}
              onDragEnter={() => handleDragEnter(stem)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              className={`rounded-xl p-4 transition-all border ${
                isDragging ? "opacity-30 scale-[0.98]" : ""
              } ${isDropTarget ? "ring-2 ring-violet-500/50" : ""} ${
                !isOn ? "opacity-50" : ""
              }`}
              style={{
                backgroundColor: `${color}${isOn ? "12" : "06"}`,
                borderColor: isOn ? `${color}40` : "transparent",
              }}
            >
              {/* Top row: toggle, name, actions */}
              <div className="flex items-center gap-3 mb-2">
                <span className="cursor-grab active:cursor-grabbing text-muted hover:text-secondary select-none text-sm">
                  {"\u2630"}
                </span>

                <button
                  onClick={() => toggleStem(stem)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0 border-2 ${
                    isOn
                      ? "scale-105"
                      : "border-control text-control hover:text-control-hover"
                  }`}
                  style={isOn ? { borderColor: color, background: `${color}30`, color } : {}}
                  title={isOn ? "Turn off" : "Turn on"}
                >
                  <span className="text-base font-bold">{isOn ? "\u{1F50A}" : "\u{1F507}"}</span>
                </button>

                <span className="text-lg">{icon}</span>
                <div className="flex-1 min-w-0">
                  {editing === stem ? (
                    <input
                      ref={editRef}
                      type="text"
                      defaultValue={getStemName(stem)}
                      onBlur={(e) => finishEditing(stem, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") finishEditing(stem, e.currentTarget.value);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="bg-transparent border-b-2 border-violet-500 outline-none text-sm font-semibold text-primary w-full py-0.5"
                    />
                  ) : (
                    <h3
                      className={`font-semibold transition-colors text-sm cursor-pointer ${
                        isOn ? "text-primary" : "text-muted hover:text-secondary"
                      }`}
                      onClick={() => toggleStem(stem)}
                      onDoubleClick={(e) => { e.stopPropagation(); startEditing(stem); }}
                      title="Double-click to rename"
                    >
                      {getStemName(stem)}
                      {stem === "other" && !customNames[stem] && (
                        <span className="font-normal text-xs text-muted ml-2">(strings, brass, sound effects...)</span>
                      )}
                    </h3>
                  )}
                </div>

                <button
                  onClick={() => enableOnly(stem)}
                  className="w-8 h-8 rounded-lg text-xs font-bold bg-control hover:bg-control-hover text-control hover:text-yellow-500 border border-control transition-all shrink-0"
                  title="Solo"
                >
                  S
                </button>

                <a
                  href={stemUrl(jobId, stem)}
                  download={`${getStemName(stem)}.wav`}
                  className="w-8 h-8 rounded-lg bg-control hover:bg-control-hover flex items-center justify-center text-control hover:text-control-hover transition-all border border-control shrink-0"
                  title={`Download ${stem}`}
                >
                  <span className="text-sm">{"\u2B07"}</span>
                </a>
              </div>

              {/* Volume slider */}
              <div className="flex items-center gap-2 pl-10 mb-1 max-w-56">
                <span className="text-xs text-muted">Vol</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={vol}
                  onChange={(e) => setVolume(stem, parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-violet-500 cursor-pointer"
                />
              </div>

              <Waveform
                url={stemUrl(jobId, stem)}
                color={color}
                currentTime={currentTime}
                duration={duration}
                isOn={isOn}
                playing={playing}
                onSeek={seekAll}
                onPeaks={(peaks) => setStemPeaks((prev) => ({ ...prev, [stem]: peaks }))}
                onLoaded={() => handleStemLoaded(stem)}
                sharedTimeRef={sharedTimeRef}
              />

              {/* Peak meter */}
              <div className="mt-1">
                <PeakMeter
                  peaks={stemPeaks[stem] || []}
                  currentTime={currentTime}
                  duration={duration}
                  color={color}
                  isOn={isOn}
                  playing={playing}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted">
          {"\u{1F50A}"}/{"\u{1F507}"} toggle &middot; <span className="text-secondary">S</span> solo &middot; {"\u2630"} reorder &middot; Double-click name to rename
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={onDelete}
            className="px-4 py-2.5 text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all font-medium text-sm"
            title="Delete this track and its stems from the server"
          >
            Delete Track
          </button>
          <button
            onClick={onReset}
            className="px-6 py-2.5 bg-control hover:bg-control-hover text-secondary hover:text-primary rounded-xl transition-all font-medium text-sm"
          >
            Split Another Track
          </button>
        </div>
      </div>
    </div>
  );
}
