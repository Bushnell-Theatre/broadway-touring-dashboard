# Architecture — Broadway Touring Intelligence Dashboard

## Overview

A fully static web application. There is no server, no API, no database, and no build step. All data is pre-processed into JSON files by local Python scripts; the HTML pages load those files at runtime and render everything in the browser.

```
┌─────────────────────────────────────────────────────────┐
│  Local Machine (rnunley laptop)                         │
│                                                         │
│  OneDrive upload folder                                 │
│       │  new XLSX dropped                               │
│       ▼                                                 │
│  watcher.py                                             │
│       │                                                 │
│       ├─ process_touring.py  →  data.json               │
│       ├─ scrape_shows.py     →  shows.json              │
│       └─ scrape_context.py   →  context.json            │
│                │                                        │
│          git push → main                                │
└─────────────────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────┐
│  GitHub (main branch)        │
│  GitHub Actions auto-trigger │
└──────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────┐
│  Azure Static Web Apps                                   │
│  https://white-pebble-01710020f.7.azurestaticapps.net/  │
│                                                          │
│  src/index.html          ← hub                          │
│  src/dashboard.html      ← operations                   │
│  src/programming.html    ← programming team             │
│  src/exec_summary.html   ← leadership                   │
│  src/data/*.json         ← all data files               │
│  src/css/*.css                                          │
│  src/js/utils.js                                        │
└──────────────────────────────────────────────────────────┘
```

---

## Data Pipeline Detail

### Stage 1 — process_touring.py

Reads Broadway League XLSX reports and writes/appends to `src/data/data.json`.

- `--append <file.xlsx> data.json` — merges new records, deduplicates by `canonical_key`
- `<folder> data.json` — full rebuild from all XLSX files in a folder
- Canonical key: `week_of|show_normalized|theatre_normalized|city|tier`
- Normalizes show names (strips suffixes like "(Chicago)", "(Angelica)") for cross-venue matching
- Flags `similar_bushnell` for venues within ±10% of Bushnell sellable capacity

### Stage 2 — scrape_shows.py

Enriches `src/data/shows.json` with show metadata. Only processes shows not already in the file (incremental). Runs across all seasons (7 seasons, ~57 unique shows).

Source priority chain per field:
1. **Wikidata SPARQL** — opening date, composer, lyricist, Tony wins/nominations, Wikipedia URL
2. **Wikidata REST API** — fallback when SPARQL is rate-limited (active outage 797a132)
3. **Wikipedia pageprops API** — reliable QID lookup by article title (avoids fuzzy search failures)
4. **DBpedia SPARQL** — fallback for composer, lyricist, image URL
5. **Wikipedia REST** — summary text (always attempted independently)

Each record stores a `sources` dict documenting which service provided each field.

### Stage 3 — scrape_context.py

Builds `src/data/context.json` — one entry per week (2019–present) with weather and economic signals.

**Weather — NOAA Storm Events:**
- Downloads annual CSV.gz files from NOAA's FTP index
- Filters to Hartford County (zone `CTZ001`) and significant event types (thunderstorm, winter storm, flood, tornado, blizzard, ice storm, hurricane)
- Files cached locally in `scripts/cache/storm_events/`; historical years cached forever, current and prior year always re-fetched (NOAA updates them)
- Requires `NOAA_CDO_TOKEN` in `.env`

**Economic — FRED API:**
- University of Michigan Consumer Sentiment (UMCSENT) — monthly
- Connecticut unemployment rate (CTURN) — monthly
- Computes month-over-month trend: `rising`, `falling`, or `stable`
- Requires `FRED_API_KEY` in `.env`

Output format:
```json
{
  "2026-01-05": {
    "weather": {
      "significant": true,
      "events": ["Winter Storm"],
      "event_count": 1
    },
    "economic": {
      "confidence": 68.2,
      "confidence_trend": "falling",
      "unemployment": 4.1
    }
  }
}
```

### Stage 4 — watcher.py

Monitors the OneDrive upload folder for new `.xlsx` files using the `watchdog` library. On detection, runs stages 1–3 in sequence, then commits and pushes all changed files to `main`.

If `scrape_context.py` fails (e.g. missing API token), the watcher logs a warning but continues — data.json and shows.json are still committed.

---

## Frontend Architecture

### Shared patterns across all pages

