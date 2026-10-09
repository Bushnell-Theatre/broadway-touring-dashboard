# Architecture — Broadway Touring Intelligence Dashboard

## Overview

A fully static web application. There is no server, no API, no database. All data is pre-processed into JSON files by local Python scripts; the HTML pages load those files at runtime and render everything in the browser. There is no build step for the deployed app — Azure copies `src/` directly. npm is used only for local dev tooling (`prettier`, `scripts/test_scoring_contract.js`), not for the frontend or the deploy pipeline.

```
┌─────────────────────────────────────────────────────────────┐
│  Local Machine (rnunley laptop)                              │
│                                                               │
│  OneDrive upload folder                                      │
│       │  new XLSX dropped                                    │
│       ▼                                                      │
│  watcher.py                                                  │
│       │                                                      │
│       ├─ process_touring.py       →  data.json                │
│       ├─ scrape_context.py        →  context.json             │
│       ├─ generate_highlights.py   →  exec_brief_highlight.json,│
│       │                              programming_highlight.json│
│       └─ generate_season_review.py → season_review.json       │
│                │                                              │
│    commit built with git plumbing, pushed by sha → main       │
│    (auto-deploy; then folded into dev; no branch checkout)    │
└─────────────────────────────────────────────────────────────┘
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
│  src/box_office.html     ← box office scenario model     │
│                             (suspended, not an active     │
│                              product experience)           │
│  src/data/*.json         ← all data files               │
│  src/css/*.css                                          │
│  src/js/utils.js                                        │
└──────────────────────────────────────────────────────────┘
```

`scrape_shows.py` (show metadata enrichment) is not part of this pipeline — it's suspended. See "Show metadata enrichment" below.

For the watcher's unattended publishing mechanism and why it never checks out a branch, see [CLAUDE.md → Branch Policy](CLAUDE.md#branch-policy) — that's the canonical description; this doc doesn't restate the mechanics.

---

## Data Pipeline Detail

### Stage 1 — process_touring.py

Reads Broadway League XLSX reports and writes `src/data/data.json`. Four modes:

| Mode | Command | Effect |
|---|---|---|
| Append | `--append <file.xlsx> data.json` | Adds records whose `canonical_key` is new. A file named as a revision is routed to revision mode automatically. |
| Revision | `--revision <file.xlsx> data.json` | Record-level upsert for a corrected weekly report. Never deletes. |
| Rebuild | `<folder> data.json` | Full rebuild from every XLSX in a folder. |
| Audit | `--audit <folder> data.json [--week YYYY-MM-DD]` | **Read-only** reconciliation of stored data against the archived workbooks. Writes nothing. |

- Canonical key: `week_of|show_normalized|theatre_normalized|city|tier`
- Normalizes show names (strips suffixes like "(Chicago)", "(Angelica)") for cross-venue matching
- Flags `similar_bushnell` for venues within ±10% of Bushnell sellable capacity

**Append semantics.** A new key is added. An existing key restated with
*identical* business values is a clean no-op. An existing key restated with
*different* values is a conflict: append mode exits non-zero, reports every
changed field, and writes nothing — because append never overwrites, silently
skipping the change would lose the correction. Such a file has to be renamed
with a REV / REVISED marker and re-dropped.

**Revision semantics.** A workbook whose *filename* carries a standalone
REV / REVISED token is treated as a correction and upserted:

- key absent from the store → **inserted**
- key present, values differ → **updated**
- key present, values identical → **unchanged**
- stored row absent from the revision → **retained, never deleted**

The last rule is deliberate and is the known limitation of this design: a
revision workbook is not guaranteed to be a complete population for its week.
Retaining absent rows is documented under "Revision handling" in
[docs/DEVELOPER.md](docs/DEVELOPER.md) and in
[docs/OPERATIONS.md](docs/OPERATIONS.md).

Both append and revision write through a temp file that is validated before it
replaces the live `data.json`, and keep the previous file as `data.json.bak`.

### Show metadata enrichment — scrape_shows.py (suspended)

