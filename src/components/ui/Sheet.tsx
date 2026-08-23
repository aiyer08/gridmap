"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cn, focusRing } from "./cn";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /** Hide the built-in close button (you must provide another way out). */
  hideClose?: boolean;
  className?: string;
  /** Accessible name when there is no visible `title`. */
  ariaLabel?: string;
}

/**
 * One component, two shapes: a bottom sheet under `sm`, a centred dialog above.
 * Focus-trapped, Escape closes, the page behind cannot scroll, and on touch you
 * can flick it down to dismiss.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  hideClose = false,
  className,
  ariaLabel,
}: SheetProps) {
  const reduce = useReducedMotion();
  const id = React.useId();
  const [mounted, setMounted] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => setMounted(true), []);

  // Scroll lock + focus management + Escape + Tab trap.
  React.useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;

    const { overflow, paddingRight } = document.body.style;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gutter > 0) document.body.style.paddingRight = `${gutter}px`;

    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const target =
        panel.querySelector<HTMLElement>("[data-autofocus]") ??
        panel.querySelector<HTMLElement>(FOCUSABLE) ??
        panel;
      target.focus({ preventScroll: true });
    };
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      returnFocus.current?.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const widths = {
    sm: "sm:max-w-md",
    md: "sm:max-w-lg",
    lg: "sm:max-w-2xl",
  } as const;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            key="scrim"
            aria-hidden="true"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            className="absolute inset-0 bg-ink/35 backdrop-blur-[2px]"
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? `${id}-title` : undefined}
            aria-label={title ? undefined : ariaLabel}
            aria-describedby={description ? `${id}-desc` : undefined}
            tabIndex={-1}
            drag={reduce ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.35 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 620) onClose();
            }}
            initial={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, y: 28, scale: 0.985 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.985 }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: "spring", stiffness: 480, damping: 38, mass: 0.8 }
            }
            className={cn(
              "relative flex max-h-[92dvh] w-full flex-col overflow-hidden",
              "border border-hairline bg-surface shadow-xl",
              "rounded-t-2xl sm:rounded-2xl",
              widths[size],
              className,
            )}
          >
            {/* Drag handle — the touch affordance, hidden on desktop. */}
            <div className="flex shrink-0 justify-center pt-2 sm:hidden">
              <span
                aria-hidden="true"
                className="h-1 w-9 rounded-full bg-border-strong"
              />
            </div>

            {title || !hideClose ? (
              <div className="flex shrink-0 items-start gap-3 px-4 pt-3 pb-3 sm:px-5 sm:pt-5">
                <div className="min-w-0 flex-1">
                  {title ? (
                    <h2
                      id={`${id}-title`}
                      className="text-base font-semibold tracking-[-0.014em] text-ink"
                    >
                      {title}
                    </h2>
                  ) : null}
                  {description ? (
                    <p id={`${id}-desc`} className="mt-1 text-sm text-ink-3">
                      {description}
                    </p>
                  ) : null}
                </div>
                {!hideClose ? (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className={cn(
                      "-mt-0.5 -mr-1 grid size-8 shrink-0 place-items-center rounded-lg",
                      "text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink",
                      focusRing,
                    )}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-5 sm:pb-5">
              {children}
            </div>

            {footer ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-hairline bg-surface-2/50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-3">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** Same component; the name to reach for when it is a desktop-first dialog. */
export const Modal = Sheet;
