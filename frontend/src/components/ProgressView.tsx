import { useRef, useEffect, useState } from "react";

interface Props {
  status: string;
  message: string;
  progress: number | null;
  title?: string;
}

export default function ProgressView({ status, progress, title }: Props) {
  // Download phase = 0-10%, separation phase = 10-100%
  const isDownloading = status === "downloading";
  const sepProgress = progress !== null && progress >= 0 ? progress : 0;
  const totalPct = isDownloading ? Math.min(sepProgress, 10) : 10 + sepProgress * 0.9;
  const displayPct = Math.round(Math.min(totalPct, 100));

  // ETA tracking
  const startRef = useRef<number | null>(null);
  const [eta, setEta] = useState<string | null>(null);

  useEffect(() => {
    if (displayPct > 2 && startRef.current === null) {
      startRef.current = Date.now();
    }
    if (startRef.current && displayPct > 5 && displayPct < 100) {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const rate = displayPct / elapsed;
      const remaining = (100 - displayPct) / rate;
      if (remaining < 60) {
        setEta("~1m remaining");
      } else {
        const mins = Math.ceil(remaining / 60);
        setEta(`~${mins}m remaining`);
      }
    }
    if (displayPct >= 100) {
      setEta(null);
    }
  }, [displayPct]);

  const label = isDownloading
    ? "Downloading..."
    : sepProgress < 30
      ? "Analyzing audio..."
      : sepProgress < 70
        ? "Separating stems..."
        : "Finalizing...";

  return (
    <div className="w-full max-w-md mx-auto text-center space-y-6">
      {/* Animated icon */}
      <div className="relative w-24 h-24 mx-auto">
        <div className="absolute inset-0 rounded-full border-[3px] border-border" />
        <div
          className="absolute inset-0 rounded-full border-[3px] border-transparent animate-spin"
          style={{
            borderTopColor: "#a855f7",
            borderRightColor: "#a855f7",
            animationDuration: "1.2s",
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-primary">
          {displayPct}%
        </div>
      </div>

      {title && title !== "Downloading..." && (
        <h3 className="text-lg font-semibold text-primary">{title}</h3>
      )}
      <p className="text-sm text-secondary">{label}</p>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="h-3 bg-surface rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden"
            style={{
              width: `${displayPct}%`,
              background: "linear-gradient(90deg, #7c3aed, #a855f7, #d946ef)",
            }}
          >
            <div
              className="absolute inset-0 opacity-30"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, white 50%, transparent 100%)",
                animation: "shimmer 2s infinite",
              }}
            />
          </div>
        </div>
        {eta && <p className="text-xs text-muted">{eta}</p>}
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
