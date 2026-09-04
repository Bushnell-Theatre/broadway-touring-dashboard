"""
Broadway Touring Dashboard — AI End-of-Season Review Generator
Bushnell Center for the Performing Arts

Runs once per season, after all final-week data has been ingested.
Compares the pre-season national touring signal available at booking time
against actual peer-venue performance during the season.

IMPORTANT: Only aggregate data (show name, avg gross, avg capacity) is ever
sent to the API. No patron, customer, or donor information is included.

Usage:
    python generate_season_review.py [--dry-run]

    --dry-run  Evaluate trigger conditions and compute aggregates without
               calling the Anthropic API. Use to verify trigger logic,
               show table formatting, and output format before live use.

Output file (season-keyed):
    src/data/season_review.json

    Format:
    {
      "2025-2026": {
        "summary": "3-4 sentence retrospective.",
        "generated_at": "2026-07-22T10:30:00",
        "shows": [
          {
            "name": ..., "sub": ...,
            "pre_cap": ..., "pre_peer_cap": ..., "pre_gross": ...,
            "pre_record_count": ...,
            "actual_peer_cap": ..., "actual_peer_gross": ...,
            "actual_peer_weeks": ...
          }
        ]
      }
    }

Returns:
    List of season keys reviewed (for watcher.py to include in git commit).
    Empty list if nothing qualified this run.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from highlight_guard import validate_summary   # noqa: E402

# ── PATHS ─────────────────────────────────────────────────────────────────────

REPO       = Path(__file__).resolve().parent.parent
DATA       = REPO / "src" / "data" / "data.json"
SEASONS    = REPO / "src" / "data" / "seasons.json"
REVIEW_OUT = REPO / "src" / "data" / "season_review.json"

# ── CONSTANTS ─────────────────────────────────────────────────────────────────

SEASON_END_BUFFER_DAYS = 14   # wait this many days after last close before triggering

# ── LOGGING ───────────────────────────────────────────────────────────────────

log = logging.getLogger(__name__)


# ── HELPERS ───────────────────────────────────────────────────────────────────


def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def season_bounds(season_key: str) -> tuple:
    """Return (start_date, end_date) for a season key like '2025-2026'."""
    start_year = int(season_key[:4])
    start = date(start_year, 7, 1)
    end   = date(start_year + 1, 6, 30)
    return start, end


def is_active(record: dict) -> bool:
    """Exclude dark / no-engagement rows that carry no performance data."""
    return not (record.get("no_engagement") and record.get("gross_gross") is None)


def is_peer(record: dict) -> bool:
    """True for Bushnell-size comparable venues (similar_bushnell flag)."""
    return bool(record.get("similar_bushnell"))


def fmt_pct(v) -> str:
    if v is None:
        return "  —  "
    return f"{v * 100:5.1f}%"


def fmt_dollars(v) -> str:
    if v is None:
        return "  —  "
    if v >= 1_000_000:
        return f"${v / 1_000_000:.2f}M"
    if v >= 1_000:
        return f"${v / 1_000:.0f}K"
    return f"${v:.0f}"


def pct_raw(v) -> float | None:
    """Convert a cap_paid value (0–1 or 0–100) to 0–1 float."""
    if v is None:
        return None
    # cap_paid in data.json is already 0–100 (percentage), not 0–1
    return v / 100.0


def safe_avg(nums: list) -> float | None:
    cleaned = [n for n in nums if n is not None]
    return sum(cleaned) / len(cleaned) if cleaned else None


# ── SEASON-END TRIGGER ────────────────────────────────────────────────────────


def check_season_end(data_records: list, seasons: dict, existing_reviews: dict):
    """
    Yield (season_key, shows, season_records) for every season that:
    - Is not already in existing_reviews
    - Has all shows closed (last close date + SEASON_END_BUFFER_DAYS in the past)
    - Has final week data present in data.json
    """
    today = date.today()

    for season_key, season_data in seasons.items():
        if season_key in existing_reviews:
            log.info(f"  {season_key}: already reviewed — skipping")
            continue

        shows = season_data.get("shows", [])
        if not shows:
            log.info(f"  {season_key}: no shows in seasons.json — skipping")
            continue

        close_dates = [s.get("close") for s in shows if s.get("close")]
        if not close_dates:
            log.info(f"  {season_key}: no close dates — skipping")
            continue

        last_close = max(parse_date(d) for d in close_dates)
        cutoff     = last_close + timedelta(days=SEASON_END_BUFFER_DAYS)

        if today <= cutoff:
            log.info(f"  {season_key}: season still active or in buffer (last_close={last_close}, cutoff={cutoff}) — skipping")
            continue

        # Confirm final week data is present
        season_start, season_end = season_bounds(season_key)
        season_records = [
            r for r in data_records
            if season_start.isoformat() <= (r.get("week_of") or "") <= season_end.isoformat()
        ]

        if not season_records:
            log.info(f"  {season_key}: no records in data.json for this season — skipping")
            continue

        latest_week = max(r["week_of"] for r in season_records)
        log.info(f"  {season_key}: QUALIFIES (last_close={last_close}, latest_week={latest_week}, {len(season_records)} records)")
        yield season_key, shows, season_records


# ── AGGREGATE COMPUTATION ─────────────────────────────────────────────────────


def compute_pre_season_signal(show_league_name: str, season_start: date,
                               all_records: list) -> dict:
    """
    Compute the national signal for a show from records BEFORE the season started.
    This is the information that would have been available at booking time.
    """
    pre_records = [
        r for r in all_records
        if (r.get("show") or "").strip() == show_league_name
        and (r.get("week_of") or "") < season_start.isoformat()
        and is_active(r)
    ]

    all_caps   = [r.get("cap_paid") for r in pre_records if r.get("cap_paid") is not None]
    peer_caps  = [r.get("cap_paid") for r in pre_records if r.get("cap_paid") is not None and is_peer(r)]
    all_gross  = [r.get("gross_gross") for r in pre_records if r.get("gross_gross") is not None]

    cap_avg      = safe_avg(all_caps)
    peer_cap_avg = safe_avg(peer_caps)
    gross_avg    = safe_avg(all_gross)

    return {
        "pre_cap":          round(cap_avg / 100.0, 4)      if cap_avg      is not None else None,
        "pre_peer_cap":     round(peer_cap_avg / 100.0, 4) if peer_cap_avg is not None else None,
        "pre_gross":        round(gross_avg)                if gross_avg    is not None else None,
        "pre_record_count": len(pre_records),
    }


def compute_actual_peer(show_league_name: str, season_records: list) -> dict:
    """
    Compute actual peer-venue performance for a show during the season.
    Only records with similar_bushnell = True are included.
    """
    peer = [
        r for r in season_records
        if (r.get("show") or "").strip() == show_league_name
        and is_peer(r)
        and is_active(r)
    ]

    caps  = [r.get("cap_paid")   for r in peer if r.get("cap_paid")   is not None]
    gross = [r.get("gross_gross") for r in peer if r.get("gross_gross") is not None]

    # Count unique weeks (not raw record count, since multiple venues per week)
    weeks = len({r.get("week_of") for r in peer if r.get("week_of")})

    cap_avg   = safe_avg(caps)
    gross_avg = safe_avg(gross)

    return {
        "actual_peer_cap":   round(cap_avg / 100.0, 4)   if cap_avg   is not None else None,
        "actual_peer_gross": round(gross_avg)              if gross_avg is not None else None,
        "actual_peer_weeks": weeks,
    }


# ── PROMPT BUILDER ────────────────────────────────────────────────────────────


def build_shows_table(shows_data: list) -> str:
    """Format the per-show comparison as a plain-text table for the API prompt."""
    header = (
        f"{'Show':<35} {'Sub':>3} "
        f"{'Pre Cap%':>9} {'Pre Peer%':>9} "
        f"{'Act Peer%':>9} {'Act Gross':>10} {'Wks':>4}"
    )
    divider = "-" * len(header)
    rows = [header, divider]

    for s in shows_data:
        pre_cap     = f"{s['pre_cap'] * 100:.1f}%" if s.get("pre_cap") is not None else "—"
        pre_peer    = f"{s['pre_peer_cap'] * 100:.1f}%" if s.get("pre_peer_cap") is not None else "—"
        act_cap     = f"{s['actual_peer_cap'] * 100:.1f}%" if s.get("actual_peer_cap") is not None else "—"
        act_gross   = fmt_dollars(s.get("actual_peer_gross"))
        wks         = str(s.get("actual_peer_weeks") or "—")
        sub         = "Yes" if s.get("sub") else "No"

        rows.append(
            f"{s['name']:<35} {sub:>3} "
            f"{pre_cap:>9} {pre_peer:>9} "
            f"{act_cap:>9} {act_gross:>10} {wks:>4}"
        )

    return "\n".join(rows)


def build_season_prompt(season_key: str, shows_data: list) -> str:
    shows_table = build_shows_table(shows_data)
    return (
        f"You are writing an end-of-season retrospective for the programming and "
        f"leadership team at The Bushnell Center for the Performing Arts in Hartford, CT.\n\n"
        f"The following shows completed their runs as part of Bushnell's {season_key} "
        f"Broadway season. For each show, the data compares the national touring signal "
        f"available before the season began against its actual performance at peer "
        f"venues of comparable size (~2,400–3,000 seats) during the season.\n\n"
        f"{shows_table}\n\n"
        f"Column definitions:\n"
        f"- Pre Cap%: average paid capacity across all national records for this show "
        f"before the season began (the signal available at booking time)\n"
        f"- Pre Peer%: same, filtered to Bushnell-size venues only\n"
        f"- Act Peer%: average paid capacity at peer venues during the season\n"
        f"- Act Gross: average weekly gross at peer venues during the season\n"
        f"- Sub: whether the show was part of Bushnell's subscriber package\n"
        f"- Wks: number of weeks with peer-venue data during the season\n\n"
        f"Write a 3–4 sentence retrospective that identifies: (1) which shows "
        f"outperformed their pre-season peer signal, (2) which underperformed, "
        f"and (3) any pattern across the season as a whole — for example, whether "
        f"subscription shows performed differently from add-ons, or whether there "
        f"was a consistent gap between national signal and peer-venue results. "
        f"Do not recommend future booking decisions. Write in plain language "
        f"appropriate for a leadership team. Keep it under 120 words."
    )


# ── API CALL ──────────────────────────────────────────────────────────────────


def _call_once(prompt: str, max_tokens: int = 300) -> str | None:
    try:
        from dotenv import load_dotenv
        load_dotenv(REPO / ".env")
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()
    except Exception as exc:
        log.warning(f"Anthropic API call failed: {exc}")
        return None


def call_api(prompt: str, dry_run: bool, show_names: set | None = None) -> str | None:
    """
    Call Claude Haiku with the season retrospective prompt and VALIDATE the
    result before returning it. Returns the summary text, or None on failure.

    This retrospective is published on the Executive Summary page, so it goes
    through the same guard as the weekly highlights: every number, date, and
    show name must trace back to the prompt, and invented causes, predicted
    consequences, and closure claims are rejected. One corrective retry, then
    fail closed and write nothing. See scripts/highlight_guard.py.
    """
    if dry_run:
        return "[DRY RUN — API not called. Trigger payload above would be sent to claude-haiku-4-5-20251001.]"

    summary = _call_once(prompt)
    if summary is None:
        return None

    problems = validate_summary(summary, prompt, show_names)
    if not problems:
        return summary

    log.warning("Season review FAILED validation — retrying once:")
    for p in problems:
        log.warning(f"    • {p}")

    retry_prompt = (
        prompt
        + "\n\nYour previous attempt was rejected for these reasons:\n"
        + "\n".join(f"- {p}" for p in problems)
        + "\n\nRewrite it. Use ONLY the figures, dates, and show names given "
          "above — do not introduce or calculate any others. Describe what the "
          "results were, not why they happened or what should be booked next."
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


def write_review(season_key: str, summary: str, shows_data: list) -> None:
    """Merge one season's review into the existing season_review.json file."""
    existing = {}
    if REVIEW_OUT.exists():
        with open(REVIEW_OUT, encoding="utf-8") as f:
            existing = json.load(f)

    existing[season_key] = {
        "summary":      summary,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
        "shows":        shows_data,
    }

    with open(REVIEW_OUT, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)


