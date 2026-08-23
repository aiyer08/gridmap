import * as React from "react";
import { cn } from "@/components/ui/cn";
import { INTENSITY_COLORS, INTENSITY_LEVELS } from "./chartUtils";

export interface IntensityLegendProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds the "recommended window" key used by CarbonRibbon. */
  showWindowKey?: boolean;
  size?: "sm" | "md";
}

/**
 * The scale key for the intensity ramp. A continuous colour scale always ships
 * one; the ordering is left-to-right clean → dirty, matching the ramp.
 */
export function IntensityLegend({
  showWindowKey = false,
  size = "md",
  className,
  ...rest
}: IntensityLegendProps) {
  return (
    <div
      {...rest}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2",
        size === "sm" ? "text-2xs" : "text-xs",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-ink-3">Cleanest</span>
        <span
          className="flex overflow-hidden rounded-full"
          role="img"
          aria-label="Colour scale from cleanest to highest carbon intensity"
        >
          {INTENSITY_LEVELS.map((level) => (
            <span
              key={level}
              className={cn(size === "sm" ? "h-2 w-4" : "h-2.5 w-5")}
              style={{ backgroundColor: INTENSITY_COLORS[level] }}
            />
          ))}
        </span>
        <span className="text-ink-3">Highest</span>
      </div>

      {showWindowKey ? (
        <div className="flex items-center gap-1.5 text-ink-3">
          <span
            aria-hidden="true"
            className={cn(
              "rounded-xs border border-brand/45 bg-brand-soft",
              size === "sm" ? "h-2.5 w-4" : "h-3 w-5",
            )}
          />
          <span>Suggested window</span>
        </div>
      ) : null}
    </div>
  );
}
