"""
Broadway Touring Dashboard — AI Weekly Highlight Generator
Bushnell Center for the Performing Arts

Evaluates hard-coded thresholds against the current week's data.
If any threshold trips for a page's scope, calls the Anthropic API and
writes a season-keyed entry to the highlight JSON files.

IMPORTANT: Only aggregate data (show name, gross, capacity) is ever sent
to the API. No patron, customer, or donor information is included.

Usage:
    python generate_highlights.py [--dry-run]

    --dry-run  Evaluate thresholds and write stub output without
               calling the Anthropic API. Use to verify trigger logic
               and output file format before live deployment.

Output files (season-keyed):
    src/data/exec_brief_highlight.json
    src/data/programming_highlight.json

    Format: { "YYYY-YYYY": { week_of, trigger, summary, generated_at }, ... }

Returns:
    List of relative paths written (for watcher.py to git-add).
    Empty list if no thresholds tripped.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from highlight_guard import validate_summary, GUARD_VERSION   # noqa: E402

# ── PATHS ─────────────────────────────────────────────────────────────────────

REPO     = Path(__file__).resolve().parent.parent
DATA     = REPO / "src" / "data" / "data.json"
SEASONS  = REPO / "src" / "data" / "seasons.json"
EXEC_OUT = REPO / "src" / "data" / "exec_brief_highlight.json"
PROG_OUT = REPO / "src" / "data" / "programming_highlight.json"

# ── THRESHOLDS ────────────────────────────────────────────────────────────────

WOW_THRESHOLD_PCT   = 15.0    # ±15% week-over-week gross change
CAP_LOW_BAND        = 60.0    # below this = low band
CAP_HIGH_BAND       = 90.0    # at or above this = high band
CLOSE_MIN_WEEKS     = 2       # show must have appeared this many prior weeks
MIN_ABSENCE_WEEKS   = 12      # consecutive calendar weeks a show must be missing
                              # before an absence is even worth reporting.
                              #
                              # This is NOT a closure threshold — no such
                              # threshold exists. Measured against data.json
                              # (2019–2026, absence spells with a full year of
                              # follow-up so the outcome isn't censored):
                              #   absent ≥6 wks  → 52% of shows came back
                              #   absent ≥12 wks → 35% came back
                              #   absent ≥26 wks → 17% came back
                              # Longest gap a show returned from: 64 weeks.
                              # Absence from this feed can never prove a tour
                              # closed, at any threshold. See ABSENCE POLICY.

# ── ABSENCE POLICY ────────────────────────────────────────────────────────────
#
# Touring shows routinely go dark and come back. The feed shows ~15 distinct
# shows reporting nationally in Jul/Aug/Sep vs 23–26 in Jan–Apr — a summer
# hiatus is normal business activity, not news. Combined with the base rates
# above, this pipeline must never assert (or let the model infer) that a tour
# has closed, ended, concluded, or exited touring. It may only report the
# observable fact: "absent from the feed for N weeks, last seen <date>."
HIATUS_MONTHS       = {6, 7, 8, 9}   # Jun–Sep: absence carries no signal here

BAND_LABELS = {0: "low (<60%)", 1: "mid (60–89%)", 2: "high (≥90%)"}

# ── LOGGING ───────────────────────────────────────────────────────────────────

log = logging.getLogger(__name__)

# ── SEASON HELPERS ────────────────────────────────────────────────────────────


def fiscal_year(date_str: str) -> str:
    """Map a week_of date string to its season key ('2026-2027')."""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    y = d.year if d.month >= 7 else d.year - 1
    return f"{y}-{y + 1}"


def cap_band(cap) -> int | None:
    """Classify a capacity percentage into a band: 0=low, 1=mid, 2=high."""
    if cap is None:
        return None
    if cap < CAP_LOW_BAND:
        return 0
    if cap < CAP_HIGH_BAND:
        return 1
    return 2


def fmt_dollars(v) -> str:
    if v is None:
        return "—"
    if v >= 1_000_000:
        return f"${v / 1_000_000:.2f}M"
    if v >= 1_000:
        return f"${v / 1_000:.0f}K"
    return f"${v:.0f}"


def fmt_pct(v) -> str:
    if v is None:
        return "—"
    return f"{v:.1f}%"


def is_active(record: dict) -> bool:
    """Exclude dark / no-engagement rows that carry no performance data."""
    return not (record.get("no_engagement") and record.get("gross_gross") is None)


def is_peer(record: dict) -> bool:
    """True for Bushnell-size comparable venues (similar_bushnell flag)."""
    return bool(record.get("similar_bushnell"))


# ── AGGREGATION ───────────────────────────────────────────────────────────────


def aggregate_by_show(records: list) -> dict:
    """
    Aggregate gross total and average cap_paid by show for a set of records.

    Returns: { show_name: { gross_total, cap_avg, week_count } }

    Only aggregate data — no individual venue or patron detail — is used.
    """
    gross_total = defaultdict(float)
    gross_cnt   = defaultdict(int)
    cap_sum     = defaultdict(float)
    cap_cnt     = defaultdict(int)

    for r in records:
        if not is_active(r):
            continue
        show = (r.get("show") or "").strip()
        if not show:
            continue
        g = r.get("gross_gross")
        c = r.get("cap_paid")
        if g is not None:
            gross_total[show] += g
            gross_cnt[show]   += 1
        if c is not None:
            cap_sum[show] += c
            cap_cnt[show] += 1

    result = {}
    for show in gross_total | cap_sum:
        result[show] = {
            "gross_total": gross_total[show] if gross_cnt[show] else None,
            "cap_avg":     cap_sum[show] / cap_cnt[show] if cap_cnt[show] else None,
            "week_count":  gross_cnt[show],
        }
    return result


# ── THRESHOLD EVALUATION ──────────────────────────────────────────────────────


def evaluate_thresholds(
    season_league_names: set,
    current_week: str,
    prior_week: str | None,
    same_season_wow: bool,
    curr_records: list,
    prev_records: list,
    all_scope_records: list,
    prior_weeks_by_show: dict,
    all_weeks: list,
    national_curr_agg: dict | None = None,
    national_weeks_by_show: dict | None = None,
) -> list:
    """
    Evaluate all hard-coded thresholds for one scope (peer or all-venue).

    all_weeks: sorted list of every distinct week_of in the dataset (the
    calendar), used to measure how many consecutive weekly snapshots a show
    has been missing from this scope — see MIN_ABSENCE_WEEKS.

    national_curr_agg: current week's show aggregation for ALL venues nationally
    (aggregate_by_show(curr_all)), used by the national-fallback path in run().

    national_weeks_by_show: show → set of every week_of it appeared anywhere
    nationally (including the current week). Absence claims about national data
    MUST be measured against this, not against the calling scope's history —
    reporting a peer-scope "last seen" date next to a claim of national absence
    previously produced a factually false brief. Leave None when evaluating the
    national scope itself, where this scope's own history is already national.

    Returns list of trigger dicts: { type, show, description }
    where description is the plain-text line sent to the API prompt.
    """
    triggers = []

    curr_agg = aggregate_by_show(curr_records)
    prev_agg = aggregate_by_show(prev_records) if (same_season_wow and prev_records) else {}

    # ── All-time records by show (exclude current week to get historical baseline)
    all_time_gross = defaultdict(float)
    all_time_cap   = defaultdict(float)
    for r in all_scope_records:
        if not is_active(r):
            continue
        show = (r.get("show") or "").strip()
        if show not in season_league_names:
            continue
        if (r.get("week_of") or "") >= current_week:
            continue   # exclude current week from all-time baseline
        g = r.get("gross_gross")
        c = r.get("cap_paid")
        if g is not None:
            all_time_gross[show] = max(all_time_gross.get(show, 0), g)
        if c is not None:
            all_time_cap[show]   = max(all_time_cap.get(show, 0.0), c)

    # ── Per-show checks
    for show, curr in curr_agg.items():
        if show not in season_league_names:
            continue

        prev = prev_agg.get(show)
        prior_weeks = prior_weeks_by_show.get(show, set())

        # — Week-over-week gross change ≥ ±15%
        if same_season_wow and prev and prev.get("gross_total") and curr.get("gross_total"):
            prev_g = prev["gross_total"]
            curr_g = curr["gross_total"]
            pct_chg = (curr_g - prev_g) / prev_g * 100
            if abs(pct_chg) >= WOW_THRESHOLD_PCT:
                sign = "+" if pct_chg > 0 else ""
                triggers.append({
                    "type": "wow_gross_change",
                    "show": show,
                    "description": (
                        f"{show}: gross {sign}{pct_chg:.0f}% week-over-week "
                        f"({fmt_dollars(prev_g)} → {fmt_dollars(curr_g)}, "
                        f"week of {current_week})"
                    ),
                })

        # — Capacity band crossing
        if same_season_wow and prev and prev.get("cap_avg") is not None and curr.get("cap_avg") is not None:
            prev_band = cap_band(prev["cap_avg"])
            curr_band = cap_band(curr["cap_avg"])
            if prev_band is not None and curr_band is not None and prev_band != curr_band:
                triggers.append({
                    "type": "cap_band_crossing",
                    "show": show,
                    "description": (
                        f"{show}: paid capacity moved from {fmt_pct(prev['cap_avg'])} "
                        f"to {fmt_pct(curr['cap_avg'])} "
                        f"(band: {BAND_LABELS[prev_band]} → {BAND_LABELS[curr_band]}, "
                        f"week of {current_week})"
                    ),
                })

        # — Show opens (first appearance in this scope)
        if not prior_weeks:
            triggers.append({
                "type": "show_opens",
                "show": show,
                "description": (
                    f"{show}: first records in scope for the {fiscal_year(current_week)} season "
                    f"(week of {current_week}, gross {fmt_dollars(curr.get('gross_total'))}, "
                    f"cap {fmt_pct(curr.get('cap_avg'))})"
                ),
            })

        # — All-time high gross
        hist_g = all_time_gross.get(show)
        if curr.get("gross_total") and hist_g and curr["gross_total"] > hist_g:
            triggers.append({
                "type": "all_time_high_gross",
                "show": show,
                "description": (
                    f"{show}: new all-time high gross in scope — "
                    f"{fmt_dollars(curr['gross_total'])} "
                    f"(prior record: {fmt_dollars(hist_g)}, week of {current_week})"
                ),
            })

        # — All-time high capacity
        hist_c = all_time_cap.get(show)
        if curr.get("cap_avg") and hist_c and curr["cap_avg"] > hist_c:
            triggers.append({
                "type": "all_time_high_cap",
                "show": show,
                "description": (
                    f"{show}: new all-time high avg paid capacity in scope — "
                    f"{fmt_pct(curr['cap_avg'])} "
                    f"(prior record: {fmt_pct(hist_c)}, week of {current_week})"
                ),
            })

    # — Absence reporting (see ABSENCE POLICY at the top of this file).
    #
    # Reports the observable fact that a show has been missing for a sustained
    # stretch. It NEVER concludes the tour closed — the data does not support
    # that inference at any threshold. Suppressed entirely during the summer
    # hiatus window, when going dark is normal business activity.
    if same_season_wow and int(current_week[5:7]) not in HIATUS_MONTHS:
        for show in season_league_names:
            if show in curr_agg:
                continue   # still present in this scope
            prior_weeks = prior_weeks_by_show.get(show, set())
            if len(prior_weeks) < CLOSE_MIN_WEEKS:
                continue

            last_seen = max(prior_weeks)
            if last_seen not in all_weeks or current_week not in all_weeks:
                continue   # can't measure the gap — skip rather than guess
            weeks_absent = all_weeks.index(current_week) - all_weeks.index(last_seen)
            if weeks_absent < MIN_ABSENCE_WEEKS:
                continue   # not a sustained gap yet

            # Report once, on the first week this show is *eligible* to be
            # reported. Eligibility requires both a sustained gap and a
            # non-hiatus week, so a show that crosses the threshold during the
            # summer window is still reported on the first week after it —
            # rather than being silently suppressed forever by a
            # fire-exactly-at-the-threshold check.
            prev_idx = all_weeks.index(current_week) - 1
            if prev_idx >= 0:
                prev_wk = all_weeks[prev_idx]
                prev_gap = prev_idx - all_weeks.index(last_seen)
                prev_eligible = (
                    prev_gap >= MIN_ABSENCE_WEEKS
                    and int(prev_wk[5:7]) not in HIATUS_MONTHS
                )
                if prev_eligible:
                    continue   # already reported on an earlier eligible week

            # National absence must be measured against NATIONAL history, not
            # this scope's. Reporting a peer-scope "last seen" date alongside a
            # claim of national absence previously produced a flatly false
            # statement (a show active nationally days earlier was reported as
            # having last appeared weeks before, and called closed).
            nat_weeks = (national_weeks_by_show or {}).get(show, set())
            nat_last_seen = max(nat_weeks) if nat_weeks else None
            nat_absent = (
                all_weeks.index(current_week) - all_weeks.index(nat_last_seen)
                if nat_last_seen in all_weeks else None
            )

            if national_weeks_by_show is not None and nat_absent == 0:
                # Still reporting nationally this week — the gap is peer-scope
                # only. A venue-size shift, explicitly not a closure.
                triggers.append({
                    "type": "left_peer_scope",
                    "show": show,
                    "description": (
                        f"{show}: absent from peer-sized venues (~2,400–3,000 seats) "
                        f"for {weeks_absent} consecutive weeks (last seen there week of "
                        f"{last_seen}), but still reporting in national Broadway League "
                        f"data as of the week of {current_week}. This is a venue-size "
                        f"shift, not a closure — the tour is still running."
                    ),
                })
            elif national_weeks_by_show is not None and (
                nat_absent is None or nat_absent < MIN_ABSENCE_WEEKS
            ):
                # Peer gap is sustained but the national gap is not. Not
                # reportable — a show that merely skipped a national week or two
                # is not news, and must never be described as absent nationally.
                continue
            else:
                # Sustained absence in the scope being described. State the fact
                # and nothing more; the base rates make any closure inference
                # unsupportable.
                shown_absent = nat_absent if nat_absent is not None else weeks_absent
                shown_last   = nat_last_seen if nat_last_seen else last_seen
                triggers.append({
                    "type": "absent_from_feed",
                    "show": show,
                    "description": (
                        f"{show}: no records anywhere in the Broadway League feed for "
                        f"{shown_absent} consecutive weeks (last reported week of "
                        f"{shown_last}). This is an observation about the feed, NOT "
                        f"evidence the tour has closed: shows routinely go dark and "
                        f"return — of shows historically absent this long, roughly a "
                        f"third came back, some after a year or more. Worth confirming "
                        f"with booking partners; not a closure."
                    ),
                })

    return triggers


# ── PROMPT BUILDERS ───────────────────────────────────────────────────────────


def build_evidence_note(curr_scope_records: list, all_records: list,
                        current_week: str, scope_label: str) -> str:
    """
    Describe the evidence base behind THIS week's aggregation, in this week's
    own numbers, plus the seasonal norm for the same calendar month.

    The weekly aggregation is what every note ultimately rests on, so how much
    data sits behind it belongs in the brief. This matters most in summer: the
    peer sample thins by roughly a third (median ~6.5 peer records/week Jun–Sep
    vs ~10 Oct–May), so a peer comparison made in August rests on materially
    less evidence than the same comparison in February.

    Deliberately says nothing about demand. Measured across 2019–2026, summer
    does NOT soften per-show performance — median paid capacity at peer venues
    is 85.2% Jun–Sep vs 85.6% Oct–May, and median weekly gross is ~5% HIGHER in
    summer. What summer changes is how many tours are on the road (~15 distinct
    shows reporting nationally vs 23–26 in Jan–Apr), i.e. the size of the
    sample — not how well the shows in it sell. Attributing a specific show's
    decline to "summer" would be inventing a cause the data contradicts.
    """
    n_records = len(curr_scope_records)
    n_venues  = len({(r.get("theatre") or "").strip() for r in curr_scope_records
                     if (r.get("theatre") or "").strip()})

    # Seasonal norm for this calendar month, computed from the data itself
    # rather than hardcoded, so it stays true as the dataset grows.
    month = current_week[5:7]
    per_week = defaultdict(int)
    weeks_in_month = set()
    for r in all_records:
        wk = r.get("week_of") or ""
        if not wk or wk[5:7] != month or not is_active(r):
            continue
        weeks_in_month.add(wk)
        per_week[wk] += 1
    counts = sorted(per_week.get(w, 0) for w in weeks_in_month)
    typical = counts[len(counts) // 2] if counts else 0

    return (
        f"EVIDENCE BASE FOR THIS WEEK: the figures above aggregate "
        f"{n_records} {scope_label} record(s) across {n_venues} venue(s) for the "
        f"week of {current_week}. The typical count for this calendar month "
        f"across all years in the dataset is {typical}."
    )


def build_exec_prompt(season_key: str, trigger_lines: list,
                      evidence_note: str = "") -> str:
    trigger_text = "\n".join(f"- {line}" for line in trigger_lines)
    evidence_block = f"{evidence_note}\n\n" if evidence_note else ""
    return (
        f"You are writing a one-paragraph executive brief for the COO of "
        f"The Bushnell Center for the Performing Arts in Hartford, CT.\n\n"
        f"The following significant changes occurred in this week's Broadway League "
        f"touring data for shows in Bushnell's {season_key} season slate, measured "
        f"against peer venues of comparable size (~2,400–3,000 seats):\n\n"
        f"{trigger_text}\n\n"
        f"{evidence_block}"
        f"If the evidence base above is materially thinner than the typical count "
        f"for this month, note that this week's read rests on fewer records — but "
        f"do NOT suggest that a thin sample, the season, or the time of year "
        f"explains any show's performance. Fewer tours report in summer; the ones "
        f"that do sell no worse than in winter. Never attribute a change to "
        f"seasonality.\n\n"
        f"Write 2–3 sentences in plain language suitable for senior leadership. "
        f"Describe what happened, which show(s) are involved, and what the data "
        f"may signal. Do not speculate beyond what the numbers show. Do not "
        f"recommend booking or cancellation decisions. Only say a tour has "
        f"NEVER state or imply that a tour has closed, ended, concluded, wrapped, "
        f"or exited touring, and never speculate about why a show is absent. "
        f"Absence from this feed does not establish any of that: touring shows "
        f"routinely go dark for months and return, and a summer hiatus is normal. "
        f"If a show is absent, say only that it has not reported for N weeks and "
        f"that it is worth confirming with booking partners. Keep it under 80 words."
    )


def build_exec_national_fallback_prompt(season_key: str, trigger_lines: list) -> str:
    trigger_text = "\n".join(f"- {line}" for line in trigger_lines)
    return (
        f"You are writing a one-paragraph executive brief for the COO of "
        f"The Bushnell Center for the Performing Arts in Hartford, CT.\n\n"
        f"No peer venues of comparable size (~2,400–3,000 seats) reported data "
        f"this week, so there is nothing to compare Bushnell's slate against at "
        f"that scale. Instead, here are the significant changes in this week's "
        f"Broadway League touring data for shows in Bushnell's {season_key} "
        f"season slate across ALL national touring markets (not peer-sized "
        f"venues specifically):\n\n"
        f"{trigger_text}\n\n"
        f"Write 2–3 sentences in plain language suitable for senior leadership. "
        f"Open by noting this reflects national touring data because no "
        f"comparable-size peer venues reported this week. Describe what "
        f"happened, which show(s) are involved, and what the data may signal. "
        f"Do not speculate beyond what the numbers show. Do not recommend "
        f"booking or cancellation decisions. NEVER state or imply that a tour "
        f"has closed, ended, concluded, wrapped, or exited touring, and never "
        f"speculate about why a show is absent — absence from this feed does "
        f"not establish any of that, and a summer hiatus is normal. Keep it "
        f"under 80 words."
    )


def build_prog_prompt(season_key: str, trigger_lines: list,
                      evidence_note: str = "") -> str:
    trigger_text = "\n".join(f"- {line}" for line in trigger_lines)
    evidence_block = f"{evidence_note}\n\n" if evidence_note else ""
    return (
        f"You are writing a one-paragraph weekly intelligence note for the "
        f"programming director at The Bushnell Center for the Performing Arts "
        f"in Hartford, CT.\n\n"
        f"The following significant changes occurred in this week's Broadway League "
        f"touring data for shows in Bushnell's {season_key} season slate, across "
        f"all national touring markets:\n\n"
        f"{trigger_text}\n\n"
        f"{evidence_block}"
        f"If the evidence base above is materially thinner than the typical count "
        f"for this month, note that this week's read rests on fewer records — but "
        f"do NOT suggest that a thin sample, the season, or the time of year "
        f"explains any show's performance. Fewer tours report in summer; the ones "
        f"that do sell no worse than in winter. Never attribute a change to "
        f"seasonality.\n\n"
        f"Write 2–3 sentences in a direct, analytical tone appropriate for a "
        f"programming professional. Describe what changed, which show(s) are "
        f"involved, and what the data signals about national touring demand. "
        f"Do not recommend booking or cancellation decisions. Do not speculate "
        f"beyond the data. NEVER state or imply that a tour has closed, ended, "
        f"concluded, wrapped, or exited touring, and never speculate about why a "
        f"show is absent. Absence from this feed does not establish any of that: "
        f"touring shows routinely go dark for months and return, and a summer "
        f"hiatus is normal. If a show is absent, say only that it has not "
        f"reported for N weeks. Keep it under 80 words."
    )


# ── API CALL ──────────────────────────────────────────────────────────────────


def _call_once(prompt: str) -> str | None:
    try:
        from dotenv import load_dotenv
        load_dotenv(REPO / ".env")
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()
    except Exception as exc:
        log.warning(f"Anthropic API call failed: {exc}")
        return None


def call_api(prompt: str, dry_run: bool, show_names: set | None = None) -> str | None:
    """
    Call Claude Haiku with the trigger prompt and VALIDATE the result before
    returning it. Returns the summary text, or None on failure. Never raises.

    Every summary is checked by highlight_guard.validate_summary() against the
    prompt it came from: numbers, dates, and show names must all trace back to
    the input, and invented causes, predicted consequences, and closure claims
    are rejected outright. Prompt instructions alone did not prevent three
    false briefs from reaching leadership — this is the enforcement layer.

    On a validation failure the model gets exactly one corrective retry. If
    that also fails, this returns None and NOTHING is written — a stale entry
    from a prior week (labeled with its own week_of) beats a confident, wrong
    one. See scripts/highlight_guard.py.
    """
    if dry_run:
        return "[DRY RUN — API not called. Trigger payload above would be sent to claude-haiku-4-5-20251001.]"

    summary = _call_once(prompt)
    if summary is None:
        return None

    problems = validate_summary(summary, prompt, show_names)
    if not problems:
        return summary

    log.warning("Generated summary FAILED validation — retrying once:")
    for p in problems:
        log.warning(f"    • {p}")

    retry_prompt = (
        prompt
        + "\n\nYour previous attempt was rejected for these reasons:\n"
        + "\n".join(f"- {p}" for p in problems)
        + "\n\nRewrite it. Use ONLY the figures, dates, and show names given "
          "above — do not introduce or calculate any others. State what the "
          "data shows and nothing about why it happened, what it means for "
          "Bushnell's bookings, or whether any tour has stopped."
    )
    summary = _call_once(retry_prompt)
    if summary is None:
        return None

    problems = validate_summary(summary, prompt, show_names)
    if problems:
        log.error("Retry ALSO failed validation — writing nothing this run:")
        for p in problems:
            log.error(f"    • {p}")
        return None

    log.info("Retry passed validation.")
    return summary


# ── FILE WRITE ────────────────────────────────────────────────────────────────


# ── WEEKLY DATA PULSE ─────────────────────────────────────────────────────────
#
# Every successful ingestion writes a current-week entry for each page, so a
# reader can always tell the week was processed. Without this, four different
# situations rendered identically — no data, the watcher never ran, the guard
# rejected the AI copy, and a genuinely uneventful week — and the previous
# week's confidently-worded callout stayed on screen looking current.
#
# Pulse copy is built entirely in Python. Routing the COMMON case through the
# model would put a failure surface on the quiet weeks, which is backwards.

_SMALL_NUMBERS = {
    0: "No", 1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six",
    7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten", 11: "Eleven", 12: "Twelve",
}


def comparison_availability(curr_records: list, prev_records: list,
                            same_season_wow: bool) -> dict:
    """
    Decide whether a week-over-week comparison was actually possible for this
    scope, and why not when it wasn't.

    Comparability is a property of SHOWS, not record counts: a WoW change can
    only be computed for a show present in both scoped weeks. A scope can hold
    records in both weeks and still support no comparison at all.

    None of these states mean the previous reporting week is unavailable — it
    exists in data.json either way. `prior_week` is derived globally from the
    dataset and is never inferred from these counts or from the output files.

    Returns the counts plus one of:
      available               at least one show appears in both scoped weeks
      no_prior_scope_records  prior reporting week holds no records in scope
      no_comparable_shows     both weeks hold records, no show in common
      season_boundary         WoW intentionally reset across the fiscal boundary
    """
    curr_agg  = aggregate_by_show(curr_records)
    prior_agg = aggregate_by_show(prev_records)
    comparable = set(curr_agg) & set(prior_agg)

    if not same_season_wow:
        status = "season_boundary"
    elif not prev_records:
        status = "no_prior_scope_records"
    elif not comparable:
        status = "no_comparable_shows"
    else:
        status = "available"

    return {
        "comparison_status": status,
        "current_records":   len(curr_records),
        "prior_records":     len(prev_records),
        "current_shows":     len(curr_agg),
        "prior_shows":       len(prior_agg),
        "comparable_shows":  len(comparable),
        "same_season":       bool(same_season_wow),
    }


def _count_word(n: int, capitalize: bool = False) -> str:
    w = _SMALL_NUMBERS.get(n, str(n))
    return w if capitalize else w.lower()


def long_date(iso: str) -> str:
    """2026-08-30 -> 'August 30, 2026' (the form the pulse prints)."""
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%B %-d, %Y") \
        if os.name != "nt" else \
        datetime.strptime(iso, "%Y-%m-%d").strftime("%B ") + \
        str(datetime.strptime(iso, "%Y-%m-%d").day) + \
        datetime.strptime(iso, "%Y-%m-%d").strftime(", %Y")


def _comparison_clause(status: str, body: str) -> str:
    """
    Say plainly whether a week-over-week comparison ran.

    "No configured material-change threshold was reached" implies the
    comparison ran and found stability. When a whole class of comparison could
    not run, saying only that is misleading, so each unavailable state names
    its own reason. No wording here implies a report is missing — the prior
    reporting week exists in the dataset in every one of these cases.
    """
    if status == "no_prior_scope_records":
        return (f" The prior reporting week contained no {body} records for "
                f"this slate, so a week-over-week comparison was not available.")
    if status == "no_comparable_shows":
        return (" Both reporting weeks contained relevant records, but no "
                "season-slate show appeared in both weeks, so a like-for-like "
                "week-over-week comparison was not available.")
    if status == "season_boundary":
        return (" Week-over-week comparison is intentionally reset at the "
                "fiscal-season boundary, so no comparison against the prior "
                "reporting week was made.")
    return ""


def build_pulse(week_of: str, scope: str, scope_records: list,
                all_scope_records: list, reason: str,
                comparison: dict | None = None) -> tuple:
    """
    Build deterministic current-week confirmation copy, plus the fact string it
    is checked against.

    reason:
      "no_threshold"                — a normal quiet week
      "highlight_validation_failed" — a threshold DID fire but the AI narrative
                                      failed validation twice. This must not
                                      claim that nothing happened.

    Returns (summary, facts).

    Deliberately describes the evidence that IS present rather than the
    evidence that is absent. "9 of 10 slate shows did not report" is true but
    predictably misleading in a season where most productions have not begun
    touring, so it is never printed.
    """
    when = long_date(week_of)
    noun = "peer venue" if scope in ("peer", "national_fallback") else "venue"
    body = "peer-venue" if scope in ("peer", "national_fallback") else "national touring"

    if reason == "highlight_validation_failed":
        summary = (
            f"Data updated through the week of {when}. A configured "
            f"material-change threshold was detected, but the automated "
            f"narrative did not pass validation. Review the current dashboard "
            f"metrics for detail."
        )
        return summary, f"week_of {week_of} ({when})"

    shows  = {(r.get("show") or "").strip() for r in scope_records
              if is_active(r) and (r.get("show") or "").strip()}
    venues = {(r.get("theatre") or "").strip() for r in scope_records
              if is_active(r) and (r.get("theatre") or "").strip()}

    if not shows:
        # State the absence plainly. It reflects which venues appear in this
        # week's feed — not a closure, cancellation, weak demand, or a failure
        # to report, none of which this data can establish.
        summary = (
            f"Data updated through the week of {when}. No season-slate shows "
            f"appear in {body} data for this week. No configured "
            f"material-change threshold was reached."
        )
        return summary, f"week_of {week_of} ({when})"

    n_s, n_v = len(shows), len(venues)
    show_word = "show" if n_s == 1 else "shows"
    venue_word = noun if n_v == 1 else noun + "s"
    counted = (f"{_count_word(n_s, True)} season-slate {show_word} reported "
               f"at {_count_word(n_v)} {venue_word}")

    # The calendar-month norm is included only when this week is at or above
    # it. Printing it on a below-norm week frames an ordinary quiet week as a
    # shortfall, which is exactly the inference this copy must not invite.
    month = week_of[5:7]
    per_week = defaultdict(int)
    weeks_seen = set()
    for r in all_scope_records:
        wk = r.get("week_of") or ""
        if wk and wk[5:7] == month and is_active(r):
            weeks_seen.add(wk)
            per_week[wk] += 1
    counts = sorted(per_week.get(w, 0) for w in weeks_seen)
    typical = counts[len(counts) // 2] if counts else 0
    norm = ""
    if typical and len(scope_records) >= typical:
        norm = (f" That is in line with the usual volume of {body} records for "
                f"this point in the year.")

    status = (comparison or {}).get("comparison_status", "available")
    clause = _comparison_clause(status, body)

    # Independent checks — show_opens and the all-time highs — do not need a
    # prior-week match and are evaluated whenever the current week has scoped
    # shows. Only claim they ran when they actually did.
    if status == "available":
        outcome = " No configured material-change threshold was reached."
    else:
        outcome = " Other configured checks produced no material highlight."

    summary = (f"Data updated through the week of {when}. {counted}."
               f"{norm}{clause}{outcome}")
    facts = (f"week_of {week_of} ({when}); shows {n_s}; venues {n_v}; "
             f"records {len(scope_records)}; typical {typical}")
    return summary, facts


def write_entry(out_path: Path, season_key: str, week_of: str,
                summary: str, kind: str, scope: str,
                triggers: list | None = None,
                pulse_reason: str | None = None,
                validation_status: str = "passed",
                validation_method: str = "ai_guard",
                comparison: dict | None = None) -> None:
    """
    Merge one season's entry into the season-keyed JSON file.

    kind:         "highlight" (guarded AI narrative) or "pulse" (deterministic
                  current-week confirmation).
    pulse_reason: "no_threshold" | "highlight_validation_failed" | None.
    scope:        "peer" | "national" | "national_fallback" — which evidence
                  the entry describes, so the page cannot mislabel what the
                  reader is looking at.

    Entries written before these fields existed simply lack them; consumers
    must treat a missing `kind` as a highlight (see the page renderers).
    """
    existing = {}
    if out_path.exists():
        with open(out_path, encoding="utf-8") as f:
            existing = json.load(f)

    existing[season_key] = {
        "kind":              kind,
        "pulse_reason":      pulse_reason,
        "scope":             scope,
        "week_of":           week_of,
        "trigger":           ",".join(sorted({t["type"] for t in (triggers or [])})),
        "summary":           summary,
        "generated_at":      datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
        "validation_status": validation_status,
        "validation_method": validation_method,
        "guard_version":     GUARD_VERSION,
        # Why a week-over-week comparison was or was not possible for this
        # scope. None of its values mean the prior reporting week is missing.
        "comparison_status": (comparison or {}).get("comparison_status"),
        "comparison_detail": {k: v for k, v in (comparison or {}).items()
                              if k != "comparison_status"} or None,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)


def write_pulse(out_path: Path, season_key: str, week_of: str, scope: str,
                scope_records: list, all_scope_records: list, reason: str,
                triggers: list | None = None,
                comparison: dict | None = None) -> bool:
    """
    Build, validate and write a deterministic pulse. Returns True if written.

    The pulse is checked by the same guard that polices AI copy. It should
    never fail: if it does, that is a defect in this function, not untrusted
    model output — so it is logged loudly and the write is abandoned. Rejected
    AI copy is never substituted, and the rest of the pipeline continues.
    """
    summary, facts = build_pulse(week_of, scope, scope_records,
                                 all_scope_records, reason, comparison)
    problems = validate_summary(summary, facts)
    if problems:
        log.error(f"DEFECT: deterministic pulse for {out_path.name} failed its own "
                  f"validation — not writing. This is a code bug, not model output:")
        for p in problems:
            log.error(f"    • {p}")
        return False

    write_entry(out_path, season_key, week_of, summary, "pulse", scope,
                triggers=triggers, pulse_reason=reason,
                validation_status="fallback", validation_method="deterministic",
                comparison=comparison)
    log.info(f"Wrote {scope} pulse ({reason}) for {season_key} → {out_path.name}")
    return True


# ── MAIN ──────────────────────────────────────────────────────────────────────


def run(dry_run: bool = False) -> list:
    """
    Evaluate thresholds and write highlight files if any trips.
    Returns list of repo-relative paths written (empty if nothing fired).
    """
    # Load data
    with open(DATA, encoding="utf-8") as f:
        raw = json.load(f)
    records = raw.get("records", raw) if isinstance(raw, dict) else raw
    log.info(f"Loaded {len(records):,} records from data.json")

    with open(SEASONS, encoding="utf-8") as f:
        seasons = json.load(f)

    # ── Find two most recent week_of values across all records
    all_weeks = sorted({r["week_of"] for r in records if r.get("week_of")})
    if len(all_weeks) < 2:
        log.error("Fewer than 2 distinct weeks in data.json — cannot evaluate thresholds.")
        return []

    current_week     = all_weeks[-1]
    prior_week       = all_weeks[-2]
    current_season   = fiscal_year(current_week)
    prior_season     = fiscal_year(prior_week)
    same_season_wow  = (current_season == prior_season)

    log.info(f"Current week : {current_week}  (season: {current_season})")
    log.info(f"Prior week   : {prior_week}  (season: {prior_season})")
    log.info(f"Same-season WoW comparisons: {'YES' if same_season_wow else 'NO (season boundary — WoW skipped)'}")

    # ── Current season's shows from seasons.json
    season_data  = seasons.get(current_season, {})
    season_shows = season_data.get("shows", [])
    if not season_shows:
        log.warning(f"No shows found in seasons.json for {current_season} — nothing to evaluate.")
        return []

    # Match against data.json using league_name (Broadway League canonical name)
    season_league_names = {
        (s.get("league_name") or s.get("name") or "").strip()
        for s in season_shows
    }
    season_league_names.discard("")
    log.info(f"Season {current_season} shows in scope ({len(season_league_names)}): "
             f"{', '.join(sorted(season_league_names))}")

    # ── Build prior-weeks-by-show for open/close detection
    # Maps show name → set of week_of dates seen before the current week
    prior_weeks_all  = defaultdict(set)   # all venues
    prior_weeks_peer = defaultdict(set)   # peer venues only

    for r in records:
        show = (r.get("show") or "").strip()
        wk   = r.get("week_of") or ""
        if not show or not wk or wk >= current_week:
            continue
        if show not in season_league_names:
            continue
        if not is_active(r):
            continue
        prior_weeks_all[show].add(wk)
        if is_peer(r):
            prior_weeks_peer[show].add(wk)

    # ── Filter records to season's shows
    season_records = [r for r in records
                      if (r.get("show") or "").strip() in season_league_names]

    # ── EXEC SCOPE: peer venues only (similar_bushnell = True)
    peer_records = [r for r in season_records if is_peer(r)]
    curr_peer    = [r for r in peer_records if r.get("week_of") == current_week]
    prev_peer    = [r for r in peer_records if r.get("week_of") == prior_week]

    exec_cmp = comparison_availability(curr_peer, prev_peer, same_season_wow)
    log.info(f"Exec scope   — current week peer records : {len(curr_peer)}")
    log.info(f"Exec scope   — prior week peer records   : {len(prev_peer)}"
             f"   (prior reporting week {prior_week} exists in data.json)")
    log.info(f"Exec scope   — WoW comparison            : {exec_cmp['comparison_status']} "
             f"(current shows {exec_cmp['current_shows']}, prior shows "
             f"{exec_cmp['prior_shows']}, comparable {exec_cmp['comparable_shows']})")

    # ── PROG SCOPE inputs computed early so the exec scope can check national
    # presence before saying anything about a show being absent nationally
    curr_all = [r for r in season_records if r.get("week_of") == current_week]
    prev_all = [r for r in season_records if r.get("week_of") == prior_week]
    national_curr_agg = aggregate_by_show(curr_all)

    # Full national appearance history (INCLUDING the current week) — any claim
    # about national absence must be measured against this, never against the
    # peer-scope history, which describes a different population entirely.
    national_weeks_by_show = defaultdict(set)
    for r in season_records:
        show = (r.get("show") or "").strip()
        wk   = r.get("week_of") or ""
        if show and wk and is_active(r):
            national_weeks_by_show[show].add(wk)

    exec_triggers = evaluate_thresholds(
        season_league_names = season_league_names,
        current_week        = current_week,
        prior_week          = prior_week,
        same_season_wow     = same_season_wow,
        curr_records        = curr_peer,
        prev_records        = prev_peer,
        all_scope_records   = peer_records,
        prior_weeks_by_show    = prior_weeks_peer,
        all_weeks              = all_weeks,
        national_curr_agg      = national_curr_agg,
        national_weeks_by_show = national_weeks_by_show,
    )

    # ── PROG SCOPE: all venues nationally

    prog_cmp = comparison_availability(curr_all, prev_all, same_season_wow)
    log.info(f"Prog scope   — current week all records  : {len(curr_all)}")
    log.info(f"Prog scope   — prior week all records    : {len(prev_all)}"
             f"   (prior reporting week {prior_week} exists in data.json)")
    log.info(f"Prog scope   — WoW comparison            : {prog_cmp['comparison_status']} "
             f"(current shows {prog_cmp['current_shows']}, prior shows "
             f"{prog_cmp['prior_shows']}, comparable {prog_cmp['comparable_shows']})")

    prog_triggers = evaluate_thresholds(
        season_league_names = season_league_names,
        current_week        = current_week,
        prior_week          = prior_week,
        same_season_wow     = same_season_wow,
        curr_records        = curr_all,
        prev_records        = prev_all,
        all_scope_records   = season_records,
        prior_weeks_by_show = prior_weeks_all,
        all_weeks           = all_weeks,
    )

    written = []

    # ── Write exec entry — ALWAYS one of three outcomes, never nothing.
    # A guard rejection must not be left looking like an old callout, so it
    # publishes a current-week pulse that says a threshold fired but the
    # narrative could not be validated.
    if exec_triggers:
        log.info(f"EXEC triggers ({len(exec_triggers)}):")
        for t in exec_triggers:
            log.info(f"  [{t['type']}] {t['description']}")
        prompt  = build_exec_prompt(current_season, [t["description"] for t in exec_triggers],
                                    build_evidence_note(curr_peer, peer_records, current_week,
                                                        "peer-venue"))
        summary = call_api(prompt, dry_run, season_league_names)
        if summary:
            write_entry(EXEC_OUT, current_season, current_week, summary,
                        "highlight", "peer", triggers=exec_triggers,
                        comparison=exec_cmp)
            log.info(f"Wrote exec highlight for {current_season} → {EXEC_OUT.name}")
            written.append(str(EXEC_OUT.relative_to(REPO)))
        elif write_pulse(EXEC_OUT, current_season, current_week, "peer",
                         curr_peer, peer_records, "highlight_validation_failed",
                         exec_triggers, exec_cmp):
            written.append(str(EXEC_OUT.relative_to(REPO)))
    elif not curr_peer and prog_triggers:
        # No peer-sized venues reported anything this week, so there's nothing
        # to compare Bushnell's slate against at that scale. Rather than go
        # dark, fall back to national data — clearly labeled as such so
        # leadership isn't misled about what it's being compared to.
        log.info(f"No peer-venue data this week — falling back to national data for exec brief "
                 f"({len(prog_triggers)} national trigger(s)):")
        for t in prog_triggers:
            log.info(f"  [{t['type']}] {t['description']}")
        prompt  = build_exec_national_fallback_prompt(current_season, [t["description"] for t in prog_triggers])
        summary = call_api(prompt, dry_run, season_league_names)
        if summary:
            write_entry(EXEC_OUT, current_season, current_week, summary,
                        "highlight", "national_fallback", triggers=prog_triggers,
                        comparison=prog_cmp)
            log.info(f"Wrote exec highlight (national fallback) for {current_season} → {EXEC_OUT.name}")
            written.append(str(EXEC_OUT.relative_to(REPO)))
        elif write_pulse(EXEC_OUT, current_season, current_week, "national_fallback",
                         curr_all, season_records, "highlight_validation_failed",
                         prog_triggers, prog_cmp):
            written.append(str(EXEC_OUT.relative_to(REPO)))
    elif write_pulse(EXEC_OUT, current_season, current_week, "peer",
                     curr_peer, peer_records, "no_threshold",
                     comparison=exec_cmp):
        written.append(str(EXEC_OUT.relative_to(REPO)))

    # ── Write programming highlight
    if prog_triggers:
        log.info(f"PROG triggers ({len(prog_triggers)}):")
        for t in prog_triggers:
            log.info(f"  [{t['type']}] {t['description']}")
        prompt  = build_prog_prompt(current_season, [t["description"] for t in prog_triggers],
                                    build_evidence_note(curr_all, season_records, current_week,
                                                        "national"))
        summary = call_api(prompt, dry_run, season_league_names)
        if summary:
            write_entry(PROG_OUT, current_season, current_week, summary,
                        "highlight", "national", triggers=prog_triggers,
                        comparison=prog_cmp)
            log.info(f"Wrote programming highlight for {current_season} → {PROG_OUT.name}")
            written.append(str(PROG_OUT.relative_to(REPO)))
        elif write_pulse(PROG_OUT, current_season, current_week, "national",
                         curr_all, season_records, "highlight_validation_failed",
                         prog_triggers, prog_cmp):
            written.append(str(PROG_OUT.relative_to(REPO)))
    elif write_pulse(PROG_OUT, current_season, current_week, "national",
                     curr_all, season_records, "no_threshold",
                     comparison=prog_cmp):
        written.append(str(PROG_OUT.relative_to(REPO)))

    return written


def main():
    dry_run = "--dry-run" in sys.argv
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )
    if dry_run:
        log.info("=" * 60)
        log.info("DRY RUN MODE — thresholds evaluated, API will NOT be called")
        log.info("=" * 60)
    written = run(dry_run=dry_run)
    if written:
        log.info(f"Files written: {written}")
    else:
        log.info("No files written this run.")


if __name__ == "__main__":
    main()
