# Box Office Scenario Model — Calculation Reference

## Core Business Rules

1. **Contracted sellable is the base** — editable per section, no hard ceiling until physical max is confirmed
2. **Face value excludes $4.00 restoration** — all gross calculations use face value only (League-compliant)
3. **Revenue Signal ≠ Net Profit** — always label this caveat wherever revenue figures appear
4. **Price Level A/B/C ≠ Broadway League Tier** — never confuse these two uses of "tier"
5. **Subscriber/group/comp sales fold into Sold** — no separate channel tracking in the scenario model
6. **Base price is what Brandon adjusts** — discounts (groups, early bird) derive as % of whatever base Brandon sets

---

## Four Gross Metrics

| Metric | Definition | Notes |
|---|---|---|
| **Contract Gross Potential** | All sellable seats (net of holds) × contracted price | Assumes full sell-through; Brandon's ceiling reference |
| **Current Gross** | Sold seats × contracted price | Actual revenue captured to date; $0 or "—" pre-sale |
| **Adjusted Gross** | Unsold × adjusted price + sold × contracted price | Brandon's pricing scenario projection |
| **Delta** | Adjusted Gross − Contract Gross Potential | Colored teal (positive) or rose (negative) |

---

## Mode Detection

Auto-detected — no toggle required.

```javascript
// Pre-sale mode: no sold counts entered anywhere in the run
// Live mode: any section in any performance has sold > 0
var isLive = _performances.some(function(p) {
  return p.sections.some(function(s) { return (s.sold || 0) > 0; });
});
```

**Pre-sale:** Sold column hidden; Current Gross shows "—"; model projects full sellable at contracted/adjusted prices
**Live:** Sold, Fill %, Captured Rev columns visible; Current Gross shows actual captured revenue

---

## Per-Section Calculation

```javascript
function calcPerfTotals(perf) {
  var contractPotential = 0, adjusted = 0, captured = 0;

  perf.sections.forEach(function(s) {
    var sold    = s.sold || 0;
    var unsold  = Math.max(0, s.totalSeats - s.holds - sold);
    var adjPrice = (s.adjustedPrice !== null && s.adjustedPrice !== undefined && s.adjustedPrice !== '')
      ? +s.adjustedPrice : s.currentPrice;

    contractPotential += (unsold + sold) * s.currentPrice;  // all seats at contracted price
    adjusted          += sold * s.currentPrice + unsold * adjPrice;  // sold locked, unsold at new price
    if (sold > 0) captured += sold * s.currentPrice;  // actual revenue only
  });

  return {
    contractPotential: contractPotential,
    captured: captured,
    adjusted: adjusted,
    delta: adjusted - contractPotential,
    isLive: captured > 0
  };
}
```

---

## Run Total Calculation

```javascript
function calcRunTotals() {
  var contractPotential = 0, captured = 0, adjusted = 0;
  _performances.forEach(function(p) {
    var t = calcPerfTotals(p);
    contractPotential += t.contractPotential;
    captured          += t.captured;
    adjusted          += t.adjusted;
  });
  return {
    contractPotential: contractPotential,
    captured: captured,
    adjusted: adjusted,
    delta: adjusted - contractPotential
  };
}
```

---

## Performance Data Model

```javascript
// Each performance is fully independent
{
  id: 'perf_' + idx + '_' + Date.now(),
  date: '2026-09-29',
  time: '7:30 PM',
  priceLevel: 'C',           // reference label — A=premium, B=mid, C=lowest
  factSheetHoldsTotal: 110,  // performance-level holds reference from fact sheet
  sections: [
    {
      name: 'Broadway Circle',
      totalSeats: 244,         // editable — contracted sellable is the default, not a ceiling
      holds: 0,                // per-section holds — Brandon enters manually (fact sheet holds are performance-level totals only)
      sold: 0,                 // manual entry now; Paciolan POS feed in future
      currentPrice: 135.00,   // face value excl. restoration
      adjustedPrice: null      // null = inherits currentPrice
    }
  ]
}
```

---

## Holds Logic

- `factsheets.json` holds (`house`, `presenter`, `troubleBO`, `troubleFOH`, `other`) are **performance-level totals only**
- They are NOT distributed across sections automatically — do not fabricate a per-section distribution
- Show the fact sheet holds total as a reference note on each performance card/modal
- Brandon manually enters per-section holds based on his own knowledge
- Default per-section holds to 0 on fact sheet load

---

## Venues.json Integration

box_office.html fetches `venues.json` at boot — do NOT hardcode section arrays:

```javascript
var VENUES = {};

function loadVenues() {
  return fetch('data/venues.json')
    .then(function(r) { return r.json(); })
    .then(function(d) { VENUES = (d && d.halls) ? d.halls : {}; })
    .catch(function() { VENUES = {}; });
}

function activeHall() {
  return VENUES[_activeHall] || { name: '', sections: [], defaultCapacity: 0 };
}
```

---

## Restoration Fee Rule

- $4.00 restoration is **never included** in gross calculations
- Show restoration as a labeled secondary display only: "Incl. $4 Restoration — not used in League reporting"
- Restoration applies to single-ticket seats only (not subscriber package pricing)
- Subscriber package pricing already includes fees — label subscriber revenue as "Incl. fees (package pricing)"

---

## Paciolan POS Integration (Future)

When Paciolan integration is complete:
- The `sold` field per section becomes auto-populated from seat-level transaction data
- Subscriber, group, and comp sales will be identifiable by channel within Sold
- Held seats that are released may be auto-detectable from the POS feed
- No structural model change required — data source swap only

---

## Justification Tab

The justification tab is Brandon's print-ready pricing decision record. It shows:
1. Document header (show, season, hall, date, mode badge)
2. Run summary (4 gross metrics)
3. Per-performance breakdown table (all performances, all 4 metrics, delta %)
4. Pricing Decision Record (baseline, scenario, editable rationale textarea)
5. Market context (preceding markets reference)

**Rationale textarea:** Auto-fills on first load; uses `data-autoGenerated="true"` flag. Once Brandon edits the text, the flag is set to "false" and auto-fill stops overwriting his text. Never overwrite user-entered text.
