import { useRef, useEffect } from "react";

interface Props {
  peaks: number[];
  currentTime: number;
  duration: number;
  color: string;
  isOn: boolean;
  playing: boolean;
}

export default function PeakMeter({ peaks, currentTime, duration, color, isOn, playing }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number | null>(null);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  currentTimeRef.current = currentTime;
  durationRef.current = duration;

  const peakDecayRef = useRef(0);
  const levelRef = useRef(0);

  useEffect(() => {
    const tick = () => {
      const bar = barRef.current;
      const hold = holdRef.current;
      if (!bar || !hold) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      if (!isOn || !playing || peaks.length === 0) {
        // Decay to zero
        levelRef.current = Math.max(0, levelRef.current - 0.05);
        peakDecayRef.current = Math.max(0, peakDecayRef.current - 0.03);
        bar.style.width = `${levelRef.current * 100}%`;
        hold.style.left = `calc(${peakDecayRef.current * 100}% - 1px)`;
        hold.style.display = peakDecayRef.current > 0.02 ? "" : "none";

        if (levelRef.current > 0.01 || peakDecayRef.current > 0.01) {
          animRef.current = requestAnimationFrame(tick);
        }
        return;
      }

      const dur = durationRef.current;
      const progress = dur > 0 ? currentTimeRef.current / dur : 0;
      const idx = Math.floor(progress * peaks.length);
      const windowSize = 3;
      let sum = 0;
      let count = 0;
      for (let i = Math.max(0, idx - windowSize); i <= Math.min(peaks.length - 1, idx + windowSize); i++) {
        sum += peaks[i];
        count++;
      }
      const raw = count > 0 ? sum / count : 0;
      const jitter = 0.9 + Math.random() * 0.2;
      const current = Math.min(1, raw * jitter);

      levelRef.current = current;

      if (current > peakDecayRef.current) {
        peakDecayRef.current = current;
      } else {
        peakDecayRef.current = Math.max(0, peakDecayRef.current - 0.008);
      }

      // Color based on level
      const meterColor = current > 0.85 ? "#ef4444" : current > 0.65 ? "#eab308" : color;
      const holdColor = peakDecayRef.current > 0.85 ? "#ef4444" : peakDecayRef.current > 0.65 ? "#eab308" : color;

      bar.style.width = `${current * 100}%`;
      bar.style.background = `linear-gradient(90deg, ${color}, ${meterColor})`;
      hold.style.left = `calc(${peakDecayRef.current * 100}% - 1px)`;
      hold.style.backgroundColor = holdColor;
      hold.style.display = peakDecayRef.current > 0.02 ? "" : "none";

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isOn, playing, peaks, color]);

  return (
    <div className="flex items-center gap-1.5 w-full h-2.5">
      <div className="flex-1 h-full bg-surface rounded-full overflow-hidden relative">
        <div
          ref={barRef}
          className="h-full rounded-full"
          style={{ transition: "width 60ms linear" }}
        />
        <div
          ref={holdRef}
          className="absolute top-0 h-full w-0.5 rounded-full"
          style={{ transition: "left 60ms linear", display: "none" }}
        />
      </div>
    </div>
  );
}