**Not part of the current pipeline.** Enriches `src/data/shows.json` with show metadata from Wikidata/Wikipedia/DBpedia, but this was pulled from automated use because the source data proved unreliable (wrong articles, missing Tony data, null fields). `shows.json` is retained in the repo from the last enrichment run before suspension — it is not regenerated by anything currently running. The script itself is kept for possible future use with a better data source; see `docs/OPERATIONS.md`.

Source priority chain per field, when run manually:
1. **Wikidata SPARQL** — opening date, composer, lyricist, Tony wins/nominations, Wikipedia URL
2. **Wikidata REST API** — fallback when SPARQL is rate-limited (active outage 797a132)
3. **Wikipedia pageprops API** — reliable QID lookup by article title (avoids fuzzy search failures)
4. **DBpedia SPARQL** — fallback for composer, lyricist, image URL
5. **Wikipedia REST** — summary text (always attempted independently)

Each record stores a `sources` dict documenting which service provided each field. Award data comes from `src/data/awards.json` (built separately by `scripts/build_awards.py`), not from this script.

### Stage 2.5 — scrape_context.py

Builds `src/data/context.json` — one entry per week (2019–present) with weather and economic signals. Numbered 2.5 for historical reasons (Stage 2 was `scrape_shows.py`, since suspended).

**Weather — NOAA Storm Events:**
- Downloads annual CSV.gz files from NOAA's public bulk FTP index — **no token or `.env` entry required**
- Filters to Hartford County via a substring match on the `CZ_NAME` CSV column (`"HARTFORD"`), not a zone code, and to significant event types (thunderstorm, winter storm, flood, tornado, blizzard, ice storm, hurricane)
- Files cached locally in `scripts/cache/storm_events/` by filename; historical years cached forever, current and prior year always re-fetched (NOAA updates them)

**Economic — FRED API:**
- University of Michigan Consumer Sentiment (`UMCSENT`) — monthly
- Connecticut unemployment rate (`CTURN`) — monthly
- Computes month-over-month trend: `rising`, `falling`, or `stable`
- Requires `FRED_API_KEY` in `.env`; if missing, this source is skipped and logs a warning

Output format:
```json
{
  "2026-01-05": {
    "weather": {
      "significant": true,
      "events": ["Winter Storm"],
      "summary": "1 significant weather event"
    },
    "economic": {
      "consumer_confidence": 68.2,
      "confidence_trend": "falling",
      "ct_unemployment": 4.1,
      "source_month": "2025-12"
    }
  }
}
```

### Stage 2.75 — generate_highlights.py

Evaluates hard-coded thresholds (week-over-week gross change, capacity-band crossing, show opens/closes, all-time highs) against the current season's data; calls the Anthropic API if any trip; writes season-keyed `exec_brief_highlight.json` and `programming_highlight.json`. Full threshold/trigger detail, including the peer-vs-national closure distinction and the exec national-fallback behavior, lives in [docs/AI_PIPELINE_PLAN.md](docs/AI_PIPELINE_PLAN.md) — not restated here.

### Stage 2.8 — generate_season_review.py

Fires once per season, 14 days after the season's last show closes; compares pre-season national signal against actual peer-venue performance; calls the Anthropic API; writes `season_review.json`. Detail in [docs/AI_PIPELINE_PLAN.md](docs/AI_PIPELINE_PLAN.md).

### Stage 3 — watcher.py

Monitors the OneDrive upload folder for new `.xlsx` files using the `watchdog` library. On detection, runs Stages 1 → 2.5 → 2.75 → 2.8 in sequence, then publishes — auto-deploying to production with no human confirmation step — and folds the same commit into `dev`. This is the one exception to this project's otherwise-manual `feat/xxx → dev → main` deploy policy (see [CLAUDE.md](CLAUDE.md#branch-policy)); it exists so a weekly data import is never blocked on a human.

The commit is assembled with git plumbing — the tree of `origin/main` with only the watcher's own `src/data/*.json` files overlaid — and pushed by sha. **The watcher never checks out a branch, never moves `HEAD`, and never touches the repository index**, so it cannot sweep in-progress work into a deploy. There is no `data-import` branch; that mechanism was removed because the hazard was the checkout, not the branch. `scripts/test_watcher_publish.py` guards this behaviour.

