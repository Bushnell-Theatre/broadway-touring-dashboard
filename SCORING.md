# Fit Score — Methodology Reference

**Version:** 2026-06  
**Source:** `src/exec_summary.html` → `profile()` function  
**Purpose:** Auditable reference for analysts, leadership, and future developers. This document is the authoritative description of how the Fit Score is calculated.

---

## What the Score Represents

The **Fit Score** is a 0–100 index that estimates how well a Broadway touring production is likely to perform at the Bushnell relative to Bushnell's historical norms. It is not a box-office forecast — it is a relative positioning tool for season planning and peer benchmarking.

- **≥ 70** — Strong fit. Consistent peer-market demand and favorable Bushnell comparables.
- **55–69** — Moderate fit. Adequate evidence with some uncertainty.
- **< 55** — Weak fit or thin evidence. Use with caution.

In past-season view the score is labeled **Result Index** — the same formula applied retrospectively to describe how the show actually performed relative to market norms.

---

## Formula

```
Score = 50  (base)
      + Cap Component
      + GG% Component
      + Peer Component
      + Depth Adjustment
      + Subscriber Lift
```

All components are added to the base, then the total is clamped to **[0, 100]** and rounded to the nearest integer.

---

## Components

### 1. Base — 50 points

Every show with usable tour data starts at 50. This reflects a neutral position: neither an outperformer nor underperformer relative to market.

---

### 2. Capacity Component — Cap Component

**Input field:** `cap_paid` (paid capacity %, Broadway League weekly report)  
**Peer benchmark:** 70% paid capacity (Bushnell historical median)

```
Cap Component = (avg_cap_paid − 70) × 0.45
```

| avg_cap_paid | Component |
|---|---|
| 90% | +9.0 |
| 75% | +2.25 |
| 70% | 0 |
| 60% | −4.5 |
| 50% | −9.0 |

**Why 70%:** Bushnell's long-run median paid capacity across reported touring weeks. Shows at or above this mark are tracking at or above Bushnell's norm.  
**Why 0.45:** Calibrated so a strong sellout week (~90%) adds roughly +9 points — meaningful but not dominant.

---

### 3. GG% Component — Gross-to-Potential Ratio

**Input field:** `gg_pct_gp` (gross gross as % of gross potential)  
**Peer benchmark:** 75%

```
GG% Component = (avg_gg_pct_gp − 75) × 0.22
```

| avg_gg_pct_gp | Component |
|---|---|
| 100% | +5.5 |
| 85% | +2.2 |
| 75% | 0 |
| 60% | −3.3 |

**Why 75%:** Industry-standard touring GG% median across the peer dataset.  
**Why 0.22:** Lower weight than capacity — gross potential figures vary by venue pricing structure and can exceed 100% in dynamic-pricing weeks, making raw GG% a noisier signal.

---

### 4. Peer Capacity Component

**Input field:** `cap_paid` filtered to **peer venues only** (size, size_extended, proximity, market — excluding `reference_only`)  
**Peer benchmark:** 70%

```
Peer Component = (avg_peer_cap_paid − 70) × 0.22
```

This isolates how the show performs specifically at venues comparable to the Bushnell, as opposed to the full touring market. A show may perform poorly nationally but strongly in peer markets — or vice versa.

**Weight equals GG% component (0.22):** Both are corroborating signals; neither should override raw capacity.

---

### 5. Depth Adjustment

Scores derived from thin data are unreliable. The depth adjustment penalizes light evidence and rewards broad evidence.

| Condition | Adjustment |
|---|---|
| 8 or more matched records | **+8** |
| 3–7 matched records | 0 |
| Fewer than 3 matched records | **−15** |

**Why −15 for thin records:** A single week or two can be an outlier (opening week bump, holiday week, poor weather). A −15 penalty pushes thin-evidence shows below 50 unless other components are strongly positive, signaling to the user that the score requires manual validation.

---

### 6. Subscriber Lift (optional)

Applies only to shows where `sub: true` in `seasons.json` (i.e., included in the Bushnell subscription season).

**Input fields:** `cap_paid` for subscription weeks (`on_sub = true`) vs. non-subscription weeks (`on_sub = false`)

```
Sub Lift = (avg_sub_cap_paid − avg_non_sub_cap_paid) × 0.08
```

If subscriber audiences outperform single-ticket buyers for this show type, this adds a small positive. If single-ticket performance is stronger, it subtracts. The weight (0.08) is intentionally modest — subscriber behavior at Bushnell may differ from the broader market.

**Requires:** Both `subCap` and `nonSubCap` to be calculable from matched records. Omitted if insufficient split-data is available.

---

## Special Cases

### Future New Tours — Score = 65

If a show has no matching records in `data.json` AND is marked as a new tour in seasons.json (i.e., `isFutureNewTour = true`), the score is set to a fixed **65** rather than computed.

**Rationale:** No comparable touring data exists to score the show objectively. 65 is a modest positive — acknowledging that Broadway productions that reach the touring stage tend to be commercially viable, while flagging that the confidence level is exploratory. These shows display as **"NEW"** in score cells and are labeled *Exploratory* confidence.

### No Matching Records — Score = 50

If a show has zero matched records but is not flagged as a future new tour (e.g., a title in a past season that didn't match the feed), the score defaults to 50 (neutral base only) and confidence is labeled *None*.

---

## Confidence Levels

Displayed alongside each score in show detail cards.

| Label | Condition |
|---|---|
| **High** | ≥ 12 matched records across ≥ 6 distinct venues |
| **Medium** | 5–11 matched records |
| **Low** | 1–4 matched records |
| **Exploratory** | Future new tour (no data) |
| **None** | Zero matched records, not a new tour |

---

## Data Sources

| Field | Source |
|---|---|
| `cap_paid`, `cap_total`, `gross_gross`, `gross_potential`, `gg_pct_gp` | Broadway League weekly touring reports (via `data.json`) |
| `on_sub` | Broadway League report flag — indicates subscription promotion week |
| Show metadata (`sub`, `open`, `close`) | Bushnell season programming (`seasons.json`) |
| Peer venue classifications | `peers.json` — curated list with `peer_types[]` per venue |

---

## Limitations

- **Market ≠ Bushnell.** The score reflects how a show performs across peer touring markets. Local variables (subscription base composition, Hartford market events, competing programming) are not captured in the score itself but are visible in the Pre-Show Sales Window analysis.
- **Above-100 values are expected.** `cap_paid > 100` and `gg_pct_gp > 100` occur legitimately due to dynamic pricing, SRO sales, and comps. The scoring formula is not distorted by these — averages smooth outliers across multi-week samples.
- **Layoff / dark weeks are excluded.** Records where `no_engagement = true` are filtered out before any metric averaging.
- **Score is not a ticket sales forecast.** It is a relative positioning index for planning conversations, not a projected gross figure.

---

## Change Log

| Date | Change |
|---|---|
| 2026-06 | Added score decomposition display in show detail cards; added subscriber lift component; documented this file |
| 2026-05 | Initial fit score formula deployed |
