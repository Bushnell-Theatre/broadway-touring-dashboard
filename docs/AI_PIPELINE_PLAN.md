# AI Pipeline Plan — Features 1 & 2

Two separate pipeline steps. Feature 1 (weekly highlights) runs on every
new XLSX ingestion. Feature 2 (end-of-season review) runs once per season,
triggered by close-date passage. Neither blocks the data pipeline.

*Status: COMPLETE — shipped July 22, 2026. All five steps deployed to production.
Trigger logic and prompts described below were revised again on August 28,
2026 (see "Show-closes rework" and "National fallback" under Feature 1) —
this doc has been updated to match.*

---

## Shared Conventions

**Season key format:** `"2026-2027"` — matches the existing key format in
`seasons.json` throughout both features.

**Season date derivation (no schema change needed):** The Python scripts
derive `season_start` and `season_end` from the key string the same way the
browser JS does — `"2026-2027"` → start `2026-07-01`, end `2027-06-30`.
`seasons.json` does not need new fields.

**API configuration (both features):**
- Model: `claude-haiku-4-5-20251001`
- Key: `ANTHROPIC_API_KEY` from `.env` via `python-dotenv`
- On failure: log warning, skip file write, continue. Nothing blocks the pipeline.

---

## Feature 1 — Weekly Highlight (revised)

### What changed from `AI_HIGHLIGHT_PIPELINE.md`

1. All threshold comparisons are **season-scoped** — a WoW comparison only
   fires if both the current week and the prior week fall within the same
   season. The first week of a new season never triggers a WoW comparison.
2. Output files are **season-keyed objects** rather than flat objects.
3. Dashboard injection looks up by `ACTIVE_SEASON`, not by `LAST_REPORT_DATE`.

Everything else in the original plan (callout element, watcher placement) is
unchanged. Thresholds and prompt text were revised again on August 28, 2026 —
see the next two subsections, which supersede any threshold/prompt detail
elsewhere in this doc or in `AI_HIGHLIGHT_PIPELINE.md`.

### Show-closes rework (August 28, 2026)

The original "show closes" trigger fired as soon as a show was absent from a
scope for a single week compared to the prior week — this produced a false
positive (a real incident: it claimed a touring show's tour had "concluded"
when it had simply played a differently-sized venue that week). The shipped
logic in `scripts/generate_highlights.py` now:

- Requires **`MIN_ABSENCE_WEEKS = 6`** consecutive calendar weeks of absence
  (measured against the full weekly calendar, not just the immediate prior
  week) before firing at all, on top of the existing `CLOSE_MIN_WEEKS = 2`
  (the show must have appeared in scope at least twice before).
- Splits the outcome into two distinct trigger types instead of one:
  - **`show_closes`** — absent from Broadway League data nationally, at any
    venue. This is the only case where the AI prompt is allowed to describe
    the tour as closed/ended/exited.
  - **`left_peer_scope`** — absent from the peer-size venue band specifically,
    but still active nationally. Worded as a venue-size shift, never a
    closure.
- Both exec and programming prompts (`build_exec_prompt`, `build_prog_prompt`)
  now include an explicit guardrail sentence: *"Only say a tour has closed,
  ended, or exited touring if the data explicitly states it is absent
  nationally — never infer a closure from a show simply moving out of the
  peer-size venue band."*

### National fallback (August 28, 2026)

The exec brief only ever compared against peer-sized venues (~2,400–3,000
seats). In a week where **zero** peer venues reported any data for the
season's shows, exec had nothing to say — even when there was meaningful
national movement the programming brief was already surfacing from the same
underlying data. `run()` now falls back: if the peer scope produced no
triggers because it had no records at all this week, and the national scope
did produce triggers, exec uses those national triggers instead, through a
dedicated prompt (`build_exec_national_fallback_prompt`) that opens by
disclosing the fallback rather than presenting it as a peer comparison.
`write_highlight()` tags the written entry with `"scope": "peer"` or
`"scope": "national_fallback"` so the dashboard can label the callout
accordingly (see the Output files and Dashboard injection sections below).

