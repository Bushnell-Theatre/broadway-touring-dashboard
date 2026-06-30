# Claude Handoff — Broadway Touring Intelligence Dashboard Refactor

## Role

You are taking over a refactored static web application called the Broadway Touring Intelligence Dashboard.

The user wants the project stabilized, simplified, and made more trustworthy without breaking the existing visual design.

Do **not** redesign the CSS or visual identity unless explicitly asked.

## Project Summary

This is a fully static HTML/CSS/JavaScript dashboard hosted on Azure Static Web Apps. There is no backend server, no database, and no frontend build step.

Data is preprocessed locally by Python scripts into JSON files under:

```text
src/data/
```

The browser loads those JSON files and renders three primary pages:

```text
src/dashboard.html        Operations / QA dashboard
src/programming.html     Programming team working view
src/exec_summary.html    Leadership-facing executive summary
```

There is also:

```text
src/index.html           Hub page
src/unauthorized.html    Auth failure page
```

## Important User Direction

The user specifically asked to:

1. Lock development while correcting architecture and methodology issues.
2. Reduce duplication across all three major pages.
3. Make Programming and Executive Summary use the same evaluation model.
4. Separate occupancy/capacity from revenue.
5. Preserve styling.
6. Create a final bundle and instructions.

## Critical Product Principle

The dashboard should not present a single occupancy-heavy score as the whole answer.

The core evaluation model is now:

```text
Planning Signal
  Demand Signal
  Revenue Signal
  Peer Signal
  Confidence Signal
```

Capacity/occupancy belongs under **Demand Signal**.

Revenue-quality measures belong under **Revenue Signal**.

Revenue Signal is **not** net profit until deal terms, local expenses, presenter economics, and ancillary revenue are added.

## Refactor Phases Completed

### Phase 1 — Shared wiring

Created a shared `BTD` namespace and core reusable modules under:

```text
src/js/core/
```

### Phase 2 — Canonical planning signals

Made `BTD.signals.profileShow()` the canonical show-evaluation model.

Programming and Executive Summary now consume the same canonical profile object.

### Phase 3 — Shared page-common helpers

Added shared page helpers under:

```text
src/js/core/page-common.js
```

### Phase 4 — Shared rendering

Moved repeated card/rank/chart helpers into:

```text
src/js/core/components.js
src/js/core/charts.js
```

### Phase 5 — Page controllers extracted

Moved inline page scripts into:

```text
src/js/pages/programming.page.js
src/js/pages/exec-summary.page.js
src/js/pages/dashboard.page.js
```

These are classic non-module scripts to preserve existing global inline-handler behavior.

### Phase 6 — Controller cleanup

Reduced duplicated page-controller logic and routed more state/filter behavior through `BTD.page` and `BTD.filters`.

### Phase 7 — Dashboard cleanup

Removed Dashboard hard-coded season fallback and centralized Dashboard-specific row/season normalization, tooltip wiring, date helpers, and rank-list rendering.

### Phase 8 — Dashboard chart registry and table extraction

Added Dashboard chart lifecycle helpers and extracted table row rendering into shared components.

### Phase 9 — Dashboard analytics extraction

Added:

```text
src/js/core/dashboard-analytics.js
```

Moved Dashboard operational calculations out of the page controller.

### Phase 10 — Browser smoke test and deployment hardening

Ran syntax, validation, static HTTP, asset-reference, and canonical signal checks. Added this handoff plus deployment-readiness notes.

## Key Files

### Shared core JavaScript

```text
src/js/core/config.js
src/js/core/state.js
src/js/core/format.js
src/js/core/metrics.js
src/js/core/data.js
src/js/core/validation.js
src/js/core/filters.js
src/js/core/seasons.js
src/js/core/peers.js
src/js/core/context.js
src/js/core/signals.js
src/js/core/charts.js
src/js/core/components.js
src/js/core/tabs.js
src/js/core/page-common.js
src/js/core/dashboard-analytics.js
```

### Page controllers

```text
src/js/pages/programming.page.js
src/js/pages/exec-summary.page.js
src/js/pages/dashboard.page.js
```

### Python pipeline scripts

```text
scripts/dashboard_config.py
scripts/process_touring.py
scripts/scrape_shows.py
scripts/scrape_context.py
scripts/run_pipeline.py
scripts/validate_data.py
scripts/watcher.py
scripts/compare_signals.js
```

### Documentation

