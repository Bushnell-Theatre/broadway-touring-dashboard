# Phase 5 — Page Controllers Extracted

## Summary

The large inline JavaScript blocks were moved out of the HTML files and into dedicated page controller files under `src/js/pages/`.

This keeps the current no-build static architecture, preserves existing global event-handler behavior, and makes the HTML files act more like layout shells.

## Files Added

- `src/js/pages/exec-summary.page.js`
- `src/js/pages/programming.page.js`
- `src/js/pages/dashboard.page.js`

## HTML Files Updated

- `src/exec_summary.html`
- `src/programming.html`
- `src/dashboard.html`

Each page now loads its page controller after the shared core scripts, compatibility utilities, and external libraries.

## Styling

No CSS files were changed.

- `src/css/styles.css` untouched
- `src/css/charts.css` untouched

## Intentional Compatibility Choice

The page controller files are loaded as classic non-module scripts, not ES modules. This is intentional so existing `onclick` handlers and page-level function calls continue to work without requiring a full DOM event binding rewrite.

## Validation Completed

- `node --check src/js/pages/*.js`
- `node --check src/js/core/*.js`
- `node scripts/compare_signals.js 2025-2026`
- `python3 -m py_compile scripts/*.py`
- `python3 scripts/validate_data.py --data src/data/data.json --out src/data/validation_report.json`
- Confirmed the three major HTML files no longer contain large non-empty inline script blocks.

## Next Recommended Phase

Phase 6 should reduce remaining legacy duplication inside the page controller files themselves. Now that controller code is isolated, repeated functions can be removed or replaced with shared `BTD.page`, `BTD.components`, `BTD.charts`, and `BTD.signals` calls more safely.
