# Developer Guide — Broadway Touring Intelligence Dashboard

This document covers the JavaScript architecture, the `BTD` shared namespace, how pages are structured, and how to extend the signal model or add shared helpers.

---

## Architecture Overview

The dashboard is a **fully static** application. There is no build step, no framework, no npm. Every file the browser loads is a plain `.html`, `.css`, or `.js` file served as-is from Azure Static Web Apps.

```
src/
├── index.html              Hub / nav page
├── programming.html        Programming team page
├── exec_summary.html       Executive summary page
├── dashboard.html          Operations / QA page
├── unauthorized.html       Azure Entra auth failure page
│
├── css/
│   ├── styles.css          Design system — all CSS variables, layout, components
│   └── charts.css          Chart-specific styles
│
├── js/
│   ├── utils.js            Legacy global helpers (loaded on all pages)
│   │
│   ├── core/               Shared modules — all attach to window.BTD
│   │   ├── config.js           Constants and thresholds
│   │   ├── state.js            Shared filter/season state
│   │   ├── format.js           fmt$(), pct(), num() formatters
│   │   ├── metrics.js          Per-show metric aggregation
│   │   ├── data.js             fetch() wrappers and data loading
│   │   ├── validation.js       Data quality checks
│   │   ├── filters.js          Filter panel logic
│   │   ├── seasons.js          Season list and slate helpers
│   │   ├── peers.js            Peer venue metadata and matching
│   │   ├── context.js          Weather and economic context
│   │   ├── signals.js          Planning Signal model (canonical)
│   │   ├── charts.js           Chart.js lifecycle helpers
│   │   ├── components.js       Shared card/table/rank rendering
│   │   ├── tabs.js             Tab show/hide logic
│   │   ├── page-common.js      Shared callout, headline, copy logic
│   │   └── dashboard-analytics.js  Dashboard-specific calculations
│   │
│   └── pages/              Page controllers — one per HTML page
│       ├── programming.page.js
│       ├── exec-summary.page.js
│       └── dashboard.page.js
│
└── data/
    ├── data.json           All weekly touring records (~10k rows)
    ├── shows.json          Show metadata (Tony, composer, Wikipedia)
    ├── seasons.json        Season slates (confirmed + candidate shows)
    ├── peers.json          Peer venue metadata
    ├── context.json        Weekly weather + economic context
    └── validation_report.json  Output of validate_data.py
```

---

## The BTD Namespace

All shared JavaScript attaches to `window.BTD`. This avoids global name collisions and makes the dependency graph explicit.

```javascript
window.BTD = window.BTD || {};
BTD.config    // constants and thresholds
BTD.state     // current season, filters
BTD.fmt       // formatters
BTD.metrics   // per-show aggregation
BTD.data      // fetch wrappers
BTD.signals   // Planning Signal model
BTD.charts    // Chart.js helpers
BTD.components // card/table rendering
BTD.page      // callout/headline copy logic
BTD.analytics // dashboard-only calculations
```

Each file checks `window.BTD = window.BTD || {}` at the top before adding its namespace, so load order within a page doesn't matter as long as all core files precede the page controller.

### Load order in HTML

```html
<!-- 1. Third-party -->
<script src="https://cdn.jsdelivr.net/...chart.js"></script>

<!-- 2. Shared core (any order within this group) -->
<script src="js/utils.js"></script>
<script src="js/core/config.js"></script>
<script src="js/core/format.js"></script>
<!-- ... other core modules ... -->
<script src="js/core/page-common.js"></script>

<!-- 3. Page controller (always last) -->
<script src="js/pages/programming.page.js"></script>
```

---

## Planning Signal Model

The canonical model lives in `src/js/core/signals.js`. Call it as:

```javascript
var profile = BTD.signals.profileShow(show, records, peers, context, config);
```

Returns:

```javascript
{
  show: { title, season, status },
  metrics: {
    gross,      // avg weekly gross ($)
    gg,         // avg GG% of gross potential
    cap,        // avg paid capacity %
    peerCap,    // avg capacity at Bushnell-size peer venues
    index,      // Bushnell index vs national cap (Hartford records only)
    count,      // number of weekly records matched
    weeks       // number of reporting weeks
  },
  signals: {
    demand,     // 0–100
    revenue,    // 0–100
    peer,       // 0–100
    confidence  // 0–100
  },
  score,        // 0–100 Planning Signal composite
  read,         // "Strong Candidate" | "Discuss" | "Watch" | "Exploratory"
  isFutureNewTour  // true if no historical records exist yet
}
```

### Signal thresholds

Defined in `src/js/core/config.js`. Change thresholds there — not in page controllers or `page-common.js`.

### GG% callout thresholds

| GG% | Color | Meaning |
|---|---|---|
| ≥ 80% | Green (`.good`) | Strong revenue performance |
| 60–79% | Neutral | Acceptable |
| < 60% | Amber/Red (`.warn`) | Substantially below gross potential |

These thresholds live in `BTD.page.seasonCalloutClass()` in `page-common.js`.

---

## Shared Page Helpers (`page-common.js`)

