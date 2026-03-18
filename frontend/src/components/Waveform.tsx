import { useRef, useEffect, useState, useCallback, type MutableRefObject } from "react";

interface Props {
  url: string;
  color: string;
  currentTime: number;
  duration: number;
  isOn: boolean;
  playing: boolean;
  onSeek: (time: number) => void;
  onPeaks?: (peaks: number[]) => void;
  onLoaded?: () => void;
  sharedTimeRef?: MutableRefObject<number>;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Shared AudioContext and sequential loading queue to avoid browser limits
let sharedAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AudioContext();
  }
  return sharedAudioCtx;
}

let loadQueue: Promise<void> = Promise.resolve();
function enqueueLoad(fn: () => Promise<void>): Promise<void> {
  loadQueue = loadQueue.then(fn, fn);
  return loadQueue;
}

export default function Waveform({ url, color, currentTime, duration, isOn, playing, onSeek, onPeaks, onLoaded, sharedTimeRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const peaksRef = useRef<number[]>([]);
  const [ready, setReady] = useState(false);
  const animRef = useRef<number | null>(null);
  const localTimeRef = useRef(0);
  const timeRef = sharedTimeRef || localTimeRef;

  // Store frequently-changing props in refs so draw doesn't need to be recreated
  const colorRef = useRef(color);
  colorRef.current = color;
  const isOnRef = useRef(isOn);
  isOnRef.current = isOn;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    let cancelled = false;

    enqueueLoad(async () => {
      if (cancelled) return;
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const ctx = getAudioContext();
        const decoded = await ctx.decodeAudioData(buf);
        if (cancelled) return;

        const raw = decoded.getChannelData(0);
        const barCount = 200;
        const blockSize = Math.floor(raw.length / barCount);
        const peaks: number[] = [];

        for (let i = 0; i < barCount; i++) {
          let sum = 0;
          const start = i * blockSize;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(raw[start + j]);
          }
          peaks.push(sum / blockSize);
        }

        const max = Math.max(...peaks);
        if (max > 0) {
          for (let i = 0; i < peaks.length; i++) peaks[i] /= max;
        }

        peaksRef.current = peaks;
        onPeaks?.(peaks);
        setReady(true);
        onLoaded?.();
      } catch {
        // Silently fail — waveform just won't show
      }
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    timeRef.current = currentTime;
  }, [currentTime]);

  // Stable draw function — reads changing values from refs
  const draw = useCallback((animTime?: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const peaks = peaksRef.current;
    if (peaks.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const c = colorRef.current;
    const on = isOnRef.current;
    const pl = playingRef.current;
    const dur = durationRef.current;
    const barCount = peaks.length;
    const barWidth = w / barCount;
    const gap = 1;
    const progress = dur > 0 ? timeRef.current / dur : 0;
    const playheadBar = Math.floor(progress * barCount);
    const isLight = document.documentElement.classList.contains("light");

    // Pulse for breathing effect
    const pulse = animTime !== undefined ? Math.sin(animTime / 200) * 0.5 + 1 : 1;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < barCount; i++) {
      const x = i * barWidth;
      const isPast = i < playheadBar;
      const distFromHead = Math.abs(i - playheadBar);

      // Animated scale near playhead
      let scale = 1;
      if (on && pl && distFromHead < 12) {
        const proximity = 1 - distFromHead / 12;
        scale = 1 + proximity * 0.4 * (pulse - 0.5);
      }

      const barH = Math.max(2, peaks[i] * h * 0.85 * scale);
      const y = (h - barH) / 2;

      if (on) {
        if (isPast) {
          ctx.fillStyle = c;
        } else if (pl && distFromHead < 12) {
          const glowAlpha = 0.2 + (1 - distFromHead / 12) * 0.6;
          ctx.fillStyle = hexToRgba(c, glowAlpha);
        } else {
          ctx.fillStyle = `${c}25`;
        }
      } else {
        ctx.fillStyle = isPast
          ? (isLight ? "#a1a1aa" : "#71717a")
          : (isLight ? "#d4d4d8" : "#27272a");
      }

      ctx.beginPath();
      ctx.roundRect(x + gap / 2, y, barWidth - gap, barH, 1);
      ctx.fill();
    }

    // Playhead with glow
    if (dur > 0) {
      const px = progress * w;
      if (on && pl) {
        ctx.shadowColor = c;
        ctx.shadowBlur = 12;
        ctx.fillStyle = c;
        ctx.fillRect(px - 1, 0, 2.5, h);
        ctx.shadowBlur = 0;
      } else if (on) {
        ctx.fillStyle = c;
        ctx.fillRect(px - 0.5, 0, 1.5, h);
      } else {
        ctx.fillStyle = isLight ? "#a1a1aa" : "#71717a";
        ctx.fillRect(px - 0.5, 0, 1.5, h);
      }
    }
  }, []);

  // Animation loop — start/stop based on playing + ready
  useEffect(() => {
    if (!playing || !ready) {
      draw();
      return;
    }

    const loop = (time: number) => {
      draw(time);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [playing, ready, draw]);

  // Redraw on prop changes when not animating
  useEffect(() => {
    if (!playing) draw();
  }, [currentTime, isOn, color, duration, draw, playing]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => draw());
    obs.observe(container);
    return () => obs.disconnect();
  }, [draw]);

  const handleClick = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container || !duration) return;
    const rect = container.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(ratio * duration);
  };

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className="w-full h-14 cursor-pointer rounded-lg overflow-hidden"
    >
      {ready ? (
        <canvas ref={canvasRef} className="w-full h-full" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="flex gap-1">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className="w-1 rounded-full bg-control animate-pulse"
                style={{ height: `${12 + Math.random() * 24}px`, animationDelay: `${i * 50}ms` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
