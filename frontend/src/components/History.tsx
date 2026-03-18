import { useState } from "react";
import { type HistoryEntry, removeFromHistory, updateHistoryEntry, reorderHistory } from "../api/history";
import { deleteJob } from "../api/client";

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

interface Props {
  entries: HistoryEntry[];
  onSelect: (entry: HistoryEntry) => void;
  onUpdate: () => void;
}

const VISIBLE_COUNT = 5;

export default function History({ entries, onSelect, onUpdate }: Props) {
  const [editingLabels, setEditingLabels] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  if (entries.length === 0) return null;

  const handleDragEnd = () => {
    if (dragItem && dragOver && dragItem !== dragOver) {
      reorderHistory(dragItem, dragOver);
      onUpdate();
    }
    setDragItem(null);
    setDragOver(null);
  };

  const filtered = search.trim()
    ? entries.filter((e) => {
        const q = search.toLowerCase();
        if (e.title.toLowerCase().includes(q)) return true;
        if (e.labels?.some((l) => l.toLowerCase().includes(q))) return true;
        return false;
      })
    : entries;

  const visible = showAll || search.trim() ? filtered : filtered.slice(0, VISIBLE_COUNT);
  const hiddenCount = filtered.length - VISIBLE_COUNT;

  const handleRemove = (e: React.MouseEvent, jobId: string, title: string) => {
    e.stopPropagation();
    const proceed = window.confirm(`Delete "${title}"? This will remove it from history and delete all stems from the server. This cannot be undone.`);
    if (!proceed) return;
    removeFromHistory(jobId);
    deleteJob(jobId).catch(() => {});
    localStorage.removeItem(`stemsplitter_mixer_${jobId}`);
    onUpdate();
  };

  const saveLabels = (jobId: string, labels: string[]) => {
    updateHistoryEntry(jobId, { labels });
    // Sync to mixer settings
    try {
      const raw = localStorage.getItem(`stemsplitter_mixer_${jobId}`);
      if (raw) {
        const mixer = JSON.parse(raw);
        mixer.labels = labels;
        localStorage.setItem(`stemsplitter_mixer_${jobId}`, JSON.stringify(mixer));
      }
    } catch {}
    onUpdate();
  };

  const toggleLabel = (jobId: string, currentLabels: string[], label: string) => {
    const updated = currentLabels.includes(label)
      ? currentLabels.filter((l) => l !== label)
      : [...currentLabels, label];
    saveLabels(jobId, updated);
  };

  const addCustomLabel = (e: React.FormEvent, jobId: string, currentLabels: string[]) => {
    e.preventDefault();
    const trimmed = customLabel.trim();
    if (trimmed && !currentLabels.includes(trimmed)) {
      saveLabels(jobId, [...currentLabels, trimmed]);
      onUpdate();
    }
    setCustomLabel("");
    setEditingLabels(null);
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm text-muted uppercase tracking-wider font-medium">
          Recent Tracks
          <span className="ml-1.5 text-xs font-normal">({entries.length})</span>
        </h3>
        {entries.length > VISIBLE_COUNT && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or label..."
            className="px-3 py-1.5 rounded-lg text-xs bg-input border border-border text-primary placeholder-zinc-500 outline-none focus:border-violet-500 w-56"
          />
        )}
      </div>
      <div className="space-y-2">
        {visible.map((entry) => {
          const labels = entry.labels || [];
          const isEditing = editingLabels === entry.jobId;

          const isDragging = dragItem === entry.jobId;
          const isDropTarget = dragOver === entry.jobId && dragItem !== entry.jobId;
          const canDrag = !search.trim();

          return (
            <div
              key={entry.jobId}
              draggable={canDrag}
              onDragStart={() => setDragItem(entry.jobId)}
              onDragEnter={() => setDragOver(entry.jobId)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => onSelect(entry)}
              className={`w-full text-left bg-surface hover:bg-card border rounded-xl p-4 transition-all group cursor-pointer ${
                isDragging ? "opacity-30 scale-[0.98]" : ""
              } ${isDropTarget ? "ring-2 ring-violet-500/50 border-violet-500/50" : "border-border"}`}
            >
              <div className="flex items-center justify-between">
                {canDrag && (
                  <span className="cursor-grab active:cursor-grabbing text-muted hover:text-secondary select-none text-sm mr-3 shrink-0">
                    {"\u2630"}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-primary font-medium truncate">{entry.title}</p>
                    {labels.map((label) => (
                      <span
                        key={label}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0 ${LABEL_COLORS[label] || DEFAULT_LABEL_STYLE}`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted mt-1">
                    {entry.stems.length} stems &middot; {entry.date}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingLabels(isEditing ? null : entry.jobId);
                      setCustomLabel("");
                    }}
                    className="text-muted hover:text-violet-400 transition-colors opacity-0 group-hover:opacity-100 p-1 text-xs"
                    title="Edit labels"
                  >
                    {"\uD83C\uDFF7\uFE0F"}
                  </button>
                  <span className="text-violet-400 text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                    Open
                  </span>
                  <button
                    onClick={(e) => handleRemove(e, entry.jobId, entry.title)}
                    className="text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 p-1"
                    title="Remove from history"
                  >
                    {"\u2715"}
                  </button>
                </div>
              </div>

              {isEditing && (
                <div
                  className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-border"
                  onClick={(e) => e.stopPropagation()}
                >
                  {LABEL_PRESETS.map((preset) => {
                    const active = labels.includes(preset);
                    return (
                      <button
                        key={preset}
                        onClick={() => toggleLabel(entry.jobId, labels, preset)}
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-medium border transition-all ${
                          active
                            ? LABEL_COLORS[preset] + " ring-1 ring-white/20"
                            : "border-border text-muted hover:text-secondary"
                        }`}
                      >
                        {active ? "\u2713 " : ""}{preset}
                      </button>
                    );
                  })}
                  <form
                    className="flex items-center"
                    onSubmit={(e) => addCustomLabel(e, entry.jobId, labels)}
                  >
                    <input
                      type="text"
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      placeholder="Custom..."
                      className="px-2 py-0.5 rounded-lg text-[11px] bg-input border border-border text-primary placeholder-zinc-500 outline-none focus:border-violet-500 w-20"
                      onKeyDown={(e) => { if (e.key === "Escape") setEditingLabels(null); }}
                    />
                  </form>
                  {labels.filter((l) => !LABEL_PRESETS.includes(l)).map((label) => (
                    <button
                      key={label}
                      onClick={() => toggleLabel(entry.jobId, labels, label)}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-medium border transition-all ${DEFAULT_LABEL_STYLE} ring-1 ring-white/20`}
                    >
                      {"\u2713"} {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!search.trim() && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll((prev) => !prev)}
          className="w-full mt-3 py-2 text-sm text-secondary hover:text-primary transition-colors"
        >
          {showAll ? "Show less" : `Show all (${hiddenCount} more)`}
        </button>
      )}
      {search.trim() && filtered.length === 0 && (
        <p className="text-sm text-muted text-center py-4">No tracks match "{search}"</p>
      )}
    </div>
  );
}