Stage 1 failing — a bad parse, a multi-week revision, or a candidate file that fails validation — exits non-zero and the watcher returns **before** publishing. A revision that processes cleanly continues through the normal downstream generation, validation, commit and deployment path, exactly like a new weekly report.

If `scrape_context.py` fails (e.g. missing FRED key), the watcher logs a warning but continues — `data.json` is still committed. `shows.json` is never part of this commit; it isn't touched by the automated pipeline at all (see "Show metadata enrichment" above).

---

## Frontend Architecture

### Shared patterns across all pages

- **No framework, no build step.** Plain HTML/CSS/JS files served as static assets.
- **Data loading:** each page fetches JSON files at runtime via `fetch()`. Production URL first, relative path fallback for local development.
- **Scoring:** the Planning Signal (0–100) is computed per show from four independently-scaled components — Demand, Revenue, Peer, Confidence — combined by equal average. See [SCORING.md](SCORING.md) for the canonical, code-checked formula; not restated here to avoid drift (a prior version of this doc described a retired additive rubric that no longer matches `src/js/core/signals.js`).
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

`main` = production (Azure auto-deploy via GitHub Actions, ~30 sec), `dev` = staging (same Azure app, separate URL). Full branch policy, including the `watcher.py` auto-deploy exception, lives in [CLAUDE.md → Branch Policy](CLAUDE.md#branch-policy) — canonical there, not restated here.

**GitHub Actions workflow:** `.github/workflows/azure-static-web-apps-white-pebble-01710020f.yml`
App root is `src/` — only files under `src/` are deployed to Azure.

---

## Environment Variables (scripts only)

Stored in `.env` in the repo root (gitignored). Not used by the frontend.

| Variable | Used by | Purpose |
|---|---|---|
| `FRED_API_KEY` | scrape_context.py | FRED economic data API key — soft-skips that source if missing |
| `ANTHROPIC_API_KEY` | generate_highlights.py, generate_season_review.py | Anthropic API key — **hard requirement**: these scripts raise/skip the file write entirely if missing, unlike the soft-skip above |

NOAA Storm Events data needs no token at all — see Stage 2.5 above.

---

## External Dependencies

### Runtime (browser)
- **Chart.js 4.4.1** — bar charts (cdnjs, loaded via `<script>` tag)
- **SheetJS (xlsx) 0.18.5** — spreadsheet import/export, `dashboard.html` only (cdnjs, loaded via `<script>` tag)
- **Google Fonts** — Libre Baskerville, Libre Franklin, IBM Plex Mono

### Build-time (Python scripts)
- `openpyxl` — reads Broadway League XLSX files
- `requests` — HTTP for Wikidata, DBpedia, Wikipedia, NOAA, FRED
- `SPARQLWrapper` — Wikidata and DBpedia SPARQL queries (required by `scrape_shows.py`, which imports it unconditionally — not an optional/graceful-fallback dependency)
- `watchdog` — file system event monitoring
- `python-dotenv` — loads `.env` tokens
- `anthropic` — Claude API calls from `generate_highlights.py` / `generate_season_review.py`

---

## Known Constraints

**Wikidata SPARQL outage (797a132):** The public SPARQL endpoint has been aggressively rate-limiting (1 req/min) since an active outage. `scrape_shows.py` falls back to the Wikidata REST API and Wikipedia pageprops API. This is moot while enrichment is suspended (see above) — noted here in case it's revived.

**Watcher requires the laptop to be on.** The automation is a local Python process. If the laptop is off or asleep when a report is uploaded, the watcher won't fire — run the manual update commands instead (`docs/OPERATIONS.md`). A move to a dedicated always-on server is planned — see [docs/SERVER_MIGRATION_AND_EMAIL_INGESTION.md](docs/SERVER_MIGRATION_AND_EMAIL_INGESTION.md).

**Static data model.** All data is pre-computed JSON. There is no query layer — filtering and aggregation happen entirely in the browser. This keeps hosting free and eliminates backend dependencies, but means large date-range queries are bounded by what JavaScript can process from a ~10MB JSON file in memory.
