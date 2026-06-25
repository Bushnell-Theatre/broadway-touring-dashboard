# Phase 2 — Canonical Planning Signals

This update makes `BTD.signals.profileShow()` the canonical title-evaluation contract used by the Programming and Executive Summary pages.

## What changed

- Expanded `src/js/core/signals.js` into the shared source of truth for:
  - Demand Signal
  - Revenue Signal
  - Peer Signal
  - Confidence Signal
  - Planning Read
  - `why this read` explanation drivers
- Rewired `programming.html` `showProfile()` to consume `BTD.signals.profileShow()`.
- Rewired `exec_summary.html` `profile()` to consume `BTD.signals.profileShow()`.
- Replaced duplicated page-local planning signal calculations with wrappers over `BTD.signals.signalLabels()`.
- Preserved existing CSS classes and markup patterns to avoid styling changes.
- Added `scripts/compare_signals.js` as a non-visual regression check.

## Test command

```bash
node scripts/compare_signals.js 2025-2026
node scripts/compare_signals.js 2026-2027
```

## Rule going forward

Pages may render profiles differently, but they should not compute Demand, Revenue, Peer, Confidence, or Planning Read independently.
