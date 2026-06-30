# Phase 4 — Shared Rendering Components

## Purpose

This phase moves repeated chart, card, rank-list, signal-row, and title-card rendering into shared helper modules while preserving the existing page styling and layout.

## Files updated

- `src/js/core/components.js`
- `src/js/core/charts.js`
- `src/js/core/page-common.js`
- `src/programming.html`
- `src/exec_summary.html`

`src/dashboard.html` already loads the shared rendering layer and remains eligible for future component adoption, but its operational/raw-data rendering was not aggressively rewritten in this pass.

## Shared rendering added

### `BTD.components`

Added shared helpers for:

- `signalStatus(label)`
- `signalRow(signals)`
- `rankItems(items, nameFn, detailFn, valFn)`
- `programmingShowCard(profile, active, idx, median)`
- `metricTile(label, value, note, statusClass)`
- `externalConditionsCard(weatherWeeks, fallingWeeks)`

### `BTD.charts`

Added shared helpers for:

- `renderFitChart(canvasId, profiles)`
- `renderCapacityComparisonChart(canvasId, profiles)`
- `renderTonyRecognitionChart(canvasId, rows)`

These wrap the lower-level shared chart primitives and preserve the existing Chart.js visual behavior.

### `BTD.page`

Updated common page helpers so `BTD.page.signalRow()` and `BTD.page.rankItems()` delegate to `BTD.components` instead of owning separate rendering logic.

## Page wiring changes

### `programming.html`

Local wrapper functions now delegate to shared rendering helpers:

- `showCard()` -> `BTD.components.programmingShowCard()`
- `rankItems()` -> `BTD.components.rankItems()`
- `chartFit()` -> `BTD.charts.renderFitChart()`
- `chartCap()` -> `BTD.charts.renderCapacityComparisonChart()`
- `chartPeers()` -> `BTD.charts.renderPeerChart()`
- `chartIntelTony()` -> `BTD.charts.renderTonyRecognitionChart()`

### `exec_summary.html`

Local wrapper functions now delegate to shared rendering helpers:

- `rankItems()` -> `BTD.components.rankItems()`
- `chartFit()` -> `BTD.charts.renderFitChart()`
- `chartCap()` -> `BTD.charts.renderCapacityComparisonChart()`
- `chartPeers()` -> `BTD.charts.renderPeerChart()`

## Styling impact

No CSS files were modified.

Existing class names and inline layout patterns were preserved so the visual design should remain stable.

## Validation run

- `node --check src/js/core/*.js`
- inline script syntax checks for:
  - `src/programming.html`
  - `src/exec_summary.html`
  - `src/dashboard.html`
- `node scripts/compare_signals.js 2025-2026`
- `python -m py_compile scripts/*.py`
- `python scripts/validate_data.py --data src/data/data.json --out src/data/validation_report.json`

## Remaining cleanup

The pages still contain large inline render controllers. The next logical phase is to move page controllers into:

- `src/js/pages/programming.page.js`
- `src/js/pages/exec-summary.page.js`
- `src/js/pages/dashboard.page.js`

That should be done after a visual regression check, because it changes page wiring more than this phase did.
