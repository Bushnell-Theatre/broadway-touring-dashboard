# Wire It In — Connectivity Audit Report

**Audited:** 2026-07-08  
**Auditor:** Claude Code (session 14e77bfc)  
**Status:** Audit complete — ready for remediation

---

## Scope

All files in `src/` that are part of the four main dashboard pages:

- `src/dashboard.html`
- `src/programming.html`
- `src/exec_summary.html`
- `src/box_office.html`
- `src/css/styles.css`
- `src/css/charts.css`
- `src/js/utils.js`
- `src/js/core/*.js` (16 modules)
- `src/js/pages/*.page.js` (3 page controllers)

`src/index.html` (dev hub) is self-contained and OUT OF SCOPE.  
Python scripts in `scripts/` are OUT OF SCOPE.

---

## Gap 1 — Shared CSS Not Linked

**Severity: High**

`src/css/styles.css` and `src/css/charts.css` exist and define shared component styles and chart container styles, but **no HTML page links either file**.

All CSS is currently duplicated inline per page via `<style>` blocks.

| Page | styles.css linked | charts.css linked |
|---|---|---|
| dashboard.html | ❌ | ❌ |
| programming.html | ❌ | ❌ |
| exec_summary.html | ❌ | ❌ |
| box_office.html | ❌ | ❌ |

**Fix:** Add `<link rel="stylesheet" href="css/styles.css" />` and `<link rel="stylesheet" href="css/charts.css" />` to each page's `<head>`, immediately after the Google Fonts `<link>` and before any `<script>` tags.

Inline `<style>` blocks remain in place. They load after the linked CSS and can override shared rules per the cascade — this is the intended pattern.

---

## Gap 2 — Core JS Modules Not Loaded

**Severity: High**

All 16 files in `src/js/core/` define the `BTD.*` namespace used by the dashboard pages. None are loaded by any HTML page.

The inline scripts in each page defensively check for `BTD.*` before using any core API (e.g. `if(window.BTD && BTD.signals)`). This means the pages currently fall back to local implementations. Adding the `<script src>` tags activates the canonical BTD implementations without breaking existing fallback logic.

**Modules and dependency load order:**

1. `js/core/config.js` → BTD.config (data URLs, defaults)
2. `js/core/state.js` → BTD.state (all, filtered, seasons, peerMeta, etc.)
3. `js/core/format.js` → BTD.format (currency, percent, date, week)
4. `js/core/metrics.js` → BTD.metrics (sum, avg, median, percentileRank, etc.)
5. `js/core/validation.js` → BTD.validation (emptyReport, summarize, status)
6. `js/core/peers.js` → BTD.peers (isPeerType, summarize, compareToBushnell)
7. `js/core/filters.js` → BTD.filters (apply, set, reset, getActiveCount)
8. `js/core/data.js` → BTD.data (tryFetch, loadCore, loadShows, normalize*)
9. `js/core/signals.js` → BTD.signals (profileShow, profileSeason, signalLabels)
10. `js/core/context.js` → BTD.context (forWeek, forDate, badge, summaryForRows)
11. `js/core/seasons.js` → BTD.seasons (all, getActive, getById, renderPills)
12. `js/core/tabs.js` → BTD.tabs (init, show)
13. *(Chart.js CDN must be loaded before charts.js)*
14. `js/core/charts.js` → BTD.charts (renderBar, renderMultiBar, renderSignalChart, etc.)
15. `js/core/components.js` → BTD.components (kpiCard, signalBadge, decisionCard, etc.)
16. `js/core/page-common.js` → BTD.page (hydrateCoreState, renderDashboardSeasonPills, etc.)
17. `js/core/dashboard-analytics.js` → BTD.dashboardAnalytics (dashboard.html only)

**Per-page chart.js dependency note:**

`box_office.html` does not load Chart.js CDN. The SKILL.md constraint says "No New Dependencies." Chart.js is already present in the project (3 other pages use it), but adding it to box_office.html is additive. Therefore `js/core/charts.js` is **omitted from box_office.html** in this pass. `js/core/components.js` and `js/core/page-common.js` are safe to load without charts.js because neither calls `new Chart()` at module initialization time.

---

## Gap 3 — Page Controllers Not Wired

**Severity: Deferred**

