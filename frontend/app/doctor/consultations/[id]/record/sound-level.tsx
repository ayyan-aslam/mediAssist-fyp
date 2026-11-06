"use client";

import { useEffect, useRef } from "react";

const BARS = 32;
// New sample every ~70 ms, so the bars move from right to left at an easy pace.
const SAMPLE_MS = 70;

// Live sound level: the newest level enters on the right. The bars are moved by changing their
// style directly on each frame, so React does not re-render 60 times a second.
export function SoundLevel({ getLevel, active }: { getLevel: () => number; active: boolean }) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const levels = new Array<number>(BARS).fill(0);
    let frame = 0;
    let lastSample = 0;
    let peak = 0;

    const draw = (now: number) => {
      // Keep the loudest moment between two samples, so short words still show.
      peak = Math.max(peak, active ? getLevel() : 0);
      if (now - lastSample >= SAMPLE_MS) {
        levels.shift();
        levels.push(peak);
        peak = 0;
        lastSample = now;
        levels.forEach((level, i) => {
          const bar = barsRef.current[i];
          if (bar) bar.style.transform = `scaleY(${0.08 + level * 0.92})`;
        });
      }
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active, getLevel]);

  return (
    <div aria-hidden="true" className="flex h-16 items-center justify-center gap-[3px] sm:h-20 sm:gap-1">
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className="h-full w-1 origin-center rounded-full bg-brand-bright transition-transform duration-75 ease-out sm:w-1.5"
          style={{ opacity: 0.35 + (0.65 * (i + 1)) / BARS, transform: "scaleY(0.08)" }}
        />
      ))}
    </div>
  );
}
