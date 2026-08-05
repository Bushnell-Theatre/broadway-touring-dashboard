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

The product uses three overlapping peer ideas:

- venues of comparable size
- geographically relevant Northeast/New England markets
- comparable nonprofit PAC/mid-size market environments

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

The Sales Intelligence Dashboard filters the full touring dataset and updates its KPIs, tables, and charts in the browser. Programming and Executive Summary focus on season slates and show profiles.

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
