"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn, focusRing } from "./cn";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: TooltipSide;
  /** Make the wrapper focusable. Needed when the child isn't interactive. */
  tabbable?: boolean;
  /** Extra classes on the bubble. */
  bubbleClassName?: string;
  className?: string;
  maxWidth?: number;
  /** Hover-open delay in ms. Touch and keyboard open immediately. */
  delay?: number;
}

/**
 * Hover + focus + tap tooltip. On touch there is no hover, so a tap toggles it
 * and a tap anywhere else (or Escape) closes it.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  tabbable = false,
  bubbleClassName,
  className,
  maxWidth = 260,
  delay = 120,
}: TooltipProps) {
  const reduce = useReducedMotion();
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [flipped, setFlipped] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const show = React.useCallback(
    (immediate = false) => {
      clear();
      const run = () => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect) {
          if (side === "top") setFlipped(rect.top < 120);
          else if (side === "bottom")
            setFlipped(window.innerHeight - rect.bottom < 120);
          else setFlipped(false);
        }
        setOpen(true);
      };
      if (immediate || reduce || delay <= 0) run();
      else timer.current = setTimeout(run, delay);
    },
    [delay, reduce, side],
  );

  const hide = React.useCallback(() => {
    clear();
    setOpen(false);
  }, []);

  React.useEffect(() => () => clear(), []);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const resolved: TooltipSide =
    side === "top" && flipped
      ? "bottom"
      : side === "bottom" && flipped
        ? "top"
        : side;

  const placement: Record<TooltipSide, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  const offset =
    resolved === "top"
      ? { y: 4 }
      : resolved === "bottom"
        ? { y: -4 }
        : resolved === "left"
          ? { x: 4 }
          : { x: -4 };

  return (
    <span
      ref={ref}
      className={cn("relative inline-flex", className)}
      tabIndex={tabbable ? 0 : undefined}
      aria-describedby={open ? id : undefined}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") show();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") hide();
      }}
      onClick={() => (open ? hide() : show(true))}
      onFocus={() => show(true)}
      onBlur={hide}
    >
      {children}
      <AnimatePresence>
        {open ? (
          <motion.span
            id={id}
            role="tooltip"
            initial={reduce ? { opacity: 1 } : { opacity: 0, ...offset }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, ...offset }}
            transition={{ duration: reduce ? 0 : 0.14, ease: [0.22, 1, 0.36, 1] }}
            style={{ maxWidth }}
            className={cn(
              "pointer-events-none absolute z-50 w-max",
              "rounded-lg border border-hairline bg-surface px-2.5 py-1.5",
              "text-xs leading-snug font-normal text-ink-2 shadow-lg",
              placement[resolved],
              bubbleClassName,
            )}
          >
            {content}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

export interface InfoDotProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** The explanation. Keep it one or two plain-English sentences. */
  content: React.ReactNode;
  /** Accessible name. Default: "How do we know this?" */
  label?: string;
  side?: TooltipSide;
  size?: "sm" | "md";
}

/** The "how do we know this?" affordance. 24px hit target, works on touch. */
export function InfoDot({
  content,
  label = "How do we know this?",
  side = "top",
  size = "md",
  className,
  ...rest
}: InfoDotProps) {
  return (
    <Tooltip content={content} side={side} delay={80}>
      <button
        {...rest}
        type="button"
        aria-label={label}
        className={cn(
          "grid shrink-0 place-items-center rounded-full text-ink-4",
          "transition-colors duration-[var(--gm-dur-1)]",
          "hover:bg-surface-2 hover:text-ink-2",
          size === "sm" ? "size-5" : "size-6",
          focusRing,
          className,
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className={size === "sm" ? "size-3.5" : "size-4"}
          aria-hidden="true"
          fill="none"
        >
          <circle
            cx="8"
            cy="8"
            r="6.4"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M8 7.1v4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
        </svg>
      </button>
    </Tooltip>
  );
}
