# GridMap methodology

*Last reviewed: 23 August 2026.*

This is the document for a skeptical reader — someone who would rather check
our arithmetic than trust our adjectives. It describes what the app actually
computes **today**, including the places where we know it is wrong.

Two ground rules for this document:

1. **Recommended changes are not documented as if they were already made.**
   Where this review concluded a constant should change, the current value is
   described here and the change is tracked in
   [`docs/science-review.md`](./science-review.md). This file never claims more
   rigour than the running code has.
2. **Anything unverified says so.** Where a source could not be loaded and
   checked, it is marked *(unverified)* with a note on what was being looked
   for. A fabricated citation would be worse than an admitted gap.

---

## 1. Data sources

| Source | What we use it for | Cost | Link |
|---|---|---|---|
| EIA API v2, `electricity/rto/fuel-type-data` (the EIA-930 dataset) | A year of hourly generation by fuel type, per balancing authority. The backbone of everything. | Free, instant API key | [eia.gov/opendata](https://www.eia.gov/opendata/) |
| EIA API v2, `electricity/rto/region-data` (`D` and `DF` types) | Live demand and the day-ahead demand forecast, used to nowcast the current hour and condition the first ~16 hours | Same key | [EIA Hourly Electric Grid Monitor](https://www.eia.gov/electricity/gridmonitor/about) |
| Electricity Maps | An independent live intensity reading and short forecast, when a token is configured | Free tier | [portal.electricitymaps.com](https://portal.electricitymaps.com/) |
| WattTime | A marginal-emissions cleanliness percentile, shown as a cross-check only — never blended into our average-intensity series (see §7) | Free tier, limited regions | [watttime.org](https://watttime.org/) |
| IPCC AR5 WG3 Annex III | Lifecycle emission factors per fuel (§3) | Free | [ipcc.ch AR5 WG3](https://www.ipcc.ch/report/ar5/wg3/) |
| EPA eGRID | Regional cross-check on our computed intensities | Free | [epa.gov/egrid](https://www.epa.gov/egrid) |
| api.zippopotam.us | ZIP → city name and lat/lon. Cosmetic only; it never decides which grid region you get. | Free, no key | [zippopotam.us](https://www.zippopotam.us/) |

If no optional key is configured, the app falls back to a bundled year of EIA
history per region (`src/lib/grid/data/profiles/`), and failing that to a
"physically plausible archetype" — which is always labelled as modelled, never
presented as measured.

---

## 2. How a fuel mix becomes gCO₂e/kWh

For one hour, EIA-930 reports megawatt-hours by fuel code for a balancing
authority — e.g. `NG: 4,200, SUN: 1,800, WAT: 600`. We then:

1. **Drop storage codes** (`BAT`, `PS`, `OES`, `UES`). A battery moves energy
   rather than making it, and its charge/discharge appears as negative/positive
   net generation. Counting discharge at 0 g/kWh would credit the grid twice
   for the same clean electron.
2. **Multiply each fuel's MWh by its lifecycle emission factor** (§3), using
   the *EIA-code-level* factor where we have one. This matters most for
   geothermal: `GEO` is displayed inside our "Other" bucket but is costed at
   38 g/kWh rather than the bucket's 300, because bucketing it overstated
   CAISO by roughly 7 gCO₂e/kWh.
3. **Divide by total MWh** to get a generation-weighted mean:

   $$I_{\text{hour}} = \frac{\sum_f \text{MWh}_f \times \text{EF}_f}{\sum_f \text{MWh}_f}$$

The result is the **average (attributional) carbon intensity of generation** in
that balancing authority for that hour. Three things it deliberately is not:

- **Not consumption-based.** Imports and exports are not traced. A region that
  imports heavily from a dirtier neighbour will read cleaner here than a full
  consumption accounting would show. EIA publishes interchange (`TI`), so this
  is fixable, and is the single largest known structural gap in the model.
- **Not marginal.** See §7 — this is the most important caveat in the document.
- **Not grid losses or end-use efficiency.** We report emissions per kWh
  *generated*, not per kWh delivered to your socket. US transmission and
  distribution losses run roughly 5%, so a true delivered-kWh figure would be
  a few percent higher across the board.

Implementation: `intensityFromEiaGeneration()` and `intensityFromMix()` in
`src/lib/emissions.ts`.

---

## 3. The emission factor table

These are the values in `LIFECYCLE_FACTORS` (`src/lib/emissions.ts`) as the
code stands today. **Lifecycle** rather than combustion-only, so that solar,
wind and nuclear come out small but non-zero — which is both more honest and
easier to explain than pretending they are free.

| Fuel | Current factor (gCO₂e/kWh) | Basis | Status of that citation |
|---|---|---|---|
| Coal | 820 | IPCC AR5 pulverised-coal lifecycle median | Matches AR5, **but understates the US fleet** — see §4 |
| Natural gas | 490 | IPCC AR5 gas *combined-cycle* lifecycle median | Matches AR5, **but understates the US fleet** — see §4 |
| Oil | 650 | **Not from AR5.** AR5 Annex III has no oil category (oil is a rounding error in global generation, so it was not modelled). | **Miscited, and understates the US fleet** — see §4 |
| Nuclear | 12 | IPCC AR5 median | Consistent with the widely reproduced AR5 table *(unverified against the primary PDF — ipcc.ch returned HTTP 403 for the Annex III PDF on 23 Aug 2026)* |
| Hydro | 24 | IPCC AR5 median | As above. Note AR5's hydro range is enormous (some tropical reservoirs exceed 2,000 g/kWh); 24 is the median, not a guarantee. |
| Solar | 48 | IPCC AR5 utility-scale PV median | As above |
| Wind | 11 | IPCC AR5 onshore median | As above |
| Other (`OTH`, `UNK`) | 300 | A judgement call, not a citation — sits between dedicated biomass (AR5 median 230) and waste-to-energy | Honest placeholder; see below |
| Geothermal (`GEO`) | 38 | IPCC AR5 geothermal median | As above |
| Biomass (`BIO`) | 230 | IPCC AR5 dedicated-biomass median | As above |
| Storage | 0 (excluded) | Not a generation source | — |

**On the "Other" bucket at 300 g/kWh.** EIA's `OTH` and `UNK` codes are a
genuine grab-bag: landfill gas, waste heat, non-biogenic municipal waste,
petroleum coke, and units the balancing authority simply did not classify.
There is no single defensible published factor for that mixture, and it varies
by region. 300 is a deliberate midpoint between biomass (230) and
waste-to-energy (which is often cited well above 500 g/kWh net, because of the
fossil-derived fraction of municipal waste). We could not find a published
breakdown of what fraction of the `OTH`/`UNK` bucket is which fuel in EIA-930
*(unverified — this is what we were looking for and did not find)*. In most
regions the bucket is a small enough share of generation that the choice
changes the headline by only a few g/kWh; the case where it mattered
(geothermal in CAISO) is special-cased out of the bucket entirely.

---

## 4. Where the factor table is wrong: US fleet vs global median

This is the most substantive finding of the August 2026 review, and it is
documented here because the constants have not changed yet.

IPCC AR5's medians are a **global, harmonised literature sample**, weighted
toward the newer and more efficient plants that dominate the LCA literature.
The US fossil fleet is older and less efficient than that sample. EIA
publishes what the US fleet actually emitted, measured from real fuel burn:

| Fuel | EIA measured US rate, 2023 (combustion only) | App's current *lifecycle* factor |
|---|---|---|
| Coal | 2.31 lb/kWh = **1,048 gCO₂/kWh** | 820 |
| Natural gas | 0.96 lb/kWh = **435 gCO₂/kWh** | 490 |
| Petroleum | 2.46 lb/kWh = **1,116 gCO₂/kWh** | 650 |

Source: [EIA FAQ — How much CO₂ is produced per kWh of generation?](https://www.eia.gov/tools/faqs/faq.php?id=74&t=11)

For coal and oil, the app's *lifecycle* number is **below** the measured
*combustion-only* rate for the same fleet. That is not a debatable modelling
choice, it is arithmetically impossible: lifecycle emissions include combustion
plus everything upstream, so lifecycle must be ≥ combustion for the same
plants. Both factors understate US reality.

### The gas case in detail

The app's 490 is AR5's median for a **combined-cycle** plant, applied to every
megawatt-hour EIA reports under the single `NG` code — which lumps
combined-cycle, simple-cycle peaking turbines, and gas steam together. The
technologies are not close to each other:

| Gas technology | EIA 2024 heat rate (Btu/kWh) | × 52.91 kg CO₂/MMBtu ⇒ combustion gCO₂/kWh |
|---|---|---|
| Combined cycle | 7,548 | **399** |
| Gas steam turbine | 10,337 | **547** |
| Simple-cycle gas turbine (peaker) | 10,999 | **582** |

Heat rates: [EIA Electric Power Annual, Table 8.2](https://www.eia.gov/electricity/annual/html/epa_08_02.html)
(capacity-weighted, at full load). Carbon coefficient: 52.91 kg CO₂ per million
Btu, [EIA carbon coefficients](https://www.eia.gov/environment/emissions/co2_vol_mass.php).

A peaking turbine emits about **46% more per kWh than a combined-cycle plant**,
and peakers are exactly what a grid dispatches to cover the evening demand
ramp — the hours this app tells people to avoid. So 490 understates the evening
peak on two counts at once: it is a best-case technology's factor, applied to a
fleet, at the hours when the worst-case technology is most likely to be running.

**The defensible correction** anchors on the measured fleet average rather than
a single technology's median. AR5's own numbers imply the lifecycle uplift over
combustion for gas: 490 (lifecycle CCGT) − 399 (combustion CCGT) ≈ **90 g/kWh**
of upstream extraction, processing, transport, methane leakage and construction.
Applying that same uplift to EIA's measured fleet-average combustion rate:

$$435 + 90 \approx 525 \text{ gCO}_2\text{e/kWh}$$

`docs/science-review.md` recommends 530 on this basis. The same method gives
~1,100 for coal and ~1,200 for oil.

**What we deliberately did not do:** apply a higher gas factor during peak
hours specifically. It is the right idea physically, but EIA's hourly feed
carries no technology split under `NG`, so any peak-hour multiplier would be a
number we invented rather than measured. Doing it properly means joining
plant-level technology (EIA-860/923) to hourly output — real future work, not a
fudge factor. We could not find published hourly gas-technology shares by
balancing authority *(unverified — this is what we looked for)*.

---

## 5. How the 7-day forecast is built

EIA publishes no carbon forecast. What it does publish is a year of hourly
history, and the grid is strongly periodic — so the single best predictor of
"how clean is 2 PM next Tuesday" is "how clean was 2 PM on recent Tuesdays".

### 5.1 Hour-of-week climatology

We build **168 buckets**, one per hour of the week, in the region's **local**
time (so a bucket means "Tuesday 2 PM" for a human, and DST transitions land
correctly). Every historical hour is weighted by the product of two kernels:

- **Recency** — exponential decay, **~90-day half-life**. Grids change fast:
  CAISO added gigawatts of batteries and solar in a single year, so last month
  is worth much more than last spring.

  $$w_{\text{recency}} = 2^{-\text{age}_{\text{days}} / 90}$$

- **Seasonality** — Gaussian on *circular* day-of-year distance, **σ ≈ 30
  days**. July solar looks nothing like January solar. The distance is circular
  so a 2 January forecast can still learn from late December.

  $$w_{\text{season}} = \exp\left(-\frac{d^2}{2 \times 30^2}\right)$$

Sparse buckets are shrunk toward a coarser **weekday/weekend × hour-of-day**
prior (pseudo-weight 1.5, so a well-populated bucket is smoothed ~25% and an
empty bucket inherits the prior entirely). Intensity is averaged *directly*
from each sample rather than recomputed from the averaged mix, so the
code-level factor corrections (geothermal at 38, not 300) survive into the
forecast.

Implementation: `buildProfile()` in `src/lib/grid/climatology.ts`.

### 5.2 The live end: nowcast and day-ahead blending

The climatology alone cannot tell you about *today*. Three verified facts about
the EIA feeds shape what we do (all measured against the live API in this
project, August 2026):

- **Fuel-mix data lags 9–12 hours** (measured 2026-08-23: CISO 9h, PJM 12h,
  ERCO 11h). So the current hour is never directly observed.
- **Live actual demand (`D`) lags ~1 hour.**
- **The day-ahead demand forecast (`DF`) reaches 13–16 hours ahead.**

Demand is not carbon intensity, but in demand-driven grids it is a good proxy,
because incremental load is met by marginal fossil plant. So we regress the
*intensity residual* (versus its hour-of-week normal) on the *demand residual*
(versus its own hour-of-week normal), fit per balancing authority, and **only
apply the correction where the fit earns it** (|r| ≥ 0.4, n ≥ 500):

| Region | Fitted r | Applied? |
|---|---|---|
| PJM | 0.82 | Yes |
| ISNE | 0.77 | Yes |
| CISO | 0.74 | Yes |
| SPP | 0.01 | **No** |
| ERCOT | −0.19 | **No** |

SPP and ERCOT are wind-driven: their dirty hours are calm hours, not busy
hours, so the relationship genuinely is not there. Gating on the fit rather
than on hand-written per-region rules means this self-calibrates as grids
change.

Two guardrails: the demand input is clipped to ±30% deviation, and the
resulting move is capped at ±35% of the climatology value, so a data glitch
cannot produce a physically absurd number. Only the regression's **slope** is
applied, never the intercept — the intercept is a level offset between the
shrunk climatology and the plain mean of the fitting window (about −19 g/kWh
for CISO), and applying it would put a visible step in the middle of the series
between corrected and uncorrected hours.

**EIA's day-ahead forecast is biased** relative to metered demand for some
regions (CISO ran 17–30% low). So it is **anchored to the latest actual
reading and used only for shape**, never for level.

Implementation: `src/lib/grid/demand.ts`, `src/lib/grid/snapshot.ts`.

### 5.3 What this means for confidence

| Horizon | What it is | Labelled |
|---|---|---|
| Current hour | Climatology + live-demand nowcast | Estimated, flagged in the UI |
| ~1–16 hours | Climatology + day-ahead demand forecast shape | Higher confidence |
| ~16 hours – 7 days | Pure hour-of-week climatology | Pattern, not prediction |

Beyond about 16 hours the forecast has no idea whether next Thursday is windy.
It is your grid's typical shape for that hour of that weekday, and the app says
so.

---

## 6. How savings are computed

For an appliance with energy $E$ (kWh) and duration $d$ (hours), starting at
hour $t$:

$$G(t) = E \times \frac{\sum_i I_{t+i} \cdot w_i}{\sum_i w_i}$$

where $w_i$ weights each clock hour by how much of the run lands in it — a
90-minute cycle started at 2 PM is weighted 1.0 for the 2 PM hour and 0.5 for
the 3 PM hour. Steady power draw across the run is assumed, which is close
enough for everything we model (it is least true for a dryer, which tapers).

**The baseline is running it right now** — not the week's dirtiest hour.
Comparing against the worst available moment would inflate every headline. So:

$$\text{savings\%} = \frac{G(\text{now}) - G(t)}{G(\text{now})} \times 100$$

Three deliberate conservatisms:

- **Recommendations are capped at 48 hours** (`RECOMMEND_HORIZON_HOURS`), even
  though the chart shows a week. Only the near term is conditioned on live
  conditions; the far end sits at its long-run average. Without the cap, the
  cleanest-looking hour in the series is almost always the furthest one out,
  because it is the least corrected — the app once told a Sunday visitor to run
  their dishwasher the following Saturday for a "32% saving", which is a
  comparison between a measured today and an idealised someday.
- **Savings below 5% read as "now is fine"** (`NOW_IS_GREAT_THRESHOLD`). Below
  that, the difference is noise in our own forecast.
- **A window fractionally dirtier than now displays as 0%**, never as a
  negative saving.

Implementation: `planWindows()` in `src/lib/grid/windows.ts`.

### Appliance assumptions

These are the current values in `src/lib/appliances.ts`. They are typical
figures for modern US appliances, not a reading from your meter — and because
both the baseline and the target hour scale with the same $E$, **a wrong kWh
figure changes the gram totals but barely moves the percentage**.

| Appliance | kWh/run | Duration | Review verdict (see `science-review.md`) |
|---|---|---|---|
| Dishwasher | 1.2 | 2 h | OK — ENERGY STAR ceiling is 240 kWh/yr ÷ 215 cycles = 1.12 |
| Washing machine | 0.6 | 1 h | OK, but the energy boundary is ambiguous (machine-only vs including water heating) |
| Clothes dryer | 2.5 | 1.5 h | kWh OK; **duration too long**, real cycles are 40–70 min |
| EV charging | 30 | 4 h | OK — 30 kWh ÷ 7.7 kW ≈ 3.9 h on a common 240 V/32 A charger |
| Water heater | 4 | 2 h | **Too low for its own "full tank reheat" label** — physics says 6–8.5 |
| Central AC pre-cool | 6 | 2 h | OK — 3 kW ≈ a 3-ton unit |
| Heat pump boost | 5 | 2 h | OK for compressor-only; excludes resistance backup |
| Electric oven | 2.3 | 1 h | Slightly high; element cycling puts steady baking nearer 1.5–2.0 |
| Pool pump | 7.5 | 6 h | Only right for a **variable-speed** pump; single-speed is 1.5–2.5 kW |
| Home battery | 10 | 3 h | OK |
| Charge devices | 0.3 | 2 h | OK |
| Vacuum / chores | 0.8 | 1 h | OK |

Habits (`HABITS`) are valued at the region's average intensity rather than a
shifted hour, because they are energy you did not use at all rather than energy
you moved.

---

## 7. Average vs marginal emissions — the honest caveat

**This is the most important limitation in the app, and the one a professor
will ask about first.**

### What we do

We compare the **average** carbon intensity of generation across hours: total
emissions ÷ total generation, hour by hour.

### What the strictly correct signal is

The academically correct question for load shifting is **marginal**: if you add
one kilowatt-hour of demand at 2 PM, which generator actually ramps up to serve
it, and what does *that* plant emit? This is what WattTime's Marginal Operating
Emissions Rate (MOER) estimates.

### Why we use average anyway

1. It is published free, hourly, for **every** US balancing authority. Marginal
   data is not.
2. It is auditable — you can recompute our number from EIA's public feed (§9).
   Marginal rates come from proprietary dispatch models.
3. It is explainable to someone who has never heard the phrase "carbon
   intensity".

### When this could mislead you

The two signals can differ substantially, and **can point in opposite
directions**. WattTime's own explainer gives the clearest example: a large new
load on a hydro-rich grid looks clean by average accounting — the grid's mix is
mostly hydro — while in reality the hydro was already fully committed, and the
new load is served by ramping a fossil peaker. Average says "clean", marginal
says "you just caused emissions".
([WattTime: average vs marginal](https://watttime.org/data-science/data-signals/average-vs-marginal/),
verified 23 Aug 2026.)

The general shape of the problem: average intensity is dominated by whatever
runs *most* of the time (baseload nuclear, hydro, coal), while marginal
intensity is set by whatever is *last* in the dispatch order. On a grid with
lots of must-run baseload and a slow-ramping fossil fleet, the cleanest-looking
hours by average can be hours when the marginal unit is unchanged — meaning the
saving you were promised does not materialise.

### How big is the error, really?

Here we have to be straight with you: **we could not verify a published figure
for how often average and marginal disagree in sign, or for a typical
percentage error when average is used as a proxy.** We looked for one and did
not find it. Anyone telling you a crisp number for that is probably
extrapolating.

What does exist is the foundational US study — Siler-Evans, Azevedo & Morgan,
"Marginal Emissions Factors for the U.S. Electricity System," *Environmental
Science & Technology* 46(9), 4742–4748 (2012),
[doi:10.1021/es300145v](https://doi.org/10.1021/es300145v). The DOI resolves
(checked 23 Aug 2026) but the full text is paywalled at ACS, so **we did not
re-verify its specific regional numbers ourselves** and do not quote figures
from it here.

### The practical bottom line

The direction of our advice is robust where the *fuel mix itself* changes a
lot between hours — a solar grid at noon versus 7 PM genuinely has different
marginal units, not just a different average. It is least reliable on grids
where the mix is flat across the day and the marginal unit is the same gas
plant at every hour; there, our "cleaner hour" may be a real but much smaller
saving than the percentage implies.

We show WattTime's marginal percentile alongside our own number when a token is
configured, precisely so a curious user can see the two signals disagree. We
never blend it into the average series.

---

## 8. Limitations, ranked by how much they could bite

1. **Average, not marginal** (§7). Structural. Could overstate or understate
   any individual saving, and in unusual cases point the wrong way.
2. **Coal and oil factors understate the US fleet** (§4). Currently biases
   coal-heavy regions (MISO, SPP) *cleaner* than they are — by roughly 30% on
   the coal contribution.
3. **Gas is costed as combined-cycle** (§4). Biases the evening peak cleaner
   than reality, which specifically understates the thing the app is selling.
4. **Generation-based, not consumption-based** (§2). Import-heavy regions read
   cleaner than a full accounting would show.
5. **Beyond ~16 hours it is a pattern, not a prediction** (§5.3). No weather
   input at all.
6. **ZIP → grid region is approximate.** Utility service territories do not
   follow postal boundaries and some states are split across operators. The UI
   offers a manual override.
7. **The current hour is inferred, not measured** (§5.2), because the fuel-mix
   feed lags 9–12 hours.
8. **Appliance figures are typical, not yours** (§6). Percentages hold; gram
   totals scale with your actual appliance.
9. **No grid losses.** Per-kWh-generated, roughly 5% below a delivered-kWh
   figure.

---

## 9. How to check us

Everything above is recomputable from a free API key
([register here](https://www.eia.gov/opendata/register.php)).

### Pull one region's fuel mix for the last day

> **`curl` needs `-g`.** Without it, the shell/curl globbing parser treats
> `data[0]` as a glob pattern and mangles the URL.

```bash
API_KEY=your_key_here

curl -g "https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/\
?api_key=${API_KEY}\
&frequency=hourly\
&data[0]=value\
&facets[respondent][]=CISO\
&start=2026-08-20T00\
&end=2026-08-21T00\
&sort[0][column]=period&sort[0][direction]=desc\
&offset=0&length=500"
```

Rows come back as:

```json
{ "period": "2026-08-20T14", "respondent": "CISO", "fueltype": "SUN",
  "type-name": "Solar", "value": 12345, "value-units": "megawatthours" }
```

Periods are **UTC hour starts**. `value` is a JSON number in current
responses, but has historically been quoted — coerce it.

### Recompute an hour's intensity by hand

Take every fuel code for a single `period`, drop `BAT`/`PS`/`OES`/`UES`, then:

```
intensity = Σ(MWh × factor) / Σ(MWh)
```

using the factors in §3. You should land within a gram or two of what the app
shows for that hour (allowing for the geothermal special-case and for EIA
revising provisional rows).

### Check the freshness claims for yourself

```bash
# Fuel mix: expect the newest row to be 9-12 hours old
curl -g "https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/\
?api_key=${API_KEY}&frequency=hourly&data[0]=value\
&facets[respondent][]=CISO\
&sort[0][column]=period&sort[0][direction]=desc&length=1"

# Live demand: expect ~1 hour old
curl -g "https://api.eia.gov/v2/electricity/rto/region-data/data/\
?api_key=${API_KEY}&frequency=hourly&data[0]=value\
&facets[respondent][]=CISO&facets[type][]=D\
&sort[0][column]=period&sort[0][direction]=desc&length=1"

# Day-ahead forecast: expect rows 13-16 hours into the future
curl -g "https://api.eia.gov/v2/electricity/rto/region-data/data/\
?api_key=${API_KEY}&frequency=hourly&data[0]=value\
&facets[respondent][]=CISO&facets[type][]=DF\
&sort[0][column]=period&sort[0][direction]=desc&length=1"
```

### Cross-check a region against an independent source

EPA's eGRID gives annual average CO₂ rates per subregion. These are
**combustion-only**, so our lifecycle numbers should sit *above* them for
fossil-heavy regions — if one of ours came out below its eGRID rate, something
is wrong. eGRID2023 examples (converting lb/MWh × 0.4536):

| eGRID subregion | lb CO₂e/MWh | ≈ gCO₂e/kWh |
|---|---|---|
| CAMX (most of California) | 430.0 | 195 |
| RFCE (mid-Atlantic) | 599.2 | 272 |
| NWPP (Northwest) | 635.3 | 288 |
| ERCT (most of Texas) | 736.6 | 334 |
| FRCC (peninsular Florida) | 784.8 | 356 |
| SPNO / SPSO (Southwest Power Pool) | 867.7 / 875.6 | 394 / 397 |
| RFCW (Ohio Valley) | 916.1 | 415 |
| MROW (upper Midwest) | 926.6 | 420 |
| RMPA (Colorado) | 1042.5 | 473 |
| MROE (eastern Wisconsin) | 1405.0 | 637 |

Source: [EPA eGRID](https://www.epa.gov/egrid) (eGRID2023, released 2025).

---

## 10. Corrections and changelog

Findings from the August 2026 science review — including the recommended
constant changes that this document deliberately does **not** pretend are
already in the code — are in
[`docs/science-review.md`](./science-review.md).

If you find something wrong here, the fix belongs in both places: the constant
in `src/lib/`, and the claim in this file.
