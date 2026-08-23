"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn, focusRing } from "./cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shorter label used under ~380px. Falls back to `label`. */
  shortLabel?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Required — a filter group needs a name. */
  ariaLabel: string;
  size?: "sm" | "md";
  fullWidth?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  fullWidth = false,
  className,
}: SegmentedControlProps<T>) {
  const reduce = useReducedMotion();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const move = (dir: 1 | -1) => {
    const n = options.length;
    for (let step = 1; step <= n; step++) {
      const next = (activeIndex + dir * step + n * n) % n;
      if (!options[next].disabled) {
        onChange(options[next].value);
        refs.current[next]?.focus();
        return;
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(options[0].value);
      refs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const last = options.length - 1;
      onChange(options[last].value);
      refs.current[last]?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "relative isolate inline-grid rounded-lg border border-hairline bg-surface-2 p-0.5",
        fullWidth && "w-full",
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {/* Sliding thumb. Equal-width cells, so a % translate needs no measuring. */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0.5 left-0.5 -z-10 rounded-[6px] border border-hairline bg-surface shadow-xs"
        style={{ width: `calc((100% - 4px) / ${options.length})` }}
        animate={{ x: `${activeIndex * 100}%` }}
        transition={
          reduce
            ? { duration: 0 }
            : { type: "spring", stiffness: 520, damping: 38, mass: 0.8 }
        }
      />
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative z-10 inline-flex min-w-0 items-center justify-center gap-1.5",
              "rounded-[6px] font-medium transition-colors",
              "duration-[var(--gm-dur-1)] ease-(--ease-out-soft)",
              "disabled:pointer-events-none disabled:opacity-40",
              size === "sm"
                ? "h-7 px-2 text-2xs [&_svg]:size-3.5"
                : "h-8 px-3 text-xs [&_svg]:size-4",
              selected ? "text-ink" : "text-ink-3 hover:text-ink-2",
              focusRing,
            )}
          >
            {opt.icon ? (
              <span aria-hidden="true" className="shrink-0">
                {opt.icon}
              </span>
            ) : null}
            <span className="truncate">
              <span className="sm:hidden">{opt.shortLabel ?? opt.label}</span>
              <span className="hidden sm:inline">{opt.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
