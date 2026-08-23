"use client";

import * as React from "react";
import { cn, focusRing } from "@/components/ui/cn";
import { useChartWidth } from "./useChartWidth";
import { clamp, formatGrams, smoothPath } from "./chartUtils";

export interface SparkPoint {
  /** Short axis label, e.g. "Mon" or "Wk 12". Pre-formatted by the caller. */
  label: string;
  value: number;
}

export interface ImpactSparklineProps {
  points: SparkPoint[];
  /** Bars for discrete buckets (days, weeks); line for a running total. */
  variant?: "bars" | "line";
  /** Emphasis: this index wears the accent, the rest recede. Default: last. */
  emphasisIndex?: number;
  /** Optional target line, e.g. a weekly goal in grams. */
  goal?: number;
  goalLabel?: string;
  height?: number;
  /** How to render a value in the tooltip. Defaults to grams → kg. */
  format?: (value: number) => string;
  /** What the numbers are, for the screen-reader summary. */
  unitName?: string;
  className?: string;
}

/**
 * A small weekly-progress chart. One series, so no legend box — emphasis does
 * the work: the current bucket takes the accent, the rest sit in the
 * de-emphasis grey.
 */
export function ImpactSparkline({
  points,
  variant = "bars",
  emphasisIndex,
  goal,
  goalLabel = "Goal",
  height = 72,
  format = formatGrams,
  unitName = "grams of CO₂ avoided",
  className,
}: ImpactSparklineProps) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const [ref, width] = useChartWidth<HTMLDivElement>(320);
  const [active, setActive] = React.useState<number | null>(null);

  const n = points.length;
  const pad = { top: 8, right: 2, bottom: 16, left: 2 };
  const plotW = Math.max(24, width - pad.left - pad.right);
  const plotH = height;
  const svgH = plotH + pad.top + pad.bottom;
  const baseY = pad.top + plotH;

  const emphasis = emphasisIndex ?? n - 1;
  const maxValue = Math.max(
    1,
    ...points.map((p) => p.value),
    goal ?? 0,
  );
  const y = (v: number) => baseY - (clamp(v, 0, maxValue) / maxValue) * plotH;

  const band = n > 0 ? plotW / n : plotW;
  const barW = Math.min(24, Math.max(4, band - 6));
  const barX = (i: number) => pad.left + i * band + (band - barW) / 2;
  const pointX = (i: number) =>
    pad.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));

  const summary = React.useMemo(() => {
    if (n === 0) return "No data yet.";
    const total = points.reduce((s, p) => s + p.value, 0);
    const best = points.reduce((a, b) => (b.value > a.value ? b : a));
    return `${unitName}, ${n} buckets. Total ${format(total)}. Best was ${best.label} at ${format(best.value)}. Latest is ${points[n - 1].label} at ${format(points[n - 1].value)}.`;
  }, [points, n, format, unitName]);

  if (n === 0) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-lg border border-dashed border-border text-xs text-ink-3",
          className,
        )}
        style={{ height: height + 24 }}
      >
        Nothing logged yet
      </div>
    );
  }

  const activePoint = active !== null ? points[active] : null;

  return (
    <figure className={cn("m-0", className)}>
      <div
        ref={ref}
        role="group"
        tabIndex={0}
        aria-label="Weekly impact. Use the arrow keys to read each bucket."
        onKeyDown={(e) => {
          const base = active ?? emphasis;
          if (e.key === "ArrowRight") {
            e.preventDefault();
            setActive(Math.min(n - 1, base + 1));
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            setActive(Math.max(0, base - 1));
          } else if (e.key === "Escape") {
            setActive(null);
          }
        }}
        onBlur={() => setActive(null)}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        className={cn("relative w-full rounded-lg", focusRing)}
      >
        <svg
          width="100%"
          height={svgH}
          viewBox={`0 0 ${Math.max(width, 1)} ${svgH}`}
          role="img"
          aria-label={summary}
          className="block overflow-visible"
        >
          {variant === "line" ? (
            <defs>
              <linearGradient
                id={`spark-${uid}`}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={pad.top}
                x2="0"
                y2={baseY}
              >
                <stop offset="0" stopColor="var(--gm-brand)" stopOpacity="0.16" />
                <stop offset="1" stopColor="var(--gm-brand)" stopOpacity="0" />
              </linearGradient>
            </defs>
          ) : null}

          {/* Baseline hairline */}
          <line
            x1={pad.left}
            x2={pad.left + plotW}
            y1={baseY}
            y2={baseY}
            stroke="var(--gm-axis)"
            strokeWidth="1"
            shapeRendering="crispEdges"
          />

          {goal !== undefined ? (
            <g>
              <line
                x1={pad.left}
                x2={pad.left + plotW}
                y1={y(goal)}
                y2={y(goal)}
                stroke="var(--gm-ink-4)"
                strokeWidth="1"
                shapeRendering="crispEdges"
              />
              <text
                x={pad.left + plotW}
                y={y(goal) - 4}
                textAnchor="end"
                className="fill-ink-4 text-[10px]"
              >
                {goalLabel}
              </text>
            </g>
          ) : null}

          {variant === "bars" ? (
            points.map((p, i) => {
              const top = y(p.value);
              const h = Math.max(p.value > 0 ? 2 : 0, baseY - top);
              const isEmphasis = i === emphasis;
              const isActive = active === i;
              return (
                <g key={i}>
                  {/* Hit target: the whole band, never just the painted bar. */}
                  <rect
                    x={pad.left + i * band}
                    y={pad.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    onPointerEnter={() => setActive(i)}
                    onPointerDown={() => setActive(i)}
                  />
                  <rect
                    x={barX(i)}
                    y={top}
                    width={barW}
                    height={h}
                    rx={Math.min(4, barW / 2)}
                    fill={
                      isEmphasis ? "var(--gm-brand)" : "var(--gm-border-strong)"
                    }
                    opacity={
                      active !== null && !isActive && !isEmphasis ? 0.6 : 1
                    }
                    className="pointer-events-none transition-opacity duration-[var(--gm-dur-1)]"
                  />
                </g>
              );
            })
          ) : (
            <>
              <path
                d={`${smoothPath(points.map((p, i) => ({ x: pointX(i), y: y(p.value) })))} L ${pointX(n - 1)} ${baseY} L ${pointX(0)} ${baseY} Z`}
                fill={`url(#spark-${uid})`}
              />
              <path
                d={smoothPath(points.map((p, i) => ({ x: pointX(i), y: y(p.value) })))}
                fill="none"
                stroke="var(--gm-brand)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {points.map((p, i) => (
                <rect
                  key={`hit-${i}`}
                  x={pointX(i) - band / 2}
                  y={pad.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                />
              ))}
              <circle
                cx={pointX(n - 1)}
                cy={y(points[n - 1].value)}
                r="4"
                fill="var(--gm-brand)"
                stroke="var(--gm-surface)"
                strokeWidth="2"
                className="pointer-events-none"
              />
            </>
          )}

          {active !== null ? (
            <circle
              cx={variant === "bars" ? barX(active) + barW / 2 : pointX(active)}
              cy={y(points[active].value)}
              r="4"
              fill="var(--gm-brand)"
              stroke="var(--gm-surface)"
              strokeWidth="2"
              className="pointer-events-none"
            />
          ) : null}

          {/* Direct label on the emphasised bucket only. */}
          <text
            x={
              variant === "bars"
                ? clamp(barX(emphasis) + barW / 2, 14, width - 14)
                : clamp(pointX(emphasis), 14, width - 14)
            }
            y={svgH - 4}
            textAnchor="middle"
            className="fill-ink-2 text-[10px] font-semibold"
          >
            {points[emphasis]?.label}
          </text>
          {points.map((p, i) =>
            i === emphasis || n > 8 ? null : (
              <text
                key={`lbl-${i}`}
                x={
                  variant === "bars"
                    ? clamp(barX(i) + barW / 2, 12, width - 12)
                    : clamp(pointX(i), 12, width - 12)
                }
                y={svgH - 4}
                textAnchor="middle"
                className="fill-ink-4 text-[10px]"
              >
                {p.label}
              </text>
            ),
          )}
        </svg>

        {activePoint ? (
          <div
            className={cn(
              "pointer-events-none absolute z-20 w-max rounded-lg",
              "border border-hairline bg-surface px-2 py-1 shadow-lg",
            )}
            style={{
              left: clamp(
                variant === "bars"
                  ? barX(active as number) + barW / 2
                  : pointX(active as number),
                44,
                Math.max(44, width - 44),
              ),
              top: Math.max(0, y(activePoint.value) - 10),
              transform: "translate(-50%, -100%)",
            }}
          >
            <span className="text-sm font-semibold text-ink tabular-nums">
              {format(activePoint.value)}
            </span>{" "}
            <span className="text-2xs text-ink-3">{activePoint.label}</span>
          </div>
        ) : null}
      </div>

      <table className="sr-only">
        <caption>{unitName}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <th scope="row">{p.label}</th>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
