"use client";

import * as React from "react";
import { useHydrated } from "@/components/ui/useHydrated";

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

/**
 * Fade-and-rise scroll reveal, in the reference's own easing
 * (`cubic-bezier(0.44, 0, 0.56, 1)`).
 *
 * **Visible is the default state, and hiding is the deliberate act.** That
 * inversion is the whole design of this component, and it is not fussiness: an
 * earlier version started every section at `opacity: 0` and relied on
 * JavaScript to bring it back. It failed twice in review — once with no JS at
 * all, and once because a backgrounded tab throttles `requestAnimationFrame`,
 * which froze whole sections at 0.6% opacity indefinitely. A reveal animation
 * that can eat the page's content is a bad trade for some motion.
 *
 * So: the element renders opaque; only after the client has hydrated do we mark
 * it `data-reveal="pending"`, and an `IntersectionObserver` flips that to
 * `"shown"`. The transition is plain CSS, driven by the compositor rather than
 * by a JS animation loop. If anything in that chain fails — no JS, an error
 * before mount, an observer that never fires, a throttled tab — the content is
 * simply already there.
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
  const hydrated = useHydrated();
  const ref = React.useRef<HTMLElement | null>(null);
  const Tag = as;

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Reduced motion, or no observer support: leave it in its visible state.
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    node.dataset.reveal = "pending";
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          node.dataset.reveal = "shown";
          observer.disconnect();
        }
      },
      // Fire a little before it reaches the viewport, so content has settled by
      // the time someone's eye arrives rather than animating mid-glance.
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);

    // Belt and braces: if the observer somehow never fires within a couple of
    // seconds, show the content anyway.
    const failsafe = window.setTimeout(() => {
      node.dataset.reveal = "shown";
    }, 2000);

    return () => {
      observer.disconnect();
      window.clearTimeout(failsafe);
    };
  }, []);

  return (
    <>
      {/* createElement keeps one cast in one place: `Tag` is a union of three
          intrinsic elements, so their `ref` types don't unify on their own. */}
      {React.createElement(
        Tag,
        {
          ref: ref as React.Ref<never>,
          id,
          "aria-labelledby": ariaLabelledBy,
          className,
          style: hydrated
            ? ({
                "--gm-reveal-rise": `${rise}px`,
                "--gm-reveal-delay": `${delay}s`,
              } as React.CSSProperties)
            : undefined,
        },
        children,
      )}
      <style>{`
        [data-reveal="pending"] {
          opacity: 0;
          transform: translateY(var(--gm-reveal-rise, 20px));
        }
        [data-reveal] {
          transition:
            opacity 0.42s cubic-bezier(0.44, 0, 0.56, 1) var(--gm-reveal-delay, 0s),
            transform 0.42s cubic-bezier(0.44, 0, 0.56, 1) var(--gm-reveal-delay, 0s);
        }
        [data-reveal="shown"] {
          opacity: 1;
          transform: none;
        }
        @media (prefers-reduced-motion: reduce) {
          [data-reveal] {
            opacity: 1 !important;
            transform: none !important;
            transition: none;
          }
        }
      `}</style>
    </>
  );
}