Three functions that both Programming and Executive Summary pages share:

### `BTD.page.seasonCalloutClass(avgGG)`

Returns the CSS class for the season callout banner. Input: season average GG%. Output: `'good'`, `''` (neutral), or `'warn'`.

### `BTD.page.seasonHeadline(avgGG, avgGross, peer, profiles)`

Returns the headline sentence for the callout banner. Reads actual profile data — names the top-grossing show by title, the actual GG%, and the number of matched shows. Changes every week as data updates.

Example output:
> "Hamilton leads at $1.2M avg gross · season at 84% GG% across 8 matched shows."

### `BTD.page.seasonSummaryCopy(profiles, avgGG, avgGross, avgCap, peer)`

Returns a multi-sentence body paragraph for the callout. Names specific strong performers (GG% ≥ 80%) and soft signals (GG% < 60%) by show title. Ends with a capacity footnote.

---

## Adding a Shared Helper

1. Decide which core module it belongs to (formatting → `format.js`, metrics → `metrics.js`, page copy → `page-common.js`, etc.).
2. Add the function at the module level, then expose it on the `BTD.*` namespace at the bottom of the file.
3. Guard the namespace: `BTD.page = BTD.page || {};` before assigning.
4. Call it from page controllers via `BTD.page.myHelper()` with a fallback for the case where the core module hasn't loaded.

Example pattern from `page-common.js`:

```javascript
function myHelper(value) {
  return value > 0 ? 'positive' : 'negative';
}

// Expose at bottom of file
BTD.page = BTD.page || {};
BTD.page.myHelper = myHelper;
```

In a page controller:

```javascript
var result = (BTD.page && BTD.page.myHelper) ? BTD.page.myHelper(val) : fallback;
```

The defensive guard (`BTD.page && BTD.page.myHelper`) ensures the page degrades gracefully if a core file fails to load.

---

## Page Controllers

Each page controller is a classic non-module script. It uses global variables and `DOMContentLoaded`. It is **not** an ES module — this is intentional because inline event handlers (e.g., `onclick="showTab('brief')"`) require globals.

### Typical structure

```javascript
// Module-level state
var ALL = [], SEASONS = [], PROFILES = [], SCORE_MED = 50;
var STATE = { season: null, filter: '' };

// Entry point
document.addEventListener('DOMContentLoaded', function() {
  loadData();
});

function loadData() {
  // fetch data.json, shows.json, seasons.json, peers.json, context.json
  // then call renderAll()
}

function renderAll() {
  // compute PROFILES = BTD.signals.profileShow() for each slate show
  // compute SCORE_MED = median of scores
  // call renderBrief(), renderActive(), renderHistory(), renderPlanning(), renderPeers()
}
```

### Rules for page controllers

- Do **not** put scoring or threshold logic in page controllers. It belongs in `signals.js` or `page-common.js`.
- Do **not** duplicate callout/headline logic across pages. Use `BTD.page.*` functions.
- Page controllers may have page-specific rendering (HTML structure, tab behavior) — that's fine.

---

## Charts

Charts use Chart.js 4.x loaded from CDN. The `BTD.charts` module in `charts.js` provides lifecycle helpers:

```javascript
BTD.charts.renderDashboardChart(CHARTS, key, canvasId, config);
// CHARTS is a registry object — Chart instances are stored here by key
// Calling again destroys the old instance before creating a new one
```

Chart configurations follow Chart.js v4 options format. See [docs/CHARTS.md](CHARTS.md) for what each chart shows and why.

---

## CSS Design System

All colors, spacing, and typography are CSS custom properties in `src/css/styles.css`.

Key variables:

```css
--ink1       /* primary text */
--ink2       /* secondary text */
--ink3       /* metadata / tertiary */
--bg1        /* page background */
--bg2        /* card background */
--accent     /* Bushnell blue #003865 */
--good       /* green — strong performance */
--warn       /* amber/red — below threshold */
```

Status classes: `.status.good`, `.status.warn`, `.status.neutral` — used on score badges and table cells.

**Do not modify `styles.css` without explicit direction.** Visual identity changes have downstream effects across all pages.

---

## Do Not Break

These constraints are intentional:

1. Do not convert page controllers to ES modules without also replacing all inline event handlers.
2. Do not collapse Demand and Revenue into one score — they measure different things.
3. Do not treat Revenue Signal as net profit — it is gross revenue quality only.
4. Do not remove above-100 capacity/gross values — they are valid Broadway League reporting conditions.
5. Do not reintroduce page-local scoring logic — all thresholds live in `config.js` and `signals.js`.
6. Do not add a frontend build step without explicit agreement — the no-build constraint keeps hosting free and deployments trivial.

---

## Validation and Syntax Checks

Run before any push:

```bash
node --check src/js/core/*.js
node --check src/js/pages/*.js
node --check scripts/compare_signals.js
python -m py_compile scripts/*.py
```

Run after a data update:

```bash
python scripts/validate_data.py --data src/data/data.json --out src/data/validation_report.json
node scripts/compare_signals.js 2025-2026
node scripts/compare_signals.js 2026-2027
```
