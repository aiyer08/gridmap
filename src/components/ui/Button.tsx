"use client";

import * as React from "react";
import { cn, focusRing } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Swaps the label for a spinner but keeps the button's width. */
  loading?: boolean;
  /** Announced to screen readers while `loading`. */
  loadingLabel?: string;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  children?: React.ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  // Flat fill, no shadow — a printed rectangle of colour, not a raised chip.
  primary:
    "bg-brand text-brand-on border border-transparent " +
    "hover:bg-brand-hover active:bg-brand-active",
  secondary:
    "bg-surface text-ink border border-border shadow-xs " +
    "hover:bg-surface-2 hover:border-border-strong active:bg-surface-3",
  ghost:
    "bg-transparent text-ink-2 border border-transparent " +
    "hover:bg-surface-2 hover:text-ink active:bg-surface-3",
  // Quiet-destructive: reads as a normal quiet control until you hover it.
  destructive:
    "bg-transparent text-ink-2 border border-transparent " +
    "hover:bg-danger-soft hover:text-danger active:bg-danger-soft",
};

// Flatter and more rectangular than the old lg/xl scale — a modest ~6-8px,
// never a pill.
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs rounded-sm",
  md: "h-10 gap-2 px-3.5 text-sm rounded-md",
  lg: "h-12 gap-2 px-5 text-base rounded-md",
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "[&_svg]:size-3.5",
  md: "[&_svg]:size-4",
  lg: "[&_svg]:size-[18px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  loadingLabel = "Working…",
  iconLeft,
  iconRight,
  fullWidth,
  className,
  disabled,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...rest}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-loading={loading ? "" : undefined}
      className={cn(
        "group relative inline-flex select-none items-center justify-center",
        "font-medium tracking-[-0.005em] whitespace-nowrap",
        "transition-[background-color,border-color,color,box-shadow,transform]",
        "duration-[var(--gm-dur-2)] ease-editorial",
        "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45",
        "disabled:active:scale-100",
        focusRing,
        SIZES[size],
        ICON_SIZES[size],
        VARIANTS[variant],
        fullWidth && "w-full",
        className,
      )}
    >
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner />
          <span className="sr-only">{loadingLabel}</span>
        </span>
      )}
      <span
        className={cn(
          "inline-flex items-center",
          size === "sm" ? "gap-1.5" : "gap-2",
          loading && "invisible",
        )}
      >
        {iconLeft ? (
          <span className="shrink-0 opacity-90" aria-hidden="true">
            {iconLeft}
          </span>
        ) : null}
        {children}
        {iconRight ? (
          <span
            className={cn(
              "shrink-0 opacity-90 transition-transform",
              "duration-[var(--gm-dur-2)] ease-editorial",
              "group-hover:translate-x-0.5",
            )}
            aria-hidden="true"
          >
            {iconRight}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      aria-hidden="true"
      style={{ animation: "gm-spin 620ms linear infinite" }}
    >
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M8 1.75A6.25 6.25 0 0 1 14.25 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Icon-only button. Requires an accessible label. */
export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  label: string;
  children: React.ReactNode;
}

export function IconButton({
  label,
  size = "md",
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      {...rest}
      size={size}
      aria-label={label}
      title={label}
      className={cn(
        "px-0",
        size === "sm" ? "w-8" : size === "md" ? "w-10" : "w-12",
        className,
      )}
    >
      {children}
    </Button>
  );
}
