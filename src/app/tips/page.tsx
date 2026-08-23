import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { FAQ, TIPS } from "@/lib/copy";
import { LIFECYCLE_FACTORS } from "@/lib/emissions";
import { APPLIANCES } from "@/lib/appliances";
import { formatDuration, formatKWh } from "@/lib/format";

export const metadata: Metadata = {
  title: "Tips & how it works",
  description:
    "Practical ways to cut household electricity emissions, and exactly how GridMap works out when your grid is cleanest.",
};

const IMPACT_TONE = {
  big: { label: "Big win", tone: "clean" as const },
  medium: { label: "Worth doing", tone: "accent" as const },
  small: { label: "Small but free", tone: "neutral" as const },
};

export default function TipsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-20 sm:px-6">
      <header className="pt-8 pb-6 sm:pt-12">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Tips &amp; how it works
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-ink-3">
          Timing is the easiest lever, but it isn&apos;t the only one. These are
          ordered by how much they actually save — biggest first, because most
          advice gets that backwards.
        </p>
      </header>

      <section aria-labelledby="tips-heading" className="space-y-3">
        <h2 id="tips-heading" className="sr-only">
          Tips
        </h2>
        {TIPS.map((tip) => {
          const meta = IMPACT_TONE[tip.impact];
          return (
            <Card key={tip.id}>
              <CardBody className="flex items-start gap-4">
                <span aria-hidden className="text-xl leading-none">
                  {tip.emoji}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{tip.title}</h3>
                    <Badge tone={meta.tone} size="sm">
                      {meta.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink-3">
                    {tip.body}
                  </p>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </section>

      <section
        id="how-it-works"
        aria-labelledby="how-heading"
        className="mt-12 scroll-mt-20"
      >
        <h2
          id="how-heading"
          className="text-xl font-semibold tracking-tight"
        >
          How it works
        </h2>
        <div className="mt-4 space-y-4">
          {FAQ.map((entry) => (
            <Card key={entry.q} variant="quiet">
              <CardBody>
                <h3 className="font-medium">{entry.q}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-3">
                  {entry.a}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="factors-heading" className="mt-12">
        <h2
          id="factors-heading"
          className="text-xl font-semibold tracking-tight"
        >
          The numbers behind the numbers
        </h2>
        <p className="mt-2 text-sm text-ink-3">
          We multiply each fuel your grid is burning by its lifecycle emissions
          factor — grams of CO₂-equivalent per kilowatt-hour, counting
          construction and fuel supply, not just the smokestack. These are IPCC
          AR5 medians, the same basis Electricity Maps uses.
        </p>
        <Card bleed className="mt-4">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Lifecycle emissions factors by fuel
            </caption>
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-3 uppercase">
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                  Fuel
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium sm:px-5">
                  g CO₂e per kWh
                </th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Coal", LIFECYCLE_FACTORS.coal],
                  ["Oil", LIFECYCLE_FACTORS.oil],
                  ["Natural gas", LIFECYCLE_FACTORS.gas],
                  ["Other / biomass", LIFECYCLE_FACTORS.other],
                  ["Solar", LIFECYCLE_FACTORS.solar],
                  ["Hydro", LIFECYCLE_FACTORS.hydro],
                  ["Nuclear", LIFECYCLE_FACTORS.nuclear],
                  ["Wind", LIFECYCLE_FACTORS.wind],
                ] as const
              ).map(([label, value]) => (
                <tr key={label} className="border-b border-hairline last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-normal sm:px-5">
                    {label}
                  </th>
                  <td className="px-4 py-2 text-right font-mono tabular-nums sm:px-5">
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="mt-3 text-xs text-ink-3">
          Geothermal is reported separately by the EIA and counted at 38 g/kWh,
          even though it appears inside the &ldquo;Other&rdquo; slice above —
          lumping it in with the rest of that bucket would overstate emissions on
          grids like California&apos;s.
        </p>
      </section>

      <section aria-labelledby="appliances-heading" className="mt-12">
        <h2
          id="appliances-heading"
          className="text-xl font-semibold tracking-tight"
        >
          What we assume your appliances use
        </h2>
        <p className="mt-2 text-sm text-ink-3">
          These are typical figures for modern US appliances, not a reading from
          your meter. If yours differ, the percentages still hold — only the
          gram totals shift.
        </p>
        <Card bleed className="mt-4">
          <table className="w-full text-sm">
            <caption className="sr-only">Appliance energy assumptions</caption>
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-3 uppercase">
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                  Appliance
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium sm:px-5">
                  Per run
                </th>
                <th scope="col" className="hidden px-4 py-2 text-right font-medium sm:table-cell sm:px-5">
                  Takes
                </th>
              </tr>
            </thead>
            <tbody>
              {APPLIANCES.map((appliance) => (
                <tr
                  key={appliance.id}
                  className="border-b border-hairline last:border-0"
                >
                  <th scope="row" className="px-4 py-2 text-left font-normal sm:px-5">
                    <span aria-hidden className="mr-1.5">
                      {appliance.emoji}
                    </span>
                    {appliance.label}
                  </th>
                  <td className="px-4 py-2 text-right font-mono tabular-nums sm:px-5">
                    {formatKWh(appliance.kWhPerRun)}
                  </td>
                  <td className="hidden px-4 py-2 text-right text-ink-3 sm:table-cell sm:px-5">
                    {formatDuration(appliance.durationHours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section aria-labelledby="limits-heading" className="mt-12">
        <h2 id="limits-heading" className="text-xl font-semibold tracking-tight">
          Where we could be wrong
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-3">
          Worth knowing, because we&apos;d rather tell you than have you find out.
        </p>
        <ul className="mt-3 space-y-3 text-sm leading-relaxed text-ink-3">
          <li>
            <span className="font-medium text-ink">
              Your ZIP is matched to a grid region approximately.
            </span>{" "}
            Utility service territories don&apos;t follow postal boundaries, and
            some states are split across several grid operators. If the region we
            picked looks wrong, change it — there&apos;s a &ldquo;not your
            grid?&rdquo; link on the Today page.
          </li>
          <li>
            <span className="font-medium text-ink">
              We use average emissions, not marginal.
            </span>{" "}
            The strictly correct question is &ldquo;what does the *next*
            kilowatt-hour cause?&rdquo;, which can differ from the grid average
            and occasionally even points the other way. Average intensity is what
            is freely published for every US region, and it is far easier to
            explain, so that is what we use.
          </li>
          <li>
            <span className="font-medium text-ink">
              The fuel mix runs about half a day behind.
            </span>{" "}
            The EIA publishes generation by fuel with a 9–12 hour lag, so the
            current hour is estimated from live grid demand rather than measured
            directly. Where that estimate is being used, the app says so.
          </li>
          <li>
            <span className="font-medium text-ink">
              Beyond about 16 hours, it&apos;s a pattern, not a prediction.
            </span>{" "}
            The far end of the week is your grid&apos;s typical shape for that
            hour and day of the week. It has no idea whether next Thursday is
            windy.
          </li>
        </ul>
      </section>
    </div>
  );
}