- **No framework, no build step.** Plain HTML/CSS/JS files served as static assets.
- **Data loading:** each page fetches JSON files at runtime via `fetch()`. Production URL first, relative path fallback for local development.
- **Scoring:** `profile(show)` computes a Fit Score (0–100) from touring record aggregates. `SCORE_MED` is the season median, computed in `renderAll()` before any render function runs.
- **State:** module-level `let` globals (`ALL`, `STATE`, `CONTEXT`, `SCORE_MED`, etc.). No reactive framework.
- **Tab switching:** `showTab(tab)` shows/hides panels; render functions are called lazily when a tab is first opened.

### Data flow within a page

```
fetch(data.json)      → ALL[]         (raw weekly records)
fetch(seasons.json)   → SEASONS[]     (season slates)
fetch(peers.json)     → PEER_META     (venue metadata, via utils.js)
fetch(context.json)   → CONTEXT{}     (keyed by week_of date)

renderAll()
  → SCORE_MED = median(season profiles)
  → renderBrief()    (executive summary card + slate table)
  → renderActive()   (show cards + detail panel)
  → renderHistory()  (past season review)
  → renderPlanning() (future season candidates)
  → renderPeers()    (peer venue benchmarks)
  → renderReference() (methodology + FAQ)
```

### Context badges

`context.json` is surfaced as inline badges on show detail views and history tables:
- `⛈ Nwk` badge on show titles (N weeks with significant weather or falling sentiment)
- `🌩` badge on individual week rows
- `↘ Sentiment` badge when consumer sentiment was falling that week

### Fit Score rubric

```
Base:                50 points
Paid capacity:       up to +25 (linear, 50%→100% cap)
Gross vs potential:  up to +15
Peer performance:    up to +15 (Bushnell-size venues)
Sample depth:        up to +10 (record count + venue spread)
Subscription lift:   up to +5  (sub vs non-sub cap delta)
```

Score is then compared to `SCORE_MED` (the season's median) rather than fixed bands. This prevents the entire slate from showing as "below threshold" in a soft touring year, or hiding differentiation in a strong year.

---

## CSS Design System

`src/css/styles.css` defines CSS custom properties for all colors, spacing, and typography. Key variables:

```css
--ink1   /* primary text */
--ink2   /* secondary text */
--ink3   /* tertiary / metadata */
--bg1    /* page background */
--bg2    /* card background */
--accent /* Bushnell blue #003865 */
--good   /* green — above median */
--warn   /* amber/red — below median */
```

Status classes (`.status.good`, `.status.warn`, `.status.neutral`) are used consistently across all score badges and table cells.

---

## Deployment

**Branch model:**
- `dev` → staging (same Azure app, different URL suffix)
- `main` → production (auto-deploy via GitHub Actions, ~30 seconds)

**GitHub Actions workflow:** `.github/workflows/azure-static-web-apps-white-pebble-01710020f.yml`  
App root is `src/` — only files under `src/` are deployed to Azure.

**No build step.** The workflow copies `src/` directly to Azure. No npm, no bundler, no transpilation.

---

## Environment Variables (scripts only)

Stored in `.env` in the repo root (gitignored). Not used by the frontend.

| Variable | Used by | Purpose |
|---|---|---|
| `NOAA_CDO_TOKEN` | scrape_context.py | NOAA Climate Data Online API token |
| `FRED_API_KEY` | scrape_context.py | FRED economic data API key |

If either token is missing, `scrape_context.py` skips that data source and logs a warning.

---

## External Dependencies

### Runtime (browser)
- **Chart.js 4.4.1** — bar charts (cdnjs, loaded via `<script>` tag)
- **Google Fonts** — Libre Baskerville, Libre Franklin, IBM Plex Mono

### Build-time (Python scripts)
- `openpyxl` — reads Broadway League XLSX files
- `requests` — HTTP for Wikidata, DBpedia, Wikipedia, NOAA, FRED
- `SPARQLWrapper` — Wikidata and DBpedia SPARQL queries
- `watchdog` — file system event monitoring
- `python-dotenv` — loads `.env` tokens

---

## Known Constraints

**Wikidata SPARQL outage (797a132):** The public SPARQL endpoint has been aggressively rate-limiting (1 req/min) since an active outage. `scrape_shows.py` falls back to the Wikidata REST API and Wikipedia pageprops API. Tony award data will be sparse until the outage resolves — re-run `scrape_shows.py` afterward to backfill.

**Watcher requires the laptop to be on.** The automation is a local Python process. If the laptop is off or asleep when a report is uploaded, the watcher won't fire — run the manual update commands instead. Upgrade path: Azure Function triggered by blob storage event.

**Static data model.** All data is pre-computed JSON. There is no query layer — filtering and aggregation happen entirely in the browser. This keeps hosting free and eliminates backend dependencies, but means large date-range queries are bounded by what JavaScript can process from a ~10MB JSON file in memory.