---

### Output files

`src/data/exec_brief_highlight.json`
`src/data/programming_highlight.json`

```json
{
  "2025-2026": {
    "week_of": "2026-05-11",
    "trigger": "cap_band_crossing",
    "summary": "...",
    "generated_at": "2026-05-14T09:12:00"
  },
  "2026-2027": {
    "week_of": "2026-10-06",
    "trigger": "wow_gross_change",
    "summary": "...",
    "generated_at": "2026-10-08T10:05:00"
  }
}
```

`exec_brief_highlight.json` entries additionally carry an optional `"scope"`
field — `"peer"` (the normal case, written whenever the peer-venue scope
itself produced a trigger) or `"national_fallback"` (peer scope had zero
data this week, so the entry is based on national data instead — see the
National fallback subsection above). `programming_highlight.json` entries
never carry `scope`; that scope is always national. Possible `trigger`
values now also include `left_peer_scope` alongside the original
`wow_gross_change`, `cap_band_crossing`, `show_opens`, `show_closes`,
`all_time_high_gross`, and `all_time_high_cap`.

Each season key is written once per triggering week. A season's entry is
overwritten if a later week in that same season also trips a threshold.
Once a season ends, its entry is never touched again.

---

### Season-scoping rule for thresholds

Before any comparison:

```
current_season  = fiscal_year(latest_week_of)   # e.g. "2026-2027"
previous_season = fiscal_year(prior_week_of)

if current_season != previous_season:
    skip WoW comparisons entirely for this run
    (open/close and all-time high/low can still fire)
```

Where `fiscal_year(date)` maps a `week_of` date to the season key using
the same July-1 boundary logic already in the JS.

---

### Dashboard injection (season-keyed)

This is what's actually shipped in `exec_summary.html` (see "AI callout
injection" comment, ~line 2362) — note it's a **combined fetch of both**
`season_review.json` and `exec_brief_highlight.json`, not the highlight file
alone, because `exec_summary.html` also needs to prioritize the amber
season-retrospective callout over the teal weekly one when both exist for a
season:

```javascript
// exec_summary.html — after chartCap call
Promise.all([
  fetch('data/season_review.json').then(r => r.ok ? r.json() : null).catch(() => null),
  fetch('data/exec_brief_highlight.json').then(r => r.ok ? r.json() : null).catch(() => null)
]).then(([reviewData, highlightData]) => {
  const reviewEntry    = reviewData    && reviewData[season.id];
  const highlightEntry = highlightData && highlightData[season.id];
  if (reviewEntry && reviewEntry.summary) {
    // amber "Season Retrospective" callout — takes priority, see Feature 2
  } else if (highlightEntry && highlightEntry.summary) {
    const label = (highlightEntry.scope === 'national_fallback'
      ? 'Weekly Intelligence (National Data — No Peer Venues Reported) · '
      : 'Weekly Intelligence · ') + highlightEntry.week_of;
    const el = document.createElement('div');
    el.className = 'callout ai-highlight';
    el.style.cssText = 'border-left-color:var(--teal);margin-bottom:16px;';
    el.innerHTML =
      `<div style="font-size:.6rem;font-weight:700;letter-spacing:.12em;
                   text-transform:uppercase;color:var(--teal);margin-bottom:6px;">
         ${label}
       </div>
       <p style="margin:0;"></p>`;
    el.querySelector('p').textContent = highlightEntry.summary;  // textContent, not innerHTML — AI text is untrusted
    document.getElementById('tab-brief').prepend(el);
  }
});
```

`programming.html` only ever shows the weekly teal callout (there is no
season-retrospective competitor on that page), so it fetches
`programming_highlight.json` alone and looks up the current season key from
the existing `ACTIVE_SEASON` variable on that page — no `scope` label needed
there, since `programming_highlight.json` entries are always national.

