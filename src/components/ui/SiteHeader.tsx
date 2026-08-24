"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, focusRing } from "./cn";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export interface NavItem {
  href: string;
  label: string;
  /** Used below `sm` so three links still fit at 340px. */
  short?: string;
}

export const DEFAULT_NAV: NavItem[] = [
  { href: "/", label: "Today" },
  { href: "/impact", label: "My impact", short: "Impact" },
  { href: "/tips", label: "Tips" },
];

export interface SiteHeaderProps {
  nav?: NavItem[];
  className?: string;
}

export function SiteHeader({ nav = DEFAULT_NAV, className }: SiteHeaderProps) {
  const pathname = usePathname();

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b border-hairline",
        "bg-page/80 backdrop-blur-xl backdrop-saturate-150",
        "supports-[not(backdrop-filter:blur(0))]:bg-page",
        className,
      )}
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <Link
          href="/"
          aria-label="GridMap — home"
          className={cn(
            "-mx-1 rounded-md px-1 py-1 transition-opacity",
            "duration-[var(--gm-dur-2)] ease-editorial hover:opacity-80",
            focusRing,
          )}
        >
          <Logo />
        </Link>

        <nav aria-label="Main" className="ml-auto min-w-0">
          <ul className="flex items-center gap-0.5 sm:gap-1">
            {nav.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href} className="min-w-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative block truncate rounded-md px-2 py-1.5 text-xs font-semibold tracking-[0.005em] sm:px-2.5 sm:text-sm",
                      "transition-colors duration-[var(--gm-dur-2)] ease-editorial",
                      active
                        ? "text-ink"
                        : "text-ink-3 hover:bg-surface-2 hover:text-ink",
                      focusRing,
                    )}
                  >
                    <span className="sm:hidden">{item.short ?? item.label}</span>
                    <span className="hidden sm:inline">{item.label}</span>
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-2 -bottom-[11px] h-[2px] rounded-full bg-brand sm:inset-x-2.5"
                      />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />
        <ThemeToggle size="sm" />
      </div>
    </header>
  );
}

export interface SiteFooterProps {
  className?: string;
}

export function SiteFooter({ className }: SiteFooterProps) {
  return (
    <footer
      className={cn("mt-auto border-t border-hairline bg-page", className)}
    >
      <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-prose">
            <Logo compactUntil="never" markSize={18} />
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              Grid data comes from the U.S. EIA hourly fuel-mix feed, with
              Electricity Maps and WattTime where they cover your region. Future
              hours are our own estimate, built from a year of history for your
              regional grid — not a promise. We show you where the number
              came from on every screen.
            </p>
          </div>
          <ul className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
            <li>
              <a
                href="https://www.eia.gov/opendata/"
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  "rounded transition-colors duration-[var(--gm-dur-2)] ease-editorial",
                  "hover:text-ink hover:underline",
                  focusRing,
                )}
              >
                EIA Open Data
              </a>
            </li>
            <li>
              <a
                href="https://www.electricitymaps.com/"
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  "rounded transition-colors duration-[var(--gm-dur-2)] ease-editorial",
                  "hover:text-ink hover:underline",
                  focusRing,
                )}
              >
                Electricity Maps
              </a>
            </li>
            <li>
              <a
                href="https://www.watttime.org/"
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  "rounded transition-colors duration-[var(--gm-dur-2)] ease-editorial",
                  "hover:text-ink hover:underline",
                  focusRing,
                )}
              >
                WattTime
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
