# Phase 6 — Page Controller Cleanup

## Goal

Reduce duplicated controller logic after the Phase 5 extraction to `src/js/pages/` while preserving the existing HTML and CSS presentation.

## Completed Changes

### Shared controller helpers

Expanded `src/js/core/page-common.js` with controller-level helpers:

- `BTD.page.setFilterValue(globalName, value)`
- `BTD.page.setFilterButton(globalName, selector, value, renderFn)`
- `BTD.page.hydrateCoreState()`

These helpers centralize active filter state syncing and core data hydration for page controllers.

### Filter normalization

Updated `src/js/core/filters.js` to support both canonical and legacy page filter values:

- subscription: `sub` / `nonsub` and legacy `1` / `0`
- equity: `equity` / `nonequity` and legacy `no` / `yes`
- engagement: `performed` / `no_performance` and legacy `no` / `yes`

This lets older page controls continue working while the shared filter layer becomes the canonical path.

### Programming controller cleanup

Updated `src/js/pages/programming.page.js`:

- removed the hard-coded season fallback block from the page controller
- removed stale local data URL dependency
- rewired `loadData()` to use `BTD.data.loadCore()` exclusively
- uses `BTD.page.hydrateCoreState()` for local compatibility variables
- rewired filter setters through `BTD.page.setFilterButton()`
- rewired `applyFilters()` through `BTD.page.applyStandardFilters()`

### Executive Summary controller cleanup

Updated `src/js/pages/exec-summary.page.js`:

- removed the large hard-coded season fallback block from the page controller
- rewired `loadData()` to use `BTD.data.loadCore()` exclusively
- uses `BTD.page.hydrateCoreState()` for local compatibility variables
- rewired filter setters through `BTD.page.setFilterButton()`
- rewired `applyFilters()` through `BTD.page.applyStandardFilters()`

### Dashboard controller cleanup

Updated `src/js/pages/dashboard.page.js` conservatively:

- rewired shared top-level filter setters through `BTD.page.setFilterButton()`
- syncs selected season into `BTD.state.active.season`
- syncs `FILTERED` into `BTD.state.filtered`

The dashboard still contains substantial operational logic and should remain the last controller to deeply refactor.

## Validation

Passed:

```bash
node --check src/js/core/*.js
node --check src/js/pages/*.js
node scripts/compare_signals.js 2025-2026
python3 -m py_compile scripts/*.py
python3 scripts/validate_data.py --data src/data/data.json --out src/data/validation_report.json
```

## Remaining Controller Cleanup

Recommended next items:

1. Move common season-pill rendering into `BTD.components` or `BTD.seasons`.
2. Move tooltip/help-text wiring into a shared helper.
3. Migrate Dashboard's hard-coded season fallback to shared `BTD.data.normalizeSeasons()` and `seasons.json` only.
4. Gradually replace Dashboard-specific chart/ranking utilities with shared `BTD.charts` and `BTD.components` calls.
5. Begin reducing local compatibility globals (`ALL`, `FILTERED`, `SEASONS`, etc.) once all renderers are safely consuming `BTD.state`.

## Guiding Rule

Controllers may decide page-specific layout and audience depth, but common state, filtering, data hydration, signal calculation, and reusable rendering behavior should live under `BTD.*`.
