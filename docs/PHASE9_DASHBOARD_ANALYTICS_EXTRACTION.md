# Phase 9 — Dashboard Analytics Extraction

## Purpose

Move Dashboard-specific operational calculations out of `src/js/pages/dashboard.page.js` and into a dedicated shared analytics helper while preserving the existing Dashboard layout and styling.

## Added

- `src/js/core/dashboard-analytics.js`

This file owns Dashboard-oriented aggregation and derived data helpers:

- `BTD.dashboardAnalytics.buildCache(records, options)`
- `BTD.dashboardAnalytics.topShowGross(cache, limit, desc)`
- `BTD.dashboardAnalytics.showVenueBreakdown(cache, show)`
- `BTD.dashboardAnalytics.topMarketGross(cache, limit)`
- `BTD.dashboardAnalytics.topMarketCap(cache, limit)`
- `BTD.dashboardAnalytics.weekOverWeek(records)`
- `BTD.dashboardAnalytics.theatreSizeBuckets(records)`
- `BTD.dashboardAnalytics.analyticsSeries(cache, options)`
- `BTD.dashboardAnalytics.peerSummary(records, peerType, peerMeta, synopses)`

## Updated shared rendering

Added component helpers:

- `BTD.components.dashboardWowTable(data, options)`
- `BTD.components.dashboardSizeGrid(rows, options)`

These preserve the existing Dashboard markup/classes/inline styles while removing more rendering logic from the page controller.

## Updated Dashboard controller

`src/js/pages/dashboard.page.js` now delegates:

- cache construction to `BTD.dashboardAnalytics.buildCache()`
- Analytics tab data preparation to `BTD.dashboardAnalytics.analyticsSeries()`
- Ranking tab calculations to `BTD.dashboardAnalytics.topShowGross()`, `weekOverWeek()`, `topMarketGross()`, `topMarketCap()`, and `theatreSizeBuckets()`
- Peer tab summary calculations to `BTD.dashboardAnalytics.peerSummary()`
- WoW table rendering to `BTD.components.dashboardWowTable()`
- theatre-size grid rendering to `BTD.components.dashboardSizeGrid()`

## Not changed

- No CSS files were modified.
- Existing Chart.js visual configuration was preserved in the Dashboard controller for now.
- Dashboard still owns page state, filter orchestration, sort state, and tab flow.

## Validation

Ran:

```bash
node --check src/js/core/*.js
node --check src/js/pages/*.js
node scripts/compare_signals.js 2025-2026
python3 -m py_compile scripts/*.py
python3 scripts/validate_data.py --data src/data/data.json --out src/data/validation_report.json
```

All checks passed.

## Next recommended phase

Phase 10 should focus on visual smoke testing and deployment readiness rather than another large refactor. The codebase has now gone through several structural changes and should be tested in browser before deeper extraction continues.
