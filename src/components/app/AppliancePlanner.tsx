"use client";

import { useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { PartyPopper, Sparkles } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Celebrate } from "@/components/ui/Celebrate";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { APPLIANCES } from "@/lib/appliances";
import { cheerFor, declineMessage } from "@/lib/copy";
import { formatDuration, formatGrams, formatKWh } from "@/lib/format";
import type { GridSnapshot, RunWindow, WindowPlan } from "@/lib/types";
import type { useTracker } from "@/lib/track/useTracker";
import { WindowCard } from "./WindowCard";

/**
 * "What do you want to run?" → three windows worth considering.
 *
 * The plan is explicit that we offer several options and that turning one down
 * is fine, so declining just removes the card and leaves the total untouched.
 */
export function AppliancePlanner({
  snapshot,
  plan,
  applianceId,
  onApplianceChange,
  tracker,
}: {
  snapshot: GridSnapshot;
  plan: WindowPlan;
  applianceId: string;
  onApplianceChange: (id: string) => void;
  tracker: ReturnType<typeof useTracker>;
}) {
  const toast = useToast();
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [burst, setBurst] = useState(0);

  const options = useMemo(
    () =>
      APPLIANCES.map((a) => ({
        value: a.id,
        label: a.label,
        emoji: a.emoji,
        sublabel: `${formatKWh(a.kWhPerRun)} over ${formatDuration(a.durationHours)}`,
      })),
    [],
  );

  const visible = plan.windows.filter((w) => !declined.has(w.id));

  async function accept(runWindow: RunWindow) {
    const action = await tracker.logShift(
      plan.appliance,
      runWindow,
      plan.baseline,
      snapshot.region.ba,
    );
    setLogged((prev) => new Set(prev).add(runWindow.id));
    setBurst((b) => b + 1);
    toast.celebrate(
      "Nice — that's counted",
      action
        ? `${formatGrams(action.gramsSaved)} of CO₂ avoided. ${cheerFor(
            tracker.summary.actionCount,
          )}`
        : cheerFor(tracker.summary.actionCount),
    );
  }

  function decline(runWindow: RunWindow) {
    setDeclined((prev) => new Set(prev).add(runWindow.id));
    toast.toast({
      title: "No problem",
      description: declineMessage(declined.size),
      tone: "default",
    });
  }

  return (
    <section aria-labelledby="planner-heading" className="relative">
      <Celebrate runKey={burst || null} mode="overlay" count={26} />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2
            id="planner-heading"
            className="text-lg font-semibold tracking-tight"
          >
            When should you run it?
          </h2>
          <p className="mt-0.5 text-sm text-ink-3">
            Pick something you were going to run anyway.
          </p>
        </div>
        <Select
          options={options}
          value={applianceId}
          onChange={onApplianceChange}
          ariaLabel="Choose an appliance"
          size="lg"
          fullWidth={false}
          className="min-w-[15rem]"
        />
      </div>

      <p className="mb-4 text-xs text-ink-4">
        <Tooltip content={plan.appliance.assumption}>
          <span
            tabIndex={0}
            className="cursor-help underline decoration-dotted underline-offset-2"
          >
            Assuming {formatKWh(plan.appliance.kWhPerRun)} over{" "}
            {formatDuration(plan.appliance.durationHours)}
          </span>
        </Tooltip>{" "}
        · compared with starting it right now (
        {formatGrams(plan.baseline.gramsCO2)})
      </p>

      {plan.nowIsGreat ? (
        <Card className="mb-4">
          <CardBody className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-i1-soft text-i1">
              <PartyPopper className="size-4" />
            </span>
            <div>
              <p className="font-medium">
                Go ahead and run it now — timing barely matters today
              </p>
              <p className="mt-1 text-sm text-ink-3">
                Your grid is unusually steady over the next few days, so waiting
                would save almost nothing. That&apos;s a good thing: it means
                there&apos;s no dirty peak to dodge. The options below are still
                the cleanest we found, if you want to be precise about it.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {visible.length === 0 ? (
        <Card variant="quiet">
          <CardBody className="flex items-center gap-3 text-sm text-ink-3">
            <Sparkles className="size-4 shrink-0" />
            <p>
              That&apos;s all the windows for this one — and turning them down
              cost you nothing. Try a different appliance, or check back
              tomorrow when the forecast rolls forward.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {visible.map((runWindow) => (
              <WindowCard
                key={runWindow.id}
                window={runWindow}
                appliance={plan.appliance}
                onAccept={accept}
                onDecline={decline}
                logged={logged.has(runWindow.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
