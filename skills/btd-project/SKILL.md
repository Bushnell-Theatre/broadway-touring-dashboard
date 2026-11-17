---
name: btd-project
description: Broadway Touring Dashboard (BTD) project conventions, architecture, and coding standards for The Bushnell Center for the Performing Arts. Use this skill for ANY task involving the BTD project files: dashboard.html, exec_summary.html, programming.html, index.html, utils.js, styles.css, charts.css, process_touring.py, watcher.py, or any file in src/data/. Also use when writing Claude Code prompts targeting BTD files, when working with BTD JSON data files (data.json, seasons.json, peers.json, factsheets.json, context.json, shows.json, awards.json), or when the user mentions Tom, Stephanie, Alex, Paciolan, Broadway League, or Bushnell Broadway.
---

# Broadway Touring Dashboard — Project Skill

## Read this before touching any BTD file.

This skill encodes hard-won project conventions. Skipping it causes regressions.

---

## Project Overview

The Broadway Touring Dashboard (BTD) is a data intelligence suite for The Bushnell Center for the Performing Arts in Hartford, CT. It benchmarks Bushnell's Broadway touring performance against national Broadway League data.

**Repo:** `C:\Users\rnunley\OneDrive - Bushnell Center for the Performing Arts\Documents\GitHub\broadway-touring-dashboard`
**Live URL:** `https://white-pebble-01710020f.7.azurestaticapps.net/`
**Hosting:** Azure Static Web Apps via GitHub Actions CI/CD

---

## The Golden Rule — One File, One Change

