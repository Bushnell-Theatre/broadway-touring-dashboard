# Broadway Touring Intelligence Dashboard

**Production:** https://white-pebble-01710020f.7.azurestaticapps.net/  
**Version:** v5.0 · June 2026  
**Sponsor:** Stephanie Fried, COO — The Bushnell Center for the Performing Arts

---

## What It Is

A programming and executive intelligence tool that turns Broadway League weekly touring reports into actionable planning signals. It scores each season title for Bushnell fit, surfaces peer-venue benchmarks, and layers in external context (weather events, consumer sentiment) to give leadership a data-grounded starting point for programming, marketing, and finance conversations.

---

## Pages

| Page | URL path | Audience |
|---|---|---|
| Hub | `/` | All — links to all views |
| Dashboard | `/dashboard.html` | Operations — full data, filters, KPIs |
| Programming | `/programming.html` | Programming team — fit scores, planning read, context |
| Executive Summary | `/exec_summary.html` | Leadership — brief, history, planning, peers |

All pages share the same data files and scoring logic. Fit scores are median-relative (above/below the season median), not fixed-percentage bands.

---

## Repository Structure

```
broadway-touring-dashboard/
├── src/
│   ├── index.html              ← Hub page
│   ├── dashboard.html          ← Operations dashboard
│   ├── programming.html        ← Programming intelligence view
│   ├── exec_summary.html       ← Executive summary view
│   ├── css/
│   │   ├── styles.css          ← Shared design system
│   │   └── charts.css          ← Chart-specific overrides
│   ├── js/
│   │   └── utils.js            ← Shared helpers (peer metadata, formatting)
│   └── data/
│       ├── data.json           ← Weekly touring records (2019–present)
│       ├── seasons.json        ← Season slates (shows per season, open/close dates)
│       ├── peers.json          ← Peer venue metadata and classifications
│       ├── context.json        ← Weekly ambient context (weather + econ, 2019–present)
│       └── shows.json          ← Show metadata (Tony awards, composer, Wikipedia summary)
├── scripts/
│   ├── process_touring.py      ← Parses Broadway League XLSX → data.json
│   ├── scrape_shows.py         ← Enriches shows.json (Wikidata, DBpedia, Wikipedia)
│   ├── scrape_context.py       ← Builds context.json (NOAA weather + FRED econ)
│   ├── watcher.py              ← File watcher — runs full pipeline on new XLSX
│   ├── start_watcher.bat       ← Double-click launcher for watcher.py
│   └── cache/                  ← Local NOAA download cache (gitignored, auto-managed)
├── .github/
│   └── workflows/
│       └── azure-static-web-apps-white-pebble-01710020f.yml  ← Auto-deploy on push to main
├── .gitignore
└── README.md
```

---

## Weekly Update Pipeline

When a new Broadway League XLSX report is saved to the OneDrive upload folder, the watcher handles everything automatically:

```
New XLSX file detected
        │
        ▼
process_touring.py --append   →  updates src/data/data.json
        │
        ▼
scrape_shows.py               →  enriches src/data/shows.json (new shows only)
        │
        ▼
scrape_context.py             →  refreshes src/data/context.json (new weeks)
        │
        ▼
git commit + push to main     →  Azure auto-deploys (~30 seconds)
```

**Watch folder:**
```
C:\Users\rnunley\Bushnell Center for the Performing Arts\
AI Taskforce Group-Testing-Development - Broadway League Report Uploads\reports
```

**To start the watcher:** double-click `scripts/start_watcher.bat`  
**Log:** `scripts/watcher.log`

### Manual update (if watcher is not running)

```bash
python scripts/process_touring.py --append <new_file.xlsx> src/data/data.json
python scripts/scrape_context.py
git add src/data/data.json src/data/context.json
git commit -m "Weekly update: <filename>"
git push
```

### Full data rebuild

```bash
python scripts/process_touring.py ./reports src/data/data.json
python scripts/scrape_context.py
git add src/data/data.json src/data/context.json
git commit -m "Full rebuild"
git push
```

---

## Data Files

### `data.json`
Weekly Broadway touring records from Broadway League XLSX reports, 2019–present.

```json
{
  "generated_at": "2026-06-15T00:00:00Z",
  "record_count": 10762,
  "records": [
    {
      "week_of": "2026-06-07",
      "tier": "Primary",
      "show": "Hamilton",
      "theatre": "Opera House",
      "city": "Boston",
      "gross_gross": 2507893,
      "gross_potential": 2395920,
      "gg_pct_gp": 104.7,
      "cap_paid": 99.9,
      "cap_total": 100,
      "on_sub": true,
      "venue_sellable": 2590,
      "similar_bushnell": true
    }
  ]
}
```

