"use client";

import * as React from "react";
import {
  ArrowRight,
  Bell,
  Download,
  Leaf,
  Plus,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, Pill } from "@/components/ui/Badge";
import { Stat } from "@/components/ui/Stat";
import { Eyebrow, EyebrowPair, EyebrowSeparator } from "@/components/ui/Eyebrow";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Tooltip, InfoDot } from "@/components/ui/Tooltip";
import { Skeleton, SkeletonChart, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ProgressBar, ProgressRing } from "@/components/ui/Progress";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sheet } from "@/components/ui/Sheet";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { CelebrateOn } from "@/components/ui/Celebrate";
import { Logo, LogoMark } from "@/components/ui/Logo";

/**
 * A gallery of every UI primitive, in every state it supports, with local
 * mock data — not wired to any real GridMap data. This route exists purely
 * so the restyle is reviewable at a glance; it isn't linked from the app nav.
 */
export default function DesignGalleryPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-14">
        <EyebrowPair start="Design system" end="GridMap" />
        <h1 className="mt-2 font-display text-5xl leading-none tracking-[-0.01em] text-ink sm:text-6xl">
          UI primitives
        </h1>
        <p className="mt-3 max-w-xl text-pretty text-ink-3">
          Every primitive, every state, local mock data. A gallery for
          reviewing the restyle — not a page anyone using GridMap will see.
        </p>
      </header>

      <div className="flex flex-col gap-14">
        <ButtonSection />
        <CardSection />
        <BadgeSection />
        <StatSection />
        <SegmentedControlSection />
        <SelectSection />
        <TooltipSection />
        <SkeletonSection />
        <ToastSection />
        <ProgressSection />
        <EmptyStateSection />
        <SheetSection />
        <ThemeToggleSection />
        <CelebrateSection />
        <LogoSection />
      </div>
    </div>
  );
}

