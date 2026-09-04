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

# Bumped when the checks change in a way worth distinguishing in stored
# provenance. v2 added payload-aware benchmark-comparison validation.
GUARD_VERSION = "2"

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

    # — Derived counts of shows. "three shows exceeded their benchmark" is
    # arithmetic performed over the table, not a figure the model was given,
    # and in practice it has been wrong: a regenerated 2024-2025 retrospective
    # counted shows with NO pre-season benchmark among those that "exceeded"
    # one, and miscounted subscriber titles in both directions. Counts cannot
    # be checked against the input, so they are not allowed.
    (r"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+"
     r"(of\s+(the\s+)?\w+\s+)?"
     r"(subscriber\s+|subscription\s+|non-subscription\s+|major\s+)?"
     r"(shows?|titles?|productions?|engagements?)\b",
     "states a count of shows — counts are derived, not given, and cannot be verified"),

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


def _normalize_dashes(text: str) -> str:
    """
    Fold en/em dashes and the minus sign to a plain hyphen.

    Without this, a model writing "2025–2026" (en dash) against a prompt
    containing "2025-2026" (hyphen) had the second year read as a standalone
    unsupported number, and three sound season retrospectives were rejected.
    """
    return re.sub(r"[‐-―−]", "-", text)


def extract_numbers(text: str) -> list[tuple[float, str]]:
    """
    Pull every quantity out of `text` as (value, kind) where kind is
    'money' | 'percent' | 'bare'. Money is normalized to whole dollars so
    "$761K" and "$761,000" compare equal.
    """
    text = _normalize_dashes(text)
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
    text = _normalize_dashes(text)
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


# ── COMPARISON CLAIMS ─────────────────────────────────────────────────────────
#
# Narrow, runtime-derived checking for the ONE claim shape that has repeatedly
# shipped wrong: "<show> exceeded / underperformed / matched its benchmark".
#
# This deliberately does not attempt general fact-checking of prose, and it
# defines no schema of allowed analysis. It reads whatever fields the per-show
# payload actually carries at runtime, and only adjudicates sentences that
# combine a show name with comparison language. Everything else stays
# open-ended and continues through the ingredient and banned-claim checks.
#
# Confirmed production errors this exists to catch:
#   2021-2022 Hamilton         "significantly exceeded"  92.1% vs 99.7% -> below
#   2022-2023 Mean Girls       grouped as outperforming  85.0% vs 90.9% -> below
#   2022-2023 Ain't Too Proud  grouped as outperforming  74.7% vs 75.0% -> below
#   2023-2024 Funny Girl       grouped as underperforming, pre_peer_cap is null

_DIRECTION_WORDS = {
    "above": [
        r"exceed(s|ed|ing)?", r"outperform(s|ed|ing)?", r"surpass(es|ed|ing)?",
        r"beat", r"above", r"ahead\s+of", r"stronger\s+than", r"over-?perform(s|ed|ing)?",
        r"outpaced?", r"better\s+than",
    ],
    "below": [
        r"underperform(s|ed|ing)?", r"under-?perform(s|ed|ing)?",
        r"fell\s+(notably\s+|well\s+|significantly\s+)?short", r"falls\s+short",
        r"below", r"missed", r"trail(s|ed|ing)?", r"lagg?(s|ed|ing)?",
        r"short\s+of", r"weaker\s+than", r"worse\s+than", r"declined\s+against",
    ],
    "equal": [
        r"matched?", r"in\s+line\s+with", r"met\s+(its|their)", r"on\s+par",
        r"equal(l)?ed", r"consistent\s+with", r"tracked\s+(closely\s+)?with",
    ],
    # An explicit statement that there is nothing to compare against. This is
    # a legitimate claim and must be checked like any other — and it stops a
    # clause from inheriting a direction from its sentence lead-in.
    "none": [
        r"no\s+(\w+\s+){0,3}?benchmarks?\b",
        r"no\s+(\w+\s+){0,3}?(signal|comparison|data)\s+available",
        r"without\s+(\w+\s+){0,3}?benchmarks?\b",
        # "lacked comparable benchmarks" — allow an adjective or two between.
        r"lack(s|ed|ing)?\s+(\w+\s+){0,3}?(benchmarks?|signals?|comparisons?)\b",
    ],
}

