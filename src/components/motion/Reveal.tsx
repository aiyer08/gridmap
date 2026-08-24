"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

export interface RevealProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
  /** Forwarded as `aria-labelledby`, for `as="section"` landmarks. */
  ariaLabelledBy?: string;
  /**
   * Stagger offset in seconds. Give a group of `Reveal`s increasing delays so
   * they settle in one after another instead of all at once.
   */
  delay?: number;
  /** Upward travel distance in px before the element settles. */
  rise?: number;
  /** Wrapping element. Defaults to `div`; `section`/`li` for semantic slots. */
  as?: "div" | "section" | "li";
}

const TAGS = { div: motion.div, section: motion.section, li: motion.li } as const;

/**
 * Fade-and-rise scroll reveal, in the reference's own easing
 * (`cubic-bezier(0.44, 0, 0.56, 1)`). Triggers once, a little before the
 * element actually reaches the viewport, so content has settled by the time
 * someone's eye gets to it rather than animating mid-glance.
 *
 * Renders a plain static element — no motion component, no listeners — when
 * the visitor prefers reduced motion.
 */
export function Reveal({
  children,
  className,
  id,
  ariaLabelledBy,
  delay = 0,
  rise = 20,
  as = "div",
}: RevealProps) {
  const reduce = useReducedMotion();

  if (reduce) {
    const Tag = as;
    return (
      <Tag id={id} aria-labelledby={ariaLabelledBy} className={className}>
        {children}
      </Tag>
    );
  }

  const MotionTag = TAGS[as];
  return (
    <MotionTag
      id={id}
      aria-labelledby={ariaLabelledBy}
      className={className}
      initial={{ opacity: 0, y: rise }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.42, ease: [0.44, 0, 0.56, 1], delay }}
    >
      {children}
    </MotionTag>
  );
}
