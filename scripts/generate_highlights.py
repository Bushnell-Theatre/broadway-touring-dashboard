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
    national_curr_agg: dict | None = None,
) -> list:
    """
    Evaluate all hard-coded thresholds for one scope (peer or all-venue).

    national_curr_agg: when evaluating the peer scope, pass the current week's
    show aggregation for ALL venues nationally (aggregate_by_show(curr_all)).
    This lets "show closes" distinguish a show that dropped out of the peer-size
    band this week (still touring, just not at a comparably-sized venue) from a
    show that is genuinely absent from Broadway League data nationally. Leave
    None when evaluating the national scope itself, where "absent from scope"
    already means absent nationally.

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

    # — Show closes (was in scope last week, gone this week, ≥ CLOSE_MIN_WEEKS prior)
    if same_season_wow:
        for show, prev in prev_agg.items():
            if show not in season_league_names:
                continue
            if show in curr_agg:
                continue   # still running
            prior_weeks = prior_weeks_by_show.get(show, set())
            if len(prior_weeks) < CLOSE_MIN_WEEKS:
                continue

            national_hit = (national_curr_agg or {}).get(show)
            if national_curr_agg is not None and national_hit and national_hit.get("gross_total"):
                # Still touring nationally — just not at a peer-sized venue this
                # week. This is NOT a closure signal; do not describe it as one.
                triggers.append({
                    "type": "left_peer_scope",
                    "show": show,
                    "description": (
                        f"{show}: no longer among peer-sized venues (~2,400–3,000 seats) "
                        f"this week, but still active in national Broadway League data "
                        f"(national gross {fmt_dollars(national_hit.get('gross_total'))}, "
                        f"week of {current_week}). This is a venue-size shift, not a "
                        f"closure — the tour is still running."
                    ),
                })
            else:
                triggers.append({
                    "type": "show_closes",
                    "show": show,
                    "description": (
                        f"{show}: absent from Broadway League touring data entirely "
                        f"this week — no records at any venue nationally "
                        f"(last seen week of {prior_week}, "
                        f"after {len(prior_weeks)} weeks in scope)"
                    ),
                })

    return triggers


# ── PROMPT BUILDERS ───────────────────────────────────────────────────────────


def build_exec_prompt(season_key: str, trigger_lines: list) -> str:
    trigger_text = "\n".join(f"- {line}" for line in trigger_lines)
    return (
        f"You are writing a one-paragraph executive brief for the COO of "
        f"The Bushnell Center for the Performing Arts in Hartford, CT.\n\n"
        f"The following significant changes occurred in this week's Broadway League "
        f"touring data for shows in Bushnell's {season_key} season slate, measured "
        f"against peer venues of comparable size (~2,400–3,000 seats):\n\n"
        f"{trigger_text}\n\n"
        f"Write 2–3 sentences in plain language suitable for senior leadership. "
        f"Describe what happened, which show(s) are involved, and what the data "
        f"may signal. Do not speculate beyond what the numbers show. Do not "
        f"recommend booking or cancellation decisions. Only say a tour has "
        f"closed, ended, or exited touring if the data explicitly states it is "
        f"absent nationally — never infer a closure from a show simply moving "
        f"out of the peer-size venue band. Keep it under 80 words."
    )


def build_prog_prompt(season_key: str, trigger_lines: list) -> str:
    trigger_text = "\n".join(f"- {line}" for line in trigger_lines)
    return (
        f"You are writing a one-paragraph weekly intelligence note for the "
        f"programming director at The Bushnell Center for the Performing Arts "
        f"in Hartford, CT.\n\n"
        f"The following significant changes occurred in this week's Broadway League "
        f"touring data for shows in Bushnell's {season_key} season slate, across "
        f"all national touring markets:\n\n"
        f"{trigger_text}\n\n"
        f"Write 2–3 sentences in a direct, analytical tone appropriate for a "
        f"programming professional. Describe what changed, which show(s) are "
        f"involved, and what the data signals about national touring demand. "
        f"Do not recommend booking or cancellation decisions. Do not speculate "
        f"beyond the data. Only say a tour has closed, ended, or exited touring "
        f"if the data explicitly states it is absent nationally — never infer "
        f"a closure from a show simply moving out of the peer-size venue band. "
        f"Keep it under 80 words."
    )


# ── API CALL ──────────────────────────────────────────────────────────────────


def call_api(prompt: str, dry_run: bool) -> str | None:
    """
    Call Claude Haiku with the trigger prompt. Returns the summary text,
    or None on failure. Never raises — failures are logged and skipped.
    """
    if dry_run:
        return "[DRY RUN — API not called. Trigger payload above would be sent to claude-haiku-4-5-20251001.]"

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


# ── FILE WRITE ────────────────────────────────────────────────────────────────


def write_highlight(out_path: Path, season_key: str, week_of: str,
                    triggers: list, summary: str) -> None:
    """Merge one season's entry into the existing season-keyed JSON file."""
    existing = {}
    if out_path.exists():
        with open(out_path, encoding="utf-8") as f:
            existing = json.load(f)

    existing[season_key] = {
        "week_of":      week_of,
        "trigger":      ",".join(sorted({t["type"] for t in triggers})),
        "summary":      summary,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)


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

    log.info(f"Exec scope   — current week peer records : {len(curr_peer)}")
    log.info(f"Exec scope   — prior week peer records   : {len(prev_peer)}")

    # ── PROG SCOPE inputs computed early so exec scope can check national
    # presence before calling a show "closed" (see national_curr_agg below)
    curr_all = [r for r in season_records if r.get("week_of") == current_week]
    prev_all = [r for r in season_records if r.get("week_of") == prior_week]
    national_curr_agg = aggregate_by_show(curr_all)

    exec_triggers = evaluate_thresholds(
        season_league_names = season_league_names,
        current_week        = current_week,
        prior_week          = prior_week,
        same_season_wow     = same_season_wow,
        curr_records        = curr_peer,
        prev_records        = prev_peer,
        all_scope_records   = peer_records,
        prior_weeks_by_show = prior_weeks_peer,
        national_curr_agg   = national_curr_agg,
    )

    # ── PROG SCOPE: all venues nationally

    log.info(f"Prog scope   — current week all records  : {len(curr_all)}")
    log.info(f"Prog scope   — prior week all records    : {len(prev_all)}")

    prog_triggers = evaluate_thresholds(
        season_league_names = season_league_names,
        current_week        = current_week,
        prior_week          = prior_week,
        same_season_wow     = same_season_wow,
        curr_records        = curr_all,
        prev_records        = prev_all,
        all_scope_records   = season_records,
        prior_weeks_by_show = prior_weeks_all,
    )

    written = []

    # ── Write exec highlight
    if exec_triggers:
        log.info(f"EXEC triggers ({len(exec_triggers)}):")
        for t in exec_triggers:
            log.info(f"  [{t['type']}] {t['description']}")
        prompt  = build_exec_prompt(current_season, [t["description"] for t in exec_triggers])
        summary = call_api(prompt, dry_run)
        if summary:
            write_highlight(EXEC_OUT, current_season, current_week, exec_triggers, summary)
            log.info(f"Wrote exec highlight for {current_season} → {EXEC_OUT.name}")
            written.append(str(EXEC_OUT.relative_to(REPO)))
    else:
        log.info("No exec triggers — skipping exec highlight")

    # ── Write programming highlight
    if prog_triggers:
        log.info(f"PROG triggers ({len(prog_triggers)}):")
        for t in prog_triggers:
            log.info(f"  [{t['type']}] {t['description']}")
        prompt  = build_prog_prompt(current_season, [t["description"] for t in prog_triggers])
        summary = call_api(prompt, dry_run)
        if summary:
            write_highlight(PROG_OUT, current_season, current_week, prog_triggers, summary)
            log.info(f"Wrote programming highlight for {current_season} → {PROG_OUT.name}")
            written.append(str(PROG_OUT.relative_to(REPO)))
    else:
        log.info("No programming triggers — skipping programming highlight")

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
