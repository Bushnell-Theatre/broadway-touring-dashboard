# BTD Scoring Contract

**Version:** 1.0 — 2026-08-05  
**Status:** Active  
**Authority:** This contract governs all Planning Signal UI in the Broadway Touring Dashboard.

---

## Purpose

This document defines the exact fields that Scoring and Planning Signal UI may
consume from a show profile produced by `BTD.signals.profileShow()`. It exists
to prevent the recurrence of multiple competing scoring models producing
inconsistent results across pages.

The contract was written after a review identified three independent scoring
algorithms running simultaneously in `programming.html` and `exec_summary.html`:
one in `utils.js` (percentile-based, 40/25/25/10 weighted), one in `signals.js`
(peer-cohort scaled, equal-weight), and one inline in each page (raw-metric
band sums). All three produced different Planning Reads for the same show.

---

## Authority rule

**Scoring and Planning Signal UI may consume only the scoring fields defined in
this contract.**

Pages may consume other profile fields — `p.show.title`, `p.show.open`,
`p.metrics.grossGross`, `p.records.subscription`, `p.awards`, and so on — for
non-scoring presentation.

**Pages may not invent component labels or Planning Reads.** The only permitted
derivation outside the contract fields is the Season Position badge, which may
be derived from `p.score` and the calculated season median when clearly
identified as a comparative label, not a component of the score itself.

---

## Canonical score source

**`BTD.signals.profileShow(show, records, options)`** in `js/core/signals.js`
is the sole scoring authority. No page may call `planningSignal()` from
`utils.js`. No page may compute demand, revenue, peer fit, or confidence scores
inline.

The shared entry point for page use is **`BTD.page.profileShowCanonical(show,
allRows, options)`** in `js/core/page-common.js`. It constructs an explicit
whitelist of permitted evidence filters before passing records to `signals.js`:

| Filter | Role | Included in evidence boundary |
|---|---|---|
| `tier` | Broadway League market tier | ✓ Yes |
| `sub` | Subscription vs non-subscription | ✓ Yes |
| `peer` | Peer-type display selector | ✗ No — display only |
| `equity` | Equity/non-equity display toggle | ✗ No — display only |
| `engage` | Engagement/dark display toggle | ✗ No — display only |

For past seasons, callers must also pass `options.dateTo = season.end` to
prevent records published after the season closed from leaking into
retrospective scoring. Current and future seasons pass no upper date boundary.

---

## Contract fields

### Score

| Field | Type | Notes |
|---|---|---|
| `p.score` | `integer 0–100` or `null` | `null` for new tours — never a fabricated zero |
| `p.isFutureNewTour` | `boolean` | When `true`: score is `null`, all components are Exploratory |

### Planning Read (fixed thresholds — not season-relative)

| Field | Type | Notes |
|---|---|---|
| `p.planning.read` | `string` | `Strong Candidate`, `Mixed: Demand Ahead of Revenue`, `Upside: Revenue Ahead of Demand`, `Discuss`, `Watch`, `Exploratory` |
| `p.planning.note` | `string` | One-sentence interpretation of the read |

The Planning Read is computed from fixed component thresholds inside `signals.js`.
It is **not** relative to the season slate. It answers: "What does the touring
evidence say about this title?" regardless of what else is on the season.

### Component signals

Each component follows the same shape:

```
p.signals.demand.value      — integer 0–100, or null
p.signals.demand.label      — "Strong" | "Moderate" | "Soft" | "Weak" | "Exploratory"
p.signals.demand.drivers    — string[] explaining what data contributed
```

| Component | Field | What it measures |
|---|---|---|
| Demand | `p.signals.demand` | Paid capacity at peer cohort venues + subscription lift |
| Revenue | `p.signals.revenue` | GG% of gross potential + avg admission at peer cohorts |
| Peer Fit | `p.signals.peer` | Cross-cohort consistency and evidence breadth |
| Confidence | `p.signals.confidence` | Active record count, distinct venue count, combined peer-record count, distinct reporting-week count |

**Cohort-input null handling:** Each component (Demand, Revenue) is computed
from up to three cohort inputs (size, proximity, market). A cohort with no
records for the show contributes a null input, which is excluded from the
`avgNonNull()` average. The remaining cohort inputs still produce a component
value — a missing cohort is excluded, not penalized.

