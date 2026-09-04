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

from highlight_guard import validate_summary, extract_numbers, extract_dates  # noqa: E402

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
accepts(
    "prose counts are not treated as statistics",
    "Three titles moved materially this week.",
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
