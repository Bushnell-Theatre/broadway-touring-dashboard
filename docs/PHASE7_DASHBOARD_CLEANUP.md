# Phase 7 - Dashboard Deep Cleanup

## Goal

Reduce Dashboard-specific duplication now that Programming and Executive Summary have been aligned around shared `BTD.*` modules. This phase keeps the Dashboard's operational/raw-data purpose intact and does not change the CSS or visual design.

## Changes Made

### Removed hard-coded Dashboard season fallback

`dashboard.page.js` no longer carries its own embedded season slate fallback. Season metadata now comes from the shared `BTD.data.loadCore()` / `BTD.state.seasons` flow and is normalized for Dashboard compatibility through `BTD.page.normalizeDashboardSeasons()`.

This removes a major source of future drift between Dashboard, Programming, and Executive Summary.

### Centralized Dashboard data normalization

Added shared helpers in `src/js/core/page-common.js`:

- `BTD.page.normalizeDashboardRows()`
- `BTD.page.normalizeDashboardSeasons()`

Dashboard keeps its local compatibility aliases (`ALL_DATA`, `SEASONS`) for now, but the transformation is shared and no longer buried in the controller.

### Centralized Dashboard season pill rendering

Added:

- `BTD.page.renderDashboardSeasonPills()`

Dashboard now renders season controls through the shared page layer rather than hard-coding the season-pill HTML in the controller.

### Centralized tooltip wiring

Added:

- `BTD.page.attachHelpTooltips()`

Dashboard's HELP_TEXT remains local because it is operationally specific, but the DOM wiring is now shared.

### Centralized date utility logic

Added:

- `BTD.page.snapToSunday()`
- `BTD.page.fiscalWeek()`

Dashboard now delegates report-week snapping and fiscal-week calculation through shared helpers.

### Centralized Dashboard rank-list rendering

Added:

- `BTD.components.dashboardRankList()`

Dashboard's `mkRankList()` is now a thin wrapper over the shared component, preserving the same markup/classes/styling while removing a large local rendering block.

## Files Updated

- `src/js/core/page-common.js`
- `src/js/core/components.js`
- `src/js/pages/dashboard.page.js`
- `docs/PHASE7_DASHBOARD_CLEANUP.md`

## CSS Status

No CSS files were modified.

## Validation

The following checks passed:

```bash
node --check src/js/core/*.js
node --check src/js/pages/*.js
node scripts/compare_signals.js 2025-2026
python3 -m py_compile scripts/*.py
python3 scripts/validate_data.py --data src/data/data.json --out src/data/validation_report.json
```

## Remaining Dashboard Cleanup

The Dashboard still has substantial page-specific logic because it is the raw operations and QA view. Remaining candidates for later phases:

1. Move operational chart definitions into a Dashboard chart registry.
2. Move the raw table renderer into `BTD.components` or a `BTD.table` helper.
3. Move the import modal / Excel parsing workflow out of the controller.
4. Move peer synopsis rendering into a shared peer component.
5. Split `dashboard.page.js` into smaller controller sections only if the project is ready for another structural pass.

## Rule Preserved

Dashboard may remain more detailed than Programming and Executive Summary, but it should continue to use shared data loading, state, signal, season, peer, component, and utility functions wherever the underlying concept is the same.
