# Science review

Findings only — no files besides this one and `docs/METHODOLOGY.md` were
edited. Ordered by the priority the task set, which roughly tracks "how much
does this change a number or label the user actually sees."

Severity key: **High** = changes a user-visible number or label for a
meaningful share of users. **Medium** = changes a number, but by a small
amount or for an edge case. **Low** = documentation/citation precision; no
user-visible number changes.

---

## 1. `ABSOLUTE_BANDS` — High severity, one-line fix

**Issue:** `moderate: 450` in `src/lib/copy.ts` makes the "middling" label
span 300–450 gCO₂e/kWh, a 50% relative range. Against the measured 14-day
regional means given for this review (BPA 64–87, CISO 148–293, ERCOT
234–367, ISNE 301–341, SPP 337–447, MISO 426–506, FPL ~362, PJM ~354), that
one band swallows both ISNE's entire typical range (a nuclear-heavy grid at
its normal operating point) and MISO's *cleanest* hour (a coal-heavy grid at
its best) under the identical "middling" headline — a real difference of
~40% in actual emissions gets zero differentiation in the label the user
reads.

**Fix:** change `moderate: 450` to `moderate: 400` in the `ABSOLUTE_BANDS`
object (`src/lib/copy.ts`). `veryClean: 150`, `clean: 300`, and `dirty: 650`
are all well-supported by the same data and don't need to move:

- `veryClean: 150` cleanly separates BPA (64–87) and CISO's best hours
  (floor 148) from everything else.
- `clean: 300` cleanly brackets CISO's whole range and the cleaner half of
  ERCOT.
- Moving only the moderate/carbon-heavy edge from 450 to 400 sits in the
  genuine gap between ERCOT's dirtiest hour (367) and MISO's cleanest (426),
  while leaving ISNE (301–341), PJM (354), FPL (362) and ERCOT's top (367)
  together as "middling" — which is an accurate description of the broad
  gas/nuclear middle of the US grid mix — and correctly pushes MISO's whole
  range and SPP's dirtier hours (400–447) into "carbon-heavy," where a
  coal-heavy grid belongs even on a relatively good day.
- `dirty: 650` isn't contradicted by any of the given data (nothing here
  exceeds 506) and single-hour spikes during real winter-peak events on
  coal-heavy BAs can plausibly exceed it, so it's left as the reserved "worst
  case" band rather than moved on speculation.

**Source:** derived directly from the 14-day regional means given for this
review (live EIA-930 data). No external citation applies to a UX threshold
choice; this is an internal-consistency fix, not a literature lookup.

---

## 2. The gas factor (490 gCO₂e/kWh applied to all `NG` generation) — High severity, core savings claim

**Issue:** `LIFECYCLE_FACTORS.gas = 490` in `src/lib/emissions.ts` is IPCC
AR5's median for a **combined-cycle** gas plant specifically, applied
uniformly to every megawatt-hour EIA reports under the single `NG` code —
which is unavoidable, because EIA's hourly fuel-type-data feed doesn't
distinguish combined-cycle from peaking-turbine generation at all. Peaking
turbines are real-world dirtier (roughly 35–40% higher heat rate) and, per
EIA's own "Today in Energy" reporting, run disproportionately during the
evening demand ramp — the exact window this app tells people to avoid. That
means 490 most likely understates emissions during the hours the app is
already flagging as bad, and probably understates the US gas fleet's
true annual average too.

