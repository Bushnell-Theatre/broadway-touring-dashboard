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
source venv/bin/activate       # Mac/Linux

pip install openpyxl requests watchdog python-dotenv
pip install SPARQLWrapper       # optional — scrape_shows.py falls back gracefully without it
```

### API keys

Create a `.env` file in the repo root (already gitignored):

```
NOAA_CDO_TOKEN=your_noaa_token_here
FRED_API_KEY=your_fred_key_here
```

- **NOAA token:** https://www.ncdc.noaa.gov/cdo-web/token — free, instant
- **FRED key:** https://fred.stlouisfed.org/docs/api/api_key.html — free, instant

If either key is missing, `scrape_context.py` skips that source and logs a warning. The rest of the pipeline still runs.

---

## Weekly Update — New Broadway League Report

This is the most common task. Run it when a new weekly XLSX report arrives from the Broadway League.

### Automatic (watcher)

If `watcher.py` is running, drop the new XLSX into the designated OneDrive upload folder. The watcher detects the file, runs all three pipeline stages, commits, and pushes automatically.

```bash
python scripts/watcher.py
```

The watcher must be running on the laptop. If the machine is off or asleep, use the manual steps below.

### Manual

```bash
# 1. Append new records (deduplicates by canonical key automatically)
python scripts/process_touring.py --append path/to/new_report.xlsx src/data/data.json

# 2. Refresh show metadata (only processes shows not already in shows.json)
python scripts/scrape_shows.py

# 3. Refresh weather and economic context
python scripts/scrape_context.py

# 4. Commit and push
git add src/data/data.json src/data/shows.json src/data/context.json
git commit -m "Data update — week of YYYY-MM-DD"
git push origin main
```

Push to `main` triggers an Azure deployment automatically. Production is live in about 30 seconds.

### Full rebuild from scratch

If the data file is corrupt or you want to rebuild from all XLSX files:

```bash
python scripts/process_touring.py path/to/xlsx_folder/ src/data/data.json
```

Pass the folder containing all XLSX files. The script reads them all and writes a fresh `data.json`.

---

## Validate the Data

After any pipeline run, check data quality:

```bash
python scripts/validate_data.py --data src/data/data.json --out src/data/validation_report.json
```

This writes a `validation_report.json` used by the Dashboard page's validation panel, and prints a summary to the console. Expected baseline:

| Check | Expected |
|---|---|
| Records | ~10,000–11,000 |
| Duplicate canonical keys | 0 |
| Unique shows | 150–200 |
| Invalid dates | 0 |
| Paid capacity > 100% | Some (normal Broadway League reporting) |
| Gross % potential > 100% | Some (normal Broadway League reporting) |

Above-100 values are **not errors** — Broadway League reports sometimes show values over 100% due to standing room, group repricing, or reporting lag. They are retained and surfaced in the dashboard.

---

## Add a New Show to the Slate

Shows on the season slate come from `src/data/seasons.json`. Edit that file to add a show:

```json
{
  "season": "2026-2027",
  "shows": [
    { "title": "New Show Title", "status": "confirmed" },
    ...
  ]
}
```

Then run `scrape_shows.py` to fetch metadata for the new title:

```bash
python scripts/scrape_shows.py --season 2026-2027 --show "New Show Title" --force
```

The `--force` flag overwrites any existing entry. Omit it to skip shows already in `shows.json`.

If the scrape returns sparse data (Wikidata is rate-limiting), run it again later. The `sources` field in `shows.json` documents which service provided each field.

---

## Add a New Season

1. Edit `src/data/seasons.json` — add a new season object with the confirmed and candidate show list.
2. Run `scrape_shows.py` to fetch metadata for any new titles.
3. The Programming and Executive Summary pages will automatically pick up the new season in their season selector.

There is no hardcoded season list in the JavaScript — the pages read from `seasons.json` at runtime.

---

## Deployment

### Branch model

| Branch | Environment | Deploy trigger |
|---|---|---|
| `main` | Production | Auto — push triggers Azure GitHub Actions (~30 sec) |
| `dev` | Staging | Auto — same app, separate staging URL |

### Deploy to production

```bash
git push origin main
```

That's it. The GitHub Actions workflow (`.github/workflows/azure-static-web-apps-white-pebble-01710020f.yml`) deploys the `src/` folder to Azure automatically.

### Deploy to staging first (recommended for code changes)

```bash
git push origin dev
```

Review on the staging URL, then merge `dev` to `main`:

```bash
git checkout main
git merge dev
git push origin main
```

### What gets deployed

Only the `src/` directory. Python scripts, `.env`, `docs/`, and anything outside `src/` are never deployed — they stay local.

### Create a backup tag before a major change

```bash
git tag pre-changename origin/main
git push origin pre-changename
```

To restore:

```bash
git checkout pre-changename
# or
git reset --hard pre-changename  # destructive — confirm first
```

---

## Run Signal Comparison (QA)

After a data update, verify that the Planning Signal model is producing sensible values for both active seasons:

```bash
node scripts/compare_signals.js 2025-2026
node scripts/compare_signals.js 2026-2027
```

This prints each show's Demand / Revenue / Peer / Confidence scores and Planning Read label. Use it to spot shows that have changed tiers or that are missing data.

---

## Local Preview

```bash
cd src
python -m http.server 8765
```

Open http://127.0.0.1:8765/ — serves fresh files every request, no caching.

Note: The browser may cache JavaScript. If you see stale behavior after a code change, hard-refresh (`Ctrl+Shift+R`) or open a private window.

---

## Environment Variables Reference

| Variable | Script | Purpose |
|---|---|---|
| `NOAA_CDO_TOKEN` | `scrape_context.py` | NOAA Climate Data Online — storm event data for Hartford County |
| `FRED_API_KEY` | `scrape_context.py` | FRED — consumer sentiment (UMCSENT) and CT unemployment (CTURN) |

Neither variable is used by the frontend. They are only needed when running `scrape_context.py`.

---

## Troubleshooting

**Watcher didn't fire.** Check that `watcher.py` was running. If not, run the manual update steps. The watcher requires the laptop to be on and logged in.

**`scrape_shows.py` returns sparse Tony data.** The Wikidata SPARQL endpoint has been rate-limiting aggressively. The script falls back to the REST API and Wikipedia, but Tony data may be incomplete. Re-run after the outage resolves — use `--force` to overwrite existing entries.

**Validation shows unexpected duplicates.** Check that the new XLSX file doesn't overlap with previously ingested reports (same `week_of` dates). The pipeline deduplicates by canonical key (`week_of|show_normalized|theatre_normalized|city|tier`), so true duplicates are safe — but if the same week was in two different files with slightly different show names, they won't merge automatically.

**Push rejected.** Make sure you're on the correct branch (`git branch`) and that your local branch is not behind the remote (`git pull` first if needed).

**Azure deploy failed.** Check the Actions tab on GitHub. The most common cause is a syntax error in a JavaScript file — run `node --check src/js/core/*.js src/js/pages/*.js` locally to catch it before pushing.
