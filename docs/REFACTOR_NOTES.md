# Refactor Notes — Shared Wiring Pass

This pass is intentionally conservative. It does **not** remove the existing page-local logic yet. Instead, it creates a shared foundation and a compatibility bridge so the application can be modularized without changing visible behavior all at once.

## What Changed

### Added shared core namespace

All new shared utilities live under:

```js
window.BTD
```

New files:

```text
src/js/core/config.js
src/js/core/state.js
src/js/core/format.js
src/js/core/metrics.js
src/js/core/peers.js
src/js/core/filters.js
src/js/core/data.js
src/js/core/seasons.js
src/js/core/context.js
src/js/core/signals.js
src/js/core/charts.js
src/js/core/components.js
src/js/core/tabs.js
```

### Updated `utils.js`

`src/js/utils.js` is now a compatibility bridge. It preserves existing global helpers used by the current inline page scripts, while pointing new work toward `BTD.*` modules.

Legacy names preserved include:

```js
fmt$
pct
fmtN
avg
fmtDate
fmtWeek
fiscalYear
getFiscalYear
isPeerType
applyStandardFilters
initSharedData
```

`utils.js` deliberately does **not** overwrite page-specific `applyFilters()` because the current pages use `applyFilters()` as a render-triggering UI function, not just a pure filtering function.

### Updated page script wiring

The three major pages now load shared core files before `utils.js`:

```text
src/dashboard.html
src/programming.html
src/exec_summary.html
```

### Fixed one stale production data URL

In `programming.html`, the production fallback was corrected from:

```text
https://white-pebble-01710020f.7.azurestaticapps.net/data.json
```

to:

```text
https://white-pebble-01710020f.7.azurestaticapps.net/data/data.json
```

## What This Pass Does Not Yet Do

This pass does not aggressively remove duplicated inline functions from the large HTML pages. That would be the next step after visual smoke testing in the browser.

Still duplicated for now:

- page-local render functions
- page-local scoring/profile logic
- page-local chart functions
- page-local context badge functions
- page-local peer summaries
- page-local season logic

## Why This Was Staged This Way

The existing pages are large and tightly coupled. A full extraction in one pass would carry high breakage risk. This pass creates a reusable shared layer while preserving the current behavior paths.

## Recommended Next Pass

1. Run the modified project locally and confirm each page still loads.
2. Move shared formatting calls to `BTD.format` where easy.
3. Replace pure page-local filtering with `BTD.filters.apply`.
4. Replace peer checks with `BTD.peers.isPeerType`.
5. Extract canonical show/profile scoring into `BTD.signals.profileShow`.
6. Only after that, implement the Demand / Revenue / Peer / Confidence display split.

## Validation Performed

- All new standalone JavaScript files pass `node --check`.
- Existing JSON files parse successfully.
- A local static HTTP server returned HTTP 200 for the main HTML pages.
- A lightweight VM load confirmed the `BTD` namespace initializes with all expected modules.

A full browser visual test is still recommended before deploying.