Key field notes:
- `week_of` — always a Sunday (Broadway League standard)
- `cap_paid` / `cap_total` / `gg_pct_gp` can exceed 100% — valid per Broadway League guidelines
- `similar_bushnell` — venue sellable capacity within ±10% of Bushnell average (~2,722 seats)
- Canadian GP/GG converted to USD by the Broadway League; ticket prices remain in CAD

### `seasons.json`
Maps each season ID to its programmed show slate with opening/closing dates and subscription status. Manually maintained for future seasons; auto-updated for current season by the watcher.

### `peers.json`
Peer venue metadata: classifications (size, proximity, market, extended), city, state, synopsis. Used by the Peer Intelligence tab.

### `context.json`
One entry per week (2019–present), keyed by `YYYY-MM-DD`. Built by `scrape_context.py` from:
- **NOAA Storm Events** — significant weather events in Hartford County/Zone
- **FRED economic series** — consumer sentiment trend (University of Michigan), unemployment

```json
{
  "2026-01-05": {
    "weather": { "significant": true, "events": ["Winter Storm"] },
    "economic": { "confidence_trend": "falling", "unemployment": 4.2 }
  }
}
```

### `shows.json`
Per-show metadata enriched by `scrape_shows.py` from multiple sources:
- **Wikidata** (SPARQL or REST API) — opening date, composer, lyricist, Tony wins/nominations
- **DBpedia** — fallback for composer, lyricist, image
- **Wikipedia REST** — summary text

Each record includes a `sources` dict that documents which service provided each field.

---

## Fit Score

The Fit Score (0–100) is a directional planning signal, not a guarantee. It rewards:
- Paid capacity performance nationally
- Gross vs potential performance
- Bushnell-size peer venue performance
- Sample depth (record count and venue spread)
- Subscription lift, when relevant

**Thresholds are median-relative.** Each season's median score is computed at render time from the actual slate. Shows above the median are flagged as stronger fits; below as needing review. This keeps the signal calibrated to the actual touring market, not a fixed historical benchmark.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML / CSS / Vanilla JS (no build step) |
| Charts | Chart.js 4.4.1 (cdnjs) |
| Fonts | Libre Baskerville, Libre Franklin, IBM Plex Mono (Google Fonts) |
| Data processing | Python 3 — openpyxl, requests, gzip |
| Show enrichment | Python — SPARQLWrapper, requests (Wikidata, DBpedia, Wikipedia) |
| Context data | Python — NOAA CDO API, FRED API |
| File watching | Python — watchdog |
| Hosting | Azure Static Web Apps (free tier) |
| Deployment | GitHub Actions — auto-deploy on push to `main` |
| Auth (pending) | Azure Entra ID (restrict to @bushnell.org) |

---

## Branches

| Branch | Purpose |
|---|---|
| `main` | Production — auto-deploys to Azure |
| `dev` | Active development — deploys to staging |

---

## Known Issues / Backlog

| # | Issue | Status |
|---|---|---|
| 1 | Entra ID SSO lockdown — requires Standard SKU upgrade + Azure app registration (see below); auth block removed from config until SKU is upgraded | Pending |
| 2 | Wikidata SPARQL endpoint under active rate-limiting outage (797a132) — Tony data may be incomplete until resolved | Monitoring |
| 3 | Weekly automation requires the watcher laptop to be running | Accepted — upgrade path to Azure Function identified |
| 4 | Canadian ticket prices reported in CAD, GP/GG in USD | Documented — no fix needed |

---

## Activating Entra ID Authentication

`src/staticwebapp.config.json` is deployed and will enforce @bushnell.org login once the app registration is wired up. One-time setup:

1. **Azure Portal → Entra ID → App registrations → New registration**
   - Name: `Broadway Touring Dashboard`
   - Supported account types: *Accounts in this organizational directory only (Bushnell)*
   - Redirect URI: `https://white-pebble-01710020f.7.azurestaticapps.net/.auth/login/aad/callback`

2. **Certificates & secrets → New client secret** — copy the value immediately

3. **Azure Static Web Apps → Configuration → Application settings** — add:
   - `AZURE_CLIENT_ID` = Application (client) ID from step 1
   - `AZURE_CLIENT_SECRET` = secret value from step 2

4. Push any change to `main` to trigger a redeploy. Auth will be live immediately after deploy completes.

Users who are not signed in will be redirected to Microsoft login automatically and must authenticate with an `@bushnell.org` account.
