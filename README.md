# Broadway Touring Intelligence Dashboard

A static decision-support application for exploring Broadway League touring performance and supporting Bushnell programming conversations.

The project does **not** forecast Bushnell profit or make booking decisions. It organizes reported touring results, compares productions across curated peer cohorts, and exposes the evidence behind a directional **Planning Signal**.

**Production:** https://white-pebble-01710020f.7.azurestaticapps.net  
**Status:** In development  
**Sponsor:** Stephanie Fried, COO — The Bushnell Center for the Performing Arts

---

## What the product does

The application supports three active experiences built on the same touring dataset:

| Experience | Intended audience | Primary use |
|---|---|---|
| [Sales Intelligence Dashboard](src/dashboard.html) | Sales and analytics | Explore weekly touring results, show history, markets, subscription behavior, and peer benchmarks |
| [Programming](src/programming.html) | Programming | Review current and candidate shows, inspect the evidence behind their Planning Signals, and compare peer performance |
| [Executive Summary](src/exec_summary.html) | Leadership | Review a concise season-level view of performance, candidates, and notable signals |
| [Development Hub](src/index.html) | All internal users | Choose an experience and see data currency/version information |

The former Box Office scenario model remains in the repository, but its work is suspended and it is not presented as an active product experience.

All active pages are in development. They are different views of the same evidence, not production/demonstration versions of one another.

---

## What the product does not do

The application does not currently include:

- Bushnell deal terms, guarantees, splits, labor, marketing costs, or ancillary revenue
- A prediction of Bushnell sales, gross, or profit
- Routing, availability, technical feasibility, artistic priority, mission fit, or donor value
- Patron-level, ticket-holder, or customer data
- A database or application backend
- A continuously running cloud ingestion service

Broadway League gross is tour-reported ticket revenue, not Bushnell net revenue. The Planning Signal is a discussion aid, not a recommendation engine or forecast.

---

## Data and calculations

The browser loads static JSON files and calculates the interface at runtime.

- `src/data/data.json` is the primary dataset. Each usable record represents a show at a venue for a reporting week.
- `src/data/seasons.json` defines Bushnell season slates and candidates.
- `src/data/peers.json` defines three curated peer cohorts: venue size, geographic proximity, and comparable market/PAC.
- Optional enrichment and generated summary files add context but do not replace the primary touring evidence.

The Planning Signal is derived from four components:

| Component | Implemented meaning |
|---|---|
| Demand | Scaled paid capacity in each available peer cohort, plus subscription/non-subscription capacity difference when available |
| Revenue | Scaled GG% of gross potential and average paid admission within available peer cohorts |
| Peer | Combined peer-pool capacity, revenue efficiency, and sample breadth |
| Confidence | Overall record count, venue count, peer-record count, and reporting-week count |

The numeric Planning Signal is currently the **equal average** of the four available component scores. It is not a weighted 40/25/25/10 formula. Fixed ranges in `src/js/core/signals.js` scale source metrics to 0–100. Page-level comparisons may use the selected season median, but that median does not define the underlying numeric score.

Future new tours with no matching performance records receive no numeric score (`—`) and are labeled Exploratory.

See [SCORING.md](SCORING.md) for the exact implemented calculation and limitations.

---

## How data reaches the application

```text
Broadway League XLSX report
        |
        v
Local Python processing
        |
        v
Static JSON files in src/data/
        |
        v
Git commit and push
        |
        v
Azure Static Web Apps deployment
        |
        v
Browser loads JSON and renders the selected experience
```

The Python processing tools run locally; they are not part of the production website. The local HTTP server described below is also only a preview server. Azure serves the production application as static files.

The repository also contains optional local automation for watching an upload folder, refreshing enrichment/context data, generating threshold-triggered summaries, validating data, and publishing updates. Those operational mechanics are documented separately because they are not the product itself.

---

## Documentation

| Document | Purpose |
|---|---|
| [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) | Plain-language product and data guide |
| [SCORING.md](SCORING.md) | Exact implemented Planning Signal methodology |
| [docs/CHARTS.md](docs/CHARTS.md) | Chart definitions and intended interpretation |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Local ingestion, validation, and deployment procedures |
| [docs/DEVELOPER.md](docs/DEVELOPER.md) | Front-end architecture and extension guidance |
| [docs/AI_PIPELINE_PLAN.md](docs/AI_PIPELINE_PLAN.md) | Design notes for generated highlight and retrospective features |
| [docs/SERVER_MIGRATION_AND_EMAIL_INGESTION.md](docs/SERVER_MIGRATION_AND_EMAIL_INGESTION.md) | Planned migration work, not current production behavior |
| [SERVER_SETUP.md](SERVER_SETUP.md) | Dedicated-server setup guidance, not current production architecture |

---

## Local preview

```bash
cd src
python -m http.server 8765
```

Open http://127.0.0.1:8765/. This server is for local preview only.

For data-update procedures, prerequisites, and deployment details, use [docs/OPERATIONS.md](docs/OPERATIONS.md).
