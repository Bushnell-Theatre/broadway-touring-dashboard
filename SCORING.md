# Planning Signal — Methodology Reference

**Version:** 2026-08
**Source:** `src/js/core/signals.js` → `score()` function
**Purpose:** Auditable reference for the current Planning Signal implementation.
This document supersedes the previous `SCORING.md` (version 2026-06), which described
an additive base-50 formula that is no longer in use.

**Status:** This dashboard is in active development. Formulas, weights, and thresholds
may change as the team validates the model against real booking outcomes.

---

## What the Score Represents

The **Planning Signal** is a 0–100 composite index reflecting how a Broadway touring
production performs in venues and markets comparable to the Bushnell — not the national
touring average. It is a planning discussion tool, not a box-office forecast.

- **Above season median** — Well-supported by peer cohort evidence across demand,
  revenue, and data depth dimensions.
- **Below season median** — Warrants closer review; may indicate demand risk, thin data,
  or a show that skews toward larger markets.
- **`—` (no score)** — No matching Broadway League records exist. Score is withheld
  entirely; displaying a fabricated number would imply evidence that isn't there.

Thresholds are **relative to the season median**, not fixed percentages. A show above
median is stronger given the actual touring market for that season.

---

## The Three Peer Cohorts

Every show is evaluated against venues in up to three groups:

| Cohort | Definition |
|---|---|
| **Size** | Venues within ±10% of Bushnell's sellable capacity (2,450–2,994 seats) |
| **Proximity** | Northeast / New England markets — Hartford's booking circuit |
| **Market** | Nonprofit PACs anchoring mid-size metro markets (600K–2.5M population) with subscription programming |

A venue may belong to multiple cohorts. Each cohort that has data for a show
contributes equally to the Demand and Revenue scores.

---

## The Four Score Components

### 1. Demand Signal (40% weight)

**What it measures:** How full are the seats at venues like ours?

Paid capacity % is computed separately for each cohort type that has records for the show.
The three results are averaged equally (`avgNonNull` — cohort types with no data are excluded,
so remaining types carry equal weight automatically). Subscription lift is also applied:
the gap between subscription-week and non-subscription-week capacity, weighted at 0.08.

```
demandScore = avgNonNull([sizeCap, proximityCap, marketCap]) + subscriptionLift
```

### 2. Revenue Signal (25% weight)

**What it measures:** Does demand convert to money at comparable venues?

GG% of gross potential and average paid admission, computed per cohort and averaged equally
across the types that have records.

```
revenueScore = avgNonNull([sizeGG, proximityGG, marketGG],
                           [sizeAdm, proximityAdm, marketAdm])
```

### 3. Peer Fit Signal (25% weight)

**What it measures:** Where does this show rank within the combined peer pool?

Percentile rank of the show's capacity within the combined peer dataset (all three cohort
types merged). A show at the 80th percentile of peer venues scores 80 on this component.

```
peerScore = percentile(showCap, allPeerCaps) × 100
```

### 4. Confidence Signal (10% weight)

**What it measures:** How much evidence backs this up?

Derived from weeks of data, distinct venue count, and recency. A show with 34 peer records
scores much higher here than one with 4. Low confidence is uncertainty — not a negative
signal about the title.

---

## Composite Formula

```
Planning Signal = weightedAverage(
  Demand   × 0.40,
  Revenue  × 0.25,
  Peer Fit × 0.25,
  Confidence × 0.10
)
```

Clamped to [0, 100], rounded to nearest integer.

**Cohort types with no data for a show are excluded from their component averages.**
A show with only size-cohort data still gets a Demand score — it's just based on size peers
alone. The other cohort types are not filled with zeros.

---

## Special Cases

### Future New Tours — Score withheld (`null`)

If a show has no matching records in `data.json` and is identified as a future new tour,
all four component scores are set to `null` and the composite is `null`. The UI displays
`—` in score cells and labels confidence as *Exploratory*.

**Rationale:** No touring evidence exists. Displaying a number — even a modest one —
implies evidence that isn't there. A `—` is honest; a fabricated midpoint is not.

### Zero Records, Not a New Tour — Score = 0

A show in a past season that produced no feed match gets a score of 0 with confidence
labeled *None*. This is rare and typically indicates a match failure.

---

## Confidence Levels

| Label | Condition |
|---|---|
| **High** | ≥ 12 matched records across ≥ 6 distinct venues |
| **Medium** | 5–11 matched records |
| **Low** | 1–4 matched records |
| **Exploratory** | Future new tour — no records |
| **None** | Zero records, not a new tour |

---

## What the Score Does Not Include

- Deal terms, guarantees, or split structures
- Local Bushnell expenses, labor, or marketing costs
- Bushnell audience history (subscription response, group sales, patron feedback)
- Routing, availability, or technical requirements
- Artistic priority, mission fit, or donor value
- Competing local events or calendar factors

**Revenue Signal is not Net Profit.** The score reflects revenue quality in peer markets,
not the economics of a specific Bushnell engagement.

---

## Data Sources

| Field | Source |
|---|---|
| `cap_paid`, `gg_pct_gp`, `avg_adm`, `gross_gross` | Broadway League weekly reports (`data.json`) |
| `on_sub` | Broadway League subscription flag |
| Show metadata (`sub`, `open`, `close`) | Bushnell season programming (`seasons.json`) |
| Peer venue classifications | `peers.json` — curated list with `peer_types[]` per venue |
| Peer metadata at runtime | `window.PEER_META` (hydrated by `page-common.js` from `peers.json`) |

---

## Change Log

| Date | Change |
|---|---|
| 2026-08 | Rewrote to reflect peer-cohort formula; removed old base-50 additive formula; changed new-tour default from 65 to null |
| 2026-06 | Added score decomposition display; added subscriber lift; documented additive formula |
| 2026-05 | Initial fit score formula deployed |
