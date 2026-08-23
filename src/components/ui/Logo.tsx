import * as React from "react";
import { cn } from "./cn";

export interface LogoMarkProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * Four bars stepping from the clean end of the intensity ramp to the dirty
 * end — the product in one glyph. Uses theme tokens, so it recolours itself.
 */
export function LogoMark({ size = 24, className, ...rest }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label="GridMap"
      className={cn("shrink-0", className)}
      {...rest}
    >
      <rect x="1.5" y="12.5" width="4" height="9" rx="2" fill="var(--gm-i1)" />
      <rect x="7.5" y="7" width="4" height="14.5" rx="2" fill="var(--gm-i2)" />
      <rect x="13.5" y="10" width="4" height="11.5" rx="2" fill="var(--gm-i4)" />
      <rect x="19.5" y="2.5" width="4" height="19" rx="2" fill="var(--gm-i5)" />
    </svg>
  );
}

export interface LogoProps {
  className?: string;
  /** Hides the wordmark below this breakpoint so tiny headers don't crowd. */
  compactUntil?: "never" | "xs" | "sm";
  markSize?: number;
}

export function Logo({
  className,
  compactUntil = "xs",
  markSize = 22,
}: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark size={markSize} aria-hidden="true" role="presentation" />
      {/* Visually hidden when the header is tight, but always readable. */}
      <span
        className={cn(
          "text-base font-semibold tracking-[-0.028em] text-ink",
          compactUntil === "xs" && "sr-only min-[400px]:not-sr-only",
          compactUntil === "sm" && "sr-only sm:not-sr-only",
        )}
      >
        GridMap
      </span>
    </span>
  );
}
