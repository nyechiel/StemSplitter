import { useRef, useEffect } from "react";

interface ChordEntry {
  time: number;
  chord: string;
}

interface Props {
  chords: ChordEntry[];
  currentTime: number;
  duration: number;
}

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ChordTimeline({ chords, currentTime, duration }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Find current chord index
  let currentIdx = 0;
  for (let i = chords.length - 1; i >= 0; i--) {
    if (chords[i].time <= currentTime) {
      currentIdx = i;
      break;
    }
  }

  // Auto-scroll to keep current chord visible
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>("[data-active='true']");
    if (activeEl) {
      const containerRect = container.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();
      const offset =
        activeRect.left - containerRect.left - containerRect.width / 2 + activeRect.width / 2;
      container.scrollBy({ left: offset, behavior: "smooth" });
    }
  }, [currentIdx]);

  if (!chords.length) return null;

  return (
    <div className="flex items-center gap-2 w-full">
      <span className="text-xs text-muted shrink-0">Chords</span>
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto scrollbar-hide"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="flex items-end gap-1 py-1">
          {chords.map((entry, i) => {
            const isActive = i === currentIdx;
            const isPast = i < currentIdx;

            return (
              <div
                key={i}
                data-active={isActive}
                className="flex flex-col items-center shrink-0"
              >
                <span className={`text-[10px] mb-0.5 font-mono ${
                  isActive ? "text-violet-400" : "text-muted"
                }`}>
                  {formatTime(entry.time)}
                </span>
                <span
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all duration-150 ${
                    isActive
                      ? "bg-violet-600 text-white scale-110 shadow-lg shadow-violet-600/30"
                      : isPast
                        ? "bg-control text-muted"
                        : "bg-surface border border-border text-secondary"
                  }`}
                >
                  {entry.chord}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