**Peer Fit exception:** Peer Fit includes `scaled(allPeers.length, 0, 24)` as
one of its inputs. When no peer records exist, this term evaluates to `0`
rather than `null`. Peer Fit can therefore reach `0` rather than `null` when
evidence is absent; it is not excluded from the composite average in that case.

A show with records in only one cohort type still produces valid Demand and
Revenue components from that cohort.

### Reference metrics (national — not scored)

These fields are retained for reference display only. They are explicitly
excluded from the composite score. No score, badge, or qualitative label may
be derived from them.

| Field | Notes |
|---|---|
| `p.metrics.paidCapacity` | National avg paid cap% across all venues |
| `p.metrics.ggPctGp` | National avg GG% across all venues |
| `p.metrics.count` | Total matched records |
| `p.metrics.venueCount` | Unique venues in matched records |

### Peer reference metrics (scored)

| Field | Notes |
|---|---|
| `p.metrics.peerPaidCapacity` | Combined peer avg paid cap% (all three cohort types, deduplicated) |
| `p.metrics.peerGgPctGp` | Combined peer avg GG% |
| `p.metrics.peerCount` | Combined peer record count |

### Verification

| Field | Notes |
|---|---|
| `p.decomp.demand` | Demand component value — verification copy of `p.signals.demand.value` (already rounded) |
| `p.decomp.revenue` | Revenue component value — verification copy of `p.signals.revenue.value` (already rounded) |
| `p.decomp.peer` | Peer fit component value — verification copy of `p.signals.peer.value` (already rounded) |
| `p.decomp.confidence` | Confidence component value — verification copy of `p.signals.confidence.value` (already rounded) |
| `p.decomp.peerTypes` | String listing which cohort types contributed data |

---

## Presentation adapter

Use **`BTD.page.planningSignals(profile)`** for all signal label display.
Do not read `p.signals.*` directly for UI rendering — the adapter applies
consistent null-handling and fallbacks.

Its returned shape is part of this contract:

| Field | Type | Source |
|---|---|---|
| `.demand` | `string` | `p.signals.demand.label` |
| `.revenue` | `string` | `p.signals.revenue.label` |
| `.peer` | `string` | `p.signals.peer.label` |
| `.confidence` | `string` | `p.signals.confidence.label` |
| `.planningRead` | `string` | `p.planning.read` |
| `.interpretation` | `string` | `p.planning.note` |

---

## Season Position badge (permitted derivation)

Season Position is **not** a component of the Planning Signal. It is a
comparative presentation label derived after all profiles are scored:

```javascript
// Computed once after all season profiles are built
SCORE_MED = median(profiles.map(p => p.score).filter(s => s != null)) || 50;

// Applied per profile in UI rendering
var position = p.score >= SCORE_MED ? 'Above season median' : 'Below season median';
```

Season Position and Planning Read must be **visually distinct** in the UI —
they answer different questions and must never be conflated or displayed
interchangeably.

---

## What is prohibited

| Prohibited | Reason |
|---|---|
| Calling `planningSignal()` from `utils.js` | Deprecated percentile model — wrong methodology |
| Displaying `SIGNAL_WEIGHTS` values (40%, 25%, etc.) | Describes the deprecated model, not the current one |
| Computing demand/revenue/peer scores inline in page HTML | Creates a third divergent model |
| Converting `p.score` to "top X% among peer venues" | Score is a fixed-range index, not an empirical percentile rank |
| Using `p.metrics.paidCapacity` or `.ggPctGp` in a score or badge | National metrics are reference only |
| Applying the peer-type display filter before canonical scoring | Silently changes score when user switches peer view |

---

## Deprecation schedule

| Symbol | Location | Status | Remove when |
|---|---|---|---|
| `planningSignal()` | `js/utils.js` | Deprecated 2026-08-05 | Phase 5 contract tests pass |
| `SIGNAL_WEIGHTS` | `js/utils.js` | Deprecated 2026-08-05 | Phase 5 contract tests pass |
| Inline `planningSignals()` | `programming.html`, `exec_summary.html` | Removed in Phase 2 | — |

---

## Related documents

- `SCORING.md` — scoring model description and peer cohort definitions  
- `docs/HOW_IT_WORKS.md` — system architecture overview  
- `docs/CHARTS.md` — chart-by-chart descriptions (must match this contract)  
- `docs/DEVELOPER.md` — API reference (must match this contract)  
- `scripts/test_scoring_contract.js` — automated contract tests  
