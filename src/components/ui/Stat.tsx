import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "./cn";
import { Eyebrow } from "./Eyebrow";

export interface StatDelta {
  /** Signed change. Sign carries the direction; `goodDirection` carries meaning. */
  value: number;
  /** Formatted text. Defaults to a signed percent, e.g. "+12%". */
  text?: string;
  /** What it is measured against, e.g. "vs. last week". */
  period?: string;
  /** Which way is the good way. Default: up is good. */
  goodDirection?: "up" | "down";
}

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Small suffix glued to the value, e.g. "%" or "kg". */
  unit?: React.ReactNode;
  /**
   * The honest small print — the plan's "raw grams underneath in smaller type".
   * Wrapped in parentheses unless `parenthesize` is false.
   */
  sub?: React.ReactNode;
  parenthesize?: boolean;
  delta?: StatDelta;
  /** A sparkline or meter. Sits under the value. */
  trend?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "hero";
  tone?: "default" | "clean" | "accent";
  align?: "start" | "center";
}

const VALUE_SIZES = {
  sm: "text-xl",
  md: "text-3xl",
  lg: "text-4xl",
  hero: "text-5xl sm:text-6xl",
} as const;

/**
 * `sm`/`md` stay on the geometric sans: they're compact companion figures
 * (a streak count, "this week") read at a glance next to other numbers.
 * `lg`/`hero` are the standalone payoff figures — "CO₂ avoided, all time" —
 * which the app only ever shows one at a time, so the editorial serif's
 * proportional (non-tabular) digits read as a headline rather than data.
 */
const SERIF_SIZES = new Set(["lg", "hero"]);

const TONES = {
  default: "text-ink",
  clean: "text-i1-text",
  accent: "text-brand-text",
} as const;

export function Stat({
  label,
  value,
  unit,
  sub,
  parenthesize = true,
  delta,
  trend,
  size = "md",
  tone = "default",
  align = "start",
  className,
  ...rest
}: StatProps) {
  return (
    <div
      {...rest}
      className={cn(
        "flex min-w-0 flex-col",
        align === "center" && "items-center text-center",
        className,
      )}
    >
      <Eyebrow as="span">{label}</Eyebrow>

      <div
        className={cn(
          "mt-1 flex flex-wrap items-baseline",
          size === "hero" ? "gap-x-2" : "gap-x-1.5",
          align === "center" && "justify-center",
        )}
      >
        {/* Proportional figures: tabular-nums makes display numbers look loose. */}
        <span
          className={cn(
            VALUE_SIZES[size],
            TONES[tone],
            SERIF_SIZES.has(size)
              ? "font-display font-normal tracking-[-0.01em]"
              : "font-semibold tracking-[-0.02em]",
          )}
        >
          {value}
        </span>
        {unit ? (
          <span
            className={cn(
              "font-medium text-ink-3",
              size === "sm" ? "text-xs" : size === "hero" ? "text-lg" : "text-sm",
            )}
          >
            {unit}
          </span>
        ) : null}
        {delta ? <DeltaChip {...delta} /> : null}
      </div>

      {sub ? (
        <div className="mt-1 text-xs text-ink-3">
          {parenthesize ? <>({sub})</> : sub}
        </div>
      ) : null}

      {trend ? <div className="mt-2.5 w-full">{trend}</div> : null}
    </div>
  );
}

function DeltaChip({
  value,
  text,
  period,
  goodDirection = "up",
}: StatDelta) {
  const flat = value === 0;
  const up = value > 0;
  const good = flat ? null : (up ? "up" : "down") === goodDirection;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const label =
    text ?? `${up ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}%`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1 py-px",
        "text-xs font-semibold tabular-nums",
        good === null && "bg-surface-2 text-ink-3",
        good === true && "bg-good-soft text-good",
        good === false && "bg-danger-soft text-danger",
      )}
    >
      <Icon className="size-3" aria-hidden="true" strokeWidth={2.5} />
      {label}
      {period ? (
        <span className="ml-0.5 font-normal opacity-75">{period}</span>
      ) : null}
    </span>
  );
}
