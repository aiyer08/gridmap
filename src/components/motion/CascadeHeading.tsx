"use client";

import * as React from "react";
import { cn } from "@/components/ui/cn";

export interface CascadeHeadingProps {
  /** Each entry is one line, top to bottom. */
  lines: string[];
  className?: string;
  lineClassName?: string;
  /** Extra left indent per line, in `em` — scales with the heading's own type size. */
  step?: number;
  /** Gap between each line's animation start, in seconds. */
  stagger?: number;
  as?: "h1" | "h2";
}

/**
 * The signature staggered display headline: one `<h1>` (semantically a single
 * heading, never three), rendered as a block per line, each indented a
 * little further right than the last — the reference's own "Rethink. /
 * Rebuild. / Refound." cascade — with lines animating in one after another.
 *
 * Indentation is in `em` so it scales with the heading's font-size rather
 * than a fixed pixel amount, which keeps the cascade proportionate from a
 * 390px phone up to a wide desktop hero without any breakpoint juggling.
 *
 * The reveal is pure CSS (`@keyframes` + `animation-delay`), not Framer's
 * JS/`requestAnimationFrame`-driven `animate`. That matters for the most
 * important text on the page: a CSS animation is painted by the browser
 * itself, so it still runs — and finishes — with JavaScript disabled, erroring,
 * or (the case that actually bit this once) merely paused because the tab was
 * backgrounded and `requestAnimationFrame` got throttled. The headline is
 * never gated on script execution to become visible.
 */
export function CascadeHeading({
  lines,
  className,
  lineClassName,
  step = 0.8,
  stagger = 0.08,
  as = "h1",
}: CascadeHeadingProps) {
  const Tag = as;

  return (
    <>
      <Tag
        className={cn(
          "font-[family-name:var(--font-display)] font-normal",
          className,
        )}
      >
        {lines.map((line, i) => (
          <span
            key={i}
            className={cn("block text-balance", lineClassName)}
            style={{ marginLeft: `${i * step}em` }}
          >
            <span
              className="gm-cascade-line inline-block"
              style={
                { "--gm-cascade-delay": `${i * stagger}s` } as React.CSSProperties
              }
            >
              {line}
            </span>
          </span>
        ))}
      </Tag>
      {/* Scoped keyframes — kept local rather than added to the shared
          globals.css, which this component doesn't own. `both` fill mode
          means the pre-animation frame *is* the hidden state and the
          post-animation frame *is* the resting, fully-visible state; there is
          no third "just sitting at opacity 0 forever" state reachable by a
          stalled main thread. */}
      <style>{`
        @keyframes gm-cascade-in {
          from { opacity: 0; transform: translateY(22px); filter: blur(6px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        .gm-cascade-line {
          animation: gm-cascade-in 0.62s cubic-bezier(0.44, 0, 0.56, 1) both;
          animation-delay: var(--gm-cascade-delay, 0s);
        }
        @media (prefers-reduced-motion: reduce) {
          .gm-cascade-line { animation: none; }
        }
      `}</style>
    </>
  );
}
