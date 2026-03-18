import { useState } from "react";

interface Props {
  onYouTube: (url: string, model: string, queued?: boolean) => void;
  disabled: boolean;
  hasActiveJobs: boolean;
  queueCount: number;
}

const MODELS = [
  {
    id: "htdemucs_6s",
    name: "6 Stems",
    desc: "Vocals, drums, bass, guitar, piano, other",
    badge: "Default",
  },
  {
    id: "htdemucs",
    name: "4 Stems",
    desc: "Vocals, drums, bass, other",
    badge: "Faster",
  },
  {
    id: "htdemucs_ft",
    name: "4 Stems (Fine-tuned)",
    desc: "Vocals, drums, bass, other — higher quality",
    badge: "Quality",
  },
];

export default function UploadZone({ onYouTube, disabled, hasActiveJobs, queueCount }: Props) {
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("htdemucs_6s");

  const handleSubmitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onYouTube(url.trim(), model);
      setUrl("");
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <form onSubmit={handleSubmitUrl} className="space-y-4">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube URL..."
          disabled={disabled}
          className="
            w-full px-5 py-4 bg-input border border-border rounded-xl
            text-primary placeholder-zinc-500 text-lg
            focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20
            transition-all disabled:opacity-50
          "
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={disabled || !url.trim()}
            className="
              flex-1 py-4 bg-violet-600 hover:bg-violet-500 text-white font-semibold
              rounded-xl transition-all text-lg
              disabled:opacity-50 disabled:cursor-not-allowed
              shadow-lg shadow-violet-600/25 hover:shadow-violet-500/40
            "
          >
            Split This Track
          </button>
          {hasActiveJobs && (
            <button
              type="button"
              disabled={disabled || !url.trim()}
              onClick={() => {
                if (url.trim()) {
                  onYouTube(url.trim(), model, true);
                  setUrl("");
                }
              }}
              className="
                px-6 py-4 bg-control hover:bg-control-hover text-secondary hover:text-primary font-semibold
                rounded-xl transition-all text-lg border border-border
                disabled:opacity-50 disabled:cursor-not-allowed
              "
              title="Add to queue — will start after current jobs finish"
            >
              Add to Queue
            </button>
          )}
        </div>
      </form>

      {/* Model selector */}
      <div>
        <p className="text-xs text-muted uppercase tracking-wider font-medium mb-2 text-center">
          Separation Model
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => setModel(m.id)}
              className={`text-left p-3 rounded-xl border transition-all ${
                model === m.id
                  ? "border-violet-500 bg-violet-500/10"
                  : "border-border bg-surface hover:border-violet-500/30"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-sm font-semibold ${
                    model === m.id ? "text-primary" : "text-secondary"
                  }`}
                >
                  {m.name}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    model === m.id
                      ? "bg-violet-500/20 text-violet-300"
                      : "bg-input text-muted"
                  }`}
                >
                  {m.badge}
                </span>
              </div>
              <p className="text-xs text-muted">{m.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {queueCount > 0 && (
        <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-surface border border-border">
          <span className="text-sm text-secondary">
            {queueCount} {queueCount === 1 ? "track" : "tracks"} queued
          </span>
          <span className="text-xs text-muted">&mdash; will start automatically</span>
        </div>
      )}
    </div>
  );
}
