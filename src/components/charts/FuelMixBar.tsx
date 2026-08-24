"use client";

import * as React from "react";
import { FUEL_LABELS } from "@/lib/emissions";
import type { FuelMix, FuelType } from "@/lib/types";
import { cn, focusRingTight } from "@/components/ui/cn";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { FUEL_COLORS, FUEL_ORDER } from "./chartUtils";

export interface FuelMixBarProps {
  /** Shares 0–1 per fuel. Anything summing to ~1 works; we normalise. */
  mix: FuelMix;
  /** Slices below this share fold into "Other" rather than becoming slivers. */
  foldBelow?: number;
  /** Track height in px. */
  height?: number;
  showLegend?: boolean;
  /** Prefix for the screen-reader summary, e.g. "Powering your grid right now". */
  summaryPrefix?: string;
  className?: string;
}

interface Segment {
  fuel: FuelType;
  label: string;
  share: number;
  color: string;
  folded?: boolean;
}

/**
 * Part-to-whole, so a stacked bar. Segments are separated by a 2px surface gap
 * (never a stroke), and the legend always ships — identity is never colour
 * alone. Fixed slot order means "gas" is the same colour on every screen.
 */
export function FuelMixBar({
  mix,
  foldBelow = 0.02,
  height = 14,
  showLegend = true,
  summaryPrefix = "Powering your grid right now",
  className,
}: FuelMixBarProps) {
  const [active, setActive] = React.useState<number | null>(null);

  const segments = React.useMemo<Segment[]>(() => {
    const total = FUEL_ORDER.reduce((sum, f) => sum + Math.max(0, mix[f] ?? 0), 0);
    if (total <= 0) return [];
    let foldedShare = 0;
    const kept: Segment[] = [];
    for (const fuel of FUEL_ORDER) {
      const share = Math.max(0, mix[fuel] ?? 0) / total;
      if (share <= 0) continue;
      if (share < foldBelow && fuel !== "other") {
        foldedShare += share;
        continue;
      }
      kept.push({
        fuel,
        label: FUEL_LABELS[fuel],
        share,
        color: FUEL_COLORS[fuel],
      });
    }
    if (foldedShare > 0) {
      const existing = kept.find((s) => s.fuel === "other");
      if (existing) {
        existing.share += foldedShare;
        existing.folded = true;
      } else {
        kept.push({
          fuel: "other",
          label: FUEL_LABELS.other,
          share: foldedShare,
          color: FUEL_COLORS.other,
          folded: true,
        });
      }
    }
    // Keep the canonical slot order so colours never move between renders.
    return kept.sort(
      (a, b) => FUEL_ORDER.indexOf(a.fuel) - FUEL_ORDER.indexOf(b.fuel),
    );
  }, [mix, foldBelow]);

  const ranked = React.useMemo(
    () => [...segments].sort((a, b) => b.share - a.share),
    [segments],
  );

  const summary = React.useMemo(() => {
    if (ranked.length === 0) return "No fuel-mix data available.";
    const parts = ranked
      .slice(0, 5)
      .map((s) => `${Math.round(s.share * 100)} percent ${s.label.toLowerCase()}`);
    return `${summaryPrefix}: ${parts.join(", ")}.`;
  }, [ranked, summaryPrefix]);

  if (segments.length === 0) {
    return (
      <div className={cn("text-xs text-ink-3", className)}>
        We don&apos;t have a fuel breakdown for this hour yet.
      </div>
    );
  }

  // Centre of each segment as a percentage of the track, for tooltip anchoring.
  const centers: number[] = [];
  let run = 0;
  for (const s of segments) {
    centers.push((run + s.share / 2) * 100);
    run += s.share;
  }
  const activeSegment = active !== null ? segments[active] : null;

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="relative">
        <div
          role="img"
          aria-label={summary}
          className="flex w-full overflow-hidden rounded-full bg-surface-2"
          style={{ height, gap: 2 }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setActive(null);
          }}
        >
          {segments.map((s, i) => (
            <span
              key={s.fuel}
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
              className={cn(
                "relative h-full min-w-[3px] cursor-default transition-opacity",
                "duration-[var(--gm-dur-1)]",
                active !== null && active !== i ? "opacity-40" : "opacity-100",
              )}
              style={{
                flexBasis: `${s.share * 100}%`,
                backgroundColor: s.color,
              }}
            />
          ))}
        </div>

        {activeSegment ? (
          <div
            className={cn(
              "pointer-events-none absolute bottom-full z-20 mb-2 w-max",
              "rounded-lg border border-hairline bg-surface px-2 py-1 shadow-lg",
            )}
            style={{
              left: `clamp(0px, ${centers[active as number]}%, 100%)`,
              transform: "translateX(-50%)",
            }}
          >
            <span className="font-mono text-sm font-semibold text-ink tabular-nums">
              {Math.round(activeSegment.share * 100)}%
            </span>{" "}
            <Eyebrow as="span">{activeSegment.label}</Eyebrow>
          </div>
        ) : null}
      </div>

      {/* The legend is the table view: label + value, never colour alone. */}
      {showLegend ? (
        <ul className="flex flex-wrap gap-x-3.5 gap-y-1.5">
          {ranked.map((s) => {
            const i = segments.indexOf(s);
            return (
              <li key={s.fuel}>
                <button
                  type="button"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className={cn(
                    "flex items-center gap-1.5 rounded text-xs transition-opacity",
                    active !== null && active !== i && "opacity-50",
                    focusRingTight,
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-xs"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-ink-2">{s.label}</span>
                  <span className="font-mono font-semibold text-ink tabular-nums">
                    {Math.round(s.share * 100)}%
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
