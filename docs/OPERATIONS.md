# Operations Guide — Broadway Touring Intelligence Dashboard

This guide covers the data pipeline: how to update data when a new Broadway League report arrives, how to add shows or seasons to the slate, and how to deploy.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.9+ | `python --version` |
| Git | any | configured with `rnunley901` credentials |
| pip packages | — | see below |

### Install Python dependencies

```bash
cd path/to/broadway-touring-dashboard
python -m venv venv
venv\Scripts\activate          # Windows

pip install openpyxl requests watchdog python-dotenv anthropic
pip install SPARQLWrapper       # required only if running scrape_shows.py manually — see
                                 # "scrape_shows.py / show enrichment" below; it's an
                                 # unconditional top-level import, not a graceful fallback
```

### API keys

Create a `.env` file in the repo root (already gitignored):

```
FRED_API_KEY=your_fred_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
```

- **FRED key:** https://fred.stlouisfed.org/docs/api/api_key.html — free, instant
- **Anthropic key:** https://console.anthropic.com — required for AI highlight and season review generation

NOAA Storm Events data (`scrape_context.py`) downloads from NOAA's public bulk CSV files — no token or `.env` entry required.

If the FRED key is missing, `scrape_context.py` skips that source and logs a warning. If `ANTHROPIC_API_KEY` is missing, `generate_highlights.py` and `generate_season_review.py` log a warning and skip the file write — the dashboard shows no callout. The rest of the pipeline still runs in all cases.

---

## Weekly Update — New Broadway League Report

### Automatic (recommended on Windows)

Double-click `scripts/start_watcher.bat`. It opens a terminal window, checks that Python and watchdog are installed, and starts the watcher.

**On startup the watcher scans the watch folder** for any XLSX files whose week is not yet in `data.json` and processes them automatically — this catches reports that arrived while the watcher was down. When the scan is finished the log prints a clear summary line and flips to live mode:

```
============================================================
Startup scan complete — 2026-08-07 09:03:12 | 285 file(s) checked | 1 processed | 284 already current | 0 unreadable
Watcher is now LIVE — listening for new files.
============================================================
```

Wait for this line before concluding the watcher is ready. Everything above it is the catch-up scan, not a hang.

