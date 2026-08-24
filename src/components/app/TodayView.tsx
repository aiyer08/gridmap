"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { CarbonRibbon } from "@/components/charts/CarbonRibbon";
import { Marquee } from "@/components/motion/Marquee";
import { Reveal } from "@/components/motion/Reveal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { cn, focusRing } from "@/components/ui/cn";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";
import { useTracker } from "@/lib/track/useTracker";
import { percentileWithin } from "@/lib/copy";
import { formatClock, formatDayLabel, formatGrams } from "@/lib/format";
import type { IntensityPoint } from "@/lib/types";
import { AppliancePlanner } from "./AppliancePlanner";
import { GridNowCard } from "./GridNowCard";
import { LocationBar } from "./LocationBar";
import { LocationPrompt } from "./LocationPrompt";
import { SkyHero } from "./SkyHero";
import { useGrid } from "./useGrid";

type Horizon = "24h" | "3d" | "7d";

const HORIZON_HOURS: Record<Horizon, number> = { "24h": 24, "3d": 72, "7d": 168 };

const HORIZON_OPTIONS = [
  { value: "24h" as const, label: "Next 24 hours" },
  { value: "3d" as const, label: "3 days" },
  { value: "7d" as const, label: "Full week" },
];

/** The hero's ticker band is a fixed warm near-black regardless of the site's
 * own light/dark theme — the same literal tone this app already uses as its
 * dark theme's ink/page pairing (see globals.css), just applied invariantly
 * here so the strip reads the same under either theme, the way the
 * reference's own ticker always sits in a dark band. */
const TICKER_BG = "#201515";
const TICKER_FG = "#fdf8f0";

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

  // Live grid facts for the ticker strip under the hero. Every value here
  // comes straight out of the snapshot — nothing here is a placeholder, so
  // there is simply nothing to show until real data exists.
  const marqueeItems = useMemo(() => {
    if (!snapshot) return [];
    const todayPoints = snapshot.series.slice(0, 24);
    let cleanest: IntensityPoint | null = null;
    for (const point of todayPoints) {
      if (!cleanest || point.gCO2PerKWh < cleanest.gCO2PerKWh) cleanest = point;
    }
    const percentile =
      snapshot.now.cleanlinessPercentile ??
      percentileWithin(snapshot.now.gCO2PerKWh, snapshot.stats);

    return [
      snapshot.region.shortName,
      `${Math.round(snapshot.now.gCO2PerKWh)} g CO₂/kWh right now`,
      cleanest
        ? `Cleanest today around ${formatClock(cleanest.ts, snapshot.region.timezone)}`
        : null,
      `${percentile}% of this week is dirtier`,
    ].filter((value): value is string => Boolean(value));
  }, [snapshot]);

  return (
    <div className="w-full pb-20">
      <SkyHero
        snapshot={snapshot}
        lines={["The cleanest", "time to", "run it"]}
        subhead={
          <>
            Electricity is made the moment you use it, so the same load can be
            twice as dirty at 7 PM as at 1 PM. Here&apos;s how your grid looks
            over the next week, and when to press start.
          </>
        }
      >
        {grid.needsLocation ? (
          <LocationPrompt onSubmit={grid.setZip} />
        ) : (
          <div className="rounded-2xl border border-white/40 bg-surface/90 p-4 shadow-lg backdrop-blur-md sm:p-5">
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
        )}
      </SkyHero>

      {snapshot && marqueeItems.length > 0 ? (
        <div style={{ backgroundColor: TICKER_BG, color: TICKER_FG }}>
          <Marquee items={marqueeItems} className="mx-auto max-w-5xl px-4 sm:px-6" />
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-5xl px-4 pt-10 sm:px-6">
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

        {!snapshot && !grid.error && !grid.needsLocation ? (
          <div className="space-y-4">
            <Skeleton className="h-56 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : null}

        {snapshot ? (
          <div className="space-y-10">
            <Reveal>
              <GridNowCard snapshot={snapshot} />
            </Reveal>

            <Reveal delay={0.05} as="section" ariaLabelledBy="week-heading">
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
            </Reveal>

            {grid.plan ? (
              <Reveal delay={0.1}>
                <AppliancePlanner
                  snapshot={snapshot}
                  plan={grid.plan}
                  applianceId={grid.applianceId}
                  onApplianceChange={grid.setApplianceId}
                  tracker={tracker}
                />
              </Reveal>
            ) : null}

            {grid.week.length > 0 ? (
              <Reveal delay={0.15} as="section" ariaLabelledBy="dayplan-heading">
                <h2
                  id="dayplan-heading"
                  className="flex items-center gap-2 text-lg font-semibold tracking-tight"
                >
                  <CalendarDays className="size-4 text-ink-3" />
                  Best window each day
                </h2>
                <p className="mt-0.5 mb-3 text-sm text-ink-3">
                  For planning around a busy week. Today and tomorrow reflect
                  what&apos;s actually happening on the grid; later days are
                  your grid&apos;s usual pattern for that hour, so treat them
                  as a sketch rather than a promise.
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
              </Reveal>
            ) : null}

            {tracker.ready && tracker.summary.actionCount > 0 ? (
              <Reveal delay={0.2} as="section" ariaLabelledBy="impact-heading">
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
              </Reveal>
            ) : null}

            <Reveal delay={0.25}>
              <DataProvenance snapshot={snapshot} />
            </Reveal>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Where the numbers came from. Shown, not buried, so the app is checkable —
 * but shown as a plain sentence first. The full provider-by-provider ledger
 * (fetch timestamps, fit statistics, which token expired) is real and stays
 * intact, just tucked behind one click so it doesn't read as a wall of
 * engineering notes to someone who just wants to trust the number above.
 */
function DataProvenance({
  snapshot,
}: {
  snapshot: NonNullable<ReturnType<typeof useGrid>["snapshot"]>;
}) {
  const sourcesInUse = snapshot.providers.filter((p) => p.used).map((p) => p.label);

  return (
    <section aria-labelledby="sources-heading" className="border-t border-hairline pt-6">
      <h2 id="sources-heading" className="text-sm font-semibold">
        Where these numbers come from
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-ink-3">
        Real grid data for {snapshot.region.shortName}
        {sourcesInUse.length > 0 ? ` (via ${sourcesInUse.join(" and ")})` : ""}.
        Hours too far out to measure use your grid&apos;s usual pattern for
        that time of day instead of a specific prediction — never a promise,
        always our best honest guess.
      </p>
      <details className="mt-3">
        <summary
          className={cn(
            "cursor-pointer text-xs font-medium text-ink-3 underline decoration-dotted",
            "underline-offset-2 hover:text-ink",
            focusRing,
          )}
        >
          Show exactly where each number came from
        </summary>
        <ul className="mt-3 space-y-2">
          {snapshot.providers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-2 text-xs">
              <Badge tone={p.used ? "clean" : "neutral"} size="sm">
                {p.used ? "in use" : "not used"}
              </Badge>
              <span className="font-medium">{p.label}</span>
              <span className="text-ink-3">{p.role}</span>
              {p.detail ? <span className="text-ink-3">— {p.detail}</span> : null}
            </li>
          ))}
        </ul>
        {snapshot.notes.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {snapshot.notes.map((note) => (
              <li key={note} className="text-xs text-ink-3">
                {note}
              </li>
            ))}
          </ul>
        ) : null}
      </details>
      <p className="mt-3 text-xs text-ink-3">
        <Link href="/tips#how-it-works" className="underline underline-offset-2">
          How the forecast is built
        </Link>
      </p>
    </section>
  );
}
