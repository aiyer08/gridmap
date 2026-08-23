"use client";

import { useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { CarbonRibbon } from "@/components/charts/CarbonRibbon";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { cn, focusRing } from "@/components/ui/cn";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";
import { useTracker } from "@/lib/track/useTracker";
import { formatDayLabel, formatGrams } from "@/lib/format";
import { AppliancePlanner } from "./AppliancePlanner";
import { GridNowCard } from "./GridNowCard";
import { LocationBar } from "./LocationBar";
import { useGrid } from "./useGrid";

type Horizon = "24h" | "3d" | "7d";

const HORIZON_HOURS: Record<Horizon, number> = { "24h": 24, "3d": 72, "7d": 168 };

const HORIZON_OPTIONS = [
  { value: "24h" as const, label: "Next 24 hours" },
  { value: "3d" as const, label: "3 days" },
  { value: "7d" as const, label: "Full week" },
];

export function TodayView() {
  const grid = useGrid();
  const [horizon, setHorizon] = useState<Horizon>("24h");
  const tracker = useTracker({
    timezone: grid.snapshot?.region.timezone,
  });

  const snapshot = grid.snapshot;
  const points = snapshot
    ? snapshot.series.slice(0, HORIZON_HOURS[horizon])
    : [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-20 sm:px-6">
      <header className="pt-8 pb-6 sm:pt-12">
        <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          The cleanest time to run it
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-ink-3">
          Electricity is made the moment you use it, so the same load can be
          twice as dirty at 7 PM as at 1 PM. Here&apos;s how your grid looks over
          the next week, and when to press start.
        </p>
        <div className="mt-5">
          <LocationBar
            region={snapshot?.region ?? null}
            city={grid.city}
            zip={grid.zip}
            baOverride={grid.baOverride}
            notice={grid.notice}
            onZipChange={grid.setZip}
            onRegionChange={grid.setBaOverride}
          />
        </div>
      </header>

      {grid.error ? (
        <Card>
          <CardBody className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" />
            <div>
              <p className="font-medium">{grid.error}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={grid.reload}
              >
                Try again
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {!snapshot && !grid.error ? (
        <div className="space-y-4">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : null}

      {snapshot ? (
        <div className="space-y-10">
          {!grid.zip && !grid.baOverride ? (
            <Card variant="quiet">
              <CardBody className="text-sm text-ink-3">
                Showing{" "}
                <span className="font-medium text-ink">
                  {snapshot.region.shortName}
                </span>{" "}
                as a starting point. Pop your ZIP code in above for your own
                grid.
              </CardBody>
            </Card>
          ) : null}

          <GridNowCard snapshot={snapshot} />

          <section aria-labelledby="week-heading">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2
                  id="week-heading"
                  className="text-lg font-semibold tracking-tight"
                >
                  Your grid, hour by hour
                </h2>
                <p className="mt-0.5 text-sm text-ink-3">
                  Lower is cleaner. The dips are your openings.
                </p>
              </div>
              <SegmentedControl
                options={HORIZON_OPTIONS}
                value={horizon}
                onChange={setHorizon}
                ariaLabel="How far ahead to show"
                size="sm"
              />
            </div>
            <Card bleed>
              <CardBody>
                <CarbonRibbon
                  points={points}
                  now={snapshot.now.ts}
                  timeZone={snapshot.region.timezone}
                  windows={grid.plan?.windows ?? []}
                  height={200}
                />
              </CardBody>
            </Card>
          </section>

          {grid.plan ? (
            <AppliancePlanner
              snapshot={snapshot}
              plan={grid.plan}
              applianceId={grid.applianceId}
              onApplianceChange={grid.setApplianceId}
              tracker={tracker}
            />
          ) : null}

          {grid.week.length > 0 ? (
            <section aria-labelledby="dayplan-heading">
              <h2
                id="dayplan-heading"
                className="flex items-center gap-2 text-lg font-semibold tracking-tight"
              >
                <CalendarDays className="size-4 text-ink-3" />
                Best window each day
              </h2>
              <p className="mt-0.5 mb-3 text-sm text-ink-3">
                For planning around a busy week. Today and tomorrow reflect
                what&apos;s actually happening on the grid; later days are your
                grid&apos;s usual pattern for that hour, so treat them as a
                sketch rather than a promise.
              </p>
              <Card bleed>
                <ul className="divide-y divide-hairline">
                  {grid.week.map((w) => (
                    <li
                      key={w.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {formatDayLabel(w.startTs, snapshot.region.timezone)}
                        </p>
                        <p className="text-xs text-ink-3">{w.label}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm tabular-nums text-ink-2">
                          {Math.round(w.avgIntensity)} g/kWh
                        </span>
                        <Badge
                          tone={w.savingsPercent >= 10 ? "clean" : "neutral"}
                          size="sm"
                        >
                          {Math.round(w.savingsPercent)}% less
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}

          {tracker.ready && tracker.summary.actionCount > 0 ? (
            <section aria-labelledby="impact-heading">
              <h2
                id="impact-heading"
                className="text-lg font-semibold tracking-tight"
              >
                What you&apos;ve saved so far
              </h2>
              <Card className="mt-3">
                <CardBody className="flex flex-wrap items-end justify-between gap-6">
                  <Stat
                    label="CO₂ avoided, all time"
                    value={formatGrams(tracker.summary.totalGramsSaved)}
                    sub={`${tracker.summary.actionCount} well-timed ${
                      tracker.summary.actionCount === 1 ? "run" : "runs"
                    }`}
                    size="lg"
                    tone="clean"
                  />
                  <Stat
                    label="This week"
                    value={formatGrams(tracker.summary.weekGramsSaved)}
                    sub={`${tracker.summary.weekActionCount} logged`}
                    size="md"
                  />
                  <Link
                    href="/impact"
                    className={cn(
                      "flex h-9 items-center gap-1.5 rounded-lg border border-hairline",
                      "bg-surface px-3 text-sm font-medium hover:bg-surface-2",
                      focusRing,
                    )}
                  >
                    See the details
                    <ArrowRight className="size-3.5" />
                  </Link>
                </CardBody>
              </Card>
            </section>
          ) : null}

          <DataProvenance snapshot={snapshot} />
        </div>
      ) : null}
    </div>
  );
}

/** Where the numbers came from. Shown, not buried, so the app is checkable. */
function DataProvenance({
  snapshot,
}: {
  snapshot: NonNullable<ReturnType<typeof useGrid>["snapshot"]>;
}) {
  return (
    <section aria-labelledby="sources-heading" className="border-t border-hairline pt-6">
      <h2 id="sources-heading" className="text-sm font-semibold">
        Where these numbers come from
      </h2>
      <ul className="mt-3 space-y-2">
        {snapshot.providers.map((p) => (
          <li key={p.id} className="flex flex-wrap items-baseline gap-2 text-xs">
            <Badge tone={p.used ? "clean" : "neutral"} size="sm">
              {p.used ? "in use" : "not used"}
            </Badge>
            <span className="font-medium">{p.label}</span>
            <span className="text-ink-3">{p.role}</span>
            {p.detail ? <span className="text-ink-4">— {p.detail}</span> : null}
          </li>
        ))}
      </ul>
      {snapshot.notes.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {snapshot.notes.map((note) => (
            <li key={note} className="text-xs text-ink-4">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-ink-4">
        <Link href="/tips#how-it-works" className="underline underline-offset-2">
          How the forecast is built
        </Link>
      </p>
    </section>
  );
}
