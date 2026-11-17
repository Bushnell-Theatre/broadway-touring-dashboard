---
name: btd-data-model
description: Broadway Touring Dashboard (BTD) data model, JSON schemas, field definitions, and data integrity rules for The Bushnell Center for the Performing Arts. Use this skill when working with any BTD JSON data file (data.json, seasons.json, factsheets.json, peers.json, context.json, shows.json, awards.json), when writing process_touring.py pipeline changes, when adding new fields to any BTD data file, when cross-referencing data between BTD files, or when the user asks about seat counts, gross calculations, price levels, holds, sellable capacity, or any BTD data field definition.
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
| Run total sellable | varies | factsheets.json `sellableCapacityRunTotal` | Informational only |

**Always use the contracted sellable figure from factsheets.json.** Physical house capacity (2,799 for Mortensen) is a larger number that includes seats not in named sellable sections — wheelchair, companion, aisle. It lived in `venues.json`, which was removed with the box office tooling, and it was never valid for revenue calculations.

**The 2,781 bug (fixed):** Six shows previously had `contractedSellablePerPerf: 2781` — this was the run total (22,248) mistakenly stored in the per-performance field. All corrected to 2,704.

### Price Level vs Broadway League Tier

| Term | Context | Values |
|---|---|---|
| Price Level (A/B/C) | Fact sheet pricing tiers per performance | A=premium, B=mid, C=lowest |
| Tier | Broadway League market classification | "Primary" / "Secondary" |

**Never assign price levels by guessing at a "typical" pattern — always read each show's own fact sheet (`performances[].tier`).** A prior version of this doc claimed a "standard" 8-perf split (Tue/Wed=C, Thu/Fri=B, weekends mixed A/B/C) that turned out not to match any current fact sheet — checked against the live file (Aug 2026), all nine current 8-performance Mortensen shows actually use Tue=B, Wed=B, Thu=B, Fri=A, SatMat=A, SatEve=A, SunMat=A, SunEve=C (4×A / 3×B / 1×C), except BOOP! which starts Tue/Wed=C instead of B. This pattern can and does change per contract — treat any hardcoded pattern (including this one) as a snapshot, not a rule.

### non_equity / no_engagement Fields (data.json)

`data.json` has two independent boolean fields — not a single `tour_type: "eq"/"n/e"` enum:

| Field | Meaning |
|---|---|
| `non_equity` | `true` = non-equity tour, `false` = Equity tour |
| `no_engagement` | `true` = venue had no performance that week (a dark/closed row) |

**Do not conflate these two** — a non-equity tour is not the same thing as a dark week. A prior version of this data model misclassified `no_engagement` rows as non-equity; that was corrected, and the two are now tracked as separate booleans.

---

## Cross-File Name Matching

| File | Show name field | Matches |
|---|---|---|
| seasons.json | `shows[].name` | factsheets.json `shows{}` keys (exact match for 2026-27) |
| seasons.json | `shows[].league_name` | data.json `show` field |
| factsheets.json | `shows{}` keys (nested under `shows`, not top-level — file shape is `{_meta, shows: {...}}`) | seasons.json `name` (exact) |

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

`factsheets.json holds{}` carries performance-level totals, and that is the only
holds data in this repository.

**Do not distribute fact sheet holds across sections.** They are performance-level
figures; splitting them per section requires a human allocation that used to happen
in the box office tooling, which has been deprecated and moved to its own project.
Treat these as a reference display only.

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
| `data.json` | Broadway League touring records (machine-generated, do not edit manually). Shape: `{generated_at, record_count, records: [...]}` |
| `seasons.json` | Bushnell Broadway season show list (manually maintained) |
| `factsheets.json` | Per-show contracted engagement data. Shape: `{_meta, shows: {...}}` — see Cross-File Name Matching above |
| `peers.json` | Peer venue definitions — 5 types (`size`, `proximity`, `market`, `size_extended`, `reference_only`); each venue's `peer_types` is an array |
| `context.json` | NOAA weather + FRED economic enrichment, keyed by `week_of` |
| `shows.json` | Show metadata (array of 57 records). **Enrichment suspended** — retained from before suspension, not regenerated |
| `awards.json` | Award-body records (Olivier, etc.), built by `scripts/build_awards.py` — there is no `tonys.json`; Tony counts live on `shows.json` records |

`data.json` is the only machine-generated file. All others are manually maintained and version-controlled.
