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
allRows, options)`** in `js/core/page-common.js`.

---

## Filter taxonomy

Filters in the BTD pages fall into four distinct categories. Only
**evidence-boundary** filters may be applied before canonical scoring.

### Category 1 — Evidence boundary (applied before `signals.js`)

These filters define which records constitute the evidence set for this show.
Changing them changes the score. `profileShowCanonical()` applies them via an
explicit whitelist; all others are forced to their neutral/off value.

| Filter | Neutral value | Role |
|---|---|---|
| `tier` | `''` (all tiers) | Broadway League market tier (Primary / Secondary) |
| `sub` | `''` (all records) | Subscription vs non-subscription records |
| `dateFrom` | `undefined` | Earliest `week_of` date to include (ISO string) |
| `dateTo` | `undefined` | Latest `week_of` date to include (ISO string) |

**`dateTo` is required for past seasons.** Callers must pass
`options.dateTo = season.end` to prevent records published after the season
closed from leaking into retrospective scoring.

**`dateTo` for current and future seasons:** No upper boundary is applied. The
score reflects all evidence available as of the most recent data pull. This is
the intended "as-of" boundary: the latest imported XLSX report.

**`dateFrom` is intentionally absent from all current callers.** The evidence
model uses all prior touring history for a show — records from seasons before
the Bushnell booking window are legitimate evidence about how the show performs
nationally at peer venues. Restricting records to the Bushnell season window
would discard relevant prior data and reduce scoring reliability. No lower bound
is applied unless a caller has an explicit reason to exclude earlier history.

Callers may supply `options.tier` and `options.sub` explicitly to override
page globals — required for test harnesses, batch scoring, and any context
where page-global filter state is unavailable or incorrect.

### Category 2 — Display-only (never applied before `signals.js`)

These filters control which records are shown in tables and charts for context.
They do not change the score. `profileShowCanonical()` strips them to their
neutral value before passing records to `signals.js`.

| Filter | Neutral value | What it controls |
|---|---|---|
| `peer` | `''` | Which peer-type column is highlighted in tables/charts |
| `equity` | `''` | Equity/non-equity display toggle |
| `engage` | `''` | Engagement/dark display toggle |

**Critical:** Applying peer-type, equity, or engagement filters before scoring
silently changes the evidence set and produces a different score when the user
switches views. This is the exact error the canonical entry point prevents.

### Category 3 — Post-calculation analytical (applied after `signals.js`)

These filters narrow the displayed result set for exploration. They do not
change any score. Pages apply them after `profileShowCanonical()` returns.

| Filter | What it narrows |
|---|---|
| Gross range (`fGrossMin` / `fGrossMax`) | Records by weekly gross |
| Cap% range (`fCapMin` / `fCapMax`) | Records by paid capacity percentage |
| Performance count range (`fPerfMin` / `fPerfMax`) | Records by performances per week |

### Category 4 — Dashboard exploratory (Dashboard only, before aggregation)

These filters exist only in `dashboard.html` for record-level exploration.
They apply **before** Dashboard KPI aggregation and chart rendering — the KPI
strip, rankings, charts, and analytics tabs all reflect the filtered record set.

They are **outside the Planning Signal pipeline** because the Dashboard does not
compute or display a Planning Signal score. The distinction is not timing within
the Dashboard; it is that no Planning Signal depends on them.

| Filter | What it filters |
|---|---|
| Venue (`fVenue`) | Records at a specific theatre |
| City (`fCity`) | Records in a specific city |
| Show selection (checkbox list) | Visible show rows |
| Season / date intersection | Week-of boundaries (before KPI aggregation) |

---

## Score types

Three types of score may exist in the system. They answer different questions
and must be rendered differently.

### Baseline Planning Signal

Produced by `profileShowCanonical()` with `tier: ''` and `sub: ''` (the neutral
values — all records included, no evidence filter active). This is the default
display. The score reflects all available touring history up to the date boundary.

The baseline appears when the user has not set a tier or subscription filter.

### Context-filtered Planning Signal

Produced by `profileShowCanonical()` with `tier` or `sub` drawn from page-global
filter state. This is still a **canonical score** from the same entry point and
methodology — tier and subscription are authorized evidence-boundary filters.
However, the evidence set is narrowed, so the score may differ from the baseline.

**UI disclosure is required.** When a context-filtered score is displayed, the
evidence context must be visible (for example: a badge reading "Primary tier only"
or "Subscribers only"). Without disclosure, a context-filtered score is
indistinguishable from the baseline.

This disclosure requirement is a Phase 3 UI task. Until Phase 3 is complete,
pages should avoid displaying a context-filtered score in any context where the
active evidence boundary cannot be communicated to the reader.

### Scenario score

A score produced with any **non-standard** evidence boundary — one that is not
`tier`, `sub`, or `date` — is a scenario score. Scenario scores must be labeled
explicitly as such. Unlabeled scenario scores are prohibited.

Example: "What does the score look like using only Primary-tier venues?" — Using
`tier: 'Primary'` is a **context-filtered** score (tier is authorized), not a
scenario. It requires disclosure, not a scenario label. A scenario would be
something like scoring only venues within 50 miles of Hartford — not an
authorized evidence filter in this contract.

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
| Demand | `p.signals.demand` | Paid capacity at peer cohort venues + subscription lift differential |
| Revenue | `p.signals.revenue` | GG% of gross potential + avg admission, per peer cohort type |
| Peer Fit | `p.signals.peer` | Cross-cohort capacity, revenue efficiency, and sample breadth |
| Confidence | `p.signals.confidence` | Evidence depth: record volume, venue diversity, peer coverage, week span |

#### Demand inputs (4 total)

Demand is `avgNonNull()` of these four inputs:

| Input | Scaled range | Notes |
|---|---|---|
| Size-peer paid capacity | 50 % → 100 % | Null when no size-peer records |
| Proximity-peer paid capacity | 50 % → 100 % | Null when no proximity-peer records |
| Market-peer paid capacity | 50 % → 100 % | Null when no market-peer records |
| Subscription lift (`subCap − nonsubCap`) | −10 pp → +15 pp | Null when either sub or nonsub capacity is unavailable |

A cohort with no records contributes a `null` input. `avgNonNull()` excludes null
inputs, so the remaining cohorts still produce a valid Demand value. A show with
records in only one cohort type produces a valid Demand component from that cohort
alone.

#### Revenue inputs (3 per-type inputs, each averaging 2 metrics)

Revenue is `avgNonNull()` of one input per peer type:

| Per-type input | Metrics averaged (each optional) | Scaled ranges |
|---|---|---|
| Size-peer revenue | GG% of gross potential + avg admission | GG%: 55 % → 105 %; Adm: $45 → $140 |
| Proximity-peer revenue | GG% + avg admission | Same |
| Market-peer revenue | GG% + avg admission | Same |

A cohort with no records contributes a null per-type input, excluded from
`avgNonNull()`. A show with data in only one peer type still produces a Revenue
component.

#### Confidence inputs (4 total — no recency component)

Confidence is `avgNonNull()` of these four inputs, forced to `|| 0` so the result
is always a non-negative integer (never null):

| Input | Variable | Scaled range | Notes |
|---|---|---|---|
| Active record count | `rows.length` | 0 → 40 records | All matched records after evidence filters |
| Distinct venue count | `venueCount` | 0 → 20 venues | Unique theatre + city combinations |
| Combined peer-record count | `allPeers.length` | 0 → 18 records | Deduplicated union of all three cohort types |
| Distinct reporting-week count | `weekCount` | 0 → 30 weeks | Unique `week_of` values |

There is **no recency component.** Confidence measures breadth and volume of
evidence, not how recently it was reported.

Confidence label thresholds (from `confidenceLabel()` in `signals.js`):

| Label | Score range | Notes |
|---|---|---|
| `High` | ≥ 75 | |
| `Moderate` | 45–74 | |
| `Low` | 1–44 | |
| `Exploratory` | 0 or no evidence | Also returned when `rowCount = 0` and `score ≤ 0` |

#### Peer Fit inputs and the zero-record edge case

Peer Fit is `avgNonNull()` of three inputs:

| Input | Scaled range | Notes |
|---|---|---|
| Combined-peer paid capacity | 50 % → 100 % | Null when no peer records |
| Combined-peer GG% | 55 % → 105 % | Null when no peer records |
| Sample breadth (`allPeers.length`) | 0 → 24 records | **Always non-null** — evaluates to 0 when no peers |

The sample-breadth term is always a non-negative integer, so it is never excluded
by `avgNonNull()`. This creates two distinct low-evidence situations:

- **Zero peer records:** The capacity and GG% inputs are null; `avgNonNull([null, null, 0])` = 0. Peer Fit = 0 and is **not** excluded from the composite average.
- **One or more peer records:** Sample breadth contributes and capacity/GG% contribute when their underlying values are available.

Peer Fit is the only component that can reach exactly 0 without being null. The
composite score therefore does not exclude Peer Fit when evidence is thin — it
receives a zero contribution.

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

### Verification (`p.decomp`)

`p.decomp` duplicates already-rounded signal component values for debugging
purposes. These fields are **not** pre-rounding raw values — they are equal to
the corresponding `p.signals.*.value` fields. Do not derive scores from
`p.decomp`; use `p.signals.*` and `p.score` directly.

| Field | Value | Notes |
|---|---|---|
| `p.decomp.demand` | Equal to `p.signals.demand.value` | Already rounded integer |
| `p.decomp.revenue` | Equal to `p.signals.revenue.value` | Already rounded integer |
| `p.decomp.peer` | Equal to `p.signals.peer.value` | Already rounded integer |
| `p.decomp.confidence` | Equal to `p.signals.confidence.value` | Already rounded integer |
| `p.decomp.peerTypes` | String | Cohort types that contributed data (e.g. "size, proximity") |
| `p.decomp.canonical` | `true` | Internal sentinel; always `true` from `signals.js` |

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