# A sentence only enters comparison adjudication if it also refers to the thing
# being compared against. Without this, ordinary prose ("gross fell short of
# $1M") would be dragged in.
_BENCHMARK_REF = re.compile(
    r"\b(benchmark|pre-?season|peer\s+signal|signal|expectation|projection|forecast|"
    r"pre-?booking)\w*\b", re.IGNORECASE)

_DIRECTION_RE = {
    d: re.compile(r"\b(" + "|".join(pats) + r")\b", re.IGNORECASE)
    for d, pats in _DIRECTION_WORDS.items()
}

# Clause splitters — a single sentence often carries one claim per show.
_CLAUSE_SPLIT = re.compile(
    r"\s*(?::|;|,\s*(?:while|whereas|and|but|though|although)\b|"
    r"\s+(?:while|whereas|but|though|although)\b|,)\s*", re.IGNORECASE)

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _payload_facts(shows_payload) -> dict:
    """
    Build {show_name: {field: value}} from whatever the payload actually has.
    No field list is assumed; missing/None values simply stay absent.
    """
    facts = {}
    for row in shows_payload or []:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        facts[name] = {k: v for k, v in row.items() if k != "name" and v is not None}
    return facts


def displayed_pct(v):
    """
    Render a payload capacity at exactly the precision leadership sees.

    Relationships are classified from these displayed values, so a stated
    relationship can never contradict the figures printed beside it.
    """
    if v is None:
        return None
    return round(v * 100, 1) if v <= 1 else round(v, 1)


def derive_relationship(row: dict) -> dict:
    """
    Compute the benchmark relationship for one show, deterministically, from
    the values it actually has. This is the authority — neither the model nor
    the guard's prose reading is allowed to override it.

    Returns {relationship, actual, benchmark} where relationship is one of
    'no_benchmark' | 'above' | 'below' | 'matched'.
    """
    actual = displayed_pct(row.get("actual_peer_cap"))
    bench  = displayed_pct(row.get("pre_peer_cap"))
    if bench is None or actual is None:
        rel = "no_benchmark"
    elif actual > bench:
        rel = "above"
    elif actual < bench:
        rel = "below"
    else:
        rel = "matched"
    return {"relationship": rel, "actual": actual, "benchmark": bench}


def derive_relationships(shows_payload) -> dict:
    """{show_name: derive_relationship(row)} for every show in the payload."""
    out = {}
    for row in shows_payload or []:
        name = (row.get("name") or "").strip()
        if name:
            out[name] = derive_relationship(row)
    return out


# Prose direction -> the derived relationship it asserts.
_CLAIM_TO_RELATIONSHIP = {"above": "above", "below": "below", "equal": "matched",
                          "none": "no_benchmark"}


def _unmask(fragment: str, tokens: dict) -> str:
    """Restore real show names in a masked fragment, for readable messages."""
    for tok, name in tokens.items():
        fragment = fragment.replace(tok, name)
    return fragment


