"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { cn, focusRing } from "./cn";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** The honest assumption line, e.g. "about 1.2 kWh over 2 hours". */
  sublabel?: string;
  /** Emoji are allowed here specifically — appliances read better with them. */
  emoji?: string;
  icon?: React.ReactNode;
  /** Right-aligned meta, e.g. "1.2 kWh". */
  meta?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  options: readonly SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Visible field label. Omit and pass `ariaLabel` for a bare control. */
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  size?: "md" | "lg";
  disabled?: boolean;
  className?: string;
  /** Fills its container. Default true — it is usually a form field. */
  fullWidth?: boolean;
}

export function Select<T extends string>({
  options,
  value,
  onChange,
  label,
  ariaLabel,
  placeholder = "Choose one…",
  size = "md",
  disabled = false,
  className,
  fullWidth = true,
}: SelectProps<T>) {
  const reduce = useReducedMotion();
  const rootId = React.useId();
  const listId = `${rootId}-list`;
  const labelId = `${rootId}-label`;

  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [dropUp, setDropUp] = React.useState(false);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const typeahead = React.useRef({ buffer: "", at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const openList = React.useCallback(() => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setDropUp(below < 240 && rect.top > below);
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [disabled, selectedIndex]);

  const close = React.useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const commit = (index: number) => {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    close();
  };

  // Close on outside pointerdown (works for touch) and on scroll-away.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const step = (dir: 1 | -1, from = activeIndex) => {
    const n = options.length;
    for (let s = 1; s <= n; s++) {
      const next = (from + dir * s + n * n) % n;
      if (!options[next].disabled) return next;
    }
    return from;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => step(1, i));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => step(-1, i));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(step(1, options.length - 1));
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(step(-1, 0));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(activeIndex);
        break;
      default: {
        if (e.key.length !== 1) return;
        const now = Date.now();
        const t = typeahead.current;
        t.buffer = now - t.at > 700 ? e.key : t.buffer + e.key;
        t.at = now;
        const q = t.buffer.toLowerCase();
        const hit = options.findIndex(
          (o) => !o.disabled && o.label.toLowerCase().startsWith(q),
        );
        if (hit >= 0) setActiveIndex(hit);
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn("relative", fullWidth ? "w-full" : "inline-block", className)}
    >
      {label ? (
        <label
          id={labelId}
          htmlFor={`${rootId}-trigger`}
          className="mb-1.5 block text-xs font-medium text-ink-2"
        >
          {label}
        </label>
      ) : null}

      <button
        id={`${rootId}-trigger`}
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : (ariaLabel ?? placeholder)}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border bg-surface text-left",
          "transition-[border-color,background-color,box-shadow]",
          "duration-[var(--gm-dur-1)] ease-(--ease-out-soft)",
          "hover:border-border-strong hover:bg-surface-2/60",
          "disabled:pointer-events-none disabled:opacity-45",
          open ? "border-brand" : "border-border",
          size === "lg" ? "min-h-13 px-3 py-2" : "min-h-11 px-3 py-1.5",
          "shadow-xs",
          focusRing,
        )}
      >
        {selected?.emoji ? (
          <span
            aria-hidden="true"
            className={cn(
              "shrink-0 leading-none",
              size === "lg" ? "text-xl" : "text-lg",
            )}
          >
            {selected.emoji}
          </span>
        ) : selected?.icon ? (
          <span aria-hidden="true" className="shrink-0 text-ink-2 [&_svg]:size-4">
            {selected.icon}
          </span>
        ) : null}

        <span className="min-w-0 flex-1">
          {selected ? (
            <>
              <span className="block truncate text-sm font-medium text-ink">
                {selected.label}
              </span>
              {selected.sublabel ? (
                <span className="block truncate text-xs text-ink-3">
                  {selected.sublabel}
                </span>
              ) : null}
            </>
          ) : (
            <span className="block truncate text-sm text-ink-3">
              {placeholder}
            </span>
          )}
        </span>

        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-ink-3 transition-transform",
            "duration-[var(--gm-dur-2)] ease-(--ease-out-soft)",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: dropUp ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: dropUp ? 4 : -4 }}
            transition={{ duration: reduce ? 0 : 0.14, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "absolute z-50 w-full min-w-56 overflow-hidden rounded-xl",
              "border border-hairline bg-surface shadow-lg",
              dropUp ? "bottom-full mb-1.5" : "top-full mt-1.5",
            )}
          >
            <ul
              id={listId}
              ref={listRef}
              role="listbox"
              aria-label={label ?? ariaLabel ?? "Options"}
              aria-activedescendant={`${rootId}-opt-${activeIndex}`}
              tabIndex={-1}
              className="max-h-[min(19rem,50vh)] overflow-y-auto overscroll-contain p-1"
            >
              {options.map((opt, i) => {
                const isSelected = opt.value === value;
                const isActive = i === activeIndex;
                return (
                  <li
                    key={opt.value}
                    id={`${rootId}-opt-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled || undefined}
                    data-active={isActive}
                    onPointerEnter={() => !opt.disabled && setActiveIndex(i)}
                    onClick={() => commit(i)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2",
                      "transition-colors duration-[var(--gm-dur-1)]",
                      opt.disabled && "pointer-events-none opacity-40",
                      isActive && "bg-surface-2",
                    )}
                  >
                    {opt.emoji ? (
                      <span
                        aria-hidden="true"
                        className="w-6 shrink-0 text-center text-lg leading-none"
                      >
                        {opt.emoji}
                      </span>
                    ) : opt.icon ? (
                      <span
                        aria-hidden="true"
                        className="w-6 shrink-0 text-ink-2 [&_svg]:size-4"
                      >
                        {opt.icon}
                      </span>
                    ) : null}

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {opt.label}
                      </span>
                      {opt.sublabel ? (
                        <span className="block truncate text-xs text-ink-3">
                          {opt.sublabel}
                        </span>
                      ) : null}
                    </span>

                    {opt.meta ? (
                      <span className="shrink-0 text-xs text-ink-3 tabular-nums">
                        {opt.meta}
                      </span>
                    ) : null}

                    <Check
                      aria-hidden="true"
                      strokeWidth={3}
                      className={cn(
                        "size-4 shrink-0 text-brand-text",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </li>
                );
              })}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
