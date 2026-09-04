"""
Tests for highlight_guard.validate_summary().

Run:
    python scripts/test_highlight_guard.py

The three REGRESSION cases are the actual false summaries that reached the
Executive Summary page. Each must be rejected.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from highlight_guard import (  # noqa: E402
    validate_summary, extract_numbers, extract_dates, displayed_pct,
)


def _disp(v):
    return '-' if v is None else f'{displayed_pct(v)}%'

PASSED = 0
FAILED = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  PASS  {name}")
    else:
        FAILED += 1
        print(f"  FAIL  {name}" + (f"\n          {detail}" if detail else ""))


def rejects(name: str, summary: str, prompt: str, shows=None, expect: str = "") -> None:
    problems = validate_summary(summary, prompt, shows)
    ok = bool(problems) and (not expect or any(expect in p for p in problems))
    check(name, ok, f"expected a problem containing {expect!r}, got: {problems}")


def accepts(name: str, summary: str, prompt: str, shows=None) -> None:
    problems = validate_summary(summary, prompt, shows)
    check(name, not problems, f"expected no problems, got: {problems}")


# ── Fixtures ──────────────────────────────────────────────────────────────────

SHOWS = {"Hell's Kitchen", "The Great Gatsby", "The Outsiders", "Mamma Mia!",
         "Waitress", "Jersey Boys"}

PROMPT_TYPICAL = (
    "You are writing a one-paragraph executive brief for the COO of The Bushnell "
    "Center for the Performing Arts in Hartford, CT.\n\n"
    "The following significant changes occurred in this week's Broadway League "
    "touring data for shows in Bushnell's 2026-2027 season slate, measured "
    "against peer venues of comparable size (~2,400-3,000 seats):\n\n"
    "- Hell's Kitchen: gross -62% week-over-week ($2.00M -> $761K, week of 2026-08-23)\n"
    "- Hell's Kitchen: paid capacity moved from 94.7% to 50.5% (band: high (>=90%) "
    "to low (<60%), week of 2026-08-23)\n"
    "- The Outsiders: gross +41% week-over-week ($1.11M -> $1.56M, week of 2026-08-23)\n\n"
    "Write 2-3 sentences in plain language suitable for senior leadership."
)

PROMPT_ABSENCE = (
    "The following significant changes occurred in this week's Broadway League "
    "touring data for shows in Bushnell's 2026-2027 season slate:\n\n"
    "- The Great Gatsby: no records anywhere in the Broadway League feed for 12 "
    "consecutive weeks (last reported week of 2026-06-07). This is an observation "
    "about the feed, NOT evidence the tour has closed.\n"
)


print("\nSuite 1 — REGRESSION: the three false briefs that actually shipped")

rejects(
    "Aug 28 brief: invented closure + invented cause",
    "Hell's Kitchen has exited Broadway League touring data after 27 weeks in our "
    "peer venue tracking, indicating the tour has concluded or been redirected away "
    "from the regional circuit. This removal suggests the production's touring "
    "footprint has contracted, likely due to scheduling changes or commercial "
    "performance.",
    PROMPT_TYPICAL, SHOWS,
)

rejects(
    "Sep 4 brief: invented closure, wrong date, invented consequence",
    "The Great Gatsby touring production has exited the Broadway League tracking "
    "system and shows no bookings at any venue nationally as of this week, ending a "
    "11-week touring run last documented the week of July 19, 2026. This absence "
    "from national touring data suggests the production is no longer actively "
    "touring, which may impact its availability for Bushnell's 2026-2027 season "
    "slate.",
    PROMPT_ABSENCE, SHOWS,
)

rejects(
    "invented interpretation of a decline as a cause",
    "Hell's Kitchen fell 62% due to softening demand across its markets.",
    PROMPT_TYPICAL, SHOWS, expect="due to",
)


print("\nSuite 2 — invented numbers")

rejects(
    "dollar figure never given",
    "Hell's Kitchen grossed $4.20M this week.",
    PROMPT_TYPICAL, SHOWS, expect="unsupported money",
)
rejects(
    "percentage never given",
    "The Outsiders reached 88% paid capacity.",
    PROMPT_TYPICAL, SHOWS, expect="unsupported percent",
)
accepts(
    "exact figures from the prompt are fine",
    "Hell's Kitchen gross fell 62% week-over-week, from $2.00M to $761K.",
    PROMPT_TYPICAL, SHOWS,
)
accepts(
    "faithful rounding is fine (94.7% -> 95%, 50.5% -> 51%)",
    "Hell's Kitchen paid capacity moved from 95% to 51%.",
    PROMPT_TYPICAL, SHOWS,
)
# Policy change (Sep 4): counts of shows/titles were originally allowed
# through as harmless prose. They are not — a regenerated retrospective used
# them to tally shows into "exceeded"/"underperformed" buckets it had no
# benchmark for. Counts of shows are now rejected; see Suite 5c.
rejects(
    "counts of titles are rejected, not waved through as prose",
    "Three titles moved materially this week.",
    PROMPT_TYPICAL, SHOWS, expect="count of shows",
)
accepts(
    "a bare integer that is not counting shows still passes",
    "Hell's Kitchen fell 62% week-over-week, from $2.00M to $761K.",
    PROMPT_TYPICAL, SHOWS,
)


print("\nSuite 3 — invented dates")

rejects(
    "date never given",
    "Activity was last recorded the week of 2026-07-19.",
    PROMPT_ABSENCE, SHOWS, expect="unsupported date 2026-07-19",
)
accepts(
    "long-form restatement of an ISO date in the prompt",
    "The Great Gatsby has not reported for 12 weeks, last reported the week of "
    "June 7, 2026.",
    PROMPT_ABSENCE, SHOWS,
)


print("\nSuite 4 — invented subjects")

rejects(
    "attributes numbers to a show that was never in the input",
    "Waitress gross fell 62% week-over-week.",
    PROMPT_TYPICAL, SHOWS, expect="Waitress",
)
accepts(
    "shows that were in the input are fine",
    "The Outsiders gross rose 41% week-over-week.",
    PROMPT_TYPICAL, SHOWS,
)


print("\nSuite 5 — banned claim categories")

for text, label in [
    ("The tour has closed.", "closure"),
    ("Hell's Kitchen has ended its run.", "ended its run"),
    ("The production is no longer touring.", "no longer touring"),
    ("The tour was cancelled.", "cancellation"),
    ("This may impact our subscription renewals.", "predicted impact"),
    ("This raises questions about its availability for our slate.", "availability"),
    ("The drop is likely a seasonal effect.", "speculation"),
    ("The decline stems from weak regional demand.", "invented cause"),
]:
    rejects(f"blocks {label}", text, PROMPT_TYPICAL, SHOWS)


print("\nSuite 5b — false-positive guards (patterns must not over-match)")

accepts(
    "'pre-booking' must not trip the re-book pattern",
    "Peer venues outpaced our pre-booking expectations less often than hoped.",
    PROMPT_TYPICAL, SHOWS,
)
rejects(
    "'may have affected' is still caught (hedged causation)",
    "This suggests subscription positioning may have affected walk-up demand.",
    PROMPT_TYPICAL, SHOWS, expect="impact/effect",
)
accepts(
    "plain factual comparison language is fine",
    "Subscription titles tracked closer to their pre-season signals than add-ons.",
    PROMPT_TYPICAL, SHOWS,
)


print("\nSuite 5c — derived counts of shows (regenerated 2024-25 retrospective)")

# The regenerated retrospective counted shows with NO pre-season benchmark
# among those that "exceeded" one, and miscounted subscriber titles.
rejects(
    "counts of shows are not verifiable against the input",
    "Three shows exceeded their pre-season peer benchmarks.",
    PROMPT_TYPICAL, SHOWS, expect="count of shows",
)
rejects(
    "counts of subscriber titles are blocked too",
    "Three subscriber titles performed at or above peer signal, two fell short.",
    PROMPT_TYPICAL, SHOWS, expect="count of shows",
)
accepts(
    "naming shows individually with their own figures is still fine",
    "The Outsiders rose 41% to $1.56M; Hell's Kitchen fell 62% to $761K.",
    PROMPT_TYPICAL, SHOWS,
)

accepts(
    "en-dash year range must not read the second year as a bare number",
    "# 2026–2027 Season Retrospective: capacity reached 94.7%.",
    PROMPT_TYPICAL, SHOWS,
)
accepts(
    "em-dash year range is folded too",
    "The 2026—2027 season closed with capacity at 94.7%.",
    PROMPT_TYPICAL, SHOWS,
)

print("\nSuite 6 — an acceptable brief still passes (guard is not a blanket block)")

accepts(
    "factual, sourced, no causes or consequences",
    "Hell's Kitchen saw the largest movement in this week's data: gross fell 62% "
    "week-over-week, from $2.00M to $761K, with paid capacity moving from 94.7% to "
    "50.5%. The Outsiders moved the other way, up 41% to $1.56M.",
    PROMPT_TYPICAL, SHOWS,
)
accepts(
    "absence reported as an observation, not a closure",
    "The Great Gatsby has not reported in the Broadway League feed for 12 "
    "consecutive weeks, last reported the week of 2026-06-07. This is worth "
    "confirming with our booking partners.",
    PROMPT_ABSENCE, SHOWS,
)


print()
print("Suite 6b - benchmark comparison claims (guard v2, payload-aware)")

# Fixture mirrors the real payload shape: 0-1 fractions, some benchmarks null.
PAYLOAD = [
    {"name": "Hamilton",        "pre_peer_cap": 0.9970, "actual_peer_cap": 0.9210},  # below
    {"name": "Mean Girls",      "pre_peer_cap": 0.9090, "actual_peer_cap": 0.8500},  # below
    {"name": "Ain't Too Proud", "pre_peer_cap": 0.7500, "actual_peer_cap": 0.7468},  # below
    {"name": "Funny Girl",      "pre_peer_cap": None,   "actual_peer_cap": 0.7930},  # no_benchmark
    {"name": "Hadestown",       "pre_peer_cap": 0.8850, "actual_peer_cap": 0.8980},  # above
    {"name": "Tootsie",         "pre_peer_cap": 0.6130, "actual_peer_cap": 0.6250},  # above
    {"name": "Les Miserables",  "pre_peer_cap": 0.8971, "actual_peer_cap": 0.8974},  # matched at 89.7
]
# The real prompt carries the full table, so every displayed figure the model
# may legitimately quote is present in it. Build it from the fixture so the
# ingredient check sees exactly what production would supply.
CMP_PROMPT = (
    "Season table. Columns: Pre Peer%, Act Peer%, Wks, Vs Benchmark.\n"
    + "\n".join(
        f"{r['name']} | {_disp(r['pre_peer_cap'])} | {_disp(r['actual_peer_cap'])} | 19 wks"
        for r in PAYLOAD
    )
)


def cmp_rejects(name, summary, expect=""):
    problems = validate_summary(summary, CMP_PROMPT, None, PAYLOAD)
    ok = bool(problems) and (not expect or any(expect in p for p in problems))
    check(name, ok, f"expected a problem containing {expect!r}, got: {problems}")


def cmp_accepts(name, summary):
    problems = validate_summary(summary, CMP_PROMPT, None, PAYLOAD)
    check(name, not problems, f"expected no problems, got: {problems}")


# - the four confirmed production errors
cmp_rejects("REGRESSION 2021-22: Hamilton 'exceeded' at 92.1% vs 99.7%",
            "Hamilton significantly exceeded its pre-season peer benchmark, "
            "achieving 92.1% capacity versus a 99.7% pre-season peer signal.",
            expect="Hamilton")
cmp_rejects("REGRESSION 2022-23: Mean Girls grouped as outperforming at 85.0% vs 90.9%",
            "Several shows outperformed their pre-season peer benchmarks: "
            "Hadestown reached 89.8% against 88.5%, while Mean Girls achieved "
            "85.0% against 90.9%.",
            expect="Mean Girls")
cmp_rejects("REGRESSION 2022-23: Ain't Too Proud grouped as outperforming at 74.7% vs 75.0%",
            "Several shows outperformed their pre-season peer benchmarks: "
            "Hadestown reached 89.8%, while Ain't Too Proud hit 74.7% against 75.0%.",
            expect="Ain't Too Proud")
cmp_rejects("REGRESSION 2023-24: Funny Girl 'underperformed' with a null benchmark",
            "Funny Girl underperformed its pre-season peer benchmark at 79.3%.",
            expect="no pre-season peer benchmark")

# - valid claims in each direction
cmp_accepts("valid 'above'",
            "Hadestown exceeded its pre-season peer benchmark, at 89.8% against 88.5%.")
cmp_accepts("valid 'below'",
            "Hamilton underperformed its pre-season peer benchmark, at 92.1% against 99.7%.")
cmp_accepts("valid 'matched' after display rounding (89.74 vs 89.71 both show 89.7%)",
            "Les Miserables matched its pre-season peer benchmark at 89.7%.")
cmp_accepts("valid 'no benchmark' statement",
            "Funny Girl recorded 79.3%, with no pre-season peer benchmark available.")

# - grouping
cmp_accepts("multiple shows sharing one relationship may be grouped",
            "Hadestown and Tootsie both exceeded their pre-season peer benchmarks.")
cmp_rejects("multiple shows with DIFFERENT relationships may not be grouped",
            "Hadestown and Hamilton both exceeded their pre-season peer benchmarks.",
            expect="Hamilton")

# - direction errors and ambiguity
cmp_rejects("incorrect direction (above claimed, below derived)",
            "Mean Girls exceeded its pre-season peer benchmark.",
            expect="stated 'above' but derived 'below'")
cmp_rejects("incorrect direction (matched claimed, above derived)",
            "Hadestown matched its pre-season peer benchmark exactly.",
            expect="stated 'matched' but derived 'above'")
cmp_rejects("a show with a benchmark cannot be described as having none",
            "Hamilton posted 92.1%, with no pre-season peer benchmark available.",
            expect="but one exists")
cmp_rejects("ambiguous attribution fails closed",
            "Collectively, the subscription titles came in below their pre-season signals.",
            expect="cannot verify")

# - scope: prose without comparison language is untouched by this check
cmp_accepts("non-comparative prose is not adjudicated",
            "Hadestown played 19 weeks at peer venues this season.")


print("\nSuite 7 — extraction helpers")

check("money scales normalize ($761K == 761000)",
      (761000.0, "money") in extract_numbers("$761K"))
check("money with commas normalizes",
      (760558.0, "money") in extract_numbers("$760,558"))
check("percent extracted",
      (94.7, "percent") in extract_numbers("94.7%"))
check("ISO date extracted", "2026-08-23" in extract_dates("week of 2026-08-23"))
check("long date normalizes to ISO",
      "2026-07-19" in extract_dates("the week of July 19, 2026"))
check("empty summary rejected", bool(validate_summary("", "prompt")))


print(f"\n{'=' * 60}\n{PASSED} passed, {FAILED} failed\n{'=' * 60}")
sys.exit(1 if FAILED else 0)
