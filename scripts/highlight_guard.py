"""
Broadway Touring Dashboard — AI Highlight Guard
Bushnell Center for the Performing Arts

Validates an AI-generated weekly summary against the facts it was given
BEFORE it is written to a highlight file and shown to leadership.

Why this exists
---------------
Three separate false briefs reached the Executive Summary page:

  1. "the tour has concluded or been redirected away from the regional
     circuit ... likely due to scheduling changes or commercial performance"
     — invented a closure AND a cause for it.
  2. "suggesting potential demand softness for that title" — invented an
     interpretation not present in the trigger data.
  3. "has exited the Broadway League tracking system ... last documented the
     week of July 19, 2026 ... may impact its availability for Bushnell's
     2026-2027 season slate" — a wrong date, a closure claim, and an
     invented business consequence, for a show that had reported nationally
     the week before.

Prompt instructions alone did not prevent any of these. This module is the
enforcement layer: the model's output is checked against its own input, and
anything unsupported blocks the write.

The governing rule
------------------
**The summary may only contain numbers, dates, and show names that appear in
the prompt.** It may not assert why something happened, what it means for
Bushnell's bookings, or that a tour has stopped.

Fail-closed: if a summary cannot be validated, nothing is written. A stale
entry from a previous week (clearly labeled with its own week_of) is far
better than a confident, wrong one.

Usage:
    from highlight_guard import validate_summary
    problems = validate_summary(summary, prompt, show_names)
    if problems:
        ...do not write the file...
"""

from __future__ import annotations

import re

# ── BANNED LANGUAGE ───────────────────────────────────────────────────────────
#
# Each entry is (compiled pattern, human-readable explanation). These are
# claims the weekly feed cannot support, regardless of what the numbers show.

_BANNED = [
    # — Finality. Absence from the feed never proves a tour stopped; see the
    # ABSENCE POLICY in generate_highlights.py for the measured base rates.
    (r"\b(has|have|had)\s+(closed|ended|concluded|wrapped|folded)\b",
     "claims a tour closed/ended — the feed cannot establish this"),
    (r"\b(closed|ended|concluded|wrapped|folded)\s+(its|their)\s+(run|tour)\b",
     "claims a tour closed/ended — the feed cannot establish this"),
    (r"\bexited?\s+(the\s+)?(broadway\s+league|touring|tracking|circuit)",
     "claims a tour exited touring — the feed cannot establish this"),
    (r"\bno\s+longer\s+(actively\s+)?(touring|running|active|on\s+tour)\b",
     "claims a tour is no longer touring — the feed cannot establish this"),
    (r"\b(tour|production|show)\s+(is|was|has\s+been)\s+(cancel|cancell)ed\b",
     "claims a cancellation — the feed cannot establish this"),
    (r"\bceased\s+(touring|operations|performances)\b",
     "claims a tour ceased — the feed cannot establish this"),

    # — Invented causation. The feed reports what happened, never why.
    (r"\bdue\s+to\b", "asserts a cause ('due to') not present in the data"),
    (r"\bbecause\s+of\b", "asserts a cause ('because of') not present in the data"),
    (r"\bas\s+a\s+result\s+of\b", "asserts a cause not present in the data"),
    (r"\bdriven\s+by\b", "asserts a cause ('driven by') not present in the data"),
    (r"\battributable\s+to\b", "asserts a cause not present in the data"),
    (r"\bcaused\s+by\b", "asserts a cause not present in the data"),
    (r"\bstems?\s+from\b", "asserts a cause not present in the data"),
    (r"\bowing\s+to\b", "asserts a cause not present in the data"),

    # — Speculation markers.
    (r"\blikely\b", "speculative ('likely') — state only what the data shows"),
    (r"\bprobably\b", "speculative ('probably') — state only what the data shows"),
    (r"\bpresumably\b", "speculative — state only what the data shows"),
    (r"\bappears?\s+to\s+be\s+(closing|ending|winding)\b",
     "speculates about a tour ending"),

    # — Invented business consequences for Bushnell. The pipeline is given
    # touring performance data only; it knows nothing about our contracts,
    # holds, routing, or availability.
    (r"\bavailabilit(y|ies)\b",
     "claims something about booking availability — not in the data"),
    (r"\b(may|might|will|could)\s+(have\s+)?"
     r"(impact(ed)?|affect(ed)?|jeopardi[sz]ed?|threaten(ed)?)\b",
     "asserts an impact/effect not established by the data"),
    # NB: needs the leading boundary — an early version matched inside
    # "pre-booking" and would have rejected a sound season retrospective.
    (r"\bre-?book(ing|ed|s)?\b", "speculates about booking actions"),
    (r"\b(secure|replace|substitute)\s+(a\s+)?(replacement|another\s+title)\b",
     "recommends a booking action — out of scope for this brief"),
]

_BANNED_COMPILED = [(re.compile(p, re.IGNORECASE), why) for p, why in _BANNED]

# ── FACT EXTRACTION ───────────────────────────────────────────────────────────

_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}

_ISO_DATE   = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_LONG_DATE  = re.compile(
    r"\b(" + "|".join(_MONTHS) + r")\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b",
    re.IGNORECASE,
)
_MONTH_YEAR = re.compile(
    r"\b(" + "|".join(_MONTHS) + r")\.?\s+(\d{4})\b", re.IGNORECASE
)

