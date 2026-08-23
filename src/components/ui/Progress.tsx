"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "./cn";

export type ProgressTone = "accent" | "clean" | "neutral";

const FILL: Record<ProgressTone, string> = {
  accent: "bg-brand",
  clean: "bg-i2",
  neutral: "bg-ink-3",
};

/** The unfilled track is a lighter step of the fill's own ramp. */
const TRACK: Record<ProgressTone, string> = {
  accent: "bg-brand-soft",
  clean: "bg-i2-soft",
  neutral: "bg-surface-3",
};

const STROKE: Record<ProgressTone, string> = {
  accent: "stroke-brand",
  clean: "stroke-i2",
  neutral: "stroke-ink-3",
};

const STROKE_TRACK: Record<ProgressTone, string> = {
  accent: "stroke-brand-soft",
  clean: "stroke-i2-soft",
  neutral: "stroke-surface-3",
};

export interface ProgressBarProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  value: number;
  max?: number;
  tone?: ProgressTone;
  size?: "sm" | "md" | "lg";
  /** Visible label above the bar. */
  label?: React.ReactNode;
  /** Right-aligned value text above the bar, e.g. "3.2 of 5 kg". */
  valueText?: React.ReactNode;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
}

export function ProgressBar({
  value,
  max = 100,
  tone = "accent",
  size = "md",
  label,
  valueText,
  ariaLabel,
  className,
  ...rest
}: ProgressBarProps) {
  const reduce = useReducedMotion();
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <div {...rest} className={cn("w-full", className)}>
      {label || valueText ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label ? (
            <span className="text-xs font-medium text-ink-2">{label}</span>
          ) : (
            <span />
          )}
          {valueText ? (
            <span className="text-xs text-ink-3 tabular-nums">{valueText}</span>
          ) : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={
          label ? undefined : (ariaLabel ?? "Progress")
        }
        className={cn(
          "w-full overflow-hidden rounded-full",
          TRACK[tone],
          size === "sm" ? "h-1.5" : size === "md" ? "h-2 " : "h-3",
        )}
      >
        <motion.div
          className={cn("h-full rounded-full", FILL[tone])}
          initial={reduce ? { width: `${pct}%` } : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={
            reduce
              ? { duration: 0 }
              : { duration: 0.7, ease: [0.22, 1, 0.36, 1] }
          }
        />
      </div>
    </div>
  );
}

export interface ProgressRingProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  value: number;
  max?: number;
  /** Outer diameter in px. */
  size?: number;
  thickness?: number;
  tone?: ProgressTone;
  /** Big text in the middle. */
  centerLabel?: React.ReactNode;
  /** Small text under it. */
  centerSub?: React.ReactNode;
  ariaLabel?: string;
}

export function ProgressRing({
  value,
  max = 100,
  size = 96,
  thickness = 8,
  tone = "accent",
  centerLabel,
  centerSub,
  ariaLabel,
  className,
  ...rest
}: ProgressRingProps) {
  const reduce = useReducedMotion();
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div
      {...rest}
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={ariaLabel ?? "Progress"}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          className={STROKE_TRACK[tone]}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={c}
          className={STROKE[tone]}
          initial={reduce ? { strokeDashoffset: c * (1 - pct) } : { strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={
            reduce ? { duration: 0 } : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }
          }
        />
      </svg>
      {centerLabel || centerSub ? (
        <div className="absolute inset-0 grid place-content-center text-center">
          {centerLabel ? (
            <div
              className="font-semibold tracking-[-0.02em] text-ink"
              style={{ fontSize: Math.max(14, Math.round(size * 0.24)) }}
            >
              {centerLabel}
            </div>
          ) : null}
          {centerSub ? (
            <div className="mt-0.5 text-2xs text-ink-3">{centerSub}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