function Section({
  index,
  title,
  description,
  children,
}: {
  index: number;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <Eyebrow>
        <span>{String(index).padStart(2, "0")}</span>
        <EyebrowSeparator />
        <span>{title}</span>
      </Eyebrow>
      <h2 className="mt-1.5 font-display text-3xl tracking-[-0.008em] text-ink">
        {title}
      </h2>
      {description ? (
        <p className="mt-2 max-w-2xl text-sm text-ink-3">{description}</p>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Swatch({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-2xs font-medium text-ink-3">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function ButtonSection() {
  return (
    <Section
      index={1}
      title="Button"
      description="Flatter and more rectangular than the old pill-leaning shapes, with a trailing arrow that nudges forward on hover for primary CTAs."
    >
      <div className="flex flex-col gap-5">
        <Swatch label="Variant × trailing arrow">
          <Button variant="primary" iconRight={<ArrowRight />}>
            Find a clean window
          </Button>
          <Button variant="secondary" iconRight={<ArrowRight />}>
            See the week
          </Button>
          <Button variant="ghost">Skip for now</Button>
          <Button variant="destructive" iconLeft={<Trash2 />}>
            Remove
          </Button>
        </Swatch>

        <Swatch label="Size">
          <Button size="sm" variant="primary" iconRight={<ArrowRight />}>
            Small
          </Button>
          <Button size="md" variant="primary" iconRight={<ArrowRight />}>
            Medium
          </Button>
          <Button size="lg" variant="primary" iconRight={<ArrowRight />}>
            Large
          </Button>
        </Swatch>

        <Swatch label="State">
          <Button variant="primary" loading loadingLabel="Logging…">
            Log it
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button variant="primary" iconLeft={<Plus />}>
            Icon left
          </Button>
          <IconButton label="Notifications" variant="secondary">
            <Bell />
          </IconButton>
        </Swatch>

        <Swatch label="Full width">
          <div className="w-full max-w-sm">
            <Button variant="primary" fullWidth iconRight={<ArrowRight />}>
              Save your spot
            </Button>
          </div>
        </Swatch>
      </div>
    </Section>
  );
}

function CardSection() {
  return (
    <Section
      index={2}
      title="Card"
      description="Paper on paper: a hairline border and a flat, warm fill carry the surface. Only `raised` lifts on hover, and only just."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card variant="flat">
          <CardHeader>
            <CardTitle
              eyebrow={
                <>
                  <span>Today</span>
                  <EyebrowSeparator />
                  <span>7-day view</span>
                </>
              }
              subtitle="Updated 4 minutes ago"
              adornment={<Pill tone="clean" size="sm">Clean now</Pill>}
            >
              Grid outlook
            </CardTitle>
          </CardHeader>
          <CardBody>
            Flat variant — the default. No shadow, just the hairline border
            doing the work.
          </CardBody>
          <CardFooter>
            <Button size="sm" variant="ghost">
              Dismiss
            </Button>
            <Button size="sm" variant="secondary" iconRight={<ArrowRight />}>
              Details
            </Button>
          </CardFooter>
        </Card>

        <Card variant="raised" as="article">
          <CardHeader>
            <CardTitle subtitle="Hover this card">Raised variant</CardTitle>
          </CardHeader>
          <CardBody>
            Lifts a hairline&rsquo;s width and gains a soft shadow on hover —
            for when the whole card is the interactive element.
          </CardBody>
        </Card>

        <Card variant="quiet">
          <CardHeader>
            <CardTitle>Quiet variant</CardTitle>
          </CardHeader>
          <CardBody>
            A step down in the surface stack — for a card nested inside
            another card, or a de-emphasised secondary panel.
          </CardBody>
        </Card>

        <Card bleed>
          <SkeletonChart height={140} className="p-4 sm:p-5" />
        </Card>
      </div>
    </Section>
  );
}

function BadgeSection() {
  return (
    <Section
      index={3}
      title="Badge / Pill"
      description="Rounded for a tag, fully pilled for a chip. Tone maps straight to the carbon-intensity ramp so a badge and a chart mark always agree."
    >
      <div className="flex flex-col gap-5">
        <Swatch label="Tone (rounded)">
          <Badge tone="clean" dot>
            Clean
          </Badge>
          <Badge tone="moderate" dot>
            Moderate
          </Badge>
          <Badge tone="dirty" dot>
            Dirty
          </Badge>
          <Badge tone="neutral">Neutral</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="warn">Warn</Badge>
          <Badge tone="danger">Danger</Badge>
        </Swatch>
        <Swatch label="Pill + icon + size">
          <Pill tone="clean" icon={<Leaf />}>
            Solar-heavy hour
          </Pill>
          <Pill tone="accent" size="sm">
            Small pill
          </Pill>
          <Pill tone="neutral" dotColor="var(--gm-fuel-hydro)">
            Hydro
          </Pill>
        </Swatch>
      </div>
    </Section>
  );
}

function StatSection() {
  return (
    <Section
      index={4}
      title="Stat"
      description={
        <>
          The label is now a formal eyebrow. The value&rsquo;s typeface is a
          judgement call: <code className="text-ink-2">sm</code>/
          <code className="text-ink-2">md</code> stay on the geometric sans —
          they&rsquo;re compact companion figures read as data — while{" "}
          <code className="text-ink-2">lg</code>/
          <code className="text-ink-2">hero</code> switch to the editorial
          serif, because in practice they&rsquo;re the one-per-screen
          &ldquo;look what you did&rdquo; payoff figure, not a number in a
          table.
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
        <Stat
          label="CO₂ avoided, all time"
          value="18.4"
          unit="kg"
          sub="across 62 actions"
          size="hero"
          tone="clean"
        />
        <Stat
          label="This week"
          value="1.2"
          unit="kg"
          size="lg"
          delta={{ value: 12, period: "vs. last week" }}
        />
        <Stat label="Streak" value="6" unit="days" size="md" />
        <Stat
          label="Right now"
          value="412"
          unit="g/kWh"
          size="sm"
          tone="accent"
          delta={{ value: -8, goodDirection: "down", period: "vs. yesterday" }}
        />
      </div>
      <div className="mt-8 max-w-xs">
        <Stat
          label="Weekly budget used"
          value="68"
          unit="%"
          size="md"
          trend={<ProgressBar value={68} tone="accent" />}
        />
      </div>
      <div className="mt-8 flex justify-center">
        <Stat label="Centred" value="0" unit="g" size="sm" align="center" />
      </div>
    </Section>
  );
}

const HORIZONS: SegmentedOption<"24h" | "3d" | "7d">[] = [
  { value: "24h", label: "Next 24 hours", shortLabel: "24h" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "Full week", disabled: true },
];

function SegmentedControlSection() {
  const [value, setValue] = React.useState<"24h" | "3d" | "7d">("24h");
  return (
    <Section
      index={5}
      title="Segmented control"
      description="The sliding thumb keeps its spring — a tactile detail worth keeping — while colour transitions moved to the editorial ease."
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          options={HORIZONS}
          value={value}
          onChange={setValue}
          ariaLabel="How far ahead to show"
        />
        <SegmentedControl
          options={HORIZONS}
          value={value}
          onChange={setValue}
          ariaLabel="How far ahead to show (small)"
          size="sm"
          fullWidth
          className="max-w-xs"
        />
      </div>
    </Section>
  );
}

const APPLIANCES: SelectOption<"dishwasher" | "dryer" | "ev">[] = [
  { value: "dishwasher", label: "Dishwasher", sublabel: "1.2 kWh over 2 hours", emoji: "🍽️" },
  { value: "dryer", label: "Clothes dryer", sublabel: "2.5 kWh over 1.5 hours", emoji: "👕" },
  { value: "ev", label: "EV charging", sublabel: "30 kWh over 4 hours", emoji: "🔌", meta: "30 kWh" },
];

function SelectSection() {
  const [value, setValue] = React.useState<"dishwasher" | "dryer" | "ev">("dishwasher");
  return (
    <Section index={6} title="Select">
      <div className="grid max-w-sm gap-4">
        <Select
          label="Appliance"
          options={APPLIANCES}
          value={value}
          onChange={setValue}
        />
        <Select
          options={APPLIANCES}
          value={null}
          onChange={setValue}
          ariaLabel="Appliance, unset"
          placeholder="Choose an appliance…"
          size="lg"
        />
        <Select
          options={APPLIANCES}
          value={value}
          onChange={setValue}
          ariaLabel="Appliance, disabled"
          disabled
        />
      </div>
    </Section>
  );
}

function TooltipSection() {
  return (
    <Section
      index={7}
      title="Tooltip / Info dot"
      description="Hover, focus or tap. InfoDot is the app's 'how do we know this?' affordance."
    >
      <div className="flex flex-wrap items-center gap-6">
        <Tooltip content="Estimated from a year of history for your grid.">
          <Button variant="secondary">Hover me</Button>
        </Tooltip>
        <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
          Forecast confidence
          <InfoDot content="Future hours are our own estimate, not a promise." />
        </span>
        <Tooltip content="Left side" side="left">
          <Button variant="ghost" size="sm">
            Left
          </Button>
        </Tooltip>
        <Tooltip content="Right side" side="right">
          <Button variant="ghost" size="sm">
            Right
          </Button>
        </Tooltip>
      </div>
    </Section>
  );
}

function SkeletonSection() {
  return (
    <Section index={8} title="Skeleton">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Skeleton shape="block" />
          <div className="flex items-center gap-3">
            <Skeleton shape="circle" />
            <Skeleton shape="chip" />
            <Skeleton shape="chip" />
          </div>
          <SkeletonText lines={3} />
        </div>
        <Card bleed>
          <SkeletonChart className="p-4" />
        </Card>
      </div>
    </Section>
  );
}

function ToastSection() {
  const toast = useToast();
  return (
    <Section
      index={9}
      title="Toast"
      description="Fires into the app's real toast viewport (mounted once in the root layout) — try one."
    >
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={() =>
            toast.toast({ title: "No problem", description: "Nothing lost." })
          }
        >
          Default
        </Button>
        <Button
          variant="primary"
          onClick={() => toast.celebrate("Nice — that's counted", "42 g avoided.")}
        >
          Celebrate
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast.toast({
              title: "Forecast updated",
              description: "Tonight got a little cleaner.",
              tone: "info",
            })
          }
        >
          Info
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast.toast({
              title: "Location permission denied",
              description: "Showing your last saved grid instead.",
              tone: "warn",
            })
          }
        >
          Warn
        </Button>
        <Button
          variant="destructive"
          onClick={() =>
            toast.toast({
              title: "Couldn't save that",
              description: "Check your connection and try again.",
              tone: "error",
            })
          }
        >
          Error
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast.toast({
              title: "Undo available",
              description: "Removed the dishwasher window.",
              duration: 0,
              action: { label: "Undo", onClick: () => toast.dismissAll() },
            })
          }
        >
          With action
        </Button>
      </div>
    </Section>
  );
}

function ProgressSection() {
  return (
    <Section index={10} title="Progress">
      <div className="flex flex-wrap items-center gap-10">
        <div className="flex w-64 flex-col gap-4">
          <ProgressBar value={30} size="sm" tone="neutral" label="Neutral" />
          <ProgressBar
            value={68}
            size="md"
            tone="accent"
            label="This week's budget"
            valueText="3.4 of 5 kg"
          />
          <ProgressBar value={92} size="lg" tone="clean" label="Clean" />
        </div>
        <div className="flex gap-6">
          <ProgressRing value={68} tone="accent" centerLabel="68%" centerSub="budget" />
          <ProgressRing
            value={92}
            tone="clean"
            size={72}
            thickness={6}
            centerLabel="92%"
          />
        </div>
      </div>
    </Section>
  );
}

function EmptyStateSection() {
  return (
    <Section index={11} title="Empty state">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <EmptyState
            icon={<Leaf />}
            title="Nothing logged yet — and that's a fine place to start"
            description="Pick a clean window on the Today page and press start."
            action={
              <Button variant="primary" size="sm" iconRight={<ArrowRight />}>
                Find a clean window
              </Button>
            }
          />
        </Card>
        <EmptyState
          bordered
          size="sm"
          icon={<Download />}
          title="No export yet"
          description="Bordered, compact — for a smaller slot."
        />
      </div>
    </Section>
  );
}

function SheetSection() {
  const [open, setOpen] = React.useState(false);
  return (
    <Section index={12} title="Sheet">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open a sheet
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Pick your grid"
        description="We use this to find your regional fuel mix."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Save
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          A bottom sheet under `sm`, a centred dialog above it — same
          component, drag-to-dismiss on touch.
        </p>
      </Sheet>
    </Section>
  );
}

function ThemeToggleSection() {
  return (
    <Section
      index={13}
      title="Theme toggle"
      description="The one in the real header (top right) is the `cycle` variant. `group` shown here for comparison."
    >
      <div className="flex flex-wrap items-center gap-6">
        <ThemeToggle variant="cycle" />
        <ThemeToggle variant="group" />
      </div>
    </Section>
  );
}

function CelebrateSection() {
  const [runKey, setRunKey] = React.useState(0);
  return (
    <Section index={14} title="Celebrate">
      <CelebrateOn runKey={runKey || null}>
        <Button
          variant="primary"
          iconLeft={<Sparkles />}
          onClick={() => setRunKey((k) => k + 1)}
        >
          Log it
        </Button>
      </CelebrateOn>
    </Section>
  );
}

function LogoSection() {
  return (
    <Section
      index={15}
      title="Logo / wordmark"
      description="The SiteHeader and SiteFooter above and below this page are the real thing — this is just the mark on its own."
    >
      <div className="flex flex-wrap items-center gap-8">
        <Logo />
        <LogoMark size={40} />
        <div className="flex items-center gap-2 rounded-md border border-hairline bg-surface-2 px-3 py-2">
          <Zap className="size-4 text-brand-text" aria-hidden="true" />
          <span className="text-sm text-ink-2">
            Interactive colour stays periwinkle — orange is reserved for
            &ldquo;dirty&rdquo; and decorative accents only.
          </span>
        </div>
      </div>
    </Section>
  );
}
