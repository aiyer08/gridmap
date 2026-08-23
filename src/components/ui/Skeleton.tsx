import * as React from "react";
import { cn } from "./cn";

export interface ShimmerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Slows or speeds the sweep. */
  duration?: number;
}

/**
 * A single travelling highlight. Drop it inside any `relative overflow-hidden`
 * box. Removed outright (not just sped up) under prefers-reduced-motion.
 */
export function Shimmer({ className, duration = 1.6, style, ...rest }: ShimmerProps) {
  return (
    <span
      aria-hidden="true"
      {...rest}
      className={cn(
        "gm-shimmer pointer-events-none absolute inset-0",
        "bg-gradient-to-r from-transparent via-surface to-transparent",
        "opacity-70",
        className,
      )}
      style={{
        animation: `shimmer ${duration}s var(--gm-ease-in-out-soft) infinite`,
        ...style,
      }}
    />
  );
}

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  shimmer?: boolean;
  /** Convenience shape presets. */
  shape?: "block" | "text" | "circle" | "chip";
}

export function Skeleton({
  shimmer = true,
  shape = "block",
  className,
  children,
  ...rest
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      {...rest}
      className={cn(
        "relative overflow-hidden bg-surface-3",
        shape === "block" && "h-24 w-full rounded-lg",
        shape === "text" && "h-3 w-full rounded-full",
        shape === "circle" && "size-10 rounded-full",
        shape === "chip" && "h-6 w-16 rounded-md",
        className,
      )}
    >
      {shimmer ? <Shimmer /> : null}
      {children}
    </div>
  );
}

export interface SkeletonTextProps
  extends React.HTMLAttributes<HTMLDivElement> {
  lines?: number;
  /** Last line is shortened so it reads as prose. */
  lastLineWidth?: string;
}

export function SkeletonText({
  lines = 3,
  lastLineWidth = "62%",
  className,
  ...rest
}: SkeletonTextProps) {
  return (
    <div {...rest} className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          shape="text"
          style={i === lines - 1 ? { width: lastLineWidth } : undefined}
        />
      ))}
    </div>
  );
}

/** Loading placeholder shaped like a chart card, so nothing jumps on load. */
export function SkeletonChart({
  height = 200,
  className,
  ...rest
}: SkeletonProps & { height?: number }) {
  return (
    <div
      {...rest}
      aria-hidden="true"
      className={cn("flex w-full flex-col gap-3", className)}
    >
      <div className="flex items-end gap-1" style={{ height }}>
        {Array.from({ length: 24 }, (_, i) => {
          const h = 26 + Math.round(58 * Math.abs(Math.sin((i + 1) * 0.62)));
          return (
            <Skeleton
              key={i}
              className="min-w-0 flex-1 rounded-t-xs rounded-b-none"
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>
      <div className="flex justify-between">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} shape="text" className="w-10" />
        ))}
      </div>
    </div>
  );
}
