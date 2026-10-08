# Which Car Should I Buy? 🚗

A small, dependency-free static site for picking a car with evidence instead of vibes.
Candidates live in one JSON file; the page scores and ranks them against **your** priorities.

## What it does

- **Weighted scoring model** — move a slider for each factor (price, reliability, running cost, safety, …) and the ranking re-sorts live.
- **Normalised scores** — each criterion is min-max normalised 0–100 across the cars currently shown, with "lower is better" factors inverted, then combined as a weighted mean.
- **Filters** — budget slider, body style, fuel type, shortlist status, free-text search.
- **Detail view** — click any row for full specs, pros/cons and notes.
- Weights and theme persist in `localStorage`. No build step, no dependencies.

## Editing the data

Everything you care about is in [`data/cars.json`](data/cars.json).

```jsonc
{
  "meta":     { "title": "...", "subtitle": "...", "currency": "$", "updated": "2026-10-08" },
  "criteria": [ { "key": "price", "label": "Price", "unit": "$", "direction": "lower", "defaultWeight": 9, "hint": "..." } ],
  "cars":     [ { "id": "...", "make": "...", "model": "...", "price": 32000, "status": "shortlist", "pros": [], "cons": [] } ]
}
```

**Criteria**

| Field | Meaning |
| --- | --- |
| `key` | Must match a numeric field name on every car |
| `direction` | `lower` (cheaper/faster is better) or `higher` |
| `unit` | `$`, `$/yr`, `/10`, or any free label (`km/l`, `L`, `s`) |
| `defaultWeight` | 0–10 starting slider position |

Add a criterion by adding one entry here **and** the matching numeric field on each car.
The first six criteria become table columns; all of them show in the detail dialog.

**Cars**

`status` is one of `shortlist`, `considering`, or `rejected` (rejected rows are dimmed but still ranked).
`pros`, `cons`, `notes` and `link` are optional.

## Running locally

`fetch()` is blocked on `file://`, so serve the folder:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Publishing to GitHub Pages

1. Push this folder to a GitHub repo.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick your default branch and the `/ (root)` folder, then save.

The `.nojekyll` file is already present so Jekyll won't touch the assets.

## Methodology, honestly

The score is only as good as the numbers you put in. Treat it as a way to make your
own trade-offs explicit and check whether your gut pick survives contact with your
stated priorities — not as an objective verdict. Set a weight to 0 to drop a factor entirely.

## Structure

```
index.html        markup and layout
css/style.css     theme tokens, light/dark
js/app.js         scoring, filtering, rendering
data/cars.json    the only file you need to edit
```

## License

MIT — see [LICENSE](LICENSE).
