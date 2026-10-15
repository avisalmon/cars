# New Family Car in Israel — Hybrid & PHEV Shortlist

A static, dependency-free site that compares new hybrid and plug-in hybrid family cars
available in Israel, built on a reproducible five-year cost-of-ownership model that
recomputes live from assumptions you control.

Market snapshot: Israel, October 2026. New cars only. Fully electric vehicles and
Chinese brands are out of scope.

## What it does

- Offers four **buyer profiles** as starting points — each re-weights the ranking, and some
  remove cars from consideration entirely.
- Ranks 12 fully modeled cars against ten criteria you weight yourself (0 removes a criterion).
- Recomputes every cost figure in the browser from four sliders: kilometres per year,
  petrol price, electricity price, and the share of PHEV kilometres driven on battery.
- Shows the highest-scoring cars as photo cards with official model links and
  Haifa-area showrooms.
- Breaks each car's five-year cost into its components, with trims, warranty position,
  negotiation targets and the pros/cons from the underlying research.

### Buyer profiles

| Profile | What it does |
|---|---|
| Cash price & petrol only, space required | **Default.** Scores on purchase price plus five years of fuel, added together in shekels. Five-year total cost and resale are weighted to **zero**. Excludes plug-ins and requires a 550 L+ boot, so three cars remain. |
| Price, fuel & comfort — every car | All 12 cars, ranked on cash price, fuel use and the comfort proxy. |
| Full research ranking | Every model, weighted as the original report argued. |
| Cost-effective family car, no plug | Weights running cost and fuel economy highest and **excludes plug-in hybrids**. |
| Space is a requirement, no plug | No plug-ins **and** a published boot of 550 L or more. Leaves three cars. |
| Biggest verified boot | A **published boot of 550 L or more**, any powertrain. |
| Lowest cash outlay | Weights purchase price over five-year cost. |

A profile owns two separate things: **which cars are in scope** (sticky — it is the category
you chose) and a **starting weight mix** (freely adjustable). Moving a weight slider marks the
profile as adjusted but never quietly puts an excluded car back into the list; Reset restores
the profile's mix.

Why the space profiles filter rather than just weighting cargo: almost every car here seats
five, and the Camry, Santa Fe and CX-90 have no published Israeli boot figure, so they cannot
be ranked on space honestly. A cargo floor treats *unknown* as failing the floor rather than
pretending the value is good. Weighting alone ranked the **smallest**-boot car first.

#### Boot figures are not all the same kind of number

`fieldNotes.cargo` carries the provenance of each boot figure, shown as a tooltip on the value.
This matters: the Symbioz's 624 L exists only with its sliding rear bench pushed forward, so it
trades boot space against rear legroom and is not comparable with a fixed 580 L boot. The
Sorento's 179 L is with all three rows up, 813 L with the third row folded. Three cars have no
published figure at all and show `—`.

### The comfort proxy — read this before trusting the column

**The research contains no comfort rating, so this number is computed by the site, not taken
from a source.** It is a weighted blend of four published specs, normalised across all 12 cars:

| Component | Weight | Source |
|---|---|---|
| Boot litres | 30% | Published figure |
| Seats | 30% | Published figure |
| Power (hp) | 20% | Published figure |
| Body class | 20% | **This site's judgement**: Sedan 0.50, SUV 0.75, 3-row SUV 1.00 |

It measures **size and space — not ride quality, seat comfort or cabin noise.** Three safeguards
are built in rather than hidden:

- A car with fewer than three of the four specs published scores `—`, not zero. Only the CX-90
  fails this (no boot volume, no local power figure).
- Missing components are re-weighted over what exists, so a gap never reads as "bad".
- The index normalises over the whole fleet once, so it does not move when you filter.

The **Camry is the clearest warning**: it scores 32/100 because its Israeli boot figure was
never published, while the research calls it the "best sedan for comfort and efficiency". The
**Sorento** scores 48 because its published 179 L is measured with all three rows occupied,
where every five-seater is quoted with nothing behind the seats — consistent, but not fair to
that car. Both caveats appear as tooltips on the value. Sort with it, then test-drive.

### Filtering by price and fuel

Two sliders in **Filters** cut the list to your real limits: **Max cash price** and **Max fuel
use**. The fuel filter works on the *modeled* `fuel.l100`, which is the figure the cost model
actually spends — not the official claim, which runs optimistic (the Elantra claims ~4.4 L/100km
and measures ~5.43 locally).

### Why "price + petrol" is one criterion, not two

The **Price + petrol** column adds the cash price and five years of fuel together *before*
scoring. This is not cosmetic. Scoring is min–max normalised per criterion across the visible
cars, so each criterion's spread is stretched to the same 0–100 range regardless of how many
shekels that spread is worth. On the three-car space shortlist the price spread is ₪60,710 but
the fuel spread is only ₪7,284 — scoring them separately made a ₪7k fuel gap count as heavily
as a ₪61k price gap, and ranked the car that was ₪38k more expensive on *both* measures above
the one that was cheaper. Adding shekels to shekels first removes the distortion.

