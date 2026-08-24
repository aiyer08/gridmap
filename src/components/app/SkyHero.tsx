"use client";

import * as React from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { cn } from "@/components/ui/cn";
import { hourInZone } from "@/lib/format";
import type { GridSnapshot } from "@/lib/types";
import { CascadeHeading } from "@/components/motion/CascadeHeading";

export interface SkyHeroProps {
  /** The live snapshot, once a region is known. `null`/`undefined` while
   * there's no location yet or the first fetch is still in flight. */
  snapshot?: GridSnapshot | null;
  lines: string[];
  subhead: React.ReactNode;
  /** Location controls / the cold-start prompt, rendered inside the hero. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The full-bleed illustrated hero: a periwinkle sky, a sun disc, a silhouette
 * skyline, and the cascading headline on top. Scroll-linked parallax drifts
 * the sun and scales the sky a touch while the text holds still.
 *
 * The sun is not decoration alone. Its height on the sky is the real local
 * hour at the region derived from `snapshot.now.ts` in `snapshot.region.timezone`
 * (a plain sine day-arc: high at solar noon, low at midnight), and its glow /
 * size gets an extra boost from the *actual* solar share of the current
 * fuel mix — a sunnier grid literally makes for a brighter sun. Before a
 * region is known there is no real hour to anchor it to, so it falls back to
 * a fixed, clearly-decorative mid-afternoon position instead of guessing.
 */
export function SkyHero({ snapshot, lines, subhead, children, className }: SkyHeroProps) {
  const reduce = useReducedMotion();
  const heroRef = React.useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const skyScale = useTransform(scrollYProgress, [0, 1], [1, 1.07]);
  const sunDrift = useTransform(scrollYProgress, [0, 1], [0, -56]);

  const localHour = snapshot ? hourInZone(snapshot.now.ts, snapshot.region.timezone) : null;
  const solarShare = snapshot?.now.fuelMix?.solar ?? 0;

  // A plain sine day-arc: -1 at midnight, 0 at sunrise/sunset (6/18), +1 at
  // solar noon. `null` (no region yet) falls back to a fixed, decorative
  // mid-afternoon value rather than a real one.
  const altitude = localHour !== null ? Math.sin(((localHour - 6) / 12) * Math.PI) : 0.55;
  const dayFactor = Math.max(0, altitude);
  const topPercent = 46 - altitude * 36;
  const glowOpacity = Math.min(0.85, 0.22 + dayFactor * 0.3 + solarShare * 0.45);
  const sunScale = 1 + dayFactor * 0.12 + solarShare * 0.3;

  return (
    <section
      ref={heroRef}
      className={cn("relative isolate overflow-hidden", className)}
    >
      <motion.div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(165deg, var(--gm-sky) 0%, var(--gm-sky-deep) 82%)",
          scale: reduce ? undefined : skyScale,
        }}
      />

      {/* Sun glow halo */}
      <motion.div
        aria-hidden="true"
        className="absolute rounded-full"
        style={{
          top: `${topPercent}%`,
          right: "6%",
          width: "clamp(180px, 26vw, 380px)",
          height: "clamp(180px, 26vw, 380px)",
          transform: `translate(32%, -50%) scale(${sunScale})`,
          backgroundColor: "var(--gm-sun)",
          opacity: glowOpacity,
          filter: "blur(48px)",
          y: reduce ? undefined : sunDrift,
        }}
      />
      {/* Sun disc — flat, per the reference, with the softly-shaded edge doing
          just enough work to read as a sphere rather than a sticker. The
          halo above carries the data-driven "glow" so the disc itself can
          stay flat. */}
      <motion.div
        aria-hidden="true"
        className="absolute rounded-full"
        style={{
          top: `${topPercent}%`,
          right: "6%",
          width: "clamp(76px, 11vw, 172px)",
          height: "clamp(76px, 11vw, 172px)",
          transform: `translate(32%, -50%) scale(${sunScale})`,
          background:
            "radial-gradient(circle at 42% 38%, var(--gm-sun) 60%, var(--gm-sun-deep) 100%)",
          y: reduce ? undefined : sunDrift,
        }}
      />

      <Skyline className="absolute inset-x-0 bottom-0 z-[1]" />

      {/* Smooth hand-off into the page below. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 z-[1] h-20 sm:h-28"
        style={{
          backgroundImage: "linear-gradient(to bottom, transparent, var(--gm-page))",
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 pt-16 pb-14 sm:px-6 sm:pt-24 sm:pb-20">
        <CascadeHeading
          lines={lines}
          className="[color:var(--gm-sky-ink)] text-5xl leading-[0.98] tracking-tight sm:text-7xl md:text-8xl"
        />
        <p className="mt-6 max-w-md text-pretty text-sm leading-relaxed opacity-90 sm:max-w-lg sm:text-base [color:var(--gm-sky-ink)]">
          {subhead}
        </p>
        {children ? <div className="mt-7">{children}</div> : null}
      </div>
    </section>
  );
}

/**
 * A flat, silhouette city skyline — plain rectangles with a tiny window-grid
 * pattern, not an illustration. Building widths/heights are a fixed
 * (non-random) sequence so server and client markup always match.
 */
const BUILDINGS = [
  8, 15, 6, 20, 9, 17, 5, 22, 11, 14, 7, 19, 10, 16, 6, 21, 9, 13, 8, 18,
] as const;

interface SkylineBar {
  x: number;
  w: number;
  h: number;
}

/** Lays buildings out left to right without mutating a running cursor —
 * each step returns a brand-new list, which keeps this safe under the
 * React Compiler's render-purity checks. */
function layoutSkyline(heights: readonly number[]): { bars: SkylineBar[]; width: number } {
  const { bars, cursor } = heights.reduce<{ bars: SkylineBar[]; cursor: number }>(
    (acc, h, i) => {
      const w = 9 + (i % 3) * 2;
      return {
        bars: [...acc.bars, { x: acc.cursor, w, h: 14 + h }],
        cursor: acc.cursor + w + 1.4,
      };
    },
    { bars: [], cursor: 0 },
  );
  return { bars, width: cursor };
}

function Skyline({ className }: { className?: string }) {
  const { bars, width: totalWidth } = layoutSkyline(BUILDINGS);

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${totalWidth} 46`}
      preserveAspectRatio="none"
      className={cn("h-24 w-full sm:h-32", className)}
    >
      <defs>
        <pattern id="gm-skyline-grid" width="3.2" height="3.2" patternUnits="userSpaceOnUse">
          <circle cx="0.9" cy="0.9" r="0.35" fill="rgba(253, 248, 240, 0.22)" />
        </pattern>
      </defs>
      {bars.map((b, i) => (
        <React.Fragment key={i}>
          <rect x={b.x} y={46 - b.h} width={b.w} height={b.h} fill="rgba(18, 13, 28, 0.45)" />
          <rect x={b.x} y={46 - b.h} width={b.w} height={b.h} fill="url(#gm-skyline-grid)" />
        </React.Fragment>
      ))}
    </svg>
  );
}
