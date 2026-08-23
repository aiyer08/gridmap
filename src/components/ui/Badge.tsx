import * as React from "react";
import { cn } from "./cn";

/**
 * Semantic tones. `clean | moderate | dirty` come from the carbon-intensity
 * ramp so a pill and a chart mark always agree; `neutral | accent` are chrome.
 */
export type BadgeTone =
  | "clean"
  | "moderate"
  | "dirty"
  | "neutral"
  | "accent"
  | "warn"
  | "danger";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: "sm" | "md";
  /** Fully rounded (a Pill) vs. softly rounded (a Badge). */
  shape?: "pill" | "rounded";
  /** A small colour key in front of the label — identity is never colour-alone. */
  dot?: boolean;
  /** Explicit dot colour, e.g. a fuel colour. Overrides the tone's dot. */
  dotColor?: string;
  icon?: React.ReactNode;
}

const TONES: Record<BadgeTone, string> = {
  clean: "bg-i1-soft text-i1-text border-transparent",
  moderate: "bg-i3-soft text-i3-text border-transparent",
  dirty: "bg-i5-soft text-i5-text border-transparent",
  neutral: "bg-surface-2 text-ink-2 border-hairline",
  accent: "bg-brand-soft text-brand-text border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

const DOTS: Record<BadgeTone, string> = {
  clean: "bg-i1",
  moderate: "bg-i3",
  dirty: "bg-i5",
  neutral: "bg-ink-4",
  accent: "bg-brand",
  warn: "bg-fuel-solar",
  danger: "bg-danger-fill",
};

export function Badge({
  tone = "neutral",
  size = "md",
  shape = "rounded",
  dot = false,
  dotColor,
  icon,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      {...rest}
      className={cn(
        "inline-flex max-w-full items-center border font-medium",
        "align-middle whitespace-nowrap",
        shape === "pill" ? "rounded-full" : "rounded-md",
        size === "sm"
          ? "h-5 gap-1 px-1.5 text-2xs [&_svg]:size-3"
          : "h-6 gap-1.5 px-2 text-xs [&_svg]:size-3.5",
        TONES[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            !dotColor && DOTS[tone],
          )}
          style={dotColor ? { backgroundColor: dotColor } : undefined}
        />
      ) : null}
      {icon ? (
        <span className="shrink-0 opacity-90" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Fully-rounded badge. Same API. */
export function Pill(props: BadgeProps) {
  return <Badge shape="pill" {...props} />;
}
