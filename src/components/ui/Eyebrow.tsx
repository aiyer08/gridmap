import * as React from "react";
import { cn } from "./cn";

export interface EyebrowProps extends React.HTMLAttributes<HTMLElement> {
  as?: "p" | "span" | "div";
}

/**
 * The uppercase, wide-tracked small-caps label the reference uses everywhere
 * — a date stamp, a card's category, a `Stat`'s name. Never body copy: at
 * `text-2xs` with this much tracking it's decorative-reading only, so real
 * captions stay on `Card`/`Stat`'s own `text-ink-3` prose sizes, not this.
 */
export function Eyebrow({ as: Tag = "p", className, children, ...rest }: EyebrowProps) {
  return (
    <Tag
      {...rest}
      className={cn(
        "inline-flex items-center gap-2 text-2xs font-semibold text-ink-3",
        "uppercase tracking-[0.14em]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export interface EyebrowSeparatorProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: number;
}

/**
 * The small orange square the reference drops between two halves of an
 * eyebrow label (`SEPT 23 2026 ■ 9AM PT`). Purely decorative — the two halves
 * must each carry their own meaning without it — so it's `aria-hidden`.
 * `--gm-sun` has no `@theme` colour utility (it's reserved for exactly this
 * kind of one-off decorative accent), hence the arbitrary-value reference.
 */
export function EyebrowSeparator({
  size = 5,
  className,
  ...rest
}: EyebrowSeparatorProps) {
  return (
    <span
      aria-hidden="true"
      {...rest}
      className={cn("inline-block shrink-0 bg-[var(--gm-sun)]", className)}
      style={{ width: size, height: size }}
    />
  );
}

export interface EyebrowPairProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  start: React.ReactNode;
  end: React.ReactNode;
  as?: EyebrowProps["as"];
}

/** Convenience for the two-part case: `<EyebrowPair start="SEPT 23" end="9AM PT" />`. */
export function EyebrowPair({ start, end, className, ...rest }: EyebrowPairProps) {
  return (
    <Eyebrow className={className} {...rest}>
      <span>{start}</span>
      <EyebrowSeparator />
      <span>{end}</span>
    </Eyebrow>
  );
}
