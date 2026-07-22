# How the Broadway Touring Intelligence Dashboard Works

A plain-language guide to the data, the pipeline, and the four dashboard pages — written for anyone who needs to understand the system without reading the source code.

*July 2026 · Broadway Touring Dashboard v5*

---

## The Big Picture

Every week, Broadway touring productions report their box office results to the **Broadway League** — the national trade association for the touring industry. That data covers every major market in the country: how much each show grossed, how many seats it sold, and what percentage of its capacity it filled.

The Bushnell receives this data in the form of Excel spreadsheets. A script converts those spreadsheets into a single structured data file that all four dashboard pages read from. When you open a dashboard, it pulls that file, applies any filters you've set, and draws everything you see — the charts, the rankings, the KPI tiles — in real time, right in your browser.

No database. No login. No server-side processing. The intelligence lives in the data file; the dashboards are the lens.

---

## Step 1 — Where the Data Comes From

The Broadway League publishes weekly touring data as Excel files. These files contain one row per show per week per venue — every market the show played, what it earned, and how full the house was. A single file may cover hundreds of shows and thousands of venue-weeks going back years.

```
Broadway League Excel Files
        ↓
process_touring.py   (Python script run by IT)
        ↓
data.json            (single structured file read by all four dashboards)
        ↓
Dashboard Pages      (charts, rankings, and KPIs built in your browser)
```

> **Who runs the pipeline?** IT (Randale) runs `process_touring.py` when new Broadway League data arrives. The dashboards update automatically once the new `data.json` is deployed — no manual work required on the dashboard side.

---

## Step 2 — What's in the Data

Each record in `data.json` represents **one show, at one venue, for one week**. The current dataset contains roughly 10,900 such records spanning several touring seasons. Here are the most important fields in plain terms:

| Field | Plain-language meaning |
|---|---|
| `gross_gross` | **Total ticket revenue** reported by the touring production for that week at that venue. This is what the tour earned — not what the presenter kept. |
| `gross_potential` | **Maximum possible revenue** if every seat sold at full price for every performance. Used as the denominator in efficiency calculations. |
| `gg_pct_gp` | **Revenue efficiency** — gross earned as a percentage of gross potential. Can exceed 100% when dynamic pricing pushes tickets above face value. |
| `cap_paid` | **Paid capacity percentage** — paid tickets sold divided by total sellable seats. The most reliable measure of audience demand. |
| `on_sub` | **Subscription flag** — whether this particular week was part of the venue's subscriber package. For multi-week runs, individual weeks may differ (one week sub, others not). |
| `tier` | **Market size** — the Broadway League's classification of the market (Primary = major cities, Secondary = mid-size markets like Hartford). |
| `similar_bushnell` | **Peer venue flag** — marks venues with seat counts close to Bushnell's Mortensen Hall (~2,700 seats). Used to build peer comparisons that reflect Hartford-scale conditions. |
| `no_engagement` | **Dark week** — the show was scheduled but did not play (road dark, layoff). These records are kept so gap analysis works correctly, but they are excluded from revenue and capacity calculations. |

Three other files support the dashboards alongside `data.json`:

- **`seasons.json`** — Bushnell's own season show list
- **`peers.json`** — peer venue comparison group definitions
- **`venues.json`** — physical seat counts for Bushnell's own halls, used by the Box Office scenario tool

---

## Step 3 — The Four Dashboard Pages

Each page reads the same underlying data but is designed for a different question and a different audience.

### Sales Intelligence Dashboard
**Primary users: Tom, Programming Staff**

The broadest view. Shows top and bottom grossing productions, week-over-week momentum, market capacity, subscription vs. non-subscription performance, and multi-season trends. Built for ongoing market monitoring.

### Programming
**Primary users: Tom, Programming Staff**

Show-by-show analysis for booking decisions. Generates a Planning Signal score for each candidate title, combining demand, revenue efficiency, peer performance, and data confidence into a single comparable rating.

### Executive Summary
**Primary users: Stephanie, Leadership**

Season retrospective and strategic overview. Compares Bushnell's results against the peer market, surfaces subscription lift, identifies hidden gems and shows that underperform in mid-size venues.

### Box Office Scenario Model
**Primary users: Brandon, Box Office**

Revenue projection tool specific to Bushnell's own halls. Models different pricing and hold configurations for upcoming shows using Mortensen Hall's actual section-by-section seat counts.

---

