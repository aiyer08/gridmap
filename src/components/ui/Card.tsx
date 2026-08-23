import * as React from "react";
import { cn } from "./cn";

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** `raised` lifts on hover — use only when the whole card is a link/button. */
  variant?: "flat" | "raised" | "quiet";
  /** Removes the default padding so charts can bleed to the edges. */
  bleed?: boolean;
  as?: "div" | "section" | "article" | "li";
}

export function Card({
  variant = "flat",
  bleed = false,
  as: Tag = "div",
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Tag
      {...rest}
      className={cn(
        "relative rounded-xl border border-hairline bg-surface",
        "transition-[box-shadow,border-color,transform]",
        "duration-[var(--gm-dur-2)] ease-(--ease-out-soft)",
        variant === "flat" && "shadow-xs",
        variant === "raised" &&
          "shadow-sm hover:-translate-y-px hover:border-border hover:shadow-md",
        variant === "quiet" && "bg-surface-2 shadow-none",
        !bleed && "p-4 sm:p-5",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "flex items-start justify-between gap-3 pb-3 sm:pb-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface CardTitleProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Small muted line under the title. */
  subtitle?: React.ReactNode;
  /** Sits inline after the title — an InfoDot, a Pill, a count. */
  adornment?: React.ReactNode;
  as?: "h2" | "h3" | "h4" | "div";
}

export function CardTitle({
  subtitle,
  adornment,
  as: Tag = "h3",
  className,
  children,
  ...rest
}: CardTitleProps) {
  return (
    <div {...rest} className={cn("min-w-0", className)}>
      <div className="flex min-w-0 items-center gap-1.5">
        <Tag className="truncate text-sm font-semibold tracking-[-0.006em] text-ink">
          {children}
        </Tag>
        {adornment}
      </div>
      {subtitle ? (
        <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>
      ) : null}
    </div>
  );
}

export function CardBody({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn("text-sm text-ink-2", className)}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
