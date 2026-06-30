# Phase 8 — Dashboard Chart Registry and Table Extraction

## Scope

This phase continued the Dashboard cleanup while preserving the existing visual design and CSS.

## Changes

### Shared chart registry helpers

Added shared Dashboard chart lifecycle helpers to `src/js/core/charts.js`:

- `BTD.charts.renderDashboardChart(store, key, canvasId, config)`
- `BTD.charts.destroyDashboardChart(store, key)`
- `BTD.charts.renderDashboardChartRegistry(defs, store)`

The Dashboard controller now routes Chart.js construction through the shared helper instead of directly instantiating `new Chart(...)` throughout the controller.

### Shared table rendering

Added shared Dashboard table helpers to `src/js/core/components.js`:

- `BTD.components.dashboardTableRows(records, options)`
- `BTD.components.dashboardTableCount(count)`

`dashboard.page.js` now delegates the raw engagement table body rendering to the shared component layer while preserving the existing table markup, classes, and inline layout styles.

### Dashboard controller cleanup

Updated `src/js/pages/dashboard.page.js`:

- `renderTable()` now handles sorting and delegates row markup to `BTD.components.dashboardTableRows()`.
- `dc()` now delegates chart destruction to `BTD.charts.destroyDashboardChart()`.
- Dashboard chart creation now uses `BTD.charts.renderDashboardChart()`.

## Styling

No CSS files were modified.

## Validation

Passed:

- `node --check src/js/core/*.js`
- `node --check src/js/pages/*.js`
- `node scripts/compare_signals.js 2025-2026`
- `python3 -m py_compile scripts/*.py`
- `python3 scripts/validate_data.py --data src/data/data.json --out src/data/validation_report.json`

## Remaining Dashboard Work

The Dashboard still has large operational render functions, especially for analytics and peer breakdowns. The next cleanup should focus on extracting Dashboard-specific analytics builders into a dedicated shared module or page helper layer without changing page design.