```text
docs/REFACTOR_NOTES.md
docs/BACKEND_REFACTOR_NOTES.md
docs/SHOW_SCRAPE_FIX_NOTES.md
docs/PHASE2_CANONICAL_SIGNALS.md
docs/PHASE3_SHARED_PAGE_COMMON.md
docs/PHASE4_SHARED_RENDERING.md
docs/PHASE5_PAGE_CONTROLLERS.md
docs/PHASE6_CONTROLLER_CLEANUP.md
docs/PHASE7_DASHBOARD_CLEANUP.md
docs/PHASE8_DASHBOARD_CHART_TABLE_EXTRACTION.md
docs/PHASE9_DASHBOARD_ANALYTICS_EXTRACTION.md
docs/PHASE10_DEPLOYMENT_READINESS.md
docs/CLAUDE_HANDOFF.md
```

## Validation Commands

Run these from the repo root:

```bash
node --check src/js/core/*.js
node --check src/js/pages/*.js
node --check scripts/compare_signals.js
python3 -m py_compile scripts/*.py
python3 scripts/validate_data.py --data src/data/data.json --out src/data/validation_report.json
node scripts/compare_signals.js 2025-2026
node scripts/compare_signals.js 2026-2027
```

Serve locally:

```bash
cd src
python3 -m http.server 8765
```

Then open:

```text
http://127.0.0.1:8765/
http://127.0.0.1:8765/programming.html
http://127.0.0.1:8765/exec_summary.html
http://127.0.0.1:8765/dashboard.html
```

## Expected Validation Data

The current data validation report should show approximately:

```text
Records: 10,798
Duplicate canonical keys: 0
Unique shows: 175
Unique theatre/city pairs: 557
Invalid dates: 0
Paid capacity over 100%: 143
Gross % potential over 100%: 1,145
Gross over potential: 1,153
```

Above-100 capacity/gross values are retained intentionally and should be surfaced as known reporting conditions.

## Show Scrape Notes

`scripts/scrape_shows.py` was fixed so `SPARQLWrapper` is no longer a hard dependency. If unavailable, it falls back to a requests-based SPARQL client.

Useful test command:

```bash
python3 scripts/scrape_shows.py --season 2026-2027 --show "Mamma Mia!" --force
```

Then, if successful:

```bash
python3 scripts/scrape_shows.py --season 2026-2027 --force
```

Live API calls could not be verified in the sandbox, so test this locally.

## Deployment Guidance

Do not push directly to production first.

Use a branch or `dev` deployment:

```bash
git checkout -b phase10-refactor-readiness
git add .
git commit -m "Refactor dashboard shared logic and deployment readiness"
git push origin phase10-refactor-readiness
```

Then test the Azure staging/dev URL before merging to `main`.

## Manual Smoke Test Checklist

### Hub page

- `/` loads.
- Navigation cards link to the three major pages.

### Programming page

- Page loads without console errors.
- Season selection works.
- Filters work.
- Tabs render.
- Title cards render.
- Charts render.
- Demand / Revenue / Peer / Confidence appear consistently.

### Executive Summary page

- Page loads without console errors.
- Season selection works.
- Executive cards render.
- Watchlist and strong-candidate sections render.
- Language matches Programming page’s canonical signal model.

### Dashboard page

- Page loads without console errors.
- Raw data table renders.
- Sorting works.
- Filters work.
- Charts render.
- Analytics panels render.
- Peer panels render.

### Auth

If Azure Entra ID lockdown is enabled:

- Authorized `@bushnell.org` users can access the app.
- Unauthorized users reach `unauthorized.html`.
- Login route `/.auth/login/aad?post_login_redirect_uri=/` works in Azure.

## Do Not Break

Avoid these changes unless explicitly requested:

1. Do not modify `src/css/styles.css` or `src/css/charts.css` casually.
2. Do not replace the static architecture with a framework.
3. Do not convert page controllers to ES modules without also replacing inline/global event handlers.
4. Do not reintroduce page-local scoring logic.
5. Do not collapse Demand and Revenue back into one opaque score.
6. Do not treat Revenue Signal as net profit.
7. Do not remove above-100 reporting values as errors.

## Best Next Work

Recommended next phase:

```text
Phase 11 — Manual browser QA and targeted bug fixes
```

Only after browser QA should you consider:

1. reducing remaining Dashboard controller size,
2. improving visual display of Demand vs Revenue,
3. adding local Bushnell history,
4. adding deal-terms/net-contribution modeling,
5. migrating watcher automation to a cloud trigger.
