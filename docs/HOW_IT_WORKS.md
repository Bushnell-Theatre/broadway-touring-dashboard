# How the Broadway Touring Intelligence Dashboard Works

A plain-language guide to the current product: what it helps users do, what evidence it uses, and what its conclusions do and do not mean.

*Status: In development · August 2026*

---

## The product in one sentence

The dashboard turns Broadway League weekly touring reports into searchable market evidence that Bushnell staff can use when discussing productions, peer performance, and season planning.

It is a decision-support tool, not a forecast or automated booking system.

---

## The three active experiences

All three experiences use the same underlying data but emphasize different questions.

### Sales Intelligence Dashboard

**Audience:** sales and analytics

Use it to explore touring records, show history, market performance, subscription behavior, and peer benchmarks. This is the broadest analytical view.

### Programming

**Audience:** programming

Use it to review Bushnell season slates and candidate titles, compare productions, inspect Planning Signal components, and see the evidence and cautions behind a planning read.

### Executive Summary

**Audience:** leadership

Use it for a condensed view of season performance, candidate signals, peer context, and notable changes.

The Development Hub is the entry point to these experiences. The former Box Office scenario model is suspended and is not an active experience, even though its files remain in the repository.

---

## Where the data comes from

The Broadway League supplies Excel reports. Local Python scripts convert those reports to static JSON files used by the website.

```text
Broadway League XLSX
        |
        v
Local processing and validation
        |
        v
Static JSON committed to GitHub
        |
        v
Azure Static Web Apps
        |
        v
Browser calculations, charts, tables, and explanations
```

There is no production database or application backend. Azure serves static files, and the browser performs the interactive filtering and analysis.

The Python scripts and optional file watcher run on a local machine. They do not run continuously in Azure, and the local `python -m http.server` command is only a preview server.

---

## The primary evidence

Each usable record in `src/data/data.json` represents one show at one venue for one reporting week.

Common fields include:

| Field | Meaning |
|---|---|
| `gross_gross` | Tour-reported ticket gross for the week; not Bushnell net revenue |
| `gross_potential` | Reported maximum possible gross for the engagement |
| `gg_pct_gp` | Gross as a percentage of gross potential |
| `cap_paid` | Paid tickets as a percentage of sellable capacity |
| `avg_adm` | Average paid admission |
| `on_sub` | Whether the reported week was part of a subscription engagement |
| `tier` | Broadway League market classification |
| `no_engagement` | A reported week without performance data |

Supporting files define Bushnell seasons, curated peer cohorts, optional show metadata, context, validation results, and generated summaries.

---

## Peer comparisons

The product uses three peer ideas in scoring, plus two additional non-scoring context tiers — five total types defined in `peers.json`:

- **size** — venues within ±10% of Bushnell's sellable capacity (2,450–2,994 seats); the core scoring cohort
- **proximity** — geographically relevant Northeast/New England markets
- **market** — comparable nonprofit PAC/mid-size market environments
- **size_extended** — venues within ±15% (2,314–3,130 seats) but outside the ±10% core; context only, not used in scoring
- **reference_only** — included for broad context/data completeness; explicitly excluded from peer scoring calculations

These definitions come from curated metadata in `peers.json`. They are analytical choices, not Broadway League classifications. A venue can belong to more than one cohort.

National figures remain useful context, but the Planning Signal is anchored in the available peer-cohort records.

---

## Planning Signal

The Planning Signal combines four components:

- **Demand:** paid capacity at available peer cohorts, with subscription/non-subscription capacity difference when both exist
- **Revenue:** GG% of gross potential and average paid admission at available peer cohorts
- **Peer:** combined peer-pool capacity, revenue efficiency, and sample breadth
- **Confidence:** depth of evidence across records, venues, peer records, and reporting weeks

The current numeric score is the equal average of the four available components. The component inputs are converted to 0–100 using fixed ranges in the code. The score is not a probability or forecast.

Some pages compare shows with the median score for the selected Bushnell season. That comparison helps users read a slate, but it does not change how each show's underlying numeric score is calculated.

If a future new tour has no matching records, the product withholds the numeric score and displays `—`/Exploratory rather than inventing evidence.

For the exact formulas, ranges, and edge cases, see [../SCORING.md](../SCORING.md).

---

## How to interpret the output

Use the dashboard to ask:

- What touring evidence exists for this production?
- How did it perform in contexts selected as relevant to the Bushnell?
- Do demand and revenue quality tell the same story?
- Is the evidence deep enough to support a confident discussion?
- What additional local, financial, artistic, or routing information is still needed?

