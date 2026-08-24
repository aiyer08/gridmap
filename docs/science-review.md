# Science review — August 2026

Reviewer's findings on the numbers behind GridMap. **No existing source file
was edited**; every recommendation below is a constant to change, with the
exact replacement value and the source it came from.

Ordered by the priority set in the brief, which roughly tracks "how much does
this change a number the user actually sees".

**Severity key**
- **High** — changes a user-visible number or label for a meaningful share of users.
- **Medium** — changes a number, but by a small amount or in an edge case.
- **Low** — citation/wording precision; no user-visible number changes.

---

## Summary of every recommended change

| # | File | Constant | Current | → Recommended | Severity | Confidence |
|---|---|---|---|---|---|---|
| 1 | `src/lib/copy.ts` | `ABSOLUTE_BANDS.moderate` | `450` | **`400`** | High | High |
| 2a | `src/lib/emissions.ts` | `LIFECYCLE_FACTORS.gas` | `490` | **`530`** | High | Medium-high |
| 2b | `src/lib/emissions.ts` | `LIFECYCLE_FACTORS.oil` | `650` | **`1200`** | High | High |
| 2c | `src/lib/emissions.ts` | `LIFECYCLE_FACTORS.coal` | `820` | **`1100`** (ship with a band re-cut) | High | High on the number, medium on the rollout |
| 3 | `src/lib/appliances.ts` | water heater `kWhPerRun` | `4` | **`7`** | High | High |
| 3b | `src/lib/appliances.ts` | dryer `durationHours` | `1.5` | **`1`** | Medium | High |
| 3c | `src/lib/appliances.ts` | `HABITS` `lights-off.kWhSaved` | `0.3` | **`0.1`** | Medium | High |
| 3d | `src/lib/appliances.ts` | pool pump `assumption` text | "A 1.25 kW pump" | relabel as **variable-speed** (or raise kWh to `11`) | Medium | High |
| 3e | `src/lib/appliances.ts` | oven `kWhPerRun` | `2.3` | `2.0` *(optional)* | Low | Medium |
| 4 | `src/lib/copy.ts` | thermostat tip + habit detail | "about 5%" | **"roughly 2–5%"** | Low | High |
| 4b | `src/app/tips/page.tsx` | "These are IPCC AR5 medians" | — | **reword** — untrue for oil today, untrue for gas/coal/oil after #2 | Low | High |
| 5 | `src/lib/emissions.ts` | oil factor's code comment | "IPCC AR5 (WG3 Annex III) medians" | **fix the citation** — AR5 has no oil category | Low | High |

Everything else checked out, and is called out as fine in §7 rather than
padded into a finding.

---

## 1. `ABSOLUTE_BANDS` — High severity

**The question asked:** under the current bands, MISO's *cleanest* hour (426)
and New England's *typical* hour (301) both land in the same "middling" bucket.
Is that right?

**No.** That is the clearest possible symptom of a band edge in the wrong place.

`absoluteLabel()` currently reads: ≤150 "very clean", ≤300 "clean", ≤450
"middling", ≤650 "carbon-heavy", >650 "very carbon-heavy". The "middling" band
spans 300–450 — a 50% relative range that swallows two genuinely different
situations:

- **ISNE at 301–341** — a nuclear-and-gas grid at its normal operating point.
  "Middling" is a fair description.
- **MISO at 426** — a coal-heavy grid having its *best hour of the fortnight*.
  Calling that "middling" tells a Minnesota user their cleanest available hour
  is unremarkable, and simultaneously tells a Boston user their ordinary hour is
  no better than it.

### Where the edge belongs

Sorting the measured 14-day means and looking for natural breaks:

```
64  87 | 148  234  293 | 301  337  341  354  362  367 | 426  447  506
BPA    | CISO ········ | ISNE/SPP/PJM/FPL/ERCOT ····· | MISO/SPP   MISO
```

The largest interior gaps are 148→234 (86), 87→148 (61), and **367→426 (59)**.
That last gap is the real boundary between "the broad gas/nuclear middle of the
US grid" and "coal-heavy", and it is where the label should switch.

**Recommendation — change exactly one value:**

```ts
export const ABSOLUTE_BANDS = {
  veryClean: 150,
  clean: 300,
  moderate: 400,   // was 450
  dirty: 650,
} as const;
```

