"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Car, Leaf, Smartphone, Trash2, TreePine } from "lucide-react";
import { ImpactSparkline } from "@/components/charts/ImpactSparkline";
import { StorageNotice } from "@/components/auth/StorageNotice";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Celebrate } from "@/components/ui/Celebrate";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";
import { useToast } from "@/components/ui/Toast";
import { HABITS } from "@/lib/appliances";
import { cheerFor } from "@/lib/copy";
import { formatDayLabel, formatGrams, formatGramsLong } from "@/lib/format";
import { useTracker } from "@/lib/track/useTracker";
import { useGrid } from "./useGrid";

export function ImpactView() {
  const grid = useGrid();
  const timezone = grid.snapshot?.region.timezone;
  const tracker = useTracker({ timezone });
  const toast = useToast();
  const [burst, setBurst] = useState(0);
  const router = useRouter();

  // Habits are straight avoided energy, so they're valued at the grid's average
  // intensity rather than at any particular hour.
  const averageIntensity = grid.snapshot?.stats.mean ?? 400;

  if (!tracker.ready) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const { summary, report, weekly } = tracker;
  const hasHistory = summary.actionCount > 0;

  return (
    <div className="relative mx-auto w-full max-w-3xl px-4 pb-20 sm:px-6">
      <Celebrate runKey={burst || null} mode="overlay" count={22} />

      <header className="pt-8 pb-6 sm:pt-12">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your impact
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-ink-3">
          Every well-timed load is CO₂ that never entered the atmosphere. Here it
          is, added up.
        </p>
      </header>

      {!hasHistory ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Leaf />}
              title="Nothing logged yet — and that's a fine place to start"
              description="Pick a clean window on the Today page and press start. One dishwasher load is a few dozen grams; a year of them is real."
              action={
                <Button variant="primary" onClick={() => router.push("/")}>
                  Find a clean window
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-8">
          <Card>
            <CardBody className="space-y-6">
              <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
                <Stat
                  label="CO₂ avoided, all time"
                  value={formatGrams(summary.totalGramsSaved)}
                  sub={`across ${summary.actionCount} ${
                    summary.actionCount === 1 ? "action" : "actions"
                  }`}
                  size="hero"
                  tone="clean"
                />
                <Stat
                  label="This week"
                  value={formatGrams(summary.weekGramsSaved)}
                  sub={`${summary.weekActionCount} logged`}
                  size="md"
                />
                {summary.streakDays > 0 ? (
                  <Stat
                    label="Streak"
                    value={`${summary.streakDays}`}
                    unit={summary.streakDays === 1 ? "day" : "days"}
                    size="md"
                  />
                ) : null}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">
                  {report.message}
                </p>
                {weekly.length > 1 ? (
                  <ImpactSparkline
                    points={weekly.map((w) => ({
                      // "Aug 17", not "2026-08-17" — it's a chart axis, not a log.
                      label: new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      }).format(new Date(`${w.weekStart}T00:00:00Z`)),
                      value: w.gramsSaved,
                    }))}
                    variant="bars"
                    unitName="grams of CO₂ avoided"
                    format={(v) => formatGrams(v)}
                  />
                ) : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What that actually means</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="grid gap-4 sm:grid-cols-3">
                <Equivalent
                  icon={<Car className="size-4" />}
                  value={summary.equivalents.milesDriven}
                  unit={summary.equivalents.milesDriven === 1 ? "mile" : "miles"}
                  label="not driven"
                />
                <Equivalent
                  icon={<Smartphone className="size-4" />}
                  value={summary.equivalents.phoneCharges}
                  unit="phone charges"
                  label="worth of power"
                />
                <Equivalent
                  icon={<TreePine className="size-4" />}
                  value={summary.equivalents.treeDays}
                  unit={summary.equivalents.treeDays === 1 ? "tree-day" : "tree-days"}
                  label="of absorption"
                />
              </ul>
              <p className="mt-4 text-xs text-ink-3">
                Using 400 g of CO₂ per mile driven (EPA average passenger
                vehicle), 8 g per phone charge, and 58 g absorbed per day by one
                mature tree. That&apos;s {formatGramsLong(summary.totalGramsSaved)}{" "}
                in total.
              </p>
            </CardBody>
          </Card>

          <section aria-labelledby="history-heading">
            <h2 id="history-heading" className="text-lg font-semibold tracking-tight">
              Everything you&apos;ve logged
            </h2>
            <Card bleed className="mt-3">
              <ul className="divide-y divide-hairline">
                {tracker.actions.slice(0, 30).map((action) => (
                  <li
                    key={action.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{action.label}</p>
                      <p className="text-xs text-ink-3">
                        {formatDayLabel(action.loggedAt, timezone ?? "UTC")}
                        {action.status === "declined" ? " · skipped" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {action.status === "declined" ? (
                        <Badge tone="neutral" size="sm">
                          no harm done
                        </Badge>
                      ) : (
                        <span className="font-mono text-sm tabular-nums text-i1">
                          −{formatGrams(action.gramsSaved)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void tracker.remove(action.id)}
                        aria-label={`Remove ${action.label}`}
                        className="rounded p-1 text-ink-4 hover:text-danger"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        </div>
      )}

      <section aria-labelledby="habits-heading" className="mt-10">
        <h2 id="habits-heading" className="text-lg font-semibold tracking-tight">
          Log an everyday win
        </h2>
        <p className="mt-0.5 mb-3 text-sm text-ink-3">
          Not everything is about timing. These are loads you simply didn&apos;t
          run — valued at your grid&apos;s average of{" "}
          {Math.round(averageIntensity)} g/kWh.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {HABITS.map((habit) => (
            <button
              key={habit.id}
              type="button"
              onClick={async () => {
                const action = await tracker.logHabit(
                  habit,
                  averageIntensity,
                  grid.snapshot?.region.ba,
                );
                setBurst((b) => b + 1);
                toast.celebrate(
                  "Logged",
                  action
                    ? `${formatGrams(action.gramsSaved)} avoided. ${cheerFor(
                        summary.actionCount,
                      )}`
                    : habit.detail,
                );
              }}
              className="flex items-start gap-3 rounded-xl border border-hairline bg-surface p-3 text-left transition-colors hover:bg-surface-2"
            >
              <span aria-hidden className="text-lg leading-none">
                {habit.emoji}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{habit.label}</span>
                <span className="mt-0.5 block text-xs text-ink-3">
                  {habit.detail}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="mt-10">
        <StorageNotice />
      </div>

      {hasHistory ? (
        <div className="mt-6 text-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (
                window.confirm(
                  "Clear your whole impact history? This can't be undone.",
                )
              ) {
                void tracker.clear();
              }
            }}
          >
            Clear history
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Equivalent({
  icon,
  value,
  unit,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  unit: string;
  label: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-i1-soft text-i1">
        {icon}
      </span>
      <span>
        <span className="block font-mono text-xl font-semibold tabular-nums">
          {value.toLocaleString("en-US")}
        </span>
        <span className="block text-xs text-ink-3">
          {unit} {label}
        </span>
      </span>
    </li>
  );
}
