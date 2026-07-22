# AI Highlight Pipeline — Implementation Plan

Auto-generated weekly intelligence blurbs for the Executive Brief and
Programming Brief tabs, triggered only by hard-coded data thresholds.
No AI call fires unless at least one threshold trips.

*Status: SUPERSEDED — replaced by `AI_PIPELINE_PLAN.md`, which added season-keyed output and the end-of-season review (Feature 2). See that document for the current implementation.*

---

## Overview

When a new Broadway League report is ingested, a new pipeline step evaluates
hard-coded thresholds against the updated data. If any threshold trips for a
given page, the step calls the Anthropic API with only the aggregate data that
triggered the rule, writes a small JSON file, and the dashboard page injects
a callout into the existing Brief tab on next load. If no threshold trips,
nothing happens — no API call, no file write, no visual change.

---

## Where the Trigger Check Runs

**`scripts/watcher.py` — new Step 2.75**, inserted between the existing
Step 2.5 (scrape_context.py) and Step 3 (git commit).

At that point `data.json` is already updated and available on disk.
The step calls the new script `scripts/generate_highlights.py` via subprocess.
If it fails for any reason, `watcher.py` logs a warning and continues to
the git commit — the highlight step never blocks deployment.

`process_touring.py` is not modified.

---

## New File: `scripts/generate_highlights.py`

Responsible for all threshold evaluation, API calls, and file writes.

**Execution order:**

1. Load `data.json` and `seasons.json`
2. Identify the current season's show list from `seasons.json`
3. Determine the two most recent distinct `week_of` values across all records
4. Evaluate thresholds for each page's scope (see below)
5. If thresholds trip → format the trigger payload → call Claude API → write JSON file
6. Return exit code 0 always; log warnings on API failure; write nothing on silence

---

## Trigger Thresholds

All thresholds evaluated only against the **current season's shows**
(from `seasons.json`). Records with `no_engagement = true` and
`gross_gross = null` are excluded from all calculations.

### exec_summary scope — peer venues only (`similar_bushnell = true`)

| Trigger | Value | Notes |
|---|---|---|
| WoW gross change | ≥ ±15% | `(this_week − prev_week) / prev_week` per show, summed across peer venues |
| Cap% band crossing | `<60%` ↔ `60–89%` ↔ `≥90%` | Average `cap_paid` across peer venues moves from one band to another week-over-week |
| Show opens | First appearance of a season show in peer-venue data | Show name absent from all prior weeks |
| Show closes | Season show present in prior week, absent from current week | Only after ≥2 weeks of data |
| All-time high/low | Current week's peer-venue gross or cap exceeds every prior record for that show | Across all seasons in `data.json` |

### programming scope — all venues nationally

| Trigger | Value | Notes |
|---|---|---|
| WoW gross change | ≥ ±15% | Per show, summed across all venues nationally |
| Cap% band crossing | same `<60%` / `60–89%` / `≥90%` bands | Average `cap_paid` nationally |
| Show opens / closes | same logic, all venues | |
| All-time high/low | Current week's national gross or cap exceeds every prior record | |

If no threshold trips for a given page, the script produces no output
for that page — no API call, no file, no visual change.

---

## Output Files

`src/data/exec_brief_highlight.json`
`src/data/programming_highlight.json`

```json
{
  "week_of": "2026-07-14",
  "trigger": "wow_gross_change,cap_band_crossing",
  "summary": "Two sentences of plain-language narrative here.",
  "generated_at": "2026-07-22T14:30:00"
}
```

Both files are added to `files_to_add` in `watcher.py`'s git commit step
only if they were written during that run.

---

## API Configuration

**Model:** `claude-haiku-4-5-20251001`
Fast, low-cost, sufficient for a 2–3 sentence narrative.

**Key:** `ANTHROPIC_API_KEY` from `.env`, read via `python-dotenv`.

**On failure:** log a warning, skip the file write, continue. The dashboard
silently shows no callout. The pipeline is never blocked.

---

## Prompt — exec_summary page

```
You are writing a one-paragraph executive brief for the COO of The Bushnell
Center for the Performing Arts in Hartford, CT.

The following significant changes occurred in this week's Broadway League
touring data for shows in Bushnell's current season slate, measured against
peer venues of comparable size (~2,400–3,000 seats):

{trigger_summary}

Write 2–3 sentences in plain language suitable for senior leadership.
Describe what happened, which show(s) are involved, and what the data
may signal. Do not speculate beyond what the numbers show. Do not
recommend booking or cancellation decisions. Keep it under 80 words.
```

Where `{trigger_summary}` contains only the aggregate data that tripped
the rule — never patron or customer-level data. Example:

```
- Hamilton: peer-venue gross +23% week-over-week ($1.20M → $1.48M,
  week of 2026-07-14). Paid capacity moved from 87% to 94% (band: mid → high).
- Wicked 2: new all-time high peer-venue weekly gross $2.1M
  (week of 2026-07-14, Connor Palace, Cleveland). Prior record: $1.97M.
```

---

## Prompt — programming page

```
You are writing a one-paragraph weekly intelligence note for the programming
director at The Bushnell Center for the Performing Arts in Hartford, CT.

The following significant changes occurred in this week's Broadway League
touring data for shows in Bushnell's current season slate, across all
national touring markets:

{trigger_summary}

Write 2–3 sentences in a direct, analytical tone appropriate for a
programming professional. Describe what changed, which show(s) are
involved, and what the data signals about national touring demand.
Do not recommend booking or cancellation decisions. Do not speculate
beyond the data. Keep it under 80 words.
```

---

## Dashboard Injection

Both pages follow the same pattern. After the existing
`$('tab-brief').innerHTML = ...` assignment and chart calls complete,
a `fetch()` checks for the highlight file. If it exists **and its
`week_of` matches the dashboard's `LAST_REPORT_DATE`**, a callout div
is prepended to `#tab-brief`. If the fetch fails or the week does not
match, nothing happens — silent.

### exec_summary.html

Insert after ~line 2198 (`chartCap(ranked, 'cBriefCap')`).
Callout prepends before the `section-divider` — first element the COO sees.

### programming.html

Insert after ~line 1300 (`chartCap(profiles, 'cBriefCap')`).
Same — prepended to `#tab-brief`, above the section divider.

### Callout element (both pages)

```html
<div class="callout ai-highlight"
     style="border-left-color:var(--teal);margin-bottom:16px;">
  <div style="font-size:0.6rem;font-weight:700;letter-spacing:0.12em;
              text-transform:uppercase;color:var(--teal);margin-bottom:6px;">
    Weekly Intelligence · {week_of}
  </div>
  <p style="margin:0;">{summary}</p>
</div>
```

Reuses the existing `.callout` styles from `styles.css` — no new CSS needed.

---

## Files Touched

| File | Change |
|---|---|
| `scripts/generate_highlights.py` | **New** — all threshold + API logic |
| `scripts/watcher.py` | Add Step 2.75 subprocess call; add highlight files to git commit list |
| `src/exec_summary.html` | ~5 lines after `chartCap` call to fetch and inject callout |
| `src/programming.html` | ~5 lines after `chartCap` call to fetch and inject callout |
| `src/data/exec_brief_highlight.json` | Written by pipeline; read by dashboard |
| `src/data/programming_highlight.json` | Written by pipeline; read by dashboard |
| `.env` | `ANTHROPIC_API_KEY` must be present; read by `python-dotenv` |