# ── MAIN ──────────────────────────────────────────────────────────────────────


def run(dry_run: bool = False) -> list:
    """
    Check all seasons for end-of-season trigger and write review entries.
    Returns list of season keys reviewed (empty if nothing qualified).
    """
    # Load data
    with open(DATA, encoding="utf-8") as f:
        raw = json.load(f)
    all_records = raw.get("records", raw) if isinstance(raw, dict) else raw
    log.info(f"Loaded {len(all_records):,} records from data.json")

    with open(SEASONS, encoding="utf-8") as f:
        seasons = json.load(f)

    existing_reviews = {}
    if REVIEW_OUT.exists():
        with open(REVIEW_OUT, encoding="utf-8") as f:
            existing_reviews = json.load(f)
    log.info(f"Existing season reviews: {list(existing_reviews.keys()) or 'none'}")

    log.info("Checking season-end trigger for all seasons:")
    reviewed = []

    for season_key, shows, season_records in check_season_end(all_records, seasons, existing_reviews):
        log.info(f"\n{'─' * 60}")
        log.info(f"Processing season: {season_key}")

        season_start, season_end = season_bounds(season_key)

        # ── Build per-show aggregate data
        shows_data = []
        for show_def in shows:
            league_name = (show_def.get("league_name") or show_def.get("name") or "").strip()
            if not league_name:
                continue

            pre  = compute_pre_season_signal(league_name, season_start, all_records)
            act  = compute_actual_peer(league_name, season_records)

            entry = {
                "name":            show_def.get("name") or league_name,
                "sub":             bool(show_def.get("sub")),
                **pre,
                **act,
            }
            shows_data.append(entry)

            log.info(
                f"  {league_name:<35} "
                f"pre_cap={fmt_pct(entry.get('pre_cap'))}"
                f"  pre_peer={fmt_pct(entry.get('pre_peer_cap'))}"
                f"  act_peer={fmt_pct(entry.get('actual_peer_cap'))}"
                f"  act_gross={fmt_dollars(entry.get('actual_peer_gross'))}"
                f"  wks={entry.get('actual_peer_weeks')}"
            )

        if not shows_data:
            log.warning(f"  No show data computed for {season_key} — skipping")
            continue

        # ── Build and log the shows table
        log.info(f"\nShows table (what gets sent to API):\n{build_shows_table(shows_data)}\n")

        # ── Call API
        prompt  = build_season_prompt(season_key, shows_data)
        summary = call_api(prompt, dry_run,
                           {s.get("name") for s in shows_data if s.get("name")})
        if not summary:
            log.warning(f"  No summary returned for {season_key} — skipping file write")
            continue

        log.info(f"Summary:\n{summary}\n")

        if not dry_run:
            write_review(season_key, summary, shows_data)
            log.info(f"Wrote season review for {season_key} → {REVIEW_OUT.name}")
        else:
            log.info(f"[DRY RUN] Would write season review for {season_key}")

        reviewed.append(season_key)

    return reviewed


def main():
    dry_run = "--dry-run" in sys.argv
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )
    if dry_run:
        log.info("=" * 60)
        log.info("DRY RUN MODE — aggregates computed, API will NOT be called")
        log.info("=" * 60)
    reviewed = run(dry_run=dry_run)
    if reviewed:
        log.info(f"\nSeasons reviewed this run: {reviewed}")
    else:
        log.info("No seasons qualified for review this run.")


if __name__ == "__main__":
    main()
