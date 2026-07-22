# Broadway Touring Intelligence Dashboard

A fully static web application that helps the Bushnell Center for the Performing Arts evaluate, compare, and plan Broadway touring productions. All data is preprocessed locally from Broadway League XLSX reports and hosted as static JSON on Azure Static Web Apps — no backend, no database, no build step.

**Production:** https://white-pebble-01710020f.7.azurestaticapps.net  
**Version:** v6.0 · June 25, 2026  
**Sponsor:** Stephanie Fried, COO — The Bushnell Center for the Performing Arts

---

## Pages

| Page | Audience | Purpose |
|---|---|---|
| [Hub](src/index.html) | All | Navigation and version info |
| [Programming](src/programming.html) | Programming team | Working view — show-by-show signal analysis, planning candidates |
| [Executive Summary](src/exec_summary.html) | Leadership | High-level season read, KPIs, watchlist |
| [Dashboard](src/dashboard.html) | Operations / QA | Raw data, charts, analytics, peer benchmarks |
| [Box Office](src/box_office.html) | Brandon (Box Office) | Scenario modeler — per-performance pricing, holds, gross projections |

---

## How It Works

```
Broadway League XLSX report
         │
         ▼
   process_touring.py  ──►  src/data/data.json
   scrape_shows.py     ──►  src/data/shows.json
   scrape_context.py   ──►  src/data/context.json
         │
         ▼
   git push → main → Azure auto-deploy (~30 seconds)
         │
         ▼
   Browser fetches JSON at runtime and renders everything
```

The pipeline runs locally on the rnunley laptop. `watcher.py` can watch the OneDrive upload folder and trigger the pipeline automatically when a new report arrives.

---

## Evaluation Model

Every show is evaluated on four signals:

| Signal | What it measures |
|---|---|
| **Demand** | Paid capacity — how full the venue was |
| **Revenue** | GG% (gross as % of gross potential) — how much of the available gross was captured |
| **Peer** | How the show performed at Bushnell-size peer venues nationally |
| **Confidence** | Sample depth — how many records back the scores |

These roll up into a **Planning Signal** score (0–100) with a read label: **Strong Candidate / Discuss / Watch / Exploratory.**

Revenue (GG%) is the headline metric. Capacity is context, not the lead story.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Data pipeline: how to run when a new report arrives, how to add a show or season, deployment steps, environment variables |
| [docs/DEVELOPER.md](docs/DEVELOPER.md) | Architecture, BTD namespace, shared modules, how to extend the signal model |
| [docs/CHARTS.md](docs/CHARTS.md) | What each chart shows and why |
| [docs/SERVER_MIGRATION_AND_EMAIL_INGESTION.md](docs/SERVER_MIGRATION_AND_EMAIL_INGESTION.md) | Planned: moving the pipeline to a dedicated box, switching report ingestion from SharePoint to a shared mailbox, and an AI-generated hub highlight via Anthropic Workload Identity Federation |
| [SERVER_SETUP.md](SERVER_SETUP.md) | Setting up a dedicated server to run the data pipeline automatically |

---

## Quick Start — Local Preview

```bash
cd src
python -m http.server 8765
```

Then open:
- http://127.0.0.1:8765/
- http://127.0.0.1:8765/programming.html
- http://127.0.0.1:8765/exec_summary.html
- http://127.0.0.1:8765/dashboard.html

---

## Quick Start — Update Data After a New Report

```bash
# Activate virtual environment (first time: python -m venv venv)
venv\Scripts\activate           # Windows
source venv/bin/activate        # Mac/Linux

# Append new report
python scripts/process_touring.py --append path/to/new_report.xlsx src/data/data.json

# Update show metadata (only processes new shows)
python scripts/scrape_shows.py

# Update weather and economic context
python scripts/scrape_context.py

# Commit and push to deploy
git add src/data/
git commit -m "Data update — week of YYYY-MM-DD"
git push origin main
```

Full details: [docs/OPERATIONS.md](docs/OPERATIONS.md)