def check_comparisons(summary: str, shows_payload) -> list[str]:
    """
    Adjudicate every clause that names at least one show AND uses
    benchmark-comparison language, against the deterministically derived
    relationship for each show named.

    Grouping is permitted: "Wicked and Beetlejuice exceeded their benchmarks"
    is fine when BOTH are derived 'above'. It fails when any named show does
    not share the stated relationship — which is exactly how Mean Girls and
    Ain't Too Proud were smuggled into an "outperformed" group while sitting
    below their benchmarks.

    Fails closed when a comparison cannot be attributed to any show, or when a
    clause asserts more than one direction at once.
    """
    derived = derive_relationships(shows_payload)
    if not derived:
        return []

    problems: list[str] = []
    text = _normalize_dashes(summary)

    # Mask show names before splitting. Titles contain the very punctuation the
    # clause splitter uses — "Back to the Future: The Musical", "Oh, Mary!" —
    # and splitting inside a title strands the claim from the show it is about.
    # Longest first so "Six" cannot mask part of a longer title.
    ordered = sorted(derived, key=len, reverse=True)
    tokens = {}
    for i, name in enumerate(ordered):
        tok = f"\x00SHOW{chr(65 + i % 26)}{i}\x00"
        tokens[tok] = name
        text = re.sub(re.escape(name), tok, text, flags=re.IGNORECASE)

    def shows_in(fragment: str) -> list:
        return [tokens[t] for t in tokens if t in fragment]

    for sentence in _SENTENCE_SPLIT.split(text):
        if not _BENCHMARK_REF.search(sentence):
            continue
        if not any(rx.search(sentence) for rx in _DIRECTION_RE.values()):
            continue

        clauses = _CLAUSE_SPLIT.split(sentence)

        # Only a LEAD-IN clause — one that states a direction while naming no
        # show — can lend its direction to the shows listed after it, as in
        # "Several shows outperformed their benchmarks: Hadestown ..., while
        # Mean Girls ...". A direction inside a clause that names its own show
        # ("Shucked matched expectations") belongs to that show alone and must
        # not leak onto its neighbours.
        lead_dirs: list[str] = []
        for c in clauses:
            if shows_in(c):
                continue
            lead_dirs += [d for d, rx in _DIRECTION_RE.items() if rx.search(c)]

        for clause in clauses:
            dirs = [d for d, rx in _DIRECTION_RE.items() if rx.search(clause)]

            named = shows_in(clause)

            # A sentence lead-in can carry the direction for shows listed in
            # later clauses: "Several shows outperformed ...: Hadestown reached
            # X, while Mean Girls achieved Y and Ain't Too Proud hit Z." Those
            # trailing clauses assert the lead-in's direction about their own
            # shows — which is how two shows sitting BELOW their benchmarks were
            # published inside an "outperformed" group. Inherit it, but only
            # when the sentence states exactly one direction and the clause
            # names a show and states no direction of its own.
            if not dirs and named and len(set(lead_dirs)) == 1:
                dirs = list(set(lead_dirs))
            if not dirs:
                continue

            if not named:
                # A lead-in ("Several shows outperformed their benchmarks:")
                # names no show itself, but its direction is inherited and
                # checked against every show listed after it. Only flag a
                # show-less comparison when nothing downstream picked it up —
                # that is a genuinely unattributable claim.
                if dirs and set(dirs) & set(lead_dirs) and any(
                    shows_in(c) and not any(rx.search(c) for rx in _DIRECTION_RE.values())
                    for c in clauses
                ):
                    continue
                problems.append(
                    "comparison claim names no show that can be matched to the "
                    f"payload — cannot verify: {_unmask(clause, tokens).strip()[:90]!r}"
                )
                continue
            if len(dirs) > 1:
                problems.append(
                    f"clause asserts multiple directions {sorted(dirs)} at once — "
                    f"cannot attribute unambiguously: {_unmask(clause, tokens).strip()[:90]!r}"
                )
                continue

            claimed_rel = _CLAIM_TO_RELATIONSHIP[dirs[0]]

            for show in named:
                d = derived[show]
                rel = d["relationship"]
                if rel == claimed_rel:
                    continue                      # claim matches the data
                if claimed_rel == "no_benchmark":
                    problems.append(
                        f"{show}: described as having no pre-season benchmark, but "
                        f"one exists (derived '{rel}': actual {d['actual']}% vs "
                        f"benchmark {d['benchmark']}%)"
                    )
                elif rel == "no_benchmark":
                    problems.append(
                        f"{show}: described as '{claimed_rel}' a benchmark, but it "
                        f"has no pre-season peer benchmark (derived: no_benchmark)"
                    )
                else:
                    problems.append(
                        f"{show}: stated '{claimed_rel}' but derived '{rel}' "
                        f"(actual {d['actual']}% vs benchmark {d['benchmark']}%)"
                    )

            # Within a verified comparison clause, any percentage quoted must
            # be one of the named shows' own displayed values — catches a real
            # figure attached to the wrong production.
            own = set()
            for show in named:
                own.update(x for x in (derived[show]["actual"],
                                       derived[show]["benchmark"]) if x is not None)
            for value, kind in extract_numbers(clause):
                if kind == "percent" and round(value, 1) not in own:
                    problems.append(
                        f"{'/'.join(named)}: cites {value}% in a comparison, which is "
                        f"not one of the named show's displayed figures "
                        f"({sorted(own)})"
                    )

    return problems


def validate_summary(summary: str, prompt: str,
                     show_names: set | None = None,
                     shows_payload=None) -> list[str]:
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

    # 5. Comparative claims, checked against each show's own runtime values.
    problems.extend(check_comparisons(summary, shows_payload))

    return problems