The default profile therefore weights `cashPlusFuel` and leaves `acquisition`, `energy5`,
`consumption`, `tco5` and `residual` at zero, so nothing is counted twice. Note what that
deliberately hides: with resale weighted to zero, a car with weak residual value looks better
than it will prove to be.

#### On the Tucson

Hyundai Israel sells the Tucson **only as a plug-in hybrid** — there is no non-plug-in Tucson
to order. If you buy one and never charge it, its five-year cost rises from ₪185,086 to
₪205,191 and it falls from 6th to 9th. Drag the charging-share slider to zero to see it.

## The cost model

```
5-year cost = depreciation + registration/fees + insurance + energy + maintenance
```

- **Purchase price is deliberately excluded from that total.** Adding it to depreciation
  would count the acquisition twice. Cash required is reported separately.
- **Financing interest is excluded**, because it depends entirely on your down payment and
  rate. Illustratively, ₪150,000 over 60 months at a hypothetical 7% generates roughly
  ₪28,000 of interest — enough to erase any discount you negotiate.
- `depreciation = (msrp − discount) − msrp × residual`. Resale is set by the market, not by
  your invoice, so a negotiated discount reduces economic cost roughly shekel-for-shekel.
- Energy is recomputed from your kilometres. For the PHEV it blends electricity and petrol
  by your charging share.
- Baseline constants: petrol ₪7.77/L (regulated maximum, 5 Oct 2026), electricity
  ₪0.6352/kWh (uniform residential tariff incl. VAT, 1 Jul 2026), 15,000 km/yr over 5 years.

### Modeled consumption is not official consumption

`consumption` is the published official figure and is displayed as a spec.
`fuel.l100` is the *modeling* input and is deliberately higher, because the research budgets
fuel above headline lab numbers. The Elantra Hybrid validates this: a ~4.4 L/100 km claim
against ~5.43 L/100 km measured locally. **Keep the two fields separate.**

## Honesty conventions

These are intentional. Do not "fix" them by inventing values.

| Convention | Meaning |
|---|---|
| `null` field | The source did not publish it. Rendered as a dotted `—` with a tooltip. |
| `estimates: ["key"]` | The value is an approximation. Rendered with a dotted underline. |
| `quoteOnly` array | Cars with no credible transaction price (the two Nissan e-POWER models). They are shown but **never scored or ranked**. |
| `reliability`, `safety` | Analyst 1–10 scores, **not** survey results or Euro NCAP stars. Safety penalises an old five-star rating, because Euro NCAP protocols get harder over time. |
| Missing `dealers` entry | No showroom could be verified from the brand's official site. The UI says so rather than guessing an address. |
| `cargo` vs `cargoMax` | `cargo` is the usable, all-rows-up figure; `cargoMax` (seats folded) appears only in the detail view. |

## Files

```
index.html             markup and the DOM contract
css/style.css          theme tokens + layout
js/app.js              cost model, scoring, rendering
data/cars-israel.json  single source of truth
images/                CC-licensed photographs + credits.json
```

### Editing the data

Everything is in `data/cars-israel.json`:

- `meta.assumptions` — slider defaults. `meta.defaultProfile` — profile selected on first visit.
- `criteria` — the ten scored criteria. The **first six become the table columns**, in order.
- `profiles` — buyer profiles: `{ id, label, tagline, note, weights, excludePowertrain[], minCargo? }`.
- `cars` — the modeled cars. Required numeric fields: `msrp`, `registration`, `residual`,
  `fees5`, `insurance5`, `maint5`, `fuel.l100`.
- `cars[].fieldNotes` — optional `{ fieldKey: "why this number is what it is" }`, surfaced as a
  tooltip on that value. Use it whenever a figure is conditional, approximate or missing.
- `quoteOnly`, `dealers`, `images`, `sources`, `limitations`, `timeline`.

`dealers` is keyed by make:

```json
"Toyota": {
  "importer": "…",
  "branchesUrl": "…",
  "testDriveUrl": "…",
  "showrooms": [
    { "name": "…", "address": "…", "addressHe": "…", "phone": "…",
      "kind": "Sales", "mapQuery": "…", "source": "…" }
  ]
}
```

If a brand cannot be verified, omit its `showrooms` rather than inventing any.

## Photographs

All photographs come from Wikimedia Commons under CC BY-SA 4.0 and are credited in the
site's Photo credits panel and in `images/credits.json`. They illustrate the model
generation, **not** the specific Israeli-market trim. Manufacturer press images are
deliberately not used.

## Running locally

`fetch()` is blocked on `file://`, so the folder must be served over HTTP:

```powershell
cd C:\Projects\Cars
python -m http.server 8777
```

Then open <http://localhost:8777/>.

## Publishing to GitHub Pages

```bash
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

Then in the repository: **Settings → Pages → Deploy from a branch → `main` / root**.
`.nojekyll` is already present so the asset folders are served as-is.

## Disclaimer

Not financial, insurance or purchasing advice. Prices are importer MSRP, not transaction
prices. Verify every figure against a written dealer quotation before paying a deposit.

## Licence

Code and data: MIT (see `LICENSE`). Photographs: CC BY-SA 4.0, credited individually.
