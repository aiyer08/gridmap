"use client";

import { Leaf, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { FuelMixBar } from "@/components/charts/FuelMixBar";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { InfoDot } from "@/components/ui/Tooltip";
import { cn } from "@/components/ui/cn";
import {
  absoluteLabel,
  describeMix,
  percentileWithin,
  verdictForNow,
} from "@/lib/copy";
import { formatClock } from "@/lib/format";
import type { GridSnapshot } from "@/lib/types";

/**
 * The headline. Someone who reads nothing else should still learn three things:
 * how clean their grid is right now, whether that's good or bad *for them*, and
 * what's actually generating the electricity.
 */
export function GridNowCard({
  snapshot,
  className,
}: {
  snapshot: GridSnapshot;
  className?: string;
}) {
  const verdict = verdictForNow(snapshot.now, snapshot.stats);
  const percentile =
    snapshot.now.cleanlinessPercentile ??
    percentileWithin(snapshot.now.gCO2PerKWh, snapshot.stats);

  // Colour and icon follow the *relative* standing, because that's the thing
  // the user can act on. The absolute level is stated in words below.
  const tone = verdict.tone;
  const ring =
    tone === "clean"
      ? "text-i1 bg-i1-soft"
      : tone === "okay"
        ? "text-i3-text bg-i3-soft"
        : "text-i5-text bg-i5-soft";
  const Icon = tone === "clean" ? Leaf : tone === "okay" ? Zap : TrendingUp;

  const cleanShare = snapshot.now.carbonFreeShare;
  const isLive = snapshot.now.source === "live" || snapshot.now.source === "blend";

  return (
    <Card className={className}>
      <CardBody className="flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full",
              ring,
            )}
            aria-hidden
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-[family-name:var(--font-display)] text-balance text-2xl tracking-tight sm:text-3xl">
              {verdict.headline}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-3">
              {verdict.detail}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium tracking-wide text-ink-3 uppercase">
              Right now
            </dt>
            <dd className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {Math.round(snapshot.now.gCO2PerKWh)}
              </span>
              <span className="text-xs text-ink-3">g CO₂/kWh</span>
            </dd>
            <dd className="mt-0.5 text-xs text-ink-3">
              {absoluteLabel(snapshot.now.gCO2PerKWh)} for a US grid
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium tracking-wide text-ink-3 uppercase">
              This week&apos;s range
            </dt>
            <dd className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {Math.round(snapshot.stats.min)}
                <span className="mx-0.5 text-ink-4">–</span>
                {Math.round(snapshot.stats.max)}
              </span>
              <span className="text-xs text-ink-3">g CO₂/kWh</span>
            </dd>
            <dd className="mt-0.5 text-xs text-ink-3">
              cleanest to dirtiest hour
            </dd>
          </div>

          <div className="col-span-2 sm:col-span-1">
            {/*
              This used to read "CLEANER THAN  ?" with the tooltip trigger as a
              bare question mark, so the label looked like a sentence with a
              missing value rather than a stat with a help affordance. The label
              now stands on its own and the explanation lives behind a proper
              InfoDot.
            */}
            <dt className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-ink-3 uppercase">
              How this hour ranks
              <InfoDot
                content={`We compare right now against every hour in the next seven days on your grid. ${percentile}% of them are dirtier than this moment.`}
                label="How the ranking is worked out"
                size="sm"
              />
            </dt>
            <dd className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {percentile}%
              </span>
              <span className="text-xs text-ink-3">of this week is dirtier</span>
            </dd>
            <dd className="mt-0.5 flex items-center gap-1 text-xs text-ink-3">
              {percentile >= 66 ? (
                <TrendingDown className="size-3" />
              ) : (
                <TrendingUp className="size-3" />
              )}
              {percentile >= 66
                ? "a good moment"
                : percentile >= 33
                  ? "middling"
                  : "worth waiting"}
            </dd>
          </div>
        </dl>

        {snapshot.now.fuelMix ? (
          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">
                What&apos;s powering your grid
                {isLive ? (
                  <span className="ml-1.5 font-normal text-ink-3">
                    (typical for this hour)
                  </span>
                ) : null}
              </h3>
              <p className="text-xs text-ink-3">
                {describeMix(snapshot.now.fuelMix)}
                {cleanShare !== undefined
                  ? ` ${Math.round(cleanShare * 100)}% carbon-free.`
                  : ""}
              </p>
            </div>
            <FuelMixBar
              mix={snapshot.now.fuelMix}
              summaryPrefix="Powering your grid right now"
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-xs text-ink-3">
          <Badge tone={isLive ? "accent" : "neutral"} size="sm" dot>
            {isLive ? "Live estimate" : "Modelled from history"}
          </Badge>
          <span>
            {snapshot.region.shortName} · as of{" "}
            {formatClock(snapshot.now.ts, snapshot.region.timezone)} local
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
