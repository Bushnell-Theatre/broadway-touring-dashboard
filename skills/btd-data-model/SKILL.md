---
name: btd-data-model
description: Broadway Touring Dashboard (BTD) data model, JSON schemas, field definitions, and data integrity rules for The Bushnell Center for the Performing Arts. Use this skill when working with any BTD JSON data file (data.json, seasons.json, venues.json, factsheets.json, peers.json, context.json, shows.json, tonys.json), when writing process_touring.py pipeline changes, when adding new fields to any BTD data file, when cross-referencing data between BTD files, or when the user asks about seat counts, gross calculations, price levels, holds, sellable capacity, or any BTD data field definition.
---

# BTD Data Model Skill

## Purpose

This skill prevents data integrity errors — wrong field names, unit confusion, conflated concepts — that have caused real bugs in the BTD project. Read it before touching any data file or writing code that reads BTD JSON.

---

## Critical Field Distinctions

These have caused real bugs. Get them right.

### Sellable vs Physical Capacity

| Concept | Value | Source | Use for |
|---|---|---|---|
| Contracted sellable per perf | 2,704 | factsheets.json `contractedSellablePerPerf` | All revenue calculations |
| Section sum (sellable) | 2,704 | Sum of venues.json `sections[].seats` | Validation check |
| Physical house capacity | 2,799 | venues.json `physicalHouseReference.totalHouseCapacity` | Reference only — NOT for calculations |
| Run total sellable | varies | factsheets.json `sellableCapacityRunTotal` | Informational only |

**The 2,704 vs 2,799 gap (95 seats):** Physical seats that are not in named sellable sections (wheelchair, companion, aisle, etc.). Physical-to-sellable section mapping is not yet complete — do not use 2,799 in any calculation.

**The 2,781 bug (fixed):** Six shows previously had `contractedSellablePerPerf: 2781` — this was the run total (22,248) mistakenly stored in the per-performance field. All corrected to 2,704.

### Gross Metric Definitions

| Field name | Meaning | Never confuse with |
|---|---|---|
| `contractPotential` | All sellable × contracted price (full sell-through) | Current sales |
| `captured` | Sold seats × contracted price (actual revenue) | Projected revenue |
| `adjusted` | Unsold × adjusted price + sold × contracted price | Contract potential |
| `delta` | adjusted − contractPotential | adjusted − captured |
| `splitPointGross` | Contractual gross threshold from fact sheet | Profitability threshold |
| `grossPotentialExclRest` | Fact sheet GP excluding $4 restoration | League reporting gross |
| `grossPotentialWithRest` | Fact sheet GP including $4 restoration | Display reference only |

### Price Level vs Broadway League Tier

| Term | Context | Values |
|---|---|---|
| Price Level (A/B/C) | Fact sheet pricing tiers per performance | A=premium, B=mid, C=lowest |
| Tier | Broadway League market classification | "Primary" / "Secondary" |

**Standard Price Level split for all 8-perf Mortensen shows:**
- Tue = C, Wed = C, Thu = B, Fri = B, Sat Mat = A, Sat Eve = B, Sun Mat = A, Sun Eve = C
- Result: 2×A / 3×B / 3×C

**Never assign price levels by guessing at a "typical" pattern** — always read the fact sheet. The earlier assignment error (Tue/Wed=B, Thu/Sun=A, Sun=C) was a reading error caused by `pdftotext` collapsing column alignment.

### tour_type Field

| Value | Meaning |
|---|---|
| `"eq"` | Equity tour |
| `"n/e"` | Non-equity tour |

`"n/e"` does NOT mean "no engagement" — this misclassification affected historical records and was corrected.

---

## Cross-File Name Matching

| File | Show name field | Matches |
|---|---|---|
| seasons.json | `shows[].name` | factsheets.json keys (exact match for 2026-27) |
| seasons.json | `shows[].league_name` | data.json `show` field |
| factsheets.json | top-level keys | seasons.json `name` (exact) |
| venues.json | `sections[].name` | factsheets.json `pricing[level]` keys |
| venues.json | `sections[].nameAliases[]` | Subscriber pricing sheet names |

**Name matching helper for venues.json → factsheets.json:**
```javascript
function resolveSectionName(hallKey, rawName) {
  var hall = VENUES[hallKey];
  if (!hall) return null;
  for (var i = 0; i < hall.sections.length; i++) {
    var s = hall.sections[i];
    if (s.name === rawName) return s;
    if (s.nameAliases && s.nameAliases.indexOf(rawName) !== -1) return s;
  }
  return null;
}
```

---

## Data Integrity Rules

Before adding or changing any field in any BTD JSON file:

1. **Check for existing fields** that carry the same information — do not duplicate
2. **Match naming conventions** — camelCase for JS-consumed fields
3. **Document units** — seats vs %, dollars vs cents, per-perf vs run-total
4. **Validate the sum** — section seat sums must equal `defaultCapacity` (2,704 for Mortensen)
5. **Flag human-confirmation items** — add a `_note` or `_needsHumanConfirmation` field rather than guessing

---

## Holds Data Model

Holds appear in two places with different granularity:

| Source | Granularity | Use |
|---|---|---|
| `factsheets.json holds{}` | Performance-level totals | Reference display; not distributed to sections |
| Per-section `holds` in box_office.html `_performances` | Section-level | Actual calculation input |

**Do not auto-distribute fact sheet holds across sections.** Brandon manually allocates holds per section in the box office modal. Fact sheet holds are displayed as a reference note only.

---

## Adding New Fields to JSON Files

When adding a new field to any BTD data file:

1. Add to `_meta.notes` what the field represents and its source
2. For optional fields, always handle `null` / `undefined` gracefully in consuming code
3. For monetary fields, always document whether it includes or excludes restoration
4. Update both the data file AND `references/data-sources.md` in the btd-project skill

---

## Known Data File Locations

All data files live at `src/data/` in the repo and are served from:
`https://white-pebble-01710020f.7.azurestaticapps.net/data/`

| File | Purpose |
|---|---|
| `data.json` | Broadway League touring records (machine-generated, do not edit manually) |
| `seasons.json` | Bushnell Broadway season show list (manually maintained) |
| `venues.json` | Hall/section/seat canonical data |
| `factsheets.json` | Per-show contracted engagement data |
| `peers.json` | Peer venue definitions |
| `context.json` | NOAA weather + FRED economic enrichment |
| `shows.json` | Show metadata (Tony Awards, production details) |
| `tonys.json` | Tony Awards data |

`data.json` is the only machine-generated file. All others are manually maintained and version-controlled.
