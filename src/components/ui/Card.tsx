import * as React from "react";
import { cn } from "./cn";
import { Eyebrow } from "./Eyebrow";

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
        // Paper on paper: a hairline border and a flat, warm fill do almost
        // all the work. Shadows are reserved for the one variant that
        // actually lifts off the page on hover.
        "relative rounded-lg border border-hairline bg-surface",
        "transition-[box-shadow,border-color,transform]",
        "duration-[var(--gm-dur-3)] ease-editorial",
        variant === "flat" && "shadow-none",
        variant === "raised" &&
          "shadow-xs hover:-translate-y-px hover:border-border hover:shadow-sm",
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
  /** A category/date-style label above the title, e.g. "TODAY ■ 7-DAY VIEW". */
  eyebrow?: React.ReactNode;
  /** Sits inline after the title — an InfoDot, a Pill, a count. */
  adornment?: React.ReactNode;
  as?: "h2" | "h3" | "h4" | "div";
}

/**
 * A card's title is a headline, not a data point, so it takes the editorial
 * display serif — this is the one place in a `Card` where that voice should
 * show up. `CardBody`/`subtitle` stay on the geometric sans; they're prose.
 */
export function CardTitle({
  subtitle,
  eyebrow,
  adornment,
  as: Tag = "h3",
  className,
  children,
  ...rest
}: CardTitleProps) {
  return (
    <div {...rest} className={cn("min-w-0", className)}>
      {eyebrow ? <Eyebrow className="mb-1">{eyebrow}</Eyebrow> : null}
      <div className="flex min-w-0 items-center gap-2">
        <Tag className="truncate font-display text-lg leading-tight tracking-[-0.006em] text-ink">
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
