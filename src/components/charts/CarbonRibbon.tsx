"use client";

import * as React from "react";
import type { IntensityPoint, RunWindow } from "@/lib/types";
import { cn, focusRing } from "@/components/ui/cn";
import { useChartWidth } from "./useChartWidth";
import { IntensityLegend } from "./IntensityLegend";
import {
  clamp,
  colorFor,
  formatDayHour,
  formatDayLabel,
  formatHourLabel,
  formatIntensity,
  niceTicks,
  nowIndex,
  scaleFromPoints,
  smoothPath,
  verdictFor,
} from "./chartUtils";

export interface CarbonRibbonProps {
  /** Hourly points, ascending. 24 to 168 of them. */
  points: IntensityPoint[];
  /** ISO timestamp for "now". Passed in so render stays pure. */
  now: string;
  /** IANA zone the reader's clock is in. Pass `region.timezone`. */
  timeZone?: string;
  /** Bands to highlight — the windows we are suggesting. */
  windows?: RunWindow[];
  /** Plot height in px (excludes the axis bands). */
  height?: number;
  showLegend?: boolean;
  /** Overrides the generated screen-reader summary. */
  ariaLabel?: string;
  onSelectWindow?: (w: RunWindow) => void;
  className?: string;
}

const MIN_LABEL_PX = 52;