Once live, drop a new `.xlsx` file into the designated OneDrive upload folder — the watcher detects it, runs all pipeline stages, and commits and **auto-deploys straight to production** (see [Deployment](#deployment) below). No manual deploy step is needed for weekly data updates.

This applies to **revised** reports too. Drop a workbook whose filename carries a `REV` or `REVISED` marker and the watcher corrects the stored week and deploys it the same way — see [Revised reports](#revised-reports--rev--revised-workbooks) below.

Keep the window open while the watcher is running. Close it or press `Ctrl+C` to stop.

The watcher requires the laptop to be on and logged in. Because the watcher is not running on a dedicated server, check the log on startup to confirm any reports that arrived since last run have been caught up.

### Manual — single command

`run_pipeline.py` is the preferred manual entry point for the three scripted stages — `process_touring.py`, `scrape_context.py`, and `validate_data.py`. It does **not** run `generate_highlights.py` or `generate_season_review.py` — run those separately (see "Manual — individual scripts" below) if you need the AI callouts refreshed outside of the watcher.

```bash
venv\Scripts\activate

# Append a single new report
python scripts/run_pipeline.py --append path\to\new_report.xlsx

# Full rebuild from a folder of all XLSX reports
python scripts/run_pipeline.py --rebuild path\to\xlsx_folder

# Validate only (no data changes)
python scripts/run_pipeline.py --validate-only

# Skip the weather/economic context refresh when you only updated touring data
python scripts/run_pipeline.py --append path\to\new_report.xlsx --skip-context
```

After the pipeline completes, commit and push **to `dev`**, then follow the [Deployment](#deployment) section below to promote to `main` — do not push data changes straight to `main` by hand; that bypasses the confirmation step every other change on this project goes through.

```bash
git add src/data/
git commit -m "Data update — week of YYYY-MM-DD"
git push origin dev
```

### Revised reports — REV / REVISED workbooks

The League sometimes reissues a week with corrected figures. **Mark the
revision in the filename** — that is the operational signal the pipeline acts
on. A standalone `REV` or `REVISED` token, case-insensitive:

```
TouringReport_2627Wk19_10-4-26 - REVISED.xlsx
TouringReport_2627Wk19_10-4-26 - REV.xlsx
TouringReport_2627Wk19_10-4-26 - REV2.xlsx      <- second revision of the same week
TouringReport_2627Wk19_10-4-26_REV.xlsx
TouringReport_2627Wk19_10-4-26 (REV).xlsx
```

Words that merely contain the letters — `Preview`, `Revenue`, `Review` — are
not treated as revisions.

**If you issue more than one revision for the same week, number them**
(`REV2`, `REV3`). Two unnumbered revisions for one week cannot be ordered, and
the audit will report them as ambiguous rather than guess.

Drop the file in the normal upload folder. The watcher handles it like any
other report; the log will say `MODE: revision` and show exactly what changed:

```
INFO   | MODE: revision
INFO   | Added records:     0
INFO   | Updated records:   1
INFO   | Identical records: 49
INFO   | Removed records:   0 (revision mode never deletes)
INFO   | Week 2026-10-04 record count: 50 -> 50
INFO   | Week 2026-10-04 gross: 32,219,320 -> 32,358,848 (delta +139,528)
INFO   | UPDATED | The Outsiders | Pantages Theatre | Los Angeles
INFO   |     gross_gross: 1334257.0 -> 1473785.0
```

**A revision never deletes.** A stored row that the revision does not mention
is kept, because a revision workbook is not guaranteed to contain the whole
week. If the revision has fewer rows than the stored week you will see:

```
WARN   | Revision contains fewer records than the stored week.
         Missing stored records were retained; review may be required.
```

That is a prompt to look, not something the pipeline acts on. **Removing a
stored engagement is always a human decision.**

**What stops a bad revision reaching production.** Processing or validation
failure exits non-zero and the watcher returns before publishing, so nothing
is committed or deployed. A revision that processes cleanly continues through
the normal downstream generation, validation, commit and deployment path, the
same as any weekly report.

**If a plain (unmarked) file restates an existing engagement with different
numbers**, processing stops with a non-zero exit, lists every changed field
and writes nothing. Rename the file with a `REV` marker and drop it again.

### Checking the archive — historical audit (read-only)

To reconcile stored data against every archived workbook without changing
anything:

```bash
python scripts/process_touring.py --audit "<reports_folder>" src\data\data.json

# one week only — much faster
python scripts/process_touring.py --audit "<reports_folder>" src\data\data.json --week 2026-10-04
```

It reports, per week: the original and revision source files, canonical-key
conflicts, whether stored values match the latest identifiable revision, rows
present on one side but not the other, and source-derived versus stored weekly
gross. Originals are applied first, then revisions in ordinal order.

**The audit is read-only and writes nothing.** Acting on what it finds is a
separate step that needs its own authorisation — do not correct historical
data straight off an audit report.

### Recovering from a bad import

Every successful write keeps the previous file as `src\data\data.json.bak`
(gitignored). To roll back by hand:

```bash
copy src\data\data.json.bak src\data\data.json
python scripts/validate_data.py --data src\data\data.json --out src\data\validation_report.json
```

Only the most recent prior version is kept — `.bak` is overwritten on every
successful write. For anything older, use git history.

### Manual — individual scripts

Run each script directly if you need fine-grained control. This is the actual current pipeline order (matches `watcher.py`'s Step 1 → 2.5 → 2.75 → 2.8 → 3) — there is no show-metadata enrichment step; that stage was suspended (see the Data Files table below) and dropped from the pipeline entirely, not just skipped by default.

```bash
# Step 1: process touring records
# --append auto-routes to revision mode when the filename carries a REV/REVISED
# marker, so this one command covers both normal and revised reports.
python scripts/process_touring.py --append path\to\new_report.xlsx src\data\data.json

# Step 1 (explicit): force revision mode regardless of filename
python scripts/process_touring.py --revision path\to\report_REVISED.xlsx src\data\data.json

# Reconcile stored data against the archived workbooks — READ-ONLY, writes nothing
python scripts/process_touring.py --audit path\to\reports_folder src\data\data.json

# Step 2.5: refresh weather and economic context
python scripts/scrape_context.py

# Step 2.75: generate AI weekly highlight blurbs (requires ANTHROPIC_API_KEY)
python scripts/generate_highlights.py

# Step 2.75 dry run — evaluate thresholds only, no API call
python scripts/generate_highlights.py --dry-run

# Step 2.8: generate AI end-of-season reviews (fires once per season, 14 days after close)
python scripts/generate_season_review.py

# Step 2.8 dry run
python scripts/generate_season_review.py --dry-run

# Validate
python scripts/validate_data.py --data src\data\data.json --out src\data\validation_report.json
```

Running `process_touring.py` directly changes **only the local data file named on the command line**. It does not commit, push or deploy — publishing is the watcher's job, or yours via the manual flow above. There is no dry-run flag on `process_touring.py`; use `--audit` when you want to inspect without changing anything.

`scrape_shows.py` still exists and can be run by hand (`python scripts/scrape_shows.py --season 2026-2027`) if enrichment is ever revived, but it is not part of the regular pipeline — see the Data Files table below.

---

## Weekly intelligence — temporarily disabled

**Status: OFF as of October 9, 2026.** The AI weekly highlight / pulse callout
no longer appears on Programming or Executive Summary, and no weekly copy is
generated.

**Why.** The shared title matcher resolves a slate entry to touring records by
bidirectional substring, so where the Broadway League distinguishes productions
with a year or version suffix the match blends them. A slate entry mapped to
`Waitress 2026` still pulls in the 2019–2022 `Waitress` records, because
"waitress" is a substring of "waitress 2026". Weekly copy written on a blended
population can state an absence, an all-time high, or a week-over-week change
that actually belongs to a different production. Rather than publish claims
nobody can verify, the feature is paused.

**What continues normally — everything except the weekly callout:**

| Still running | Notes |
|---|---|
| Weekly data ingestion | `process_touring.py`, unchanged |
| Revision processing | REV / REVISED upsert, unchanged |
| Context enrichment | `scrape_context.py`, unchanged |
| Season retrospectives | `generate_season_review.py` — a separate generator; the retrospective callout still renders on Executive Summary |
| Validation and publication | unchanged, including the watcher's unattended deploy |
| Every Dashboard metric, chart, filter, table and export | unaffected — the Dashboard never carried this callout |

**What is switched off:**

- `scripts/watcher.py` Step 2.75 no longer calls `generate_highlights.py`, so
  **no Anthropic API call is made** for weekly copy during an import.
- Programming and Executive Summary do **not fetch** their weekly highlight
  JSON and do **not render** the callout in any form — no stale copy, no empty
  card, no "unavailable" placeholder. The whole callout is absent.

**What is preserved.** `generate_highlights.py`, `highlight_guard.py`, the
rendering code on both pages, and the stored `exec_brief_highlight.json` and
`programming_highlight.json` files are all intact and unmodified. The stored
JSON is no longer republished by the watcher, so it stays exactly as last
committed.

The switch is one shared flag, `weeklyIntelligenceEnabled` in
`src/js/core/config.js`.

### Future review — production identity

The League runs multiple productions of the same show under distinct titles,
and distinguishes them with year or version suffixes:

```
Waitress        82 records   2019-07-21 .. 2022-05-29
Waitress 2022   10 records   2022-05-01 .. 2022-06-26
Waitress 2026    5 records   2026-09-27 .. 2026-09-27
```

These are separate productions with separate histories and must not be
combined. Concurrent touring companies of one title (for example the several
`Hamilton` companies) are the same problem in a different shape.

**Confirmed and parked:** Bushnell's booked 2026–2027 production is the one the
League identifies as **`Waitress 2026`**. The `seasons.json` mapping correction
is deliberately NOT shipped in this release, because with substring matching a
mapping of `Waitress 2026` would still blend in the 2019–2022 records — a
measured 87 matched rows, only 5 of them from the booked production. The
mapping change should land together with production-aware matching, not before
it.

### Reactivation requirements

All three must hold before `weeklyIntelligenceEnabled` goes back to `true` and
Step 2.75 is restored in `watcher.py`:

1. **Exact, production-aware title matching** — a slate entry resolves only to
   records whose League title it actually names. No bidirectional substring, no
   year-suffix collapsing, no implicit alias that merges production histories.
2. **Active slate mappings reviewed** — every `league_name` in the active
   seasons of `seasons.json` checked against the League titles actually present
   in `data.json`.
3. **Highlight claims validated against the correct production population** —
   the guard checks copy against the records of the named production, so an
   absence, record high or week-over-week figure cannot be drawn from a
   different company's history.

---

## Data Files

| File | Generated by | Notes |
|---|---|---|
| `src/data/data.json` | `process_touring.py` | All weekly touring records — the primary dataset |
| `src/data/shows.json` | `scrape_shows.py` | Show metadata: Tony awards, composer, Wikipedia summary. **Enrichment suspended** — source data unreliable. Committed to the repo as retained from before suspension; not regenerated by the pipeline. |
| `src/data/seasons.json` | Edited manually | Season slates — confirmed and candidate shows |
| `src/data/peers.json` | Edited manually | Peer venue metadata (Bushnell-size venues) |
| `src/data/context.json` | `scrape_context.py` | Weekly weather and economic signals |
| `src/data/exec_brief_highlight.json` | `generate_highlights.py` | Season-keyed AI weekly intelligence blurbs for exec_summary.html |
| `src/data/programming_highlight.json` | `generate_highlights.py` | Season-keyed AI weekly intelligence blurbs for programming.html |
| `src/data/season_review.json` | `generate_season_review.py` | Season-keyed AI end-of-season retrospectives; written once per season |
| `src/data/validation_report.json` | `validate_data.py` | Data quality report, surfaced in Dashboard |

**Note:** `shows.json` **is** committed to the repo — it's the last enrichment run before the feature was suspended, kept so the Programming page's Intelligence tab still has data to show. It is not regenerated automatically; nothing in the current pipeline writes to it.

The three AI output files (`exec_brief_highlight.json`, `programming_highlight.json`, `season_review.json`) are committed by `watcher.py` only when the scripts write new content. If the Anthropic API is unavailable, these files retain their last-written values and the dashboard continues to show the previous callout until the next successful run.

**Generated copy is validated before it is written.** Every AI summary is checked by `highlight_guard.py` against the prompt it came from — numbers, dates, and show names must all trace back to the input, and invented causes, predicted booking consequences, and any claim that a tour has closed are rejected. A failure gets one corrective retry; if that also fails the run writes nothing and logs the specific violations. This is deliberate fail-closed behavior: seeing last week's callout is much better than seeing a confident, wrong one. If you see `Retry ALSO failed validation` in `watcher.log`, the pipeline worked as intended — check the logged violations before assuming the data is at fault.

**Benchmark comparisons are validated against the data; other prose is not.** For season retrospectives the pipeline computes each show's relationship to its benchmark (`above` / `below` / `matched` / `no_benchmark`) from the displayed figures and hands it to the model as a fact. The guard then checks any sentence combining a show name with comparison language against that derived relationship, and fails closed on claims it cannot attribute. This closes the failure that shipped four wrong comparisons to production. It does **not** prove other prose true — a sentence making some other kind of claim is checked only for its ingredients and for banned claim types.

**Nothing waits on a person.** Generation stays unattended:

- **Every successful ingestion writes a current-week weekly entry** for both pages. If a threshold fires and the AI copy validates, that is a *Weekly Intelligence* highlight. If no threshold fires, a deterministic *Weekly Data Pulse* is written instead. If a threshold fires but the AI copy fails validation twice, a pulse is still written and says a threshold was detected but the narrative could not be validated — rejected AI text is never published. A quiet week is therefore visibly different from a stalled pipeline.
- A **season retrospective** that fails validation twice publishes deterministic factual copy instead — each show's actual and benchmark figures with no comparative language. A season is never left blank, and no approval step exists.

Weekly entries record `comparison_status` — `available`, `no_prior_scope_records`, `no_comparable_shows` or `season_boundary` — so the copy never claims a week-over-week comparison ran when it could not. None of those values mean the prior reporting week is missing; reporting weeks come from `data.json` by ordering, so a skipped or delayed report still resolves to the preceding available week. Weekly output is written only for the season containing the latest reporting week; historical seasons are never backfilled.

Each entry records `validation_status`, `validation_method` and `guard_version` for auditing. This metadata is informational; it never blocks publication.

To audit what was published, run the verification report — it derives the table from the stored payload and the generated summary, so it is evidence rather than an assertion:

```bash
python scripts/report_review_claims.py
```

It prints `season | show | displayed actual | displayed benchmark | derived relationship | relationship stated in summary | result` and exits non-zero if any claim mismatches or cannot be attributed. Periodic spot-checking is recommended; reviewing every run is not required.

---

## Validate the Data

```bash
python scripts/validate_data.py --data src\data\data.json --out src\data\validation_report.json
```

Prints a summary to the console and writes `validation_report.json` for the Dashboard's validation panel. Expected baseline:

| Check | Expected |
|---|---|
| Records | ~10,000–11,000 |
| Duplicate canonical keys | 0 |
| Unique shows | 150–200 |
| Invalid dates | 0 |
| Paid capacity > 100% | Some (normal Broadway League reporting) |
| Gross % potential > 100% | Some (normal Broadway League reporting) |

Above-100 values are **not errors** — Broadway League reports sometimes record values over 100% due to standing room, group repricing, or reporting lag. They are retained and surfaced in the dashboard.

---

## Validate a Dashboard Export

Exports are produced entirely in the browser, so there is no pipeline log to check —
validation is done by opening what came out.

### CSV

- The row count must match the Data Table. The Data Table shows `N engagements`
  above the table; the CSV must contain `N` data rows plus one header row.
- All 14 displayed columns must be present, in the table's display order, and the
  rows must follow the sort order that was active when the export ran.
- The CSV carries **no confidentiality banner row**. That is deliberate: a banner
  above the header row breaks every tool that expects row 1 to be the header.
  Confidentiality is conveyed through the filename, which always ends
  `CONFIDENTIAL_INTERNAL_USE_ONLY.csv`.

### PNG / ZIP

- The ZIP must open normally in Windows Explorer — double-click, no repair prompt,
  no third-party tool required.
- It must contain one PNG per chart that exported successfully. The dialog reports
  any chart it skipped for having no data under the current filters.
- Open the PNGs. Every one must show `CONFIDENTIAL — INTERNAL USE ONLY` in both the
  header band and the footer band of the image itself, not only in the filename.

### PDF

- Open the PDF in **Edge or Chrome and in Adobe Acrobat**. Both are in use here and
  they do not always agree; a file that renders in one is not evidence for the other.
- The page count must equal the number of charts selected.
- Every page must show `CONFIDENTIAL — INTERNAL USE ONLY` at the top and at the
  bottom, and the chart and its labels must be readable at 100% zoom.

### Ctrl+P

**After any material change to the print CSS, check Ctrl+P by hand.** Per-page
repetition of the classification bars is a browser paged-media behaviour; it cannot
be proven from the DOM, and a rule that looks right on screen can still fail when
paginated.

Check the first page, a middle page and the final page, and confirm:

- `CONFIDENTIAL — INTERNAL USE ONLY` appears at the top and the bottom of each;
- neither bar covers page content;
- the active filter summary under the print header is current, not stale;
- export and navigation controls are absent;
- the "Desktop Recommended" overlay is absent — it is `position: fixed` over the
  whole viewport, so if it ever returns in print it blacks out every page.

Do this from a narrow window as well as a wide one: some screen-only overlays only
appear below 768px, and those are exactly the ones that damage print.

---

## Add a New Show to the Slate

Shows on the season slate come from `src/data/seasons.json`. Each entry carries a
`league_name`, which is the **exact Broadway League title** the slate entry is
matched against. Get it from `data.json`, not from the marketing title — the
League sometimes runs several productions of the same show under distinct
titles (`Waitress`, `Waitress 2022`, `Waitress 2026`), and they are separate
productions with separate histories.

> **Future review (parked):** audit season-slate mappings where the League
> distinguishes productions using year/version suffixes. Do not automatically
> combine production histories.

Edit that file to add a show:

```json
{
  "season": "2026-2027",
  "shows": [
    { "title": "New Show Title", "status": "confirmed" },
    ...
  ]
}
```

Show-metadata enrichment is currently **suspended** (see "Data Files" above) — `scrape_shows.py` is not part of the regular update flow, and its only CLI argument is `--season` (there is no `--show` or `--force` flag). If enrichment is ever revived, the real invocation is:

```bash
python scripts/scrape_shows.py --season 2026-2027
```

which scrapes metadata for every show in that season not already enriched (it skips entries younger than 30 days rather than taking a per-show `--force` flag).

---

## Add a New Season

1. Edit `src/data/seasons.json` — add a new season object with the confirmed and candidate show list.
2. Run `scrape_shows.py` to fetch metadata for any new titles.
3. The Programming and Executive Summary pages automatically pick up the new season in their season selector — no code changes needed.

---

## Deployment

### Branch model

| Branch | Environment | Deploy trigger |
|---|---|---|
| `main` | Production | Auto — push triggers Azure GitHub Actions (~30 sec) |
| `dev` | Staging | Auto — same Azure app, separate staging URL |
| _(none)_ | — | `watcher.py` uses **no branch of its own**. It builds its commit with git plumbing and pushes it by sha. The former ephemeral `data-import` branch was removed: the hazard was checking out a branch in a shared working tree, not the branch itself. |

Push to `main` deploys to production. The GitHub Actions workflow (`.github/workflows/azure-static-web-apps-white-pebble-01710020f.yml`) deploys the `src/` directory only.

**Feature/code work** (anyone working in an editor or Claude Code session) always goes through the manual `feat/* → dev → main` flow below, with an explicit confirmation before the `main` push — see [CLAUDE.md](../CLAUDE.md#branch-policy).

**Weekly data updates** are the one exception: `watcher.py` deploys them straight to `main` fully unattended, then folds the same commit into `dev` so `dev` never drifts behind on data files. It does this **without checking out any branch** — the commit is the tree of `origin/main` with only the watcher's own `src/data/*.json` files overlaid, pushed by sha — so an automated import can never pick up in-progress feature work from the shared working tree. If folding the deploy back into `dev` hits a conflict (e.g. a feature branch also touched `data.json`), the watcher aborts that merge, leaves `dev` clean, and logs that a human needs to run `git merge main` into `dev` manually — production still got the update either way.

### Deploy to staging first (recommended for code changes)

```bash
git push origin dev
```

Review on the staging URL, then merge to production:

```bash
git checkout main
git merge dev
git push origin main
```

### Create a backup tag before a major change

```bash
git tag pre-changename origin/main
git push origin pre-changename
```

To restore: `git reset --hard pre-changename` (destructive — confirm first).

---

## Run Signal Comparison (QA)

After a data update, verify that the Planning Signal model is producing sensible values:

```bash
node scripts/compare_signals.js 2025-2026
node scripts/compare_signals.js 2026-2027
```

Prints each show's Demand / Revenue / Peer / Confidence scores and Planning Read label. Use it to spot shows that changed tiers or are missing data.

---

## Local Preview

```bash
cd src
python -m http.server 8765
```

Open http://127.0.0.1:8765/ — serves fresh files on every request.

If you see stale behavior after a code change, hard-refresh (`Ctrl+Shift+R`) or open a private window. The browser may cache JavaScript locally.

---

## Environment Variables Reference

| Variable | Script | Purpose |
|---|---|---|
| `FRED_API_KEY` | `scrape_context.py` | FRED — consumer sentiment (UMCSENT) and CT unemployment (CTURN) |
| `ANTHROPIC_API_KEY` | `generate_highlights.py`, `generate_season_review.py` | Anthropic API — used to call `claude-haiku-4-5-20251001` for AI summary generation |

NOAA Storm Events data needs no token — it's a public bulk CSV download. None of the variables above are used by the browser frontend; they're only needed when running the respective scripts locally or via `watcher.py`.

---

## Scripts Reference

| Script | Purpose |
|---|---|
| `start_watcher.bat` | **Windows entry point** — double-click to start the file watcher |
| `run_pipeline.py` | **Manual entry point** — chains `process_touring.py`, `scrape_context.py`, and `validate_data.py` with `--append`, `--rebuild`, or `--validate-only` flags (`--skip-context` skips the weather/economic refresh). Does not run `generate_highlights.py` or `generate_season_review.py`. |
| `process_touring.py` | Reads XLSX reports, deduplicates, writes/appends `data.json` |
| `scrape_shows.py` | **Suspended.** Previously fetched show metadata from Wikidata, Wikipedia, DBpedia. Enrichment removed from pipeline — data was unreliable (wrong articles, missing Tony data, null fields). Script retained for future use with a better source. |
| `scrape_context.py` | Fetches NOAA weather and FRED economic data; writes `context.json`. NOAA bulk CSV files are cached in `scripts/cache/storm_events/` by filename — when NOAA publishes a revised file the name changes and the new file is fetched automatically; no re-download occurs if the filename hasn't changed. FRED data is fetched fresh on every run (small JSON, no cache). |
| `generate_highlights.py` | Evaluates hard-coded thresholds against current-season data; calls Anthropic API if any trip; writes season-keyed `exec_brief_highlight.json` and `programming_highlight.json`. Supports `--dry-run`. Output is validated by `highlight_guard.py` before any write. |
| `highlight_guard.py` | **Validation gate for all AI-generated copy.** Rejects a summary whose numbers, dates, or show names don't appear in the prompt it was given, plus invented causes, predicted consequences, counts of shows, and any claim a tour has closed. For season retrospectives it also validates benchmark comparisons against each show's derived relationship. One corrective retry, then weekly writes nothing / season publishes deterministic fallback. Tests: `npm run test:guard`. |
| `report_review_claims.py` | **Verification report for `season_review.json`.** Derives `season \| show \| actual \| benchmark \| derived relationship \| stated relationship \| result` from the stored payload and generated summary. Exits non-zero if any claim mismatches or cannot be attributed. Tests: `npm run test:pipeline`. |
| `generate_season_review.py` | Fires once per season, 14 days after last show close; computes pre-season signal vs actual peer results; calls Anthropic API; writes `season_review.json`. Supports `--dry-run`. |
| `validate_data.py` | Data quality checks; writes `validation_report.json` |
| `watcher.py` | Watches OneDrive folder for new XLSX files; on detection runs `process_touring.py` (Step 1) → `scrape_context.py` (Step 2.5) → `generate_highlights.py` (Step 2.75) → `generate_season_review.py` (Step 2.8) → git commit/auto-deploy (Step 3) — no show-enrichment step, since that's suspended. On startup, scans the folder for any reports missed while the watcher was down and processes them before going live. Handles OneDrive's `on_modified` sync pattern in addition to `on_created`. |
| `dashboard_config.py` | Shared path constants used by all other scripts |
| `compare_signals.js` | QA tool — prints Planning Signal scores for a given season |

---

## Troubleshooting

**Watcher didn't fire on a new file.** First check that the watcher is running and has printed `Watcher is now LIVE` — everything before that line is the startup scan, not a hang. If the watcher was closed or the laptop was asleep when the file arrived, restart the watcher — the startup scan will detect and process any missed files automatically. Only fall back to `run_pipeline.py --append` if the startup scan does not pick up the file (e.g. the file is in the wrong folder or the week date cannot be read from the sheet names).

**Watcher appears to stop responding after startup.** With 285+ files in the watch folder the startup scan takes about 2 minutes to open and inspect every workbook. This is normal and expected — the watcher is not frozen. Wait for the `Watcher is now LIVE` summary line before concluding something is wrong.

**Storm event data looks stale or missing for a recent week.** NOAA periodically revises its bulk CSV files. The watcher uses the filename to detect a new version — if NOAA published a correction but the filename didn't change (rare), the cached file will be used. To force a re-fetch for a specific year, delete the corresponding `.csv.gz` file from `scripts/cache/storm_events/` and re-run `scrape_context.py`.

**`scrape_shows.py` / show enrichment questions.** Show enrichment from Wikidata/Wikipedia is suspended — the data was unreliable and the Show Intel UI has been removed. The script is retained for future use when a better data source is identified.

**Validation shows unexpected duplicates.** Check that the new XLSX doesn't overlap with previously ingested reports. The pipeline deduplicates by canonical key (`week_of|show_normalized|theatre_normalized|city|tier`). Different spellings of the same show name won't merge automatically.

**Azure deploy failed.** Check the Actions tab on GitHub. The most common cause is a JavaScript syntax error — run `node --check src/js/core/*.js src/js/pages/*.js` locally before pushing.

**Push rejected.** Confirm you're on the right branch (`git branch`) and pull first if behind (`git pull`).
