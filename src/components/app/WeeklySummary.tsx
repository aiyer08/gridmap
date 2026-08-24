"use client";

import { ArrowDown, ArrowRight, ArrowUp, Award, Repeat } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { formatGrams } from "@/lib/format";
import type { WeeklyReport } from "@/lib/track/summary";

/**
 * The weekly summary the plan asks for: "every week, the app should report a
 * summary of how much CO2 was reduced as a result".
 *
 * The tone rule is the hard part. A week where someone saved less than the week
 * before is not a failure — it's a week where life happened — so the delta is
 * reported factually and the copy around it never turns into a scold. The only
 * number allowed to feel like a verdict is the total, and that only ever grows.
 */

function weekRangeLabel(weekStart: string, weekEnd: string): string {
  // Parsed as UTC noon so the label can't slip a day in a negative offset.
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(`${weekEnd}T12:00:00Z`);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const fmt = (d: Date, withMonth: boolean) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: withMonth ? "short" : undefined,
      day: "numeric",
    }).format(d);
  return `${fmt(start, true)} – ${fmt(end, !sameMonth)}`;
}

export function WeeklySummary({
  report,
  className,
}: {
  report: WeeklyReport;
  className?: string;
}) {
  const { deltaPercent, deltaGrams } = report;
  const hasComparison = deltaPercent !== null && report.previousGramsSaved > 0;
  const direction = deltaGrams > 0 ? "up" : deltaGrams < 0 ? "down" : "flat";

  // When the week's "most shifted" appliance is the very same run that just
  // won "biggest single win" (typically because it's the only thing logged),
  // showing both is the same fact twice, not two insights.
  const topApplianceIsRedundant =
    report.topAppliance !== null &&
    report.biggestWin !== null &&
    report.topAppliance.count === 1 &&
    report.biggestWin.kind === "shift" &&
    report.biggestWin.label === report.topAppliance.label &&
    report.biggestWin.gramsSaved === report.topAppliance.gramsSaved;
  const showTopAppliance = report.topAppliance !== null && !topApplianceIsRedundant;

  return (
    <Card className={className}>
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">This week</h2>
          <p className="font-mono text-xs text-ink-3">
            {weekRangeLabel(report.weekStart, report.weekEnd)}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">
              CO₂ you avoided
            </p>
            <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-i1">
              {formatGrams(report.gramsSaved)}
            </p>
            <p className="mt-1 text-sm text-ink-3">
              from {report.actionCount}{" "}
              {report.actionCount === 1 ? "thing you logged" : "things you logged"}
            </p>
          </div>

          {hasComparison ? (
            <div>
              <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">
                vs last week
              </p>
              <p
                className={cn(
                  "mt-1 flex items-center gap-1 font-mono text-2xl font-semibold tabular-nums",
                  direction === "up" ? "text-i1" : "text-ink-2",
                )}
              >
                {direction === "up" ? (
                  <ArrowUp className="size-4" />
                ) : direction === "down" ? (
                  <ArrowDown className="size-4" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                {Math.abs(Math.round(deltaPercent))}%
              </p>
              <p className="mt-1 text-sm text-ink-3">
                {/* Stated, never judged. A quieter week is still a week. */}
                {direction === "up"
                  ? `${formatGrams(Math.abs(deltaGrams))} more than last week`
                  : direction === "down"
                    ? `a quieter week than last`
                    : "the same as last week"}
              </p>
            </div>
          ) : null}
        </div>

        <p className="text-pretty text-sm leading-relaxed">{report.message}</p>

        {report.biggestWin || showTopAppliance ? (
          <ul className="grid gap-3 border-t border-hairline pt-4 sm:grid-cols-2">
            {report.biggestWin ? (
              <li className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-i1-soft text-i1"
                  aria-hidden
                >
                  <Award className="size-3.5" />
                </span>
                <span className="min-w-0 text-sm">
                  <span className="block text-ink-3">Biggest single win</span>
                  <span className="block font-medium">
                    {report.biggestWin.label}
                  </span>
                  <span className="block text-xs text-ink-3">
                    {formatGrams(report.biggestWin.gramsSaved)} avoided
                  </span>
                </span>
              </li>
            ) : null}
            {showTopAppliance && report.topAppliance ? (
              <li className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text"
                  aria-hidden
                >
                  <Repeat className="size-3.5" />
                </span>
                <span className="min-w-0 text-sm">
                  <span className="block text-ink-3">Most shifted</span>
                  <span className="block font-medium">
                    {report.topAppliance.label}
                  </span>
                  <span className="block text-xs text-ink-3">
                    {report.topAppliance.count}{" "}
                    {report.topAppliance.count === 1 ? "time" : "times"},{" "}
                    {formatGrams(report.topAppliance.gramsSaved)} avoided
                  </span>
                </span>
              </li>
            ) : null}
          </ul>
        ) : null}

        {report.gramsSaved > 0 ? (
          <p className="border-t border-hairline pt-4 text-sm text-ink-3">
            That&apos;s about the same as{" "}
            <strong className="font-medium text-ink">
              {report.equivalents.milesDriven.toLocaleString("en-US")}{" "}
              {report.equivalents.milesDriven === 1 ? "mile" : "miles"}
            </strong>{" "}
            you didn&apos;t drive.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
