"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn, focusRing } from "./cn";
import { useHydrated, useStoredString } from "./useHydrated";
import { Tooltip } from "./Tooltip";

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "gm-theme";

/**
 * Inline this in <head> (before paint) so a dark-mode reader never sees a
 * white flash. Kept in one place so the key can't drift from the toggle.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* private mode — the choice just won't persist */
  }
}

const ORDER: ThemeChoice[] = ["system", "light", "dark"];

const META: Record<ThemeChoice, { label: string; icon: React.ReactNode }> = {
  system: { label: "Match system", icon: <Monitor aria-hidden="true" /> },
  light: { label: "Light", icon: <Sun aria-hidden="true" /> },
  dark: { label: "Dark", icon: <Moon aria-hidden="true" /> },
};

export interface ThemeToggleProps {
  className?: string;
  /** `cycle` is a single icon button; `group` shows all three side by side. */
  variant?: "cycle" | "group";
  size?: "sm" | "md";
}

export function ThemeToggle({
  className,
  variant = "cycle",
  size = "md",
}: ThemeToggleProps) {
  // The persisted choice lives in localStorage, which the server can't see, so
  // it's read as an external store: one render pass, and no mismatch on hydrate.
  const [stored, setStored] = useStoredString(THEME_STORAGE_KEY);
  const ready = useHydrated();
  const choice: ThemeChoice =
    stored === "light" || stored === "dark" ? stored : "system";

  const set = (next: ThemeChoice) => {
    setStored(next === "system" ? null : next);
    apply(next);
  };

  const dims = size === "sm" ? "size-8 [&_svg]:size-3.5" : "size-9 [&_svg]:size-4";

  if (variant === "group") {
    return (
      <div
        role="radiogroup"
        aria-label="Colour theme"
        className={cn(
          "inline-flex items-center gap-0.5 rounded-lg border border-hairline bg-surface-2 p-0.5",
          className,
        )}
      >
        {ORDER.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={ready ? choice === c : undefined}
            aria-label={META[c].label}
            title={META[c].label}
            onClick={() => set(c)}
            className={cn(
              "grid place-items-center rounded-[6px] transition-colors",
              "duration-[var(--gm-dur-1)]",
              size === "sm" ? "size-7 [&_svg]:size-3.5" : "size-8 [&_svg]:size-4",
              ready && choice === c
                ? "border border-hairline bg-surface text-ink shadow-xs"
                : "text-ink-3 hover:text-ink",
              focusRing,
            )}
          >
            {META[c].icon}
          </button>
        ))}
      </div>
    );
  }

  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];

  return (
    <Tooltip content={`Theme: ${META[choice].label}`} side="bottom" delay={220}>
      <button
        type="button"
        onClick={() => set(next)}
        aria-label={`Colour theme: ${META[choice].label}. Switch to ${META[next].label}.`}
        className={cn(
          "grid place-items-center rounded-lg border border-transparent text-ink-3",
          "transition-colors duration-[var(--gm-dur-1)]",
          "hover:border-hairline hover:bg-surface-2 hover:text-ink",
          dims,
          focusRing,
          className,
        )}
      >
        {META[choice].icon}
      </button>
    </Tooltip>
  );
}
