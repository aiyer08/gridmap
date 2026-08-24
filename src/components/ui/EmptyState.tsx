import * as React from "react";
import { cn } from "./cn";

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** A lucide icon element. Sized and coloured for you. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** One or two buttons. */
  action?: React.ReactNode;
  size?: "sm" | "md";
  /** Adds a dashed hairline box. Off by default — most cards already have one. */
  bordered?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "md",
  bordered = false,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      {...rest}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "sm" ? "gap-2 px-4 py-6" : "gap-3 px-6 py-10",
        bordered && "rounded-lg border border-dashed border-border bg-surface-2/40",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            "grid place-items-center rounded-full border border-hairline bg-surface-2 text-ink-3",
            size === "sm" ? "size-9 [&_svg]:size-4" : "size-12 [&_svg]:size-5",
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="max-w-[42ch]">
        <p
          className={cn(
            "font-semibold tracking-[-0.01em] text-ink",
            size === "sm" ? "text-sm" : "text-base",
          )}
        >
          {title}
        </p>
        {description ? (
          <p
            className={cn(
              "mt-1 text-ink-3",
              size === "sm" ? "text-xs" : "text-sm",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
        </div>
      ) : null}
    </div>
  );
}
