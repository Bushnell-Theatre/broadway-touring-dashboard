# Phase 3 — Shared Page Common Layer

## Goal

Reduce duplicated page-local helper logic after Phase 2 established `BTD.signals.profileShow()` as the canonical planning model.

This phase intentionally preserves the existing HTML structure and CSS. It does not redesign the pages. It centralizes reusable helper behavior so future page cleanup can remove duplicate inline functions without changing the visual presentation.

## Added

- `src/js/core/page-common.js`

This module exposes `BTD.page` as a shared page-helper layer for common user-facing behavior.

## Shared helpers now available

`BTD.page` includes reusable helpers for:

- season/date display
- season mode classification
- score badge rendering
- planning signal labels
- signal badges and signal rows
- confidence labels/text
- “why this read?” rendering
- show row matching
- shared standard filter application
- canonical show profile generation
- context badge/tooltip wrappers
- reusable rank-list rendering
- string normalization and truncation

## Page wiring updates

The following pages now load `js/core/page-common.js`:

- `programming.html`
- `exec_summary.html`
- `dashboard.html`

The Programming and Executive Summary pages now delegate more duplicate helper behavior to `BTD.page`, including:

- signal label extraction
- signal badge rendering
- signal row rendering
- score badge rendering
- confidence label handling
- why-this-read rendering
- median calculation through `BTD.metrics`
- short label truncation through `BTD.page.short`

## State sync update

Filter setter functions now mirror page-local filter state into `BTD.state.active`.

This keeps older page code working while allowing shared helpers to read the same active filter state.

## Peer utility update

`BTD.peers.isBushnell(record)` was added as a shared utility and is now used by shared peer comparison logic.

## Validation

Validated with:

```bash
node --check src/js/core/*.js
node --check /tmp/btd_inline/programming.js
node --check /tmp/btd_inline/exec_summary.js
node --check /tmp/btd_inline/dashboard.js
node scripts/compare_signals.js 2025-2026
```

## Still intentionally deferred

The large inline render functions still remain in the pages. That is intentional for this phase.

Recommended next cleanup:

1. Move repeated chart wrappers to `BTD.charts` completely.
2. Move repeated KPI/card/table fragments to `BTD.components`.
3. Move `programming.html` and `exec_summary.html` page controllers into `src/js/pages/`.
4. Leave `dashboard.html` for last because it has the most operational/raw-data behavior.

## Governance rule reinforced

Pages may render differently for different audiences, but shared concepts must use shared helpers and shared analytical profiles.
