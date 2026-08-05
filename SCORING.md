# Planning Signal — Implemented Methodology

**Source of truth:** `src/js/core/signals.js`, especially `profileShow()`  
**Status:** In development  
**Purpose:** Describe what the current code calculates. This document is descriptive, not a separate model specification.

---

## What the Planning Signal is

The Planning Signal is a 0–100 directional index built from Broadway League touring evidence at venues and markets selected as relevant to the Bushnell.

It is intended to support a planning conversation. It is not:

- a Bushnell sales or profit forecast
- a booking recommendation
- a measure of artistic value
- a substitute for deal terms, routing, local history, or judgment

A higher score means the implemented component calculations found stronger peer-market evidence and/or deeper supporting data. It does not mean the show will achieve that percentage of any business result.

---

## Record matching and exclusions

The model first matches touring records to a show using normalized names and aliases. Records without performance data are excluded from the active scoring rows.

National metrics are calculated and displayed as reference context, but the composite score is built from curated peer cohorts.

---

## Peer cohorts

A matched record can belong to one or more peer cohorts defined in `src/data/peers.json` and hydrated at runtime:

| Cohort | Intended meaning |
|---|---|
| Size | Venues with capacity comparable to Bushnell |
| Proximity | Northeast/New England markets relevant to Hartford's routing context |
| Market | Comparable nonprofit PAC and mid-size market context |

The model evaluates each cohort separately where described below. A deduplicated union of all peer records is also used for the Peer and Confidence components. If a record belongs to multiple cohorts, it can contribute to each cohort-specific calculation but appears once in the combined pool.

Missing cohorts are excluded rather than filled with zero.

---

## Scaling function

Most source metrics are converted to a 0–100 value using a fixed linear range:

```text
scaled(value, low, high) = clamp((value - low) / (high - low) * 100, 0, 100)
```

These are fixed implementation ranges, not season-relative percentiles.

| Input | Low | High |
|---|---:|---:|
| Paid capacity | 50 | 100 |
| Subscription capacity difference | -10 | 15 |
| GG% of gross potential | 55 | 105 |
| Average paid admission | 45 | 140 |
| Overall records | 0 | 40 |
| Distinct venues | 0 | 20 |
| Combined peer records for Confidence | 0 | 18 |
| Distinct reporting weeks | 0 | 30 |
| Combined peer records for Peer breadth | 0 | 24 |

Values below the low point clamp to 0; values above the high point clamp to 100.

---

## Components

### Demand

For each available peer cohort, average paid capacity is scaled from 50–100%. When both subscription and non-subscription records exist, their capacity difference is scaled from -10 to +15 points.

```text
Demand = averageAvailable(
  scaled(size peer capacity, 50, 100),
  scaled(proximity peer capacity, 50, 100),
  scaled(market peer capacity, 50, 100),
  scaled(subscription capacity - non-subscription capacity, -10, 15)
)
```

Important: subscription lift is currently an equal fourth input when available. It is not an 8% adjustment.

### Revenue

Within each peer cohort, GG% of gross potential and average paid admission are scaled and averaged. The available cohort results are then averaged equally.

```text
cohort revenue = averageAvailable(
  scaled(cohort GG%GP, 55, 105),
  scaled(cohort average admission, 45, 140)
)

Revenue = averageAvailable(
  size cohort revenue,
  proximity cohort revenue,
  market cohort revenue
)
```

Revenue quality is not net profit.

### Peer

The Peer component measures combined peer-pool performance and evidence breadth:

```text
Peer = averageAvailable(
  scaled(combined peer paid capacity, 50, 100),
  scaled(combined peer GG%GP, 55, 105),
  scaled(combined peer record count, 0, 24)
)
```

This is not a percentile rank. It combines two performance measures with sample breadth.

### Confidence

```text
Confidence = averageAvailable(
  scaled(active record count, 0, 40),
  scaled(distinct venue count, 0, 20),
  scaled(combined peer record count, 0, 18),
  scaled(distinct reporting week count, 0, 30)
)
```

Confidence does not currently include a recency calculation.

The displayed confidence label is based on this score:

| Score | Label |
|---:|---|
| 75 or higher | High |
| 45–74 | Moderate |
| 1–44 | Low |
| 0 or no evidence | Exploratory |

---

## Composite

The current implementation uses an equal, null-aware average:

```text
Planning Signal = round(averageAvailable(
  Demand,
  Revenue,
  Peer,
  Confidence
))
```

When all four components are present, each contributes 25%. The code does **not** currently implement Demand 40%, Revenue 25%, Peer 25%, and Confidence 10%.

The fixed component scaling described above creates the numeric score. Some pages also compare scores with the median score of the selected season for display, ranking, or narrative purposes. That season median does not rescale or redefine the underlying score.

---

## Planning Read

The text read is determined separately from the composite:

| Implemented condition | Read |
|---|---|
| Demand ≥ 75, Revenue ≥ 70, Confidence ≥ 45 | Strong Candidate |
| Demand ≥ 75 and Revenue < 60 | Mixed: Demand Ahead of Revenue |
| Revenue ≥ 75 and Demand < 60 | Upside: Revenue Ahead of Demand |
| Demand ≥ 60 or Revenue ≥ 60 | Discuss |
| Otherwise, with matched records | Watch |
| No matched records | Exploratory |

The read is therefore not a direct label for score bands, and it is not season-relative.

---

## New tours and zero-record cases

A future new tour with no matched performance records receives:

- null Demand, Revenue, and Peer components
- Confidence value 0 with an Exploratory label
- null composite
- `—` in numeric score displays

A zero-record show not identified as a future new tour receives a composite of 0. This usually warrants checking title matching or season metadata rather than interpreting it as measured weak performance.

---

## Inputs not included

- Bushnell deal terms, guarantees, or splits
- Local expenses, labor, marketing costs, or ancillary revenue
- Bushnell subscription response or patron history
- Routing, availability, or technical requirements
- Artistic priority, mission fit, or donor value
- Local calendar conflicts
- A time-decay or recency factor

Awards, media, audience-fit, and local-market metadata may appear as contextual signals and explanatory text. They do not enter the current Planning Signal composite.

---

## Change record

| Date | Change |
|---|---|
| 2026-08-05 | Reconciled documentation to the implemented peer-cohort model: equal composite averaging, fixed scaling ranges, equal subscription input, non-percentile Peer component, and no recency input |
| 2026-08 | Changed future new-tour scores from a fabricated midpoint to null and expanded peer-cohort scoring |
| 2026-06 | Added score decomposition and subscription context |
| 2026-05 | Initial Fit Score implementation |