export function CarbonRibbon({
  points,
  now,
  timeZone = "UTC",
  windows = [],
  height = 200,
  showLegend = true,
  ariaLabel,
  onSelectWindow,
  className,
}: CarbonRibbonProps) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const [ref, width] = useChartWidth<HTMLDivElement>(680);
  const [active, setActive] = React.useState<number | null>(null);

  const n = points.length;
  const compact = width < 420;
  const pad = {
    top: 26,
    right: 10,
    bottom: 26,
    left: compact ? 30 : 38,
  };
  const plotH = compact ? Math.min(height, 172) : height;
  const plotW = Math.max(60, width - pad.left - pad.right);
  const svgH = plotH + pad.top + pad.bottom;
  const baseY = pad.top + plotH;

  const scale = React.useMemo(() => scaleFromPoints(points), [points]);
  const times = React.useMemo(
    () => points.map((p) => new Date(p.ts).getTime()),
    [points],
  );

  const ticks = React.useMemo(() => {
    const top = scale.max * 1.08;
    return niceTicks(top, 4);
  }, [scale.max]);
  const domainTop = ticks[ticks.length - 1] || 1;

  const x = React.useCallback(
    (i: number) => pad.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1)),
    [n, plotW, pad.left],
  );
  const y = React.useCallback(
    (v: number) => pad.top + plotH - (clamp(v, 0, domainTop) / domainTop) * plotH,
    [domainTop, plotH, pad.top],
  );

  const fracIndex = React.useCallback(
    (ts: string) => {
      const t = new Date(ts).getTime();
      if (n === 0) return 0;
      if (t <= times[0]) return 0;
      if (t >= times[n - 1]) return n - 1;
      for (let i = 0; i < n - 1; i++) {
        if (t <= times[i + 1]) {
          const span = times[i + 1] - times[i];
          return span > 0 ? i + (t - times[i]) / span : i;
        }
      }
      return n - 1;
    },
    [n, times],
  );

  const geometry = React.useMemo(() => {
    const pts = points.map((p, i) => ({ x: x(i), y: y(p.gCO2PerKWh) }));
    const line = smoothPath(pts);
    const area =
      pts.length > 0
        ? `${line} L ${x(n - 1).toFixed(2)} ${baseY} L ${x(0).toFixed(2)} ${baseY} Z`
        : "";
    return { pts, line, area };
  }, [points, x, y, n, baseY]);

  const nowIdx = React.useMemo(() => nowIndex(points, now), [points, now]);
  const readoutIdx = active ?? nowIdx;
  const readout = readoutIdx >= 0 && readoutIdx < n ? points[readoutIdx] : null;

  const spanHours = n > 1 ? (times[n - 1] - times[0]) / 3_600_000 : 1;
  const useDayLabels = spanHours > 40;

  /* --- x-axis labels: pick a stride that never collides ------------------- */
  const xLabels = React.useMemo(() => {
    if (n === 0) return [];
    const maxLabels = Math.max(2, Math.floor(plotW / MIN_LABEL_PX));
    const stride = Math.max(1, Math.ceil(n / maxLabels));
    const out: { i: number; text: string }[] = [];
    for (let i = 0; i < n; i += stride) {
      out.push({
        i,
        text: useDayLabels
          ? formatDayLabel(points[i].ts, now, timeZone)
          : formatHourLabel(points[i].ts, timeZone),
      });
    }
    // Drop a final label that would sit on top of the previous one.
    if (out.length > 1) {
      const last = out[out.length - 1];
      const prev = out[out.length - 2];
      if (x(last.i) - x(prev.i) < MIN_LABEL_PX * 0.8) out.pop();
    }
    return out;
  }, [n, plotW, points, now, timeZone, useDayLabels, x]);

  /* --- accessible summary ------------------------------------------------- */
  const summary = React.useMemo(() => {
    if (n === 0) return "No carbon-intensity data available.";
    let minI = 0;
    let maxI = 0;
    for (let i = 1; i < n; i++) {
      if (points[i].gCO2PerKWh < points[minI].gCO2PerKWh) minI = i;
      if (points[i].gCO2PerKWh > points[maxI].gCO2PerKWh) maxI = i;
    }
    const nowPoint = nowIdx >= 0 ? points[nowIdx] : points[0];
    const drop = Math.round(
      (1 - points[minI].gCO2PerKWh / (nowPoint.gCO2PerKWh || 1)) * 100,
    );
    return [
      `Carbon intensity of your grid over the next ${Math.round(spanHours)} hours, in grams of CO2 per kilowatt-hour.`,
      `Right now it is ${formatIntensity(nowPoint.gCO2PerKWh)}.`,
      `The cleanest hour is ${formatDayHour(points[minI].ts, now, timeZone)} at ${formatIntensity(points[minI].gCO2PerKWh)}${drop > 0 ? `, ${drop} percent cleaner than now` : ""}.`,
      `The highest is ${formatDayHour(points[maxI].ts, now, timeZone)} at ${formatIntensity(points[maxI].gCO2PerKWh)}.`,
      windows.length
        ? `${windows.length} suggested window${windows.length === 1 ? "" : "s"} are highlighted.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [n, points, nowIdx, spanHours, now, timeZone, windows.length]);

  /* --- pointer + keyboard ------------------------------------------------- */
  const indexFromClientX = (clientX: number) => {
    const el = ref.current;
    if (!el || n === 0) return null;
    const rect = el.getBoundingClientRect();
    const local = clientX - rect.left - pad.left;
    const t = plotW > 0 ? local / plotW : 0;
    return clamp(Math.round(t * (n - 1)), 0, n - 1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (n === 0) return;
    const base = active ?? (nowIdx >= 0 ? nowIdx : 0);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActive(Math.min(n - 1, base + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActive(Math.max(0, base - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(n - 1);
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };

  if (n === 0) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-lg border border-dashed border-border bg-surface-2/40 px-4 text-center",
          className,
        )}
        style={{ minHeight: height + 52 }}
      >
        <p className="text-sm text-ink-3">
          No forecast for this grid yet. Check back in a few minutes.
        </p>
      </div>
    );
  }

  const activePoint = active !== null ? points[active] : null;
  const activeVerdict = activePoint
    ? verdictFor(activePoint.gCO2PerKWh, scale)
    : null;
  const activeWindow =
    activePoint && windows.length
      ? (windows.find((w) => {
          const t = new Date(activePoint.ts).getTime();
          return (
            t >= new Date(w.startTs).getTime() &&
            t < new Date(w.endTs).getTime()
          );
        }) ?? null)
      : null;

  return (
    <figure className={cn("m-0 flex flex-col gap-3", className)}>
      <div
        ref={ref}
        role="group"
        tabIndex={0}
        aria-label="Carbon intensity forecast. Use the left and right arrow keys to read each hour."
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? (nowIdx >= 0 ? nowIdx : 0))}
        onBlur={() => setActive(null)}
        onPointerMove={(e) => setActive(indexFromClientX(e.clientX))}
        onPointerDown={(e) => setActive(indexFromClientX(e.clientX))}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        className={cn(
          "relative w-full touch-pan-y select-none rounded-lg",
          focusRing,
        )}
      >
        <svg
          width="100%"
          height={svgH}
          viewBox={`0 0 ${Math.max(width, 1)} ${svgH}`}
          role="img"
          aria-label={ariaLabel ?? summary}
          className="block overflow-visible"
        >
          <defs>
            <linearGradient
              id={`hue-${uid}`}
              gradientUnits="userSpaceOnUse"
              x1={pad.left}
              y1="0"
              x2={pad.left + plotW}
              y2="0"
            >
              {points.map((p, i) => (
                <stop
                  key={i}
                  offset={n <= 1 ? 0 : i / (n - 1)}
                  stopColor={colorFor(p.gCO2PerKWh, scale)}
                />
              ))}
            </linearGradient>
            <linearGradient
              id={`fade-${uid}`}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1={pad.top}
              x2="0"
              y2={baseY}
            >
              <stop offset="0" stopColor="#fff" stopOpacity="1" />
              <stop offset="0.72" stopColor="#fff" stopOpacity="0.42" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
            </linearGradient>
            <mask
              id={`mask-${uid}`}
              maskUnits="userSpaceOnUse"
              x={pad.left}
              y={pad.top}
              width={plotW}
              height={plotH}
            >
              <rect
                x={pad.left}
                y={pad.top}
                width={plotW}
                height={plotH}
                fill={`url(#fade-${uid})`}
              />
            </mask>
          </defs>

          {/* Suggested windows — behind everything, so the data stays on top. */}
          {windows.map((w) => {
            const x1 = x(fracIndex(w.startTs));
            const x2 = Math.max(x1 + 6, x(fracIndex(w.endTs)));
            const bw = Math.min(x2, pad.left + plotW) - x1;
            const best = w.rank === 1;
            return (
              <g key={w.id}>
                <rect
                  x={x1}
                  y={pad.top - 3}
                  width={bw}
                  height={plotH + 3}
                  rx="6"
                  fill="var(--gm-brand)"
                  fillOpacity={best ? 0.11 : 0.06}
                  stroke="var(--gm-brand)"
                  strokeOpacity={best ? 0.4 : 0.2}
                  strokeWidth="1"
                  className={cn(
                    onSelectWindow &&
                      "cursor-pointer transition-[fill-opacity] duration-[var(--gm-dur-2)] hover:[fill-opacity:0.2]",
                  )}
                  onClick={onSelectWindow ? () => onSelectWindow(w) : undefined}
                />
                {bw > 44 ? (
                  <text
                    x={x1 + bw / 2}
                    y={pad.top - 9}
                    textAnchor="middle"
                    className={cn(
                      "text-[10px] font-semibold",
                      best ? "fill-brand" : "fill-ink-3",
                    )}
                  >
                    {best ? "Best" : w.quality === "great" ? "Great" : "Good"}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* Gridlines — solid hairlines, one step off the surface. */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={pad.left + plotW}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? "var(--gm-axis)" : "var(--gm-grid)"}
                strokeWidth="1"
                shapeRendering="crispEdges"
              />
              <text
                x={pad.left - 6}
                y={y(t) + 3.5}
                textAnchor="end"
                className="fill-ink-3 text-[10px] tabular-nums"
              >
                {t}
              </text>
            </g>
          ))}

          {/* The ribbon: one horizontal hue gradient, faded toward the baseline. */}
          <path
            d={geometry.area}
            fill={`url(#hue-${uid})`}
            fillOpacity="0.55"
            mask={`url(#mask-${uid})`}
          />
          <path
            d={geometry.line}
            fill="none"
            stroke={`url(#hue-${uid})`}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Now marker */}
          {nowIdx >= 0 ? (
            <g>
              <line
                x1={x(nowIdx)}
                x2={x(nowIdx)}
                y1={pad.top - 2}
                y2={baseY}
                stroke="var(--gm-ink-3)"
                strokeWidth="1"
                strokeOpacity="0.55"
                shapeRendering="crispEdges"
              />
              <circle
                cx={x(nowIdx)}
                cy={y(points[nowIdx].gCO2PerKWh)}
                r="4.5"
                fill={colorFor(points[nowIdx].gCO2PerKWh, scale)}
                stroke="var(--gm-surface)"
                strokeWidth="2"
              />
              <text
                x={clamp(x(nowIdx), pad.left + 12, pad.left + plotW - 12)}
                y={svgH - 8}
                textAnchor="middle"
                className="fill-ink-2 text-[10px] font-semibold"
              >
                Now
              </text>
            </g>
          ) : null}

          {/* Crosshair for the hovered / arrow-keyed hour */}
          {active !== null ? (
            <g pointerEvents="none">
              <line
                x1={x(active)}
                x2={x(active)}
                y1={pad.top - 2}
                y2={baseY}
                stroke="var(--gm-ink)"
                strokeWidth="1"
                strokeOpacity="0.28"
              />
              <circle
                cx={x(active)}
                cy={y(points[active].gCO2PerKWh)}
                r="5"
                fill={colorFor(points[active].gCO2PerKWh, scale)}
                stroke="var(--gm-surface)"
                strokeWidth="2"
              />
            </g>
          ) : null}

          {/* Hour / day labels — skipped where "Now" already sits */}
          {xLabels.map(({ i, text }) => {
            const px = x(i);
            if (nowIdx >= 0 && Math.abs(px - x(nowIdx)) < 26) return null;
            return (
              <text
                key={i}
                x={clamp(px, pad.left + 10, pad.left + plotW - 10)}
                y={svgH - 8}
                textAnchor="middle"
                className="fill-ink-3 text-[10px]"
              >
                {text}
              </text>
            );
          })}
        </svg>

        {/* Tooltip — HTML, so the type matches the rest of the product. */}
        {activePoint && activeVerdict ? (
          <div
            className={cn(
              "pointer-events-none absolute z-20 w-max max-w-56 rounded-lg",
              "border border-hairline bg-surface px-2.5 py-2 shadow-lg",
            )}
            style={{
              left: clamp(x(active as number), 84, Math.max(84, width - 84)),
              top: y(activePoint.gCO2PerKWh) - 12,
              transform:
                y(activePoint.gCO2PerKWh) < 96
                  ? "translate(-50%, 28px)"
                  : "translate(-50%, -100%)",
            }}
          >
            <div className="text-2xs text-ink-3">
              {formatDayHour(activePoint.ts, now, timeZone)}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-sm font-semibold text-ink tabular-nums">
                {formatIntensity(activePoint.gCO2PerKWh)}
              </span>
              <span className="text-2xs text-ink-3">g CO₂/kWh</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{
                  backgroundColor: colorFor(activePoint.gCO2PerKWh, scale),
                }}
              />
              <span className="text-2xs leading-snug text-ink-2">
                {activeVerdict.text}
              </span>
            </div>
            {activeWindow ? (
              <div className="mt-1.5 border-t border-hairline pt-1.5 text-2xs font-semibold text-brand-text">
                In your {activeWindow.rank === 1 ? "best" : "suggested"} window
                {" · "}
                {Math.round(activeWindow.savingsPercent)}% less CO₂
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Keyboard readout, announced politely. */}
        <span className="sr-only" aria-live="polite">
          {readout
            ? `${formatDayHour(readout.ts, now, timeZone)}: ${formatIntensity(readout.gCO2PerKWh)} grams per kilowatt-hour, ${verdictFor(readout.gCO2PerKWh, scale).text.toLowerCase()}.`
            : ""}
        </span>
      </div>

      {showLegend ? (
        <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <IntensityLegend showWindowKey={windows.length > 0} size="sm" />
          <span className="text-2xs text-ink-3">grams CO₂ per kWh</span>
        </figcaption>
      ) : null}

      {/* The table-view twin: every value reachable without hovering. Wrapped
          in a sr-only div rather than applying sr-only to the table itself —
          table auto-layout ignores an explicit `width: 1px` once cell content
          demands more, which was blowing out the page's horizontal scroll. */}
      <div className="sr-only">
        <table>
          <caption>Hourly carbon intensity, grams CO₂ per kWh</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Grams CO₂ per kWh</th>
              <th scope="col">Compared with usual</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.ts}>
                <th scope="row">{formatDayHour(p.ts, now, timeZone)}</th>
                <td>{formatIntensity(p.gCO2PerKWh)}</td>
                <td>{verdictFor(p.gCO2PerKWh, scale).text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
