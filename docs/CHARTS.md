# Chart Reference — Broadway Touring Intelligence Dashboard

Each chart is described below: what it shows, what the axes mean, how to read it, and what decisions it is intended to support.

---

## Programming Page

### Season Show Fit (cBriefFit)

**What it shows:** A horizontal bar chart ranking every show on the current season slate by its Planning Signal score (0–100). Bars are color-coded: green for Strong Candidate, neutral for Discuss/Watch, amber for Exploratory.

**How to read it:** Longer bar = stronger combined signal across Demand, Revenue, Peer, and Confidence. The score is a fixed-range index (0–100) built from peer-cohort scaling — the same show always scores the same regardless of who else is on the slate. The Season Position badge (shown on the Planning Signal card) is the comparative element that places a show relative to the season median.

**What it supports:** A quick visual ranking of the full slate. Use it to see at a glance which shows have the strongest combined case and which are speculative.

---

### Capacity: Tour vs Peer (cBriefCap)

**What it shows:** A grouped horizontal bar chart with two bars per show. One bar shows the national touring average paid capacity; the other shows the average paid capacity at Bushnell-size peer venues (±10% of Bushnell's sellable seats).

**How to read it:** The gap between the two bars tells you whether the show performs better or worse at venues our size. A show with a high national bar but a lower peer bar may fill large houses but underperform at mid-size venues — a meaningful distinction for Bushnell.

**What it supports:** Understanding whether a show's national numbers translate to our venue scale. Peer capacity is a more relevant signal than raw national capacity for programming decisions.

---

### Season Comparison (cCurrent) — Current Season tab

**What it shows:** A vertical bar chart of Planning Signal scores for all confirmed shows in the current active season.

**How to read it:** Same scoring as the Season Show Fit chart, displayed differently for the current season view. Shows to the left are ranked higher.

**What it supports:** Quick comparison of active season performance as weekly data accumulates. Scores update as new Broadway League reports are ingested.

---

### Fit Distribution (cFuture) — Planning tab

**What it shows:** A bar chart showing the distribution of Planning Signal scores across future season candidates (shows under consideration, not yet confirmed).

**How to read it:** Each bar is a score band (e.g., 0–10, 10–20, ..., 90–100). The height shows how many candidate shows fall in that band. A cluster of bars toward the right means the planning slate is strong; a cluster left means most candidates are speculative.

**What it supports:** Understanding the overall quality of the planning pool — not just the top picks, but how the full candidate list distributes across confidence levels.

---

### Peer Capacity Distribution (cPeers) — Peers tab

**What it shows:** A horizontal bar chart of average paid capacity at the top peer venues nationally (Bushnell-size venues, ±10% of our sellable seat count).

**How to read it:** Each bar is a venue. Longer bars = higher average paid capacity across all shows that played there. This shows which peer venues are consistently strong, not just which shows did well.

**What it supports:** Benchmarking. If a peer venue consistently outperforms us in capacity across the same shows, that's a signal about market positioning, marketing, or subscription base — not just the shows themselves.

---

### Tony Recognition (cIntelTony) — Intelligence tab

**What it shows:** A horizontal bar chart of Tony Award wins and nominations per show (where data is available from Wikidata/Wikipedia).

**How to read it:** Two values per show: wins (solid) and nominations (lighter). Tony recognition is a demand signal — award-winning shows tend to carry stronger name recognition with subscribers and casual buyers.

**What it supports:** Identifying shows with strong cultural cachet that may drive subscriber acquisition or renewal — an input to marketing decisions, not a substitute for revenue data.

---

## Executive Summary Page

### Fit Scores (cBriefFit)

Same as the Programming page Season Show Fit chart. Shows Planning Signal scores for the full slate, formatted for leadership review. Supports the headline callout narrative.

---

### Tour vs Peer Capacity (cBriefCap)

Same as the Programming page Capacity: Tour vs Peer chart. Shows national vs peer-venue capacity side by side per show. Gives leadership visibility into whether the national picture translates to our venue scale.

---

### Season Capacity Comparison (cCurrentCap)

**What it shows:** A bar chart of average paid capacity for each active season show.

**How to read it:** Capacity as a percentage — higher bars mean more seats sold per week on average. Unlike the grouped bar chart, this shows only Bushnell-context capacity (using peer venue data where available).

**What it supports:** A capacity-level view of the current season for leadership — useful context alongside revenue figures but not the primary evaluation metric.

---

### Fit Distribution (cFuture) — Planning section

Same as the Programming page Fit Distribution. Shows score distribution across planning candidates for the future season. Gives leadership a sense of the pipeline quality without show-by-show detail.

---

## Dashboard Page

The Dashboard is the operations and QA layer. Its charts are built from raw Broadway League data across all seasons and venues, not filtered to the Bushnell slate.

---

### Top Shows by Cumulative Gross (cShowGross)

**What it shows:** A horizontal bar chart of the top 12 shows by total cumulative gross across all records in the dataset.

**How to read it:** The biggest earners across all markets and all seasons in the dataset. This is an absolute dollar total, not a per-week average.

**What it supports:** Understanding which shows have the largest revenue footprint nationally — a context layer for evaluating how a show on our slate compares to the all-time top earners.

---

### GG% of Gross Potential (cGgPct)

**What it shows:** A horizontal bar chart of the top 12 shows by average GG% (gross as a percentage of gross potential). Teal bars = shows that averaged ≥ 100% GG%; navy bars = below 100%.

**How to read it:** GG% above 100% means the show often exceeded its stated gross potential — a sign of exceptional demand. This chart identifies which shows are the most revenue-efficient, not just the highest grossing.

**What it supports:** Revenue quality analysis. A show that grosses less in absolute terms but maintains a high GG% may be a more reliable revenue performer than a blockbuster with inconsistent weeks.

---

### Weekly Gross + 8-Week Moving Average (cWeekly)

**What it shows:** A line chart with two series: (1) the weekly gross for each report week across all records in the dataset, and (2) an 8-week rolling moving average of that gross.

**How to read it:** The raw weekly line shows volatility — holiday spikes, dark weeks, touring gaps. The moving average smooths those out to reveal the underlying trend. Divergence between the two indicates unusual weeks.

**What it supports:** Trend monitoring. Useful for spotting whether overall Broadway touring revenue is growing, flat, or declining — and when anomalies (weather, holidays, market disruptions) affected the data.

---

### Subscribed vs Non-Subscribed Capacity (cSubComp)

**What it shows:** A grouped bar chart comparing average gross and average paid capacity for subscribed versus non-subscribed audiences, with a dual Y-axis.

**How to read it:** Subscription buyers typically show higher capacity (fewer empty seats) but may have different gross patterns due to discounted sub pricing. The gap between sub and non-sub capacity indicates subscription strength.

**What it supports:** Evaluating whether the subscription model is filling seats — and how subscriber behavior differs from single-ticket buyers. Relevant for revenue modeling and subscriber retention strategy.

---

### Market Capacity by City (cMarketCap)

**What it shows:** A vertical bar chart of the top 20 cities by average paid capacity, color-coded green (≥ 80%), amber (60–79%), or red (< 60%).

**How to read it:** Higher bars = markets that consistently fill a higher percentage of seats. Hartford/Bushnell appears in this chart when sufficient records exist — compare it to peer markets.

**What it supports:** Market benchmarking. Helps identify whether Hartford's capacity performance is consistent with comparable markets or whether it is an outlier in either direction.

---

### Theatre Size vs Performance (cTheatreSize)

**What it shows:** A grouped vertical bar chart with a dual Y-axis. Left axis: average paid capacity by theatre size bucket. Right axis: average gross by theatre size bucket.

**How to read it:** Larger theatres typically gross more in absolute terms but may have lower capacity percentages (harder to fill). Smaller theatres may have higher percentages but lower gross. Bushnell sits in the mid-size bucket — use this to understand our peer group's performance profile.

**What it supports:** Understanding the capacity/gross trade-off by venue size — useful context for evaluating whether Bushnell's performance is typical for its size tier.

---

### Seasonality — Avg Gross by Period (cSeasonality)

**What it shows:** A bar chart of average weekly gross by fiscal week or month (toggle between modes). Aggregated across all seasons in the dataset.

**How to read it:** Peaks indicate high-demand periods (holiday season, spring break, etc.). Troughs indicate structurally weak booking periods. The pattern is relatively stable year over year.

**What it supports:** Programming and scheduling. Understanding which calendar periods drive the highest gross helps prioritize when to book the strongest titles versus when a softer show can be placed without significant revenue risk.

---

### Year-Over-Year Gross (cYoY)

**What it shows:** A multi-line chart with one line per fiscal year. Each line traces average gross by week or month across that year.

**How to read it:** Lines that track together indicate stable seasons. A line that falls significantly below prior years indicates a down season; one significantly above indicates unusual strength. The spread between lines reveals inter-year volatility.

**What it supports:** Trend analysis over time. Helps identify whether revenue is structurally improving, declining, or volatile — and whether a specific season is an outlier or part of a longer pattern.

---

### Show Longevity (cLongevity)

**What it shows:** A horizontal bar chart of the top shows by number of reporting weeks in the dataset.

**How to read it:** More weeks = a longer national tour run. Shows with many weeks have deeper data and more reliable metrics. Shows with few weeks are either short runs or new additions.

**What it supports:** Confidence calibration. A show with 40 weeks of data is much more reliable to score than one with 4 weeks. This chart surfaces which shows have the deepest evidence base.

---

### Capacity Rankings (cCapRank)

**What it shows:** A horizontal bar chart of top shows by average paid capacity. Teal bars indicate shows averaging ≥ 90% capacity.

**How to read it:** The highest-capacity shows are consistently filling venues regardless of absolute gross. These are demand-leader shows even if they are not the top grossers.

**What it supports:** Separating demand signal from revenue signal. A show can have strong capacity but modest gross (smaller houses, lower ticket prices) — this chart isolates the demand side.

---

### Revenue Consistency (cConsistency)

**What it shows:** A horizontal bar chart ranking shows by revenue consistency, measured as the coefficient of variation (lower = more consistent).

**How to read it:** Shows at the left are highly consistent week-to-week; shows at the right are volatile. A show with high average gross but high volatility may have a few spectacular weeks masking many weak ones.

**What it supports:** Risk assessment. A consistently strong show is a safer programming choice than a volatile blockbuster that spikes around holidays and struggles otherwise. Use this alongside gross and capacity metrics.

---

### Dark / No-Engagement Weeks (cNoEng)

**What it shows:** A horizontal bar chart of shows ranked by the percentage of their reporting weeks that were dark or had no recorded engagement.

**How to read it:** Higher percentage = more dark weeks relative to total reporting weeks. Some dark weeks are expected (load-in, travel, closed weeks). A very high percentage may indicate a troubled tour or a show that didn't play many markets.

**What it supports:** Data quality and planning signal confidence. A show with many dark weeks has a thinner evidence base and a lower Confidence signal — its scores should be treated with more uncertainty.

---

### Peer vs Non-Peer Capacity Over Time (cPeerGap)

**What it shows:** A dual-line chart comparing weekly average paid capacity at Bushnell-size peer venues versus all other venues over time.

**How to read it:** If the peer line is consistently above the non-peer line, mid-size venues perform better than the national average. If the gap narrows or reverses, it signals a structural shift in how shows are touring mid-size markets.

**What it supports:** Market context. Helps answer whether Bushnell's peer group is performing differently from the broader Broadway touring market — and whether national benchmarks are actually relevant to our scale.
