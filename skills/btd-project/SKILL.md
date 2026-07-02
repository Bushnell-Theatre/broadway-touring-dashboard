---
name: btd-project
description: Broadway Touring Dashboard (BTD) project conventions, architecture, and coding standards for The Bushnell Center for the Performing Arts. Use this skill for ANY task involving the BTD project files: dashboard.html, exec_summary.html, programming.html, box_office.html, index.html, utils.js, styles.css, charts.css, process_touring.py, watcher.py, or any file in src/data/. Also use when writing Claude Code prompts targeting BTD files, when working with BTD JSON data files (data.json, seasons.json, peers.json, venues.json, factsheets.json, context.json, shows.json, tonys.json), or when the user mentions Brandon, Tom, Stephanie, Alex, Paciolan, Broadway League, Bushnell Broadway, or the box office scenario model.
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

**Make one file change, deploy, verify, then move to the next.**

This rule was established after aggressive multi-file refactoring broke pages and required a full revert via Claude Code. Never batch changes across multiple HTML files into a single commit unless the task explicitly requires it (e.g. a shared CSS extraction).

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
| `src/box_office.html` | Box office scenario modeler | Brandon |
| `src/index.html` | Development hub / landing page | All |
| `src/js/utils.js` | Shared JavaScript utilities | All dashboards |
| `src/styles.css` | Shared base styles | All dashboards |
| `src/charts.css` | Shared chart styles | All dashboards |
| `scripts/process_touring.py` | Broadway League XLSX → data.json pipeline | IT (Randale) |
| `scripts/watcher.py` | File watcher for pipeline automation | IT |

**Read `references/data-sources.md` for the canonical data file descriptions.**

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
- `src/data/venues.json` — Hall/section physical and sellable seat data
- `src/data/factsheets.json` — Per-show contracted data from event fact sheets

`data.json` is always fetched from the live Azure URL first, with local fallback.

---

## Dashboard-Specific Notes

### box_office.html
- Uses `venues.json` as the canonical source for hall/section/seat data — do NOT hardcode section arrays
- Uses `factsheets.json` for per-show contracted pricing, holds, and performance schedules
- Scenario model works per-performance, per-section — no global pricing grid
- Pre-sale mode vs Live mode is auto-detected based on whether any sold counts exist
- Revenue Signal ≠ Net Profit — this caveat must appear wherever revenue data is shown
- Face value always excludes $4.00 restoration fee (League-compliant reporting)
- See `references/box-office-model.md` for the full calculation spec

### dashboard.html
- Has a working `toggleSidebar()` — do not change it; port to other pages instead
- Breakpoints: 1200px / 900px / 600px — do not add new ones without aligning other pages
- Has Chart.js and XLSX loaded via CDN

### All pages
- Masthead nav links must include all pages except the current one
- Sidebar collapse pattern must match dashboard.html's implementation
- Standard breakpoints: 1200px / 900px / 600px / 480px
- KPI strip collapses to 2 columns at 600px

---

## Known Terminology Traps

| Term | What it means in BTD | What it does NOT mean |
|---|---|---|
| Tier | Broadway League Primary/Secondary market tier | Pricing tier A/B/C in fact sheets |
| Price Level | Fact sheet pricing tiers A/B/C (A=premium, B=mid, C=lowest) | Broadway League tier |
| n/e | Non-equity tour type | "No engagement" |
| GG | Gross Grosses (total revenue) | Anything else |
| GP | Gross Potential | |
| Cap % | GG ÷ GP × 100 — CAN exceed 100% | A simple fill rate |
| Contract Gross Potential | All sellable seats × contracted price at full sell-through | Current collected revenue |
| Current Gross | Actual captured revenue from sold tickets | Contract potential |
| Adjusted Gross | Projected gross using Brandon's modified prices | |

---

## What Requires Human Confirmation Before Proceeding

- Any change that affects more than one HTML file simultaneously
- Any change to `process_touring.py` or `watcher.py`
- Any new field added to `data.json` schema
- Any rename of a CSS class used across multiple files
- Any change to `venues.json` section names or seat counts
- Physical seat maximum caps (not yet confirmed — do not enforce in code)

---

## Reference Files

For detailed reference on specific topics, read these files as needed:

- `references/data-sources.md` — All JSON file schemas and field descriptions
- `references/box-office-model.md` — Box office calculation spec, mode detection, holds logic
- `references/stakeholders.md` — Who uses what, what they care about

---

## Version Convention

- box_office.html: v2.x (major version = structural redesign)
- dashboard.html: v5.x
- exec_summary.html: v5.x
- programming.html: v5.x
- Minor version bump (x.0 → x.1) for additive changes
- Major version bump for structural rewrites