Three extracted page controllers exist but are NOT loaded by any page:

- `src/js/pages/dashboard.page.js`
- `src/js/pages/programming.page.js`
- `src/js/pages/exec-summary.page.js`

**exec-summary.page.js is CRITICALLY out of sync:** It predates the Part 3 Planning Signal redesign (commit `695eb6c`). It still uses the old `profile()` / `fitScore()` / `decomp` pattern instead of `planningSignal()`. Wiring it in would silently revert Part 3.

**Decision: Do NOT wire any `pages/*.page.js` files in this pass.** The inline scripts in each HTML page are the authoritative implementation. Page controllers must be re-synced with current HTML before they can be loaded.

---

## Gap 4 — Sidebar Toggle Missing from programming.html and exec_summary.html

**Severity: Medium**

`dashboard.html` has a complete sidebar toggle implementation:
- CSS: `.sidebar-toggle` button styles and `.sidebar-backdrop` overlay
- HTML: `<button class="sidebar-toggle">` in the masthead + `<div class="sidebar-backdrop">` before `.workspace`
- JS: `toggleSidebar()` function

`programming.html` and `exec_summary.html` both have a `.sidebar` column but have **no toggle button, no backdrop, and no `toggleSidebar()` function**.

**Fix:** Port dashboard.html's sidebar toggle pattern verbatim to both pages.

---

## Gap 5 — Large-Screen Breakpoints Missing from styles.css

**Severity: Low**

`styles.css` has max-width breakpoints (1920/1400/1024/768px) but **no min-width breakpoints** for ultra-wide, 4K, or 8K displays.

`exec_summary.html` has a full V2 Responsive Scale System (lines 1094–1781) with min-width breakpoints for 1440/2560/3840/6000px. This system is exec_summary-specific — it defines many additional CSS custom properties (`--mast-pad-x`, `--sidebar-w`, `--panel-pad-y`, `--panel-pad-x`, `--grid-gap`, `--card-pad`, `--kpi-min`, etc.) that do not exist in styles.css.

**Fix:** Add simple min-width breakpoints to styles.css for the tokens it already defines (`--kpi-value`, `--base-font`, `--chart-h`, `--small-chart-h`). The V2 system in exec_summary.html remains in place as exec_summary-specific tuning.

The 1700px breakpoint from exec_summary.html's `@media (min-width: 1700px)` block is included for completeness.

---

## Gap 6 — utils.js "DRAFT" Status Comment is Stale

**Severity: Documentation only**

`src/js/utils.js` line 10 has a `STATUS: DRAFT` comment. This is misleading — utils.js IS loaded by all four pages and all its functions ARE working globals. `planningSignal()` in particular is a top-level `function` declaration (not inside any IIFE) and is accessible from all inline scripts.

**Fix:** No code change required for this pass. The comment should be updated when utils.js next receives a content change.

---

## Gap 7 — narratives.json Does Not Exist

**Severity: Low (data gap)**

`src/data/narratives.json` does not exist. No current inline script or core module fetches it. Not a blocking issue for this pass.

---

## Remediation Plan

Commits in order (one file per commit per the one-file-one-change rule):

| # | File | Change | Commit message |
|---|---|---|---|
| 1 | `src/css/styles.css` | Add large-screen min-width breakpoints | `fix(styles): add large-screen min-width breakpoints` |
| 2 | `src/dashboard.html` | Add CSS links + core JS script tags | `fix(dashboard): link shared CSS and load core JS modules` |
| 3 | `src/programming.html` | Add CSS links + core JS + sidebar toggle | `fix(programming): link shared CSS, load core JS, add sidebar toggle` |
| 4 | `src/exec_summary.html` | Add CSS links + core JS + sidebar toggle | `fix(exec_summary): link shared CSS, load core JS, add sidebar toggle` |
| 5 | `src/box_office.html` | Add CSS links + core JS (no charts.js) | `fix(box_office): link shared CSS and load core JS modules` |

---

## What Is NOT Changed in This Pass

- `src/js/pages/*.page.js` — out of sync; must be re-synced separately
- `src/index.html` — self-contained; no shared CSS/JS needed
- `scripts/*.py` — out of scope
- exec_summary.html V2 Responsive Scale System — exec_summary-specific; stays inline
- narratives.json — data file; separate task