Do not read the output as:

- expected Bushnell sales or profit
- a recommended guarantee or deal
- proof that one show is artistically preferable
- an automatic booking priority
- a complete explanation of why a show performed as it did

Revenue Signal describes gross revenue quality in the available touring evidence. It does not include presenter economics.

---

## Filters and summaries

Filtering works differently on the Dashboard than on Programming and Executive Summary. The two designs reflect two different questions.

### Sales Intelligence Dashboard — Season / Date Range toggle

The Dashboard lets you explore the full touring dataset by time period. A **Season / Date Range** toggle controls which records are included:

- **Season mode** (default): all records whose `week_of` falls in the selected Broadway fiscal season (July 1 – June 30). KPIs, charts, and rankings all update to that season's data.
- **Date Range mode**: records within an explicit From / To date window. Season selection is suspended. Any record missing a valid date is excluded.

The two modes are **mutually exclusive** — selecting a date range suppresses season filtering; clearing the range restores it. They are never intersected.

**Fail-closed validation:** If you supply a From or To boundary that is not a valid calendar date (for example, February 31), the filter returns zero records rather than silently falling back to an unbounded set. An omitted boundary is valid — "From only" gives all records from that date forward; "To only" gives all records up to that date.

A **Reset** control clears an active date range and returns to Season mode. All downstream KPIs, charts, and tables always reflect the active filter set.

The Dashboard does not compute or display a Planning Signal. Its filters are for record-level exploration only.

### Programming and Executive Summary — Show Slate + Display Evidence

Programming and Executive Summary use a **two-layer design** that separates what is always visible from what is date-scoped.

**Layer 1 — Show Slate (always visible):**
Every show on the selected Bushnell season appears in the slate and receives a Planning Signal regardless of the date scope. Filtering cannot remove a show from the slate or change its Planning Signal score, Planning Read, component signals (Demand, Revenue, Peer, Confidence), or Confidence label. The Opportunity Engine — which identifies shows where peer capacity substantially exceeds the Bushnell-venue average — is also canonical and does not change with the date scope. This isolation means the planning read a team discusses is always based on the full available evidence, not on whatever date window happens to be selected.

**Layer 2 — Display Evidence pill:**
A pill above the show cards reads either **"All available data"** (default) or **"Custom date range"**. When you choose Custom, a From / To date input appears. The selected window controls:

- The cap%, gross, and GG% figures shown on show cards and in peer comparison charts
- The "Tour vs Peer Capacity" chart
- Per-record display tables (where shown)

What the Display Evidence scope does **not** change:
- Planning Signal scores and component values
- Planning Reads (Strong Candidate, Discuss, Watch, Exploratory, etc.)
- Season Position badge (Above / At / Below season median)
- Confidence levels
- Strong Watch classifications
- Opportunity Engine results

**Missing evidence is disclosed, not zeroed.** If a show has no touring records in the selected date window, its display metrics appear as `—` rather than as zero. A zero would imply a show played and earned nothing; `—` correctly indicates that no evidence exists in that window. Shows with no display evidence in the current window remain on the slate so the team can still see their canonical Planning Signal.

**Fail-closed validation:** The same rules as the Dashboard apply. A supplied boundary that is not a valid ISO date (YYYY-MM-DD) causes the display window to return no records rather than silently opening to an unbounded range.

---

Averages and rankings answer different questions. Cumulative gross favors titles with more reported engagements; capacity and GG% describe different aspects of performance; confidence reflects evidence depth rather than show quality. Users should retain the current filters and sample size when interpreting any result.

---

## Generated callouts

The repository contains optional local scripts that evaluate threshold events and may generate short summaries for Programming and Executive Summary. These are presentation layers over aggregate touring data.

The underlying calculations and records remain the evidence. A generated callout does not change a Planning Signal and should not be treated as a separate analytical model.

If the required API is unavailable, generation can be skipped and previously written output can remain in place. Data currency and callout currency are therefore not necessarily the same.

---

## Current limitations

The product does not currently incorporate:

- Bushnell deal terms or presenter costs
- Bushnell patron and ticketing history
- routing and availability
- technical feasibility
- artistic and mission priorities
- local marketing conditions or competitive events
- score recency/time decay
- a continuously hosted ingestion service

The active experiences are explicitly in development. Their value is making touring evidence easier to inspect and discuss while keeping these limitations visible.