## Filters and What They Do

Every dashboard loads the full dataset on open, then applies a chain of filters based on what you've selected in the sidebar. All charts and rankings update instantly — no page reloads.

Filters chain together: selecting **Season 26–27** narrows to that season's weeks; adding **Sub Only** further narrows to subscription engagements within that season. The KPI tiles at the top always reflect the current filtered selection.

| Filter | What it does |
|---|---|
| **Season** | Filters by Broadway fiscal year (July–June). Multiple seasons can be selected simultaneously. |
| **Tier** | Primary (large markets) or Secondary (mid-size markets). Secondary includes Hartford — useful for isolating comparable-market behavior. |
| **Subscription** | Filters to weeks tagged as subscription (Sub) or non-subscription (Non-Sub) engagements. For shows with multi-week runs, this operates week-by-week — not show-by-show. |
| **Peer Venues** | Narrows to venues whose seat count is similar to Bushnell's (Size), geographically nearby (Proximity), or in comparable regional markets (Market). |
| **Engagement** | Filters between weeks with actual performance data (Performed) and dark/no-engagement weeks. "All" includes both. |

---

## Key Calculations in Plain Terms

### Total Gross
`Sum of gross_gross across all filtered weeks`

The total ticket revenue reported across every week included in your current filter. This is the tour's number, not Bushnell's presenter share.

### Average % Capacity Paid
`Average of cap_paid across all filtered weeks`

How full houses were, on average, across your filter. The most reliable demand signal because it's independent of pricing strategy.

### Average % of Gross Potential
`Average of gg_pct_gp across all filtered weeks`

Revenue efficiency — how close each show came to capturing its theoretical maximum revenue. Values above 100% occur when dynamic pricing pushes tickets above face value. Both are kept in the data because the Broadway League reports them this way.

### Average Paid Admission
`gross_gross ÷ paid_tix`

The effective price per ticket actually paid, after any discounting, subscription bundling, or dynamic pricing. A practical proxy for what the market was willing to spend.

### Subscription Lift
`avg cap_paid (on_sub = true) − avg cap_paid (on_sub = false)`

How much fuller houses were during subscription weeks compared to non-subscription weeks for the same show. Positive lift means the subscription package drove stronger attendance. Negative lift means single-ticket demand exceeded the subscriber base.

### Planning Signal
`Weighted composite of demand, revenue, peer, and confidence scores`

Used on the Programming and Executive Summary pages. Combines four independent signals — how much audiences want the show nationally, how well demand converts to revenue, how the show performs in Bushnell-size venues specifically, and how much data exists to support the conclusion. A show with a high signal and low confidence should be read differently than one with high signal and high confidence.

> **What the dashboard does not include:** deal terms, presenter guarantees, local Bushnell expenses, marketing costs, ancillary revenue, or routing availability. Revenue Signal is not Net Profit. All financial figures are the touring production's reported gross — not what the Bushnell retains.

---

## How Rankings Are Built

The Top and Bottom Grossing rankings aggregate **cumulative gross revenue by show** across all filtered weeks, then rank them highest to lowest (top list) or lowest to highest (bottom list).

Only shows that actually reported at least one week of gross revenue appear in these rankings. Shows present in the data only as dark or no-engagement weeks are excluded because they have no revenue to rank. This is why the rank numbers on the Bottom list (e.g., **#47 of 50**) reflect position within the revenue-reporting set, not the total number of show names visible in the sidebar filter.

The bottom list reads from least-bad (#41) to worst (#50) — the absolute lowest-grossing show appears at position 10, not position 1.

---

## Where It Lives and How It Updates

The dashboards are hosted on **Microsoft Azure Static Web Apps**, connected directly to the GitHub repository. When a change is pushed to the `main` branch, Azure automatically deploys the update — typically within 30 seconds. No server restarts, no FTP uploads.

The deployment follows a three-step process: development work happens on a feature branch, then merges to a staging branch (`dev`) for review, then to `main` for production. This means changes are always reviewed before they go live.

All four dashboard pages, the shared stylesheet, and all data files live in the same repository. A version number displayed on each page reflects the last meaningful feature addition — bug fixes and data updates do not increment the version.

> **The data is live from Azure.** Each dashboard first attempts to load `data.json` from the Azure-hosted URL. If that fails (no internet, for example), it falls back to a local copy. This means the dashboards work offline in a pinch, but will show the last-synced data rather than the current one.
