"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Info, Sparkles, TriangleAlert, X } from "lucide-react";
import { cn, focusRing } from "./cn";

export type ToastTone = "default" | "success" | "info" | "warn" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms. 0 keeps it until dismissed. Default 4200. */
  duration?: number;
  action?: { label: string; onClick: () => void };
  /** Overrides the tone's icon. */
  icon?: React.ReactNode;
}

interface ToastRecord extends ToastOptions {
  id: string;
}

interface ToastApi {
  toast: (options: ToastOptions) => string;
  /** Shorthand for the happy path — the one we use most. */
  celebrate: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside a <ToastProvider>");
  return ctx;
}

const TONE_STYLES: Record<ToastTone, { ring: string; icon: string }> = {
  default: { ring: "border-hairline", icon: "text-ink-3" },
  success: { ring: "border-i2/35", icon: "text-i1-text" },
  info: { ring: "border-brand/30", icon: "text-brand-text" },
  warn: { ring: "border-warn/30", icon: "text-warn" },
  error: { ring: "border-danger/30", icon: "text-danger" },
};

function toneIcon(tone: ToastTone) {
  switch (tone) {
    case "success":
      return <CheckCircle2 aria-hidden="true" />;
    case "info":
      return <Info aria-hidden="true" />;
    case "warn":
      return <TriangleAlert aria-hidden="true" />;
    case "error":
      return <TriangleAlert aria-hidden="true" />;
    default:
      return <Sparkles aria-hidden="true" />;
  }
}

export interface ToastProviderProps {
  children: React.ReactNode;
  /** Oldest toasts drop off past this. Default 3. */
  max?: number;
}

export function ToastProvider({ children, max = 3 }: ToastProviderProps) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seq = React.useRef(0);

  const dismiss = React.useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const dismissAll = React.useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    setToasts([]);
  }, []);

  const toast = React.useCallback(
    (options: ToastOptions) => {
      seq.current += 1;
      const id = `gm-toast-${seq.current}`;
      const record: ToastRecord = { tone: "default", ...options, id };
      setToasts((list) => [...list, record].slice(-max));
      const duration = options.duration ?? 4200;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss, max],
  );

  const celebrate = React.useCallback(
    (title: string, description?: string) =>
      toast({ title, description, tone: "success" }),
    [toast],
  );

  React.useEffect(
    () => () => {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
    },
    [],
  );

  const api = React.useMemo<ToastApi>(
    () => ({ toast, celebrate, dismiss, dismissAll }),
    [toast, celebrate, dismiss, dismissAll],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <div
      // Polite: a logged win should never interrupt what someone is reading.
      role="status"
      aria-live="polite"
      aria-relevant="additions text"
      className={cn(
        "pointer-events-none fixed z-[80] flex flex-col gap-2",
        "inset-x-3 bottom-3",
        "sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-90",
      )}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const tone = t.tone ?? "default";
          const styles = TONE_STYLES[tone];
          return (
            <motion.div
              key={t.id}
              layout={!reduce}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.15 } }
              }
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 460, damping: 34, mass: 0.7 }
              }
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface p-3 shadow-lg",
                styles.ring,
              )}
            >
              <span
                className={cn("mt-px shrink-0 [&_svg]:size-4.5", styles.icon)}
              >
                {t.icon ?? toneIcon(tone)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-[-0.008em] text-ink">
                  {t.title}
                </p>
                {t.description ? (
                  <p className="mt-0.5 text-xs leading-snug text-ink-2">
                    {t.description}
                  </p>
                ) : null}
                {t.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.onClick();
                      onDismiss(t.id);
                    }}
                    className={cn(
                      "mt-2 rounded-md text-xs font-semibold text-brand-text",
                      "hover:underline",
                      focusRing,
                    )}
                  >
                    {t.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss"
                className={cn(
                  "-m-1 grid size-7 shrink-0 place-items-center rounded-md text-ink-4",
                  "transition-colors hover:bg-surface-2 hover:text-ink-2",
                  focusRing,
                )}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
