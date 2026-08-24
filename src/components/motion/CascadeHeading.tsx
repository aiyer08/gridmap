"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/components/ui/cn";

export interface CascadeHeadingProps {
  /** Each entry is one line, top to bottom. */
  lines: string[];
  className?: string;
  lineClassName?: string;
  /** Extra left indent per line, in `em` — scales with the heading's own type size. */
  step?: number;
  /** Gap between each line's animation start, in seconds. */
  stagger?: number;
  as?: "h1" | "h2";
}

/**
 * The signature staggered display headline: one `<h1>` (semantically a single
 * heading, never three), rendered as a block per line, each indented a
 * little further right than the last — the reference's own "Rethink. /
 * Rebuild. / Refound." cascade — with lines animating in one after another.
 *
 * Indentation is in `em` so it scales with the heading's font-size rather
 * than a fixed pixel amount, which keeps the cascade proportionate from a
 * 390px phone up to a wide desktop hero without any breakpoint juggling.
 */
export function CascadeHeading({
  lines,
  className,
  lineClassName,
  step = 0.8,
  stagger = 0.08,
  as = "h1",
}: CascadeHeadingProps) {
  const reduce = useReducedMotion();
  const Tag = as;

  return (
    <Tag
      className={cn(
        "font-[family-name:var(--font-display)] font-normal",
        className,
      )}
    >
      {lines.map((line, i) => (
        <span
          key={i}
          className={cn("block text-balance", lineClassName)}
          style={{ marginLeft: `${i * step}em` }}
        >
          {reduce ? (
            line
          ) : (
            <motion.span
              className="inline-block"
              initial={{ opacity: 0, y: 22, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{
                duration: 0.62,
                delay: i * stagger,
                ease: [0.44, 0, 0.56, 1],
              }}
            >
              {line}
            </motion.span>
          )}
        </span>
      ))}
    </Tag>
  );
}
