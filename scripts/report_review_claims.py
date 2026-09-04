"""
Verification report for season_review.json.

Machine-derived from the stored per-show payload and the generated summary —
this is the evidence for whether a retrospective's comparative claims are
sound. It is not a description of a manual read-through.

Run:
    python scripts/report_review_claims.py

Emits one row per show:
    season | show | displayed actual | displayed benchmark |
    derived relationship | relationship stated in summary | result

RESULT is:
    OK        the summary states this relationship and it matches the data
    MISMATCH  the summary states a relationship the data contradicts
    (none)    the summary makes no comparative claim about this show
Any AMBIGUOUS comparison in the summary is listed separately underneath, since
it cannot be tied to a specific show by definition.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from highlight_guard import (  # noqa: E402
    _CLAIM_TO_RELATIONSHIP, _CLAUSE_SPLIT, _DIRECTION_RE, _SENTENCE_SPLIT,
    _BENCHMARK_REF, _normalize_dashes, check_comparisons, derive_relationships,
)

REVIEW = Path(__file__).resolve().parent.parent / "src" / "data" / "season_review.json"


def claims_by_show(summary: str, shows_payload) -> dict:
    """
    Collect the relationship each show is stated to have, using the same
    clause walk the guard uses to adjudicate them.
    """
    derived = derive_relationships(shows_payload)
    text = _normalize_dashes(summary)
    ordered = sorted(derived, key=len, reverse=True)
    tokens = {}
    for i, name in enumerate(ordered):
        tok = f"\x00S{chr(65 + i % 26)}{i}\x00"
        tokens[tok] = name
        import re
        text = re.sub(re.escape(name), tok, text, flags=re.IGNORECASE)

    def shows_in(frag):
        return [tokens[t] for t in tokens if t in frag]

    found: dict = {}
    for sentence in _SENTENCE_SPLIT.split(text):
        if not _BENCHMARK_REF.search(sentence):
            continue
        clauses = _CLAUSE_SPLIT.split(sentence)
        lead = []
        for c in clauses:
            if not shows_in(c):
                lead += [d for d, rx in _DIRECTION_RE.items() if rx.search(c)]
        for clause in clauses:
            dirs = [d for d, rx in _DIRECTION_RE.items() if rx.search(clause)]
            named = shows_in(clause)
            if not dirs and named and len(set(lead)) == 1:
                dirs = list(set(lead))
            if not dirs or len(dirs) > 1:
                continue
            for show in named:
                found.setdefault(show, set()).add(_CLAIM_TO_RELATIONSHIP[dirs[0]])
    return found


def main() -> int:
    data = json.loads(REVIEW.read_text(encoding="utf-8"))
    if not data:
        print("season_review.json is empty — nothing to verify.")
        return 0

    w = (9, 34, 9, 12, 13, 13, 9)
    print(f"{'season':<{w[0]}} | {'show':<{w[1]}} | {'actual':>{w[2]}} | "
          f"{'benchmark':>{w[3]}} | {'derived':<{w[4]}} | {'stated':<{w[5]}} | result")
    print("-" * 118)

    mismatches = ambiguous = 0
    for season in sorted(data):
        entry = data[season]
        payload = entry.get("shows", [])
        derived = derive_relationships(payload)
        stated = claims_by_show(entry.get("summary", ""), payload)

        for show in sorted(derived):
            d = derived[show]
            claims = sorted(stated.get(show, []))
            act = "—" if d["actual"] is None else f"{d['actual']}%"
            ben = "—" if d["benchmark"] is None else f"{d['benchmark']}%"
            if not claims:
                said, result = "(none)", "(none)"
            else:
                said = "/".join(claims)
                if claims == [d["relationship"]]:
                    result = "OK"
                else:
                    result = "MISMATCH"
                    mismatches += 1
            print(f"{season:<{w[0]}} | {show[:w[1]]:<{w[1]}} | {act:>{w[2]}} | "
                  f"{ben:>{w[3]}} | {d['relationship']:<{w[4]}} | {said:<{w[5]}} | {result}")

        for p in check_comparisons(entry.get("summary", ""), payload):
            if "cannot verify" in p or "cannot attribute" in p:
                ambiguous += 1
                print(f"{season:<{w[0]}} | AMBIGUOUS: {p[:95]}")

    print("-" * 118)
    print(f"mismatched comparative claims: {mismatches}")
    print(f"ambiguous comparisons:         {ambiguous}")
    ok = mismatches == 0 and ambiguous == 0
    print("RESULT: " + ("all comparative claims verified" if ok
                        else "UNVERIFIED CLAIMS PRESENT"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