Effect: MISO's entire range (426–506) and SPP's dirty half (400–447) become
"carbon-heavy", which is accurate for a coal-heavy grid even on a good day.
ISNE (301–341), PJM (354), FPL (362) and ERCOT's worst (367) stay "middling".

### Why the other three edges stay

- **`veryClean: 150`** — separates BPA (64–87) and CISO's best solar hours
  (floor 148) from everything else. CISO at 148 genuinely is very clean by US
  standards, and letting it earn the top label is accurate as well as
  motivating.
- **`clean: 300`** — threads precisely between CISO's ceiling (293) and ISNE's
  floor (301). Already remarkably well placed; leave it alone.
- **`dirty: 650`** — nothing in the measured set reaches it (max 506), so "very
  carbon-heavy" currently never fires for these eight regions. It stays
  reachable for small coal-heavy balancing authorities: eGRID2023 puts MROE
  (eastern Wisconsin) at 637 gCO₂/kWh **combustion-only**, which clears 650 once
  lifecycle is counted. Keep it as the reserved worst case. If you want the top
  label to fire for coal-heavy BAs, 600 is defensible — but that is a
  preference, not a correction.

### Cross-check against an independent source

eGRID2023 annual subregion averages (combustion-only, so our lifecycle numbers
sit above them) break in the same place: CAMX 195, RFCE 272, NWPP 288, ERCT
334, FRCC 356, SPNO 394, SPSO 397 │ **RFCW 415, MROW 420, RMPA 473, MROE 637**.
A cut at 400 separates the gas-dominant subregions from the coal-heavy ones.
Source: [EPA eGRID](https://www.epa.gov/egrid).

### Two implementation notes

- **No test breakage.** `src/lib/copy.test.ts` asserts `absoluteLabel(500) ===
  "carbon-heavy"` (still true at 400), `absoluteLabel(290) === "clean"` (true),
  `absoluteTone(426) !== "clean"` (true), and band monotonicity (true).
- **`absoluteTone()` is effectively dead code.** Only `absoluteLabel()` is
  rendered (`src/components/app/GridNowCard.tsx:84`); `absoluteTone` appears
  nowhere outside its own tests. Worth knowing because `absoluteTone` ignores
  `moderate` entirely and treats everything from 301 to 650 as a single "okay"
  band — if it is ever wired into the UI, it should switch on `moderate`, not
  `dirty`.

**Source:** derived from the 14-day regional means supplied for this review
(live EIA-930), cross-checked against eGRID2023. A UX threshold is a judgement
call rather than a literature value, but the *placement* here is data-driven.

---

## 2. The gas factor — High severity, and the problem is bigger than gas

**The question asked:** does 490 understate the evening peak, and is there a
defensible better approach?

**Yes, it understates it — on two counts at once.** Investigating it also
surfaced a larger problem with coal and oil.

### 2a. Gas: 490 → 530

`LIFECYCLE_FACTORS.gas = 490` is IPCC AR5's median for a **combined-cycle**
plant, applied to every MWh EIA reports under the single `NG` code — which
lumps combined-cycle, simple-cycle peakers and gas steam together. Those
technologies are not close:

| Gas technology | EIA 2024 heat rate (Btu/kWh) | Combustion gCO₂/kWh |
|---|---|---|
| Combined cycle | 7,548 | **399** |
| Gas steam turbine | 10,337 | **547** |
| Simple-cycle turbine (peaker) | 10,999 | **582** |

Heat rates: [EIA Electric Power Annual, Table 8.2](https://www.eia.gov/electricity/annual/html/epa_08_02.html)
(capacity-weighted, at full load). Carbon coefficient 52.91 kg CO₂/MMBtu:
[EIA carbon coefficients](https://www.eia.gov/environment/emissions/co2_vol_mass.php).
Arithmetic: `Btu/kWh × 52.91 ÷ 1,000,000 × 1,000 = gCO₂/kWh`.

A peaker emits **~46% more per kWh than a CCGT**, and peakers are what covers
the evening ramp. So the app prices the evening peak at a best-case
technology's factor precisely when the worst-case technology is most likely to
be running. The concern in the brief is correct.

**The fix anchors on the measured fleet rather than one technology's median.**
EIA publishes what US gas generation actually emitted in 2023, blending all
prime movers at their real output shares: **0.96 lb CO₂/kWh = 435 gCO₂/kWh**,
combustion-only ([EIA FAQ #74](https://www.eia.gov/tools/faqs/faq.php?id=74&t=11)).

AR5's own numbers imply the lifecycle uplift over combustion for gas:

```
490  (AR5 lifecycle, CCGT)
−399  (combustion, CCGT at 7,548 Btu/kWh)
=  91  gCO2e/kWh upstream — extraction, processing, transport,
        methane leakage, plant construction
```

Apply that uplift to the measured fleet-average combustion rate:

```
435 + 91  ≈  526   →   recommend 530
```

**Recommendation:** `LIFECYCLE_FACTORS.gas: 490 → 530`. Anything in 520–550 is
defensible; 530 is what the arithmetic gives. This is a *derived* figure rather
than a single published number, and the code comment should say so.

**What I explicitly do not recommend: a peak-hour multiplier.** Physically it is
the right instinct, but EIA's hourly feed carries no technology split under
`NG`, so any multiplier would be invented rather than measured. Doing it
properly means joining plant-level technology (EIA-860/923) to hourly output —
real future work. I looked for published hourly gas-technology shares by
balancing authority and did not find them: **unverified**.

**User-visible effect:** raises gas-heavy regions by roughly `gas share × 40`
g/kWh — about +18 for ERCOT, +16 for PJM. Note that because it lifts *both* the
baseline hour and the recommended hour, the headline savings **percentage barely
moves**; what improves is the honesty of the absolute gram totals.

### 2b. Oil: 650 → 1200 (the current value is arithmetically impossible)

Same EIA source, same year: **US petroleum-fired generation emitted 2.46 lb
CO₂/kWh = 1,116 gCO₂/kWh, combustion-only.**

The app's *lifecycle* oil factor is **650** — below the measured
*combustion-only* rate for the same fleet. Lifecycle emissions are combustion
plus everything upstream, so lifecycle must be ≥ combustion for the same
plants. 650 cannot be correct for US oil generation. (It is a plausible number
for an efficient modern oil plant, which is not what the US runs — US petroleum
generation is largely old oil steam and diesel engines with poor heat rates.)

**Recommendation:** `LIFECYCLE_FACTORS.oil: 650 → 1200` (1,116 combustion plus
~85–170 upstream for extraction and refining).

**Why this matters despite oil being tiny:** it is tiny *almost* everywhere.
New England burns meaningful oil during winter pipeline constraints — ISO-NE
reported oil and coal at roughly 24% of January 2026 CO₂ (794 kt of 3.28 Mt)
during a cold snap
([ISO Newswire](https://isonewswire.com/2026/02/25/monthly-wholesale-electricity-prices-and-demand-in-new-england-january-2026/)).
Those are exactly the hours an ISNE user most needs flagged, and today they are
priced at 58% of their true rate. Because oil's share is small in normal
conditions, this change barely perturbs the band calibration in #1.

### 2c. Coal: 820 → 1100 (same failure, bigger blast radius)

EIA, 2023: **US coal generation emitted 2.31 lb CO₂/kWh = 1,048 gCO₂/kWh,
combustion-only.** The app's lifecycle coal factor is **820** — again below the
measured combustion-only rate for the same fleet.

AR5's 820 is not wrong as a *global* harmonised median; it reflects a
literature sample weighted toward newer, more efficient plants. The US coal
fleet is older than that sample, and EIA's 1,048 is measured from actual fuel
burn.

**Recommendation:** `LIFECYCLE_FACTORS.coal: 820 → 1100` (1,048 plus ~60–80
upstream for mining, transport and coal-mine methane).

**⚠️ Rollout coupling — do not ship this one on its own.** The band edges in #1
were derived from 14-day means computed *with* coal at 820. Raising coal by 280
g/kWh moves coal-heavy regions substantially: at a ~30% coal share MISO gains
roughly +84 g/kWh, shifting its range from 426–506 to roughly 510–590. SPP,
MROW-area PJM and RFCW move similarly; CISO, BPA and ISNE barely move.

Two coherent shipping options:

- **Option A (recommended first step).** Ship #1 (`moderate: 400`), #2a (gas
  530) and #2b (oil 1200) now. Band placement stays valid: gas-heavy ERCOT goes
  367 → ~385, still under 400; MISO's floor goes 426 → ~436, still over it.
- **Option B (more accurate, more work).** Also ship #2c (coal 1100), then
  **re-pull 14-day means for every region and re-cut the bands from the new
  numbers** before release. Expect each edge to move up roughly 10–15% for
  coal-exposed regions.

Shipping coal without re-cutting the bands would shove MISO and SPP into
"carbon-heavy"/"very carbon-heavy" purely as an artefact of the factor change,
which is not the same thing as a real recalibration.

**The meta-point, stated plainly:** fixing gas while leaving coal at a value
*below* the US combustion-only rate would be internally inconsistent. The brief
asked about gas; applying the same test to the whole table finds two more
failures, and they are larger than the one asked about.

### 2d. `DIRECT_FACTORS` — dead code, and also wrong

`DIRECT_FACTORS` (coal 1000, gas 450, oil 850) is referenced **nowhere**:
`grep -rn "DIRECT_FACTORS" src` returns only its own definition, despite the
comment claiming it is "kept for the 'how we calculate' panel". Against EIA
measured combustion rates, coal 1000 (vs 1,048) and gas 450 (vs 435) are close
enough; **oil 850 vs 1,116 is not**. Either correct oil to `1115` or delete the
table. Zero user-visible impact today, so low priority.

---

## 3. Appliance and habit assumptions

Checked against ENERGY STAR, DOE/AFDC and EIA figures, plus first-principles
arithmetic wherever the appliance's own description implies a physical
calculation.

| Appliance | App value | Real-world | Verdict |
|---|---|---|---|
| Dishwasher | 1.2 kWh / 2 h | ENERGY STAR ceiling 240 kWh/yr ÷ 215 cycles/yr = **1.12 kWh/cycle** ([ENERGY STAR](https://www.energystar.gov/products/dishwashers/key_product_criteria), verified) | **Fine.** 1.2 sits just above the ES ceiling — reasonable with heated dry. |
| Washing machine | 0.6 kWh / 1 h | 0.5–1.0 kWh/load typical | **Fine**, with an energy-boundary caveat — see HABITS below. |
| Clothes dryer | 2.5 kWh / **1.5 h** | kWh: ~730 kWh/yr ÷ ~283 loads ≈ **2.58**. Duration: real cycles run **40–70 min**. | **kWh fine; duration too long → `durationHours: 1`.** |
| EV charging | 30 kWh / 4 h | DOE/AFDC default 3.6 mi/kWh ⇒ 27.8 kWh/100 mi ([AFDC](https://afdc.energy.gov/vehicles/electric-emissions-sources)); 30 kWh ÷ 7.7 kW ≈ 3.9 h | **Fine.** Both halves land well. |
| **Water heater** | **4 kWh / 2 h** | Sensible heat: `kWh = gal × 8.34 × ΔT°F ÷ 3412`. 50 gal, 55→120 °F = **7.9 kWh**; 40 gal, 63 °F rise = **6.2 kWh**. | **Wrong for its own label → `kWhPerRun: 7`.** See below. |
| Central AC pre-cool | 6 kWh / 2 h | ~3 kW ≈ a 3-ton unit (2.4–3.5 kW typical) | **Fine.** |
| Heat pump boost | 5 kWh / 2 h | 1.5–3.5 kW for mid-size systems | **Fine** for compressor-only. Cold-climate resistance backup would exceed it, which is acceptable for a "typical" case. |
| Electric oven | 2.3 kWh / 1 h | Element cycling puts steady-state baking nearer **1.5–2.0 kWh/h**; 2.3 works if preheat is included | **Slightly high.** Optional → `2.0`. |
| Pool pump | 7.5 kWh / 6 h (1.25 kW) | Single-speed pumps draw **1.5–2.5 kW** ⇒ 9–15 kWh over 6 h. 1.25 kW is realistic only for a **variable-speed** pump. | **Relabel** as variable-speed, or raise to `11`. |
| Home battery | 10 kWh / 3 h | ~3.3 kW charge rate is normal for home storage | **Fine.** |
| Charge devices | 0.3 kWh / 2 h | Laptop ~60 W + tablet ~15 W + 2 phones ~10 W over 2 h ≈ 0.19–0.25 kWh | **Fine**, marginally generous. |
| Vacuum / chores | 0.8 kWh / 1 h | Uprights 600–1,400 W | **Fine.** |

### The water heater, in detail

The assumption text reads "a full electric tank reheat, about 4 kWh over 2
hours". The physics of a full reheat does not give 4 kWh:

```
kWh = gallons × 8.34 lb/gal × ΔT°F ÷ 3,412 Btu/kWh

50 gal, 55 °F → 120 °F (ΔT 65):  7.9 kWh
45 gal, 55 °F → 120 °F (ΔT 65):  7.1 kWh
40 gal, 57 °F → 120 °F (ΔT 63):  6.2 kWh
```

**Recommendation: `kWhPerRun: 4 → 7`** (a mid-fleet 40–50 gallon tank),
defensible range 6–8.5. The alternative is to keep 4 and describe it as a
*partial* reheat — but then the word "full" has to go.

*On a competing figure:* a 9 kWh value can be reached by multiplying a 4,500 W
element by the app's own assumed 2-hour duration. That reasoning is circular —
it treats an app assumption as a physical input — and it additionally assumes
the element never cycles off. The sensible-heat calculation above is the
defensible route, and it lands at 6–8.5.

**Severity:** High. The water heater is a commonly selected appliance, and this
is a ~75% understatement of its gram totals. Percentages are unaffected.

### HABITS

- **`lights-off: 0.3` → `0.1`.** The detail text says "three LED bulbs left off
  for an evening". Three 9 W LEDs × 4 h = **0.108 kWh**. The value is ~3× its
  own description. Either lower it to `0.1` or rewrite the text to describe a
  whole house's evening lighting. **Medium severity** — it inflates a habit
  users can log repeatedly, so the error compounds in the running total.
- **`cold-wash: 0.5`** — no number change, but it deserves a code comment.
  Against the washer's own 0.6 kWh warm-wash baseline this implies ~83% of the
  cycle is water heating, which is the share usually quoted for a *hot* wash.
  The likely explanation is that the two figures use different energy
  boundaries: `kWhPerRun: 0.6` looks like the machine's own draw (most US
  washers draw pre-heated water from the house tank), while `cold-wash: 0.5`
  also credits the water heater's avoided reheat. Both are defensible; side by
  side they read as contradictory. One comment fixes it.
- **`air-dry: 2.5`** — matches the dryer's `kWhPerRun` exactly. **Fine.**
- **`thermostat: 1.5`** — plausible (≈5% of a ~30 kWh cooling day). The
  *wording* needs a nudge — see #4.
- **`unplug: 0.4`** — a conservative subset of a 5–10% standby load. **Fine.**
- **`shorter-shower: 1.2`** — 3 min at 2.5 gpm with a 65 °F rise = 1.19 kWh.
  **Fine** (a WaterSense head would be ~0.9).
- **`full-loads: 1.2`** — one avoided dishwasher/washer cycle. **Fine.**

---

## 4. `TIPS` and `FAQ` factual claims

| Claim | Verdict | Detail |
|---|---|---|
| "Standby power is about 5–10% of a typical home's electricity" | **Keep** | The 5–10% range is consistently attributed to DOE and to LBNL's standby-power research programme ([standby.lbl.gov](https://standby.lbl.gov/)). I could not load a primary DOE page stating that exact range this session — **well-corroborated via secondary sources; primary not verified.** |
| "Heating and cooling are the largest slice of most electricity bills" | **Accurate — keep** | EIA: air conditioning **19%** + space heating **12%** = 31% of home electricity, ahead of water heating (12%), lighting and refrigeration. Verified directly at [EIA, electricity use in homes](https://www.eia.gov/energyexplained/use-of-energy/electricity-use-in-homes.php). The "electricity bills" framing is the correct one — the frequently quoted "~50% of home energy" figure is *total site energy* including gas. |
| "Two degrees is about 5% of that" | **Soften → "roughly 2–5%"** | DOE's published rule of thumb is **~1% per degree for an 8-hour setback** ([energy.gov](https://www.energy.gov/energysaver/thermostats)). A sustained all-day 2 °F change is a larger intervention than that example, so 5% is reachable but sits at the aggressive edge of the guidance. "Roughly 2–5%" is honest and still motivating. Applies to the `TIPS` entry **and** the `HABITS.thermostat` detail line, which carry the same claim. |
| "Most of a wash cycle's energy goes into heating water" | **Accurate — keep** | ~90% is the commonly cited share for hot washes; directionally right for warm. Qualitative, so no number to fix. |
| "An LED uses about a fifth of what an incandescent does" | **Accurate — keep** | ENERGY STAR: LEDs use "at least 75% less energy" (≤¼), and real swaps (60 W → 8–12 W) land between ⅕ and ⅐. "About a fifth" is fair. |
| "It's the second-biggest energy user in a typical home" (water heater) | **Defensible — keep** | On EIA's electricity breakdown, water heating (12%) *ties* space heating (12%) behind AC (19%) as an individual end use. But the app's own adjacent tip groups "heating and cooling" (31%) — and under that grouping water heating **is** second. It is also second in total household site energy, after space heating. Optional nudge: say "your **electric** water heater", since roughly half of US homes heat water with gas and would see nothing of it on an electricity bill. |
| "A dryer load is roughly 2.5 kWh" | **Accurate — keep** | Matches the EIA-derived ~2.58 kWh/load and the app's own constant. |

### One copy inconsistency to fix

`src/app/tips/page.tsx` tells users the factor table is "IPCC AR5 medians, the
same basis Electricity Maps uses". That is **already untrue for oil** (AR5 has
no oil category at all), and would become untrue for gas and coal if #2 is
adopted. Reword to something like: "IPCC AR5 lifecycle medians for most fuels,
with coal, gas and oil adjusted to the measured US fleet average (EIA)" — and
keep it in sync with whatever `emissions.ts` ends up saying.

---

## 5. Average vs marginal — the caveat

Full write-up is in [`METHODOLOGY.md` §7](./METHODOLOGY.md). No constant
changes. What is and is not verifiable:

**Verified this session.** WattTime's own explainer confirms the two signals can
point in *opposite* directions, with a concrete example: a large new load on a
hydro-rich grid looks clean by average accounting, while in reality the hydro
was already committed and the new load ramps a fossil peaker
([watttime.org](https://watttime.org/data-science/data-signals/average-vs-marginal/)).
That page gives **no** quantitative divergence estimate — I checked
specifically for one.

**Cited but not re-verified.** The foundational US study is Siler-Evans,
Azevedo & Morgan, "Marginal Emissions Factors for the U.S. Electricity System",
*Environ. Sci. Technol.* 46(9), 4742–4748 (2012),
[doi:10.1021/es300145v](https://doi.org/10.1021/es300145v). The DOI resolves
(checked 23 Aug 2026), but ACS returns HTTP 403 and the PDF mirror would not
extract to text, so **I did not verify its specific numbers and have not quoted
any figure from it.**

**Could not verify at all — stated as a gap rather than filled with a guess.** A
published figure for (a) how often average and marginal disagree in *sign*, or
(b) a typical percentage error from using average as a proxy for marginal. I
looked and did not find one. `METHODOLOGY.md` §7 says so explicitly instead of
inventing a number, which is the honest position for a general-audience caveat.

**Existing UI copy** (`src/app/tips/page.tsx`: "We use average emissions, not
marginal… can differ from the grid average and occasionally even points the
other way") is directionally correct and needs no rewrite.

---

## 6. The other factor choices

- **Lifecycle rather than combustion-only as the default: correct, keep it.** It
  gives solar, wind and nuclear small non-zero values, which is both more
  honest and easier to explain than implying they are free. It also matches
  Electricity Maps' default basis, so numbers stay comparable across tools.
- **Coal 820, nuclear 12, hydro 24, solar 48, wind 11:** all match the widely
  reproduced IPCC AR5 WG3 Annex III Table A.III.2 medians. *(Unverified against
  the primary PDF — ipcc.ch returned HTTP 403 for the Annex III PDF on 23 Aug
  2026; values match the table as reproduced across secondary sources.)* Coal's
  separate **US-fleet** problem is #2c.
- **Oil 650 — the citation is wrong as well as the value.** AR5 Annex III has no
  oil/petroleum category (oil is under 2% of global generation and was not
  modelled), so the code comment "IPCC AR5 (WG3 Annex III) medians" overclaims
  provenance for that row. Fix the comment regardless of whether you take the
  value change in #2b.
- **`OTH`/`UNK` at 300: reasonable, and already honestly caveated.** A genuine
  EIA grab-bag (landfill gas, waste heat, non-biogenic municipal waste,
  petroleum coke, unclassified units) with no single published factor. 300 sits
  between AR5's dedicated-biomass median (230) and waste-to-energy (frequently
  cited above 500 net, because of the fossil-derived fraction of municipal
  waste). The existing code comment says exactly this rather than dressing it up
  as a citation — good practice. **No change.** I could not find a published
  composition breakdown for the bucket in EIA-930: **unverified**.
- **`GEO` at 38, pulled out of the "Other" bucket: correct, keep.** Consistent
  with AR5's geothermal median, and the brief confirms that bucketing it at 300
  overstated CAISO by ~7 gCO₂e/kWh. The underlying pattern — code-level factors
  preferred over bucket factors — is the right architecture, and it is worth
  applying anywhere else EIA reports a specific code inside a mixed bucket.
- **Excluding storage from the mix: correct.** A battery moves energy rather
  than making it; counting discharge at 0 g/kWh would credit the grid twice for
  the same clean electron.

---

## 7. Things I checked that are fine

Stated plainly rather than padded into findings: the dishwasher, washer, EV,
AC, heat-pump, home-battery, devices and vacuum energy figures; the `air-dry`,
`unplug`, `shorter-shower` and `full-loads` habit values; the standby-power,
heating/cooling-share, cold-wash, LED, water-heater-ranking and dryer-kWh copy
claims; the lifecycle-over-combustion choice; the geothermal special case; the
`OTH`/`UNK` bucket; the nuclear, hydro, solar and wind factors; the exclusion
of storage; the baseline-is-now choice in `planWindows()`; the 48-hour
recommendation cap; and the demand-correlation gate (applying CISO/PJM/ISNE,
rejecting SPP/ERCOT on |r| and n rather than by hand) — which is a genuinely
good piece of modelling discipline and worth keeping as the pattern for any
future correction.

---

## Appendix: verification log

| Claim | How verified | Result |
|---|---|---|
| EIA gas/coal/oil fleet rates | Fetched [EIA FAQ 74](https://www.eia.gov/tools/faqs/faq.php?id=74&t=11) | ✅ 2023: coal 2.31, gas 0.96, petroleum 2.46 lb CO₂/kWh |
| Gas heat rates by prime mover | Fetched [EIA EPA Table 8.2](https://www.eia.gov/electricity/annual/html/epa_08_02.html) | ✅ 2024: CC 7,548, steam 10,337, GT 10,999 Btu/kWh |
| Natural gas carbon coefficient | Fetched [EIA carbon coefficients](https://www.eia.gov/environment/emissions/co2_vol_mass.php) | ✅ 52.91 kg CO₂/MMBtu |
| eGRID subregion rates | Fetched eGRID2023 subregion table | ✅ 11 subregions, 195–637 gCO₂e/kWh |
| EIA home electricity end-use shares | Fetched [EIA electricity use in homes](https://www.eia.gov/energyexplained/use-of-energy/electricity-use-in-homes.php) | ✅ AC 19%, space heating 12%, water heating 12% |
| ENERGY STAR dishwasher criteria | Fetched [ENERGY STAR](https://www.energystar.gov/products/dishwashers/key_product_criteria) | ✅ ≤240 kWh/yr standard, 215 cycles/yr test basis |
| DOE thermostat rule of thumb | energy.gov guidance | ✅ ~1%/°F for an 8-hour setback |
| WattTime average-vs-marginal | Fetched [WattTime](https://watttime.org/data-science/data-signals/average-vs-marginal/) | ✅ Qualitative divergence confirmed; **no** quantitative estimate given |
| ISO-NE winter oil burn | Fetched [ISO Newswire, Feb 2026](https://isonewswire.com/2026/02/25/monthly-wholesale-electricity-prices-and-demand-in-new-england-january-2026/) | ✅ Oil + coal ≈24% of Jan 2026 CO₂ |
| IPCC AR5 Annex III primary PDF | ipcc.ch | ❌ HTTP 403 — values match secondary reproductions; marked unverified |
| Siler-Evans et al. 2012 full text | DOI → ACS (403); PDF mirror would not extract | ⚠️ DOI resolves; no figures quoted |
| Hourly gas technology split by BA | Searched | ❌ Not found — **unverified**; no peak multiplier recommended |
| `OTH`/`UNK` bucket composition | Searched | ❌ Not found — **unverified** |
| Average-vs-marginal sign-disagreement frequency | Searched | ❌ No published figure — gap stated in methodology |

*Method note: this session's web-search quota was exhausted partway through, so
later verification used direct fetches against known primary sources
(eia.gov, epa.gov, energystar.gov, watttime.org). Where that was not possible,
the gap is marked above rather than papered over.*