# $1.23M / $761K / $1,234,567 / 94.7% / -62% / plain numbers
_MONEY   = re.compile(r"\$\s?([\d,]+(?:\.\d+)?)\s*([KMB])?", re.IGNORECASE)
_PERCENT = re.compile(r"(-?[\d,]+(?:\.\d+)?)\s*(?:%|percent|percentage points?)",
                      re.IGNORECASE)
_BARE    = re.compile(r"(?<![\w$.-])(-?\d[\d,]*(?:\.\d+)?)(?![\w%])")

_SCALE = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}

# Bare integers this small are almost always prose counts ("three titles",
# "2 of 10 shows") rather than statistics, and blocking them would drop an
# otherwise-sound brief. Anything carrying $ or % is always checked.
_PROSE_COUNT_MAX = 12


def _to_float(raw: str, suffix: str | None = None) -> float | None:
    try:
        v = float(raw.replace(",", ""))
    except ValueError:
        return None
    if suffix:
        v *= _SCALE.get(suffix.lower(), 1)
    return v


def extract_numbers(text: str) -> list[tuple[float, str]]:
    """
    Pull every quantity out of `text` as (value, kind) where kind is
    'money' | 'percent' | 'bare'. Money is normalized to whole dollars so
    "$761K" and "$761,000" compare equal.
    """
    found: list[tuple[float, str]] = []
    consumed: list[tuple[int, int]] = []

    for m in _MONEY.finditer(text):
        v = _to_float(m.group(1), m.group(2))
        if v is not None:
            found.append((v, "money"))
        consumed.append(m.span())
    for m in _PERCENT.finditer(text):
        v = _to_float(m.group(1))
        if v is not None:
            found.append((abs(v), "percent"))
        consumed.append(m.span())
    for m in _BARE.finditer(text):
        if any(s <= m.start() < e for s, e in consumed):
            continue
        v = _to_float(m.group(1))
        if v is not None:
            found.append((abs(v), "bare"))
    return found


def extract_dates(text: str) -> set[str]:
    """Every date in `text`, normalized to ISO `YYYY-MM-DD` (or `YYYY-MM`)."""
    out: set[str] = set()
    for y, mo, d in _ISO_DATE.findall(text):
        out.add(f"{y}-{mo}-{d}")
        out.add(f"{y}-{mo}")
    for mon, d, y in _LONG_DATE.findall(text):
        out.add(f"{y}-{_MONTHS[mon.lower().rstrip('.')]:02d}-{int(d):02d}")
        out.add(f"{y}-{_MONTHS[mon.lower().rstrip('.')]:02d}")
    for mon, y in _MONTH_YEAR.findall(text):
        out.add(f"{y}-{_MONTHS[mon.lower().rstrip('.')]:02d}")
    return out


def _number_supported(value: float, kind: str,
                      allowed: list[tuple[float, str]]) -> bool:
    """
    A number is supported if it matches one from the prompt exactly, or is a
    rounded form of one (the model may write 95% for 94.7%, or $761K for
    $760,558 — both faithful restatements, not invention).
    """
    for av, _akind in allowed:
        if av == value:
            return True
        if kind == "percent" and abs(av - value) <= 0.5:
            return True
        if kind == "money" and av:
            # tolerate rounding to 3 significant figures ($760,558 -> $761K)
            if abs(av - value) / max(abs(av), 1.0) <= 0.005:
                return True
        if kind == "bare" and abs(av - value) <= 0.5:
            return True
    return False


# ── VALIDATION ────────────────────────────────────────────────────────────────


def validate_summary(summary: str, prompt: str,
                     show_names: set | None = None) -> list[str]:
    """
    Check `summary` against the `prompt` it was generated from.

    Returns a list of human-readable problems; empty list means the summary
    is safe to publish. Callers MUST treat a non-empty list as fatal and
    write nothing.

    show_names: every show on the season slate. Any of these named in the
    summary but absent from the prompt is an invented subject — the most
    dangerous failure mode, since it attributes real numbers to the wrong
    production.
    """
    problems: list[str] = []

    if not summary or not summary.strip():
        return ["summary is empty"]

    # 1. Banned claims — causes, consequences, finality, speculation.
    for pattern, why in _BANNED_COMPILED:
        m = pattern.search(summary)
        if m:
            problems.append(f"banned language {m.group(0)!r}: {why}")

    # 2. Every number must trace back to the prompt.
    allowed_nums = extract_numbers(prompt)
    for value, kind in extract_numbers(summary):
        if kind == "bare" and float(value).is_integer() and value <= _PROSE_COUNT_MAX:
            continue   # prose count, not a statistic — see _PROSE_COUNT_MAX
        if not _number_supported(value, kind, allowed_nums):
            shown = f"{value:,.10g}"
            problems.append(
                f"unsupported {kind} value {shown} — not present in the data "
                f"given to the model"
            )

    # 3. Every date must trace back to the prompt.
    allowed_dates = extract_dates(prompt)
    for d in sorted(extract_dates(summary)):
        if d not in allowed_dates:
            problems.append(
                f"unsupported date {d} — not present in the data given to the model"
            )

    # 4. Every show named must have been part of the input.
    for show in sorted(show_names or set()):
        if not show:
            continue
        if show.lower() in summary.lower() and show.lower() not in prompt.lower():
            problems.append(
                f"names {show!r}, which was not among the shows given to the model"
            )

    return problems