See [CLAUDE.md → The Golden Rule](../../CLAUDE.md#the-golden-rule--one-file-one-change) — canonical there, not restated here.

---

## Code Standards — Non-Negotiable

### No Minification
All source files must be **fully readable and expanded**. Prettier has been run across all source files. Do not minify, compress, or compact any output under any circumstances.

### Clear Documentation
Every function, every HTML section, every CSS block must have a clear comment explaining what it does. Use section divider comments throughout:

```javascript
/* ── SECTION NAME ── */
```

```html
<!-- ── Section Name ── -->
```

### No New Dependencies
Use only libraries already present. Do not add new CDN imports, npm packages, or external scripts without explicit instruction.

### CSS Variables Always
Use existing CSS custom properties (`var(--ink)`, `var(--teal)`, `var(--amber)`, etc.) — never hardcode colors or font families.

---

## File Roles — Know Before You Edit

| File | Role | Owner |
|---|---|---|
| `src/dashboard.html` | Primary Sales Intelligence Dashboard | Tom (programming) |
| `src/exec_summary.html` | Executive summary / retrospective | Stephanie (COO) |
| `src/programming.html` | Programming decision support | Tom |
| `src/index.html` | Development hub / landing page | All |
| `src/js/utils.js` | Shared JavaScript utilities (true globals — NOT an IIFE) | All dashboards |
| `src/js/core/*.js` | BTD namespace modules — 16 files, loaded in dependency order | All dashboards |
| *(removed)* | `src/js/pages/*.page.js` held page controllers nothing ever loaded. Deleted — **each page's inline `<script>` block is its controller** | — |
| `src/css/styles.css` | Shared base styles | All dashboards |
| `src/css/charts.css` | Shared chart styles | All dashboards |
| `scripts/process_touring.py` | Broadway League XLSX → data.json pipeline | IT (Randale) |
| `scripts/watcher.py` | File watcher for pipeline automation. Auto-deploys straight to `main` by pushing a plumbing-built commit by sha, never checking out a branch — the one exception to this project's manual `feat → dev → main` deploy policy. See [CLAUDE.md → Branch Policy](../../CLAUDE.md#branch-policy). | IT |

**Read `references/data-sources.md` for the canonical data file descriptions.**

---

## JavaScript Architecture

### Load order

```
utils.js                           ← true globals (fmt$, pct, avg, etc.)
                                      (planningSignal/SIGNAL_WEIGHTS were removed in
                                      Phase 4 — canonical scorer is BTD.signals.profileShow())
js/core/config.js                  → BTD.config
js/core/state.js                   → BTD.state
js/core/format.js                  → BTD.format
js/core/metrics.js                 → BTD.metrics
js/core/validation.js              → BTD.validation
js/core/peers.js                   → BTD.peers
js/core/filters.js                 → BTD.filters
js/core/data.js                    → BTD.data
js/core/signals.js                 → BTD.signals
js/core/context.js                 → BTD.context
js/core/seasons.js                 → BTD.seasons
js/core/tabs.js                    → BTD.tabs
Chart.js CDN                       ← must precede charts.js
js/core/charts.js                  → BTD.charts
js/core/components.js              → BTD.components
js/core/page-common.js             → BTD.page
js/core/dashboard-analytics.js    → BTD.dashboardAnalytics (dashboard.html only)
```

### Key invariants

- **utils.js is NOT an IIFE.** Its remaining functions (`fmt$`, `pct`, etc.) are true globals — no `BTD.` prefix needed. Scoring functions (`planningSignal`, `SIGNAL_WEIGHTS`) were removed in Phase 4; only a deprecation comment remains.
- **All core modules ARE IIFEs.** They expose via `BTD.X` namespace. Inline scripts check `if(window.BTD && BTD.X)` before using any BTD API.
- **There are no page-controller files — the inline `<script>` block in each `.html` file IS the controller.** `src/js/pages/*.page.js` was deleted; it was a stalled extraction that no page loaded and that had drifted out of sync with the live inline code. Edits made there looked right, reviewed fine and shipped nothing — commit `79c811e` is the proof. Change live page behaviour in the `.html` file.

---

## Data Flow

```
Broadway League weekly XLSX reports
    → scripts/process_touring.py
        → src/data/data.json  (single source of truth)
            → All HTML dashboards fetch this at boot
```

All dashboards also fetch:
- `src/data/seasons.json` — Bushnell's Broadway season show list
- `src/data/peers.json` — Peer venue definitions
- `src/data/context.json` — External enrichment (NOAA weather, FRED economic data)
- `src/data/factsheets.json` — Per-show contracted data from event fact sheets

`data.json` is always fetched from the live Azure URL first, with local fallback.

---

## Dashboard-Specific Notes

### dashboard.html
- Has `toggleSidebar()`, sidebar toggle button, and sidebar backdrop — all four pages share this pattern
- Has Chart.js and XLSX loaded via CDN
- Is the only page that loads `js/core/dashboard-analytics.js`

### exec_summary.html
- The V2 Responsive Scale System breakpoints are in `src/css/styles.css` (unscoped, applies to all pages) — do not add them back inline

### All pages
- Masthead nav links must include all pages except the current one
- All four pages have identical `toggleSidebar()` / `.sidebar-toggle` / `.sidebar-backdrop` — do not diverge this pattern
- Canonical breakpoints are in `src/css/styles.css` and enforced in `CLAUDE.md` — 11 blocks from 768px through 6000px. No new breakpoint values without checking the canonical set first.
- KPI strip collapses to 2 columns at 600px
- CSS load order: Google Fonts → `css/styles.css` → `css/charts.css` → inline `<style>`

---

## Known Terminology Traps

| Term | What it means in BTD | What it does NOT mean |
|---|---|---|
| Tier | Broadway League Primary/Secondary market tier | Pricing tier A/B/C in fact sheets |
| Price Level | Fact sheet pricing tiers A/B/C (A=premium, B=mid, C=lowest) | Broadway League tier |
| `non_equity` | Independent boolean: non-equity tour | `no_engagement` (a separate boolean — a dark/closed week, not tour type) |
| GG | Gross Grosses (total revenue) | Anything else |
| GP | Gross Potential | |
| Cap % | GG ÷ GP × 100 — CAN exceed 100% | A simple fill rate |

---

## Documentation Alignment — Required on Every Change

Any change to a script, pipeline behavior, scoring formula, or data file schema must be reflected in the relevant documentation file before the work is considered done. Check each one that applies:

| Change type | Documents to update |
|---|---|
| Script behavior (watcher, pipeline, caching) | `docs/OPERATIONS.md` — Scripts Reference table and Troubleshooting |
| Scoring formula or Planning Signal methodology | `SCORING.md` |
| Data file schema (new/renamed field) | `skills/btd-project/references/data-sources.md` |
| How the system works at a high level | `docs/HOW_IT_WORKS.md` |
| AI pipeline (highlights, season review) | `docs/AI_PIPELINE_PLAN.md` (`docs/AI_HIGHLIGHT_PIPELINE.md` is superseded — don't update it) |

Do not commit a behavior change without updating the matching doc in the same branch. If you are unsure which doc applies, ask.

---

## What Requires Human Confirmation Before Proceeding

- Any change that affects more than one HTML file simultaneously
- Any change to `process_touring.py` or `watcher.py`
- Any new field added to `data.json` schema
- Any rename of a CSS class used across multiple files

---

## Reference Files

For detailed reference on specific topics, read these files as needed:

- `references/data-sources.md` — All JSON file schemas and field descriptions
- `references/stakeholders.md` — Who uses what, what they care about

---

## Version Convention

Edit only `src/data/versions.json` to bump any version — never hardcode version strings in HTML. Full format/bump rules and the current version table: [CLAUDE.md → Versioning](../../CLAUDE.md#versioning) — canonical there. A version number was previously duplicated here and went stale (three of four numbers wrong) while CLAUDE.md's own table stayed current — that's exactly the failure mode cross-referencing instead of restating is meant to prevent.
