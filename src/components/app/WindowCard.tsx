"use client";

import { Check, Clock, X } from "lucide-react";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { savingsSentence, whyThisWindow } from "@/lib/copy";
import { formatGrams } from "@/lib/format";
import type { Appliance, RunWindow } from "@/lib/types";

const QUALITY_COPY: Record<RunWindow["quality"], string> = {
  best: "Cleanest",
  great: "Great",
  good: "Good",
};

const CONFIDENCE_COPY: Record<RunWindow["confidence"], string> = {
  high: "Confident — based on live grid data",
  medium: "Fairly confident — a day or two out",
  low: "Rough estimate — this far out we're going on your grid's usual pattern",
};

/**
 * One suggested window.
 *
 * Declining is a first-class action, not a hidden one: the plan is explicit
 * that saying no must cost the user nothing, so it sits right next to "I did
 * it" and simply removes the card.
 */
export function WindowCard({
  window: runWindow,
  appliance,
  onAccept,
  onDecline,
  logged,
  className,
}: {
  window: RunWindow;
  appliance: Appliance;
  onAccept: (w: RunWindow) => void;
  onDecline: (w: RunWindow) => void;
  logged?: boolean;
  className?: string;
}) {
  const { headline, parenthetical } = savingsSentence(runWindow, appliance);
  const isBest = runWindow.quality === "best";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
      className={className}
    >
      <Card
        variant={isBest ? "flat" : "quiet"}
        className={cn("h-full", isBest && "border-brand/40 ring-1 ring-brand/15")}
      >
        <CardBody className="flex h-full flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-ink-3">
                <Clock className="size-3.5 shrink-0" />
                <span className="truncate text-xs font-medium">
                  {runWindow.shortLabel}
                </span>
              </div>
              <p className="mt-0.5 font-semibold tracking-tight">
                {runWindow.label.replace(`${runWindow.shortLabel}, `, "")}
              </p>
            </div>
            <Badge
              tone={isBest ? "clean" : "neutral"}
              size="sm"
              className="shrink-0"
            >
              {QUALITY_COPY[runWindow.quality]}
            </Badge>
          </div>

          <div>
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  "font-mono text-3xl font-semibold tabular-nums",
                  runWindow.savingsPercent >= 1 ? "text-i1" : "text-ink-2",
                )}
              >
                {Math.round(runWindow.savingsPercent)}%
              </span>
              <span className="text-sm text-ink-3">less CO₂</span>
            </div>
            <p className="mt-1 text-sm leading-snug text-ink-2">{headline}</p>
            <p className="mt-1 text-xs text-ink-3">({parenthetical})</p>
          </div>

          <p className="text-xs leading-relaxed text-ink-3">
            {whyThisWindow(runWindow)}{" "}
            <span className="text-ink-3">
              Grid runs about {Math.round(runWindow.avgIntensity)} g of CO₂
              per unit of electricity then.
            </span>
          </p>

          <p className="text-[11px] text-ink-3" title={CONFIDENCE_COPY[runWindow.confidence]}>
            {CONFIDENCE_COPY[runWindow.confidence]}
          </p>

          <div className="mt-auto flex gap-2 pt-1">
            {logged ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-i1">
                <Check className="size-4" />
                Logged — {formatGrams(runWindow.baselineGrams - runWindow.gramsCO2)}{" "}
                avoided
              </p>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onAccept(runWindow)}
                  iconLeft={<Check />}
                >
                  I&apos;ll do this
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDecline(runWindow)}
                  iconLeft={<X />}
                  aria-label={`Dismiss ${runWindow.label}`}
                >
                  Not this one
                </Button>
              </>
            )}
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}
