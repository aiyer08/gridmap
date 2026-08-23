"use client";

import { useEffect, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { cn, focusRing } from "@/components/ui/cn";
import type { RegionInfo } from "@/lib/types";

interface RegionOption {
  ba: string;
  shortName: string;
  name: string;
  state: string;
}

/**
 * Where the user is, and an honest escape hatch.
 *
 * ZIP-to-grid-region is approximate — utility service territories don't follow
 * postal boundaries — so rather than hide that, we show which grid we picked and
 * let anyone correct it in one click.
 */
export function LocationBar({
  region,
  city,
  zip,
  baOverride,
  notice,
  onZipChange,
  onRegionChange,
}: {
  region: RegionInfo | null;
  city?: string;
  zip: string | null;
  baOverride: string | null;
  notice?: string;
  onZipChange: (zip: string) => void;
  onRegionChange: (ba: string | null) => void;
}) {
  const [draft, setDraft] = useState(zip ?? "");
  const [picking, setPicking] = useState(false);
  const [regions, setRegions] = useState<RegionOption[]>([]);

  // Reset the field when the saved ZIP changes underneath us (another tab, or a
  // region override clearing it). Adjusting state during render is the pattern
  // React recommends for this over a sync-in-an-effect.
  const [lastZip, setLastZip] = useState(zip);
  if (zip !== lastZip) {
    setLastZip(zip);
    setDraft(zip ?? "");
  }

  useEffect(() => {
    if (!picking || regions.length > 0) return;
    fetch("/api/regions")
      .then((r) => r.json())
      .then((body) => setRegions(body.regions ?? []))
      .catch(() => setRegions([]));
  }, [picking, regions.length]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onZipChange(draft);
          }}
        >
          <div className="relative">
            <MapPin
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4"
              aria-hidden
            />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 5))}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="ZIP code"
              aria-label="Your ZIP code"
              className={cn(
                "h-10 w-[9.5rem] rounded-lg border border-hairline bg-surface pr-3 pl-9",
                "font-mono text-sm tabular-nums placeholder:font-sans placeholder:text-ink-4",
                focusRing,
              )}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            size="md"
            iconLeft={<Search />}
            disabled={draft.length !== 5 && draft.length !== 0}
          >
            Update
          </Button>
        </form>

        {region ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <span>
              {city ? `${city} — ` : ""}
              <span className="font-medium text-ink">{region.shortName}</span>
            </span>
            {region.approximate && !baOverride ? (
              <Badge tone="neutral" size="sm">
                approximate
              </Badge>
            ) : null}
            {baOverride ? (
              <Badge tone="accent" size="sm">
                you picked this
              </Badge>
            ) : null}
            <button
              type="button"
              onClick={() => setPicking((p) => !p)}
              className={cn(
                "rounded text-xs underline decoration-dotted underline-offset-2 hover:text-ink",
                focusRing,
              )}
            >
              {picking ? "never mind" : "not your grid?"}
            </button>
          </div>
        ) : null}
      </div>

      {picking ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            options={regions.map((r) => ({
              value: r.ba,
              label: r.shortName,
              sublabel: r.name,
            }))}
            value={baOverride ?? region?.ba ?? null}
            onChange={(ba) => {
              onRegionChange(ba);
              setPicking(false);
            }}
            ariaLabel="Pick your grid region"
            placeholder={
              regions.length === 0 ? "Loading regions…" : "Choose your grid"
            }
            className="min-w-[18rem]"
            fullWidth={false}
          />
          {baOverride ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onRegionChange(null);
                setPicking(false);
              }}
            >
              Back to automatic
            </Button>
          ) : null}
        </div>
      ) : null}

      {notice ? <p className="text-xs text-ink-4">{notice}</p> : null}
    </div>
  );
}