**Result:** Switching the season selector rerenders `#tab-brief` via the
existing `renderBrief()` call, which re-runs the fetch and injects the
correct entry for the newly selected season — or nothing, if no entry exists.

---

## Feature 2 — End-of-Season Review

### Overview

Runs **once per season**, after the final week of data for that season has
been ingested. Compares:

- **"What we thought"** — pre-season national signal for each Bushnell show,
  computed from `data.json` records dated *before* the season started
- **"What happened"** — actual peer-venue performance aggregated across the
  full season

Writes one AI-generated retrospective per season to `season_review.json`.

---

### Where "What We Thought" Comes From

**The Planning Signal is not stored anywhere persistently.** It is computed
fresh in the browser from the current state of `data.json` each time the
page loads. By the time a season ends, `data.json` contains the full season's
records, which would skew any signal computed from the full dataset.

**Solution — reconstruct from pre-season records only:**

The Python script filters `data.json` to records where
`week_of < season_start_date` (i.e., before July 1 of the season's start year),
then computes a simplified pre-season signal for each show:

| Pre-season field | Source |
|---|---|
| Pre-season avg `cap_paid` | Mean of `cap_paid` across all pre-season records for that show, all venues |
| Pre-season avg `cap_paid` at peer venues | Same, filtered to `similar_bushnell = true` |
| Pre-season avg `gross_gross` | Mean of `gross_gross` across all pre-season records |
| Pre-season record count | Number of matching rows (confidence proxy) |

This is deterministic and reproducible from any point in time — no snapshot
file is needed. **No new storage is required for "what we thought."**

---

### Trigger: "Season Has Ended"

Checked at the end of `process_new_file()` in `watcher.py`, after every
weekly data update. Idempotent — once a season has an entry in
`season_review.json` it is never triggered again.

```python
def check_season_end(data_records, seasons, existing_reviews):
    today = date.today()
    for season_key, season_data in seasons.items():
        if season_key in existing_reviews:
            continue  # already reviewed
        shows = season_data.get("shows", [])
        if not shows:
            continue
        last_close = max(s["close"] for s in shows)   # latest close date in season
        if today <= last_close + timedelta(days=14):
            continue  # season not yet ended with buffer
        # Confirm final data is present
        season_end = f"{int(season_key[:4]) + 1}-06-30"
        season_start = f"{season_key[:4]}-07-01"
        season_records = [r for r in data_records
                          if season_start <= r.get("week_of", "") <= season_end]
        if not season_records:
            continue  # no data for this season at all
        latest_week = max(r["week_of"] for r in season_records)
        if latest_week < last_close:
            continue  # final weeks not yet in data
        yield season_key, shows, season_records
```

**The 14-day buffer** after the last close date ensures that the final week's
XLSX has had time to arrive and be processed before the review fires.

---

### New script: `scripts/generate_season_review.py`

Called from `watcher.py` as a new **Step 2.8**, after Step 2.75 (weekly
highlights) and before Step 3 (git commit).

**Execution order:**

1. Load `data.json`, `seasons.json`, `season_review.json` (or `{}` if absent)
2. Run `check_season_end()` — yields any seasons that qualify
3. For each qualifying season:
   a. Compute pre-season signal for each show (from pre-season records)
   b. Compute actual peer-venue results for each show (from in-season peer records)
   c. Build the `{shows_table}` payload
   d. Call Claude API with retrospective prompt
   e. Write result into `season_review.json` under that season key
4. Return list of seasons reviewed (for watcher git commit inclusion)

---

### Output file

`src/data/season_review.json`

```json
{
  "2025-2026": {
    "summary": "3–4 sentence retrospective here.",
    "generated_at": "2026-07-22T10:30:00",
    "shows": [
      {
        "name": "Hamilton",
        "sub": true,
        "pre_cap": 0.87,
        "pre_peer_cap": 0.84,
        "pre_gross": 1420000,
        "pre_record_count": 312,
        "actual_peer_cap": 0.91,
        "actual_peer_gross": 1520000,
        "actual_peer_weeks": 8
      }
    ]
  }
}
```

The `shows` array is stored alongside the summary so the dashboard can render
a per-show comparison table without re-computing from raw data.

---

### API prompt — end-of-season retrospective

```
You are writing an end-of-season retrospective for the programming and
leadership team at The Bushnell Center for the Performing Arts in Hartford, CT.

The following shows completed their runs as part of Bushnell's {season_name}
Broadway season. For each show, the data compares the national touring signal
available before the season began against its actual performance at peer
venues of comparable size (~2,400–3,000 seats) during the season.

{shows_table}

Column definitions:
- Pre-Season Cap%: average paid capacity across all national records for
  this show before the season began (the signal available at booking time)
- Pre-Season Peer Cap%: same, filtered to Bushnell-size venues only
- Actual Peer Cap%: average paid capacity at peer venues during the season
- Actual Peer Gross: average weekly gross at peer venues during the season
- Sub: whether the show was part of Bushnell's subscriber package

Write a 3–4 sentence retrospective that identifies: (1) which shows
outperformed their pre-season peer signal, (2) which underperformed,
and (3) any pattern across the season as a whole — for example, whether
subscription shows performed differently from add-ons, or whether there
was a consistent gap between national signal and peer-venue results.
Do not recommend future booking decisions. Write in plain language
appropriate for a leadership team. Keep it under 120 words.
```

Where `{shows_table}` is formatted as:

```
Show              | Sub | Pre Cap% | Pre Peer% | Act Peer% | Act Gross | Wks
Hamilton          | Yes |    87%   |    84%    |    91%    |  $1.52M   |  8
Wicked 2          | No  |    72%   |    69%    |    66%    |  $920K    |  5
...
```

Only aggregate data — no patron, ticket-holder, or customer-level information.

---

### Where Feature 2 surfaces in exec_summary.html

**Recommendation: inject into the existing `#tab-brief` for past seasons.**

`renderBrief()` already branches on `mode`:
- `'future'` → forward-looking language
- `'current'` → live season view
- `'past'` → historical performance lens (already calls `bushnellBriefCard`)

For `mode === 'past'`, after the existing innerHTML assignment and chart calls,
fetch `season_review.json` and look up by `season.id`. If an entry exists,
prepend an **amber callout** (visually distinct from the weekly teal callout)
to `#tab-brief`:

```
┌──────────────────────────────────────────────────────┐
│  SEASON RETROSPECTIVE · 2025-2026               amber │
│  3–4 sentence AI-generated summary here.             │
└──────────────────────────────────────────────────────┘
[existing section-divider "Executive Brief"]
[existing content — callout, What to Watch card, etc.]
```

For `mode === 'current'`, the weekly highlight (teal) appears instead.
The two callouts are mutually exclusive by season mode — no conflict.

A collapsible "Show-by-show comparison" section below the summary callout
would render the `shows` array from `season_review.json` as a small table
(pre vs. actual peer cap%, using existing `.mini-table` styles).

---

## Files Touched Summary

| File | Feature | Change |
|---|---|---|
| `scripts/generate_highlights.py` | F1 | **New** — season-scoped threshold + API logic |
| `scripts/generate_season_review.py` | F2 | **New** — season-end trigger + API logic |
| `scripts/watcher.py` | F1 + F2 | Add Steps 2.75 and 2.8; add output files to git commit list |
| `src/exec_summary.html` | F1 + F2 | ~10 lines after `chartCap` call: fetch highlight (teal, current) and/or review (amber, past) |
| `src/programming.html` | F1 | ~5 lines after `chartCap` call: fetch programming highlight |
| `src/data/exec_brief_highlight.json` | F1 | Season-keyed object; written by pipeline |
| `src/data/programming_highlight.json` | F1 | Season-keyed object; written by pipeline |
| `src/data/season_review.json` | F2 | Season-keyed object; written once per season |
| `seasons.json` | — | **No changes needed** |
| `data.json` | — | **No changes needed** |
| `.env` | — | `ANTHROPIC_API_KEY` must be present |
