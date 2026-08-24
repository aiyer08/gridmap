"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/components/ui/cn";

export interface MarqueeProps {
  items: React.ReactNode[];
  className?: string;
  /** Seconds for one full loop of a single track. */
  duration?: number;
}

/** Small square glyph between items — the reference's own separator. */
function Glyph() {
  return (
    <span
      aria-hidden="true"
      className="mx-4 inline-block size-[6px] shrink-0 align-middle sm:mx-6"
      style={{ backgroundColor: "var(--gm-sun)" }}
    />
  );
}

/**
 * Infinite horizontal ticker. The track is rendered twice back to back and
 * translated by exactly -50%, so the loop has no seam; pauses on hover and
 * renders as a single static (non-scrolling) row under reduced motion.
 *
 * Colour is deliberately not set here — it inherits `color` from whatever
 * wraps it, so the same component reads correctly on a dark strip or a light
 * one. Only typography (case, tracking, size) is opinionated.
 *
 * Decorative and duplicated by construction, so the whole thing is hidden
 * from assistive tech; the facts it shows also exist as real content
 * elsewhere on the page.
 */
export function Marquee({ items, className, duration }: MarqueeProps) {
  const reduce = useReducedMotion();
  const [paused, setPaused] = React.useState(false);

  if (items.length === 0) return null;

  const track = (copy: number) => (
    <div
      key={copy}
      aria-hidden={copy === 1 || undefined}
      className="flex shrink-0 items-center"
    >
      {items.map((item, i) => (
        <React.Fragment key={i}>
          <span className="whitespace-nowrap">{item}</span>
          <Glyph />
        </React.Fragment>
      ))}
    </div>
  );

  // Fixed-ish speed regardless of how many facts there are: more items get a
  // proportionally longer loop rather than a faster one.
  const loopSeconds = duration ?? Math.max(16, items.length * 5);

  return (
    <div
      aria-hidden="true"
      className={cn("w-full overflow-hidden", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {reduce ? (
        <div className="flex flex-wrap items-center gap-y-2 py-3 text-2xs font-medium tracking-[0.14em] uppercase">
          {items.map((item, i) => (
            <React.Fragment key={i}>
              <span className="whitespace-nowrap">{item}</span>
              {i < items.length - 1 ? <Glyph /> : null}
            </React.Fragment>
          ))}
        </div>
      ) : (
        <div
          className="flex w-max py-3 text-2xs font-medium tracking-[0.14em] uppercase"
          style={{
            animationName: "gm-marquee-scroll",
            animationDuration: `${loopSeconds}s`,
            animationTimingFunction: "linear",
            animationIterationCount: "infinite",
            animationPlayState: paused ? "paused" : "running",
          }}
        >
          {track(0)}
          {track(1)}
        </div>
      )}
      {/* Scoped keyframes — kept local rather than added to the shared
          globals.css, which this component doesn't own. */}
      <style>{`
        @keyframes gm-marquee-scroll {
          to { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