**The numbers, verified independently:**
- EIA's own FAQ states 2023 US natural gas generation averaged **0.96 lb
  CO₂/kWh = 435 gCO₂/kWh, combustion-only**, blending combined-cycle, simple
  cycle, steam and internal-combustion generation at their *actual* national
  output shares for the year. [eia.gov/tools/faqs/faq.php?id=74](https://www.eia.gov/tools/faqs/faq.php?id=74&t=11)
- Heat-rate-derived combustion estimates (53.06 kg CO₂/MMBtu, the standard
  EPA natural-gas combustion factor) confirm the split: modern combined-cycle
  (<7,000 Btu/kWh) ≈ 371 g/kWh combustion-only; the 2020 CCGT fleet average
  (7,146 Btu/kWh) ≈ 379 g/kWh; simple-cycle/peaking turbines (~10,000
  Btu/kWh, 2020 average) ≈ 531 g/kWh combustion-only. [eia.gov/todayinenergy/detail.php?id=61444](https://www.eia.gov/todayinenergy/detail.php?id=61444)
- EIA: combustion-turbine generation "nearly doubles" in the 3–6 PM window
  versus early morning. [eia.gov/todayinenergy/detail.php?id=13191](https://www.eia.gov/todayinenergy/detail.php?id=13191);
  GAO and Sandia both confirm peakers are dispatched specifically to cover
  peak load and run at low annual capacity factor otherwise ([gao.gov/products/gao-24-106145](https://www.gao.gov/products/gao-24-106145),
  [sandia.gov Issue Brief 2020-11](https://www.sandia.gov/app/uploads/sites/163/2022/04/Issue-Brief-2020-11-Peaker-Plants.pdf)).
- eGRID's simple-cycle CO₂ rates land in a similar 1,000–1,400 lb/MWh
  (453–635 g/kWh) combustion-only band. [EPA Simple Cycle Stationary Combustion Turbine EGUs TSD](https://www.epa.gov/system/files/documents/2023-05/Simple%20Cycle%20Stationary%20Combustion%20Turbine%20EGUs%20TSD.pdf)

**Fix:** raise `LIFECYCLE_FACTORS.gas` from `490` to **`550`**.

Derivation, shown rather than asserted: EIA's national blended
combustion-only average is 435 g/kWh (above). IPCC AR5's own 490
"combined-cycle lifecycle" figure sits roughly 90–115 g/kWh above a
combined-cycle-only *combustion* estimate (371–398 g/kWh, from the heat-rate
figures above), which is the implied lifecycle uplift (upstream extraction,
methane leakage, infrastructure) AR5 is adding on top of combustion. Applying
that same ~100 g/kWh uplift to the *national blended* combustion figure
(435, which already reflects the real annual-average peaker/CCGT mix, not
just CCGT) gives 435 + 100 ≈ **535–545**, which we round to 550. This is a
derived estimate, not a single published number — flagged as such rather
than dressed up as a direct citation. It fixes the *annual-average* bias;
it does **not** fully fix the evening-peak-specific understatement, because
EIA's hourly `NG` code carries no technology split to condition a peak-hour
multiplier on. A true fix for the peak-hour case would need a different EIA
dataset (plant-level generator technology, e.g. via EIA-923, joined to
hourly output) — out of scope for a constant change and noted here as future
work, not something to fake with an unearned multiplier.

**Severity:** this feeds directly into every "you saved X% CO₂" claim, for
every appliance, in every region, at every hour. Moving 490→550 is an ~12%
increase in the gas contribution to intensity wherever gas is a meaningful
share of the mix — which is most US regions, most evenings.

---

## 3. Appliance `kWhPerRun` / `durationHours` (`src/lib/appliances.ts`)

Checked against ENERGY STAR, EIA RECS, and DOE ballparks. Verdict for each:

| Appliance | App value | Verdict | Real-world range found | Source |
|---|---|---|---|---|
| Dishwasher | 1.2 kWh / 2h | **Fine** | ENERGY STAR cap: 270 kWh/yr ÷ 215 cycles/yr = 1.26 kWh/cycle | [energystar.gov dishwashers](https://www.energystar.gov/products/dishwashers/key_product_criteria) |
| Washing machine | 0.6 kWh / 1h | **Fine** | 0.4–1.0 kWh/load for warm settings on machines with a hose-fed (not internally-heated) water supply | multiple retailer/utility calculators, consistent with each other |
| Clothes dryer | 2.5 kWh / 1.5h | **Fine** | 2.33–3 kWh/load typically cited; ~700 kWh/yr ÷ ~300 loads/yr ≈ 2.3 | [ENERGY STAR dryer scoping report](https://www.energystar.gov/sites/default/files/asset/document/ENERGY_STAR_Scoping_Report_Residential_Clothes_Dryers.pdf) |
| EV charging | 30 kWh / 4h ≈ 100 mi | **Fine, on the efficient side** | Most-efficient 2026 models: 23–24 kWh/100mi (EPA labels); broader fleet average incl. SUVs/trucks commonly cited nearer 30–35 | [fueleconomy.gov](https://www.fueleconomy.gov/), EPA 2026 label data |
| Water heater | 4 kWh / 2h | **Plausible — unverified against a specific published per-event figure** | Physically consistent with a ~2 kW average draw on a common 4,500 W element during a partial-tank reheat, but we could not find a DOE/RECS number for "one reheat event" specifically (RECS reports daily/annual totals, not per-event) | — |
| Central AC pre-cool | 6 kWh / 2h | **Fine** | ~3 kW draw is typical for a 3-ton residential unit | general HVAC sizing convention (~1 kW/ton) |
| Heat pump boost | 5 kWh / 2h | **Fine** | ~2.5 kW average draw, reasonable mid-size unit | same convention |
| Electric oven | 2.3 kWh / 1h | **Fine** | 2–2.5 kWh/hour commonly cited for baking | multiple DOE-derived appliance calculators |
| Pool pump | 7.5 kWh / 6h (1.25 kW) | **Fine, on the efficient side** | 1.25 kW is at the low end of common 1–2.2 kW single-speed pump draws; 6h/day is within typical filtration guidance | — |
| Device charging | 0.3 kWh / 2h | **Fine** | Laptop (~65W) + tablet (~20W) + 2 phones (~10W each) over 2h ≈ 0.21–0.3 kWh | device charger wattage specs |
| Vacuum / chores | 0.8 kWh / 1h | **Fine** | Consistent with a vacuum (~1,000–1,400 W) run intermittently over a mixed-chore hour | — |

**Most consequential of these:** none require a change. The EV and pool-pump
figures sit at the efficient edge of their real-world ranges rather than
dead center, which very slightly understates typical savings for those two
categories, but not enough to warrant a specific replacement number without
better data on the actual mix of vehicles/pumps in use.

### HABITS (same file)

- **`air-dry` (2.5 kWh saved):** matches the dryer's own `kWhPerRun` (2.5)
  exactly — internally consistent, no issue.
- **`cold-wash` (0.5 kWh saved):** worth a comment, not a number change. This
  implies that of the washing machine's 0.6 kWh warm-wash baseline, ~83% is
  attributable to water heating. That ratio is commonly cited for a fully
  *hot* wash (DOE-adjacent guidance often puts water heating at ~90% of a hot
  cycle's energy), but the app's own washer baseline is explicitly a *warm*
  wash, where the water-heating share should be smaller. The likely
  explanation is that `kWhPerRun: 0.6` is meant as the washing machine's own
  electrical draw (motor/pump/spin only, since most US washers take
  pre-heated water from the home's tank rather than heating internally),
  while `cold-wash: 0.5` is meant as a *whole-household* saving that also
  credits the water heater's avoided reheat — which is a legitimate and
  commonly-cited magnitude for a warm→cold switch, just modeled on a
  different energy boundary than the washer's own figure. We didn't find
  evidence either literal number is wrong; we'd suggest a one-line code
  comment clarifying which boundary each figure uses, since right now a
  reader can reasonably interpret them as contradictory.

---

## 4. `TIPS` and `FAQ` claims (`src/lib/copy.ts`)

| Claim | Verdict | Correct figure / source |
|---|---|---|
| "Standby power is about 5–10% of a typical home's electricity" | **Accurate** | DOE-cited range, widely corroborated (e.g. Ohio Consumers' Counsel, EnergySage summarizing DOE) |
| "Heating and cooling are the largest slice of most electricity bills" | **Accurate, for electricity specifically** | EIA RECS: air conditioning 19% + electric space heating 12% = 31% of home *electricity*, ahead of water heating (13%), lighting (9%), refrigeration (7%). [eia.gov/energyexplained/use-of-energy/electricity-use-in-homes.php](https://www.eia.gov/energyexplained/use-of-energy/electricity-use-in-homes.php) — note the frequently-quoted "52% of home energy" statistic is *total* site energy including gas heating, a different (larger) number than the electricity-only claim the app is making; the app's specific wording (electricity bills) is the correct framing and doesn't need to change. |
| "Two degrees [thermostat] for a day is roughly 5% of heating or cooling energy" | **Defensible, upper end of a wide range — soften slightly** | DOE's most-quoted rule of thumb is ~1%/degree for an 8-hour setback; other DOE-adjacent and NREL-linked estimates run 1–3%/degree, and up to ~5%/degree in some real-world monitoring. 5% for a *sustained all-day* 2° change (not just an 8h setback) is plausible but sits at the aggressive edge of the literature. Suggest rewording to "roughly 3–5%" rather than a flat "5%," or specifying "for the day" to signal it's a longer window than DOE's usual 8-hour example. |
| "Most of a wash cycle's energy goes into heating water, not spinning the drum" / "skipping the water heating is most of a wash cycle's energy" | **Accurate for a hot wash; slightly generalized for the app's own warm-wash baseline** | ~90% water-heating share is commonly cited for hot washes; directionally correct but a touch strong as stated for "warm." No number to change in copy (it's qualitative), but see the `cold-wash`/HABITS note in §3 above for the quantitative version of the same issue. |
| "An LED uses about a fifth of what an incandescent does" | **Accurate** | ENERGY STAR: LEDs use "at least 75% less energy" than incandescent, i.e. ≤25% of original, with real examples (60W→10-12W) landing right around "a fifth." [energystar.gov](https://www.energystar.gov/products/learn-about-led-lighting) |
| "The water heater is the second-biggest energy user in a typical home" | **Accurate, for electricity specifically** | EIA RECS electricity breakdown ranks: AC (19%) > water heating (13%) > space heating (12%) > lighting (9%) > refrigeration (7%) > laundry (6%) — water heating genuinely is #2 by electricity end-use. Worth noting explicitly only applies to electric water heaters (roughly half of US homes have gas units, which wouldn't show up on the electric bill this app is about at all); the tip's own context (turning down an electric water heater's thermostat) already implies this, so no wording change is required, just flagging the scope. |
| "A dryer load is roughly 2.5 kWh" | **Accurate** | Matches `appliances.ts`'s own dryer value and the 2.33–3 kWh range found in §3. |

**Net: no factual errors in TIPS/FAQ.** One claim (thermostat 5%) is worth
softening slightly; everything else checks out against a real source.

**Copy consistency note:** `src/app/tips/page.tsx` states the whole factor
table is "IPCC AR5 medians, the same basis Electricity Maps uses." Per
§6/below, that's true for seven of the eight rows but not for oil (which
IPCC AR5 doesn't cover at all). If the constants get corrected, that
sentence should either drop "oil" from the "IPCC AR5" claim or add a
one-clause caveat — otherwise the user-facing methodology page states a
citation that doesn't hold for one of its own table rows.

---

## 5. Average vs. marginal emissions caveat

Not a numeric fix — see `docs/METHODOLOGY.md` §6 for the full write-up,
grounded in:

- Siler-Evans, Azevedo & Morgan, *"Marginal Emissions Factors for the U.S.
  Electricity System,"* Environ. Sci. Technol. 2012 — the foundational
  average-vs-marginal comparison for the US grid.
  [PDF via WattTime](https://watttime.org/wp-content/uploads/2023/11/Marginal-Emissions-Factors-for-the-US-Electricity-System_April-2012.pdf),
  [PubMed](https://pubmed.ncbi.nlm.nih.gov/22486733/). Quantified finding we
  could verify from search results: an identical efficiency measure was
  estimated to avoid roughly 70% more CO₂ in the Midwest than the same
  measure in the West — a gap an average-intensity comparison inside either
  region can't see.
- WattTime's own explainer, [Average vs. marginal emissions](https://watttime.org/data-science/data-signals/average-vs-marginal/),
  which gives a concrete, citable example of average and marginal pointing
  in *opposite directions* (new load on a hydro-rich grid that actually
  ramps up a fossil peaker) but — checked directly — does **not** give a
  numerical frequency for how often this happens. We report that gap
  honestly in the methodology doc rather than inventing a percentage.

**What we could not verify:** a single peer-reviewed figure for "what
fraction of US grid-hours have average and marginal intensity disagreeing in
sign." We looked and didn't find one; the methodology doc says so explicitly
rather than presenting an invented number as established fact.

The existing caveat in `src/app/tips/page.tsx` ("We use average emissions,
not marginal... can differ from the grid average and occasionally even
points the other way") is directionally correct and doesn't need a rewrite;
`docs/METHODOLOGY.md` §6 gives the fuller, cited version for anyone who
wants to check it.

---

## 6. Lifecycle factors and the `OTH`/`UNK`/`GEO` handling

- **Coal (820), gas (490 — see §2), nuclear (12), hydro (24), solar (48),
  wind (11): all verified** against IPCC AR5 WG3 Annex III, Table A.III.2
  medians. No changes.
- **Oil (650): the number is fine, the citation is not.** IPCC AR5 Annex III
  has no oil category at all (oil is under 2% of global generation, so AR5
  didn't model it). 650 gCO₂e/kWh is a real, independently-corroborated
  figure — UK Parliament POST Note 268 (Oct. 2006) cites ~650 for UK oil
  generation, and secondary sources put oil generally in the 650–750 range —
  but the code comment in `src/lib/emissions.ts` ("IPCC AR5 (WG3 Annex III)
  medians") overclaims its provenance for this one row. **Fix: correct the
  comment/citation, not the value** — e.g. cite POST Note 268 or whatever
  secondary source Electricity Maps itself uses for oil, rather than
  attributing it to AR5.
- **`OTH`/`UNK` at 300: reasonable, already honestly caveated.** This is a
  genuine EIA grab-bag (landfill gas, waste heat, unclassified units) with no
  single defensible published factor, and the existing code comment already
  says so plainly ("300 sits between biomass and waste-to-energy") rather
  than dressing it up as a citation. No change recommended.
- **`GEO` at 38, pulled out of the "Other" display bucket: correct and
  already verified** — this review's brief states it was checked against
  live EIA data and found to overstate CAISO's intensity by ~7 gCO₂/kWh if
  left in the 300 bucket. No change.
- **Minor, low-priority oddity:** `DIRECT_FACTORS` (combustion-only) has
  coal at 1000 and oil at 850 — both *higher* than their own lifecycle
  figures (820, 650), which looks backwards at a glance (lifecycle should be
  ≥ combustion). This is plausible rather than wrong — the AR5 harmonized
  lifecycle medians reflect a global literature sample skewed toward newer,
  more efficient plants than the US's specific (older, dirtier) coal fleet,
  whose EIA-measured combustion-only average really is close to 1000 g/kWh
  ([EIA FAQ](https://www.eia.gov/tools/faqs/faq.php?id=74&t=11): coal 2.31
  lb/kWh = 1047 g/kWh in 2023). We confirmed `DIRECT_FACTORS` isn't
  referenced anywhere else in the app (`grep` found only its own
  definition), so this has zero user-visible effect today. No action needed
  unless that table gets wired into a UI later, at which point it's worth a
  one-line comment explaining the apparent inversion.

---

## Summary table

| # | Item | Severity | Constant | Current | Recommended | Confidence |
|---|---|---|---|---|---|---|
| 1 | `ABSOLUTE_BANDS.moderate` | High | `src/lib/copy.ts` | 450 | **400** | High — directly derived from the given regional data |
| 2 | `LIFECYCLE_FACTORS.gas` | High | `src/lib/emissions.ts` | 490 | **550** | Medium — derived estimate, clearly shown as such, not a single direct citation |
| 3 | Appliance table | — | `src/lib/appliances.ts` | — | No changes | High — all checked values fall inside real-world ranges |
| 3b | `HABITS.cold-wash` | Low | `src/lib/appliances.ts` | 0.5 | No number change; add a clarifying comment | — |
| 4 | TIPS/FAQ thermostat claim | Low | `src/lib/copy.ts` | "roughly 5%" | Reword to "roughly 3–5%" (optional) | Medium |
| 4b | tips page IPCC citation sentence | Low | `src/app/tips/page.tsx` | Claims all factors are IPCC AR5 | Caveat the oil row, or exclude it from that sentence | High |
| 6 | `LIFECYCLE_FACTORS.oil` comment | Low | `src/lib/emissions.ts` | Cites AR5 | Cite POST 268 / other secondary source instead | High |

Everything else checked (standby power, LED, water heater ranking,
heating/cooling share, dryer kWh, geothermal handling, OTH/UNK bucket, five
of the six other lifecycle factors) is accurate as-is and is called out
above as such rather than left unaddressed.
