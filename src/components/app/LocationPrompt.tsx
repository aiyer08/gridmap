"use client";

import { useState } from "react";
import { ArrowRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { cn, focusRing } from "@/components/ui/cn";

/**
 * What a first-time visitor sees.
 *
 * We ask for a ZIP code before showing any numbers, rather than defaulting to
 * some region with an "example" caption. The caption is too easy to miss, and
 * the failure mode is bad in a specific way: someone in Texas reads
 * California's curve, waits until noon, and does the opposite of what their own
 * grid wanted. Better a five-second question than a confidently wrong answer.
 */
export function LocationPrompt({
  onSubmit,
  className,
}: {
  onSubmit: (zip: string) => void;
  className?: string;
}) {
  const [zip, setZip] = useState("");
  const valid = zip.length === 5;

  return (
    <Card
      className={cn(
        "mx-auto max-w-xl rounded-3xl shadow-xl",
        className,
      )}
    >
      <CardBody className="py-8 text-center sm:py-10">
        <span
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-text"
          aria-hidden
        >
          <MapPin className="size-5" />
        </span>
        <h2 className="mt-4 font-[family-name:var(--font-display)] text-2xl tracking-tight sm:text-3xl">
          Where do you pay your electricity bill?
        </h2>
        <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-relaxed text-ink-3">
          Electricity is made differently in every part of the country, so the
          cleanest hour where you live isn&apos;t the cleanest hour somewhere
          else. Your ZIP code is all we need — it stays in your browser.
        </p>

        <form
          className="mt-6 flex flex-wrap items-center justify-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onSubmit(zip);
          }}
        >
          <label htmlFor="onboard-zip" className="sr-only">
            Your ZIP code
          </label>
          <input
            id="onboard-zip"
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="94305"
            autoFocus
            className={cn(
              "h-11 w-32 rounded-lg border border-hairline bg-surface px-3 text-center",
              "font-mono text-lg tracking-widest tabular-nums",
              "placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-4",
              focusRing,
            )}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={!valid}
            iconRight={<ArrowRight />}
          >
            Show my grid
          </Button>
        </form>

        <p className="mt-4 text-xs text-ink-3">
          No account, no email. We don&apos;t send your ZIP code anywhere except
          to look up which regional grid serves it.
        </p>
      </CardBody>
    </Card>
  );
}
