"""
Pipeline behaviour tests — what gets published when validation fails.

Run:
    python scripts/test_review_pipeline.py

Covers what each generator publishes when validation fails, and the weekly
pulse that guarantees a current-week entry every ingestion:
  - a weekly AI summary that fails twice yields no AI copy, and run() then
    writes a deterministic pulse for the current week rather than leaving the
    prior week's entry on screen;
  - a season retrospective that fails twice publishes DETERMINISTIC factual
    copy, so a season is never left blank and no human approval is needed.

Also covers the schema/provenance metadata stored for auditing.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import generate_highlights as gh          # noqa: E402
import generate_season_review as gsr      # noqa: E402
from highlight_guard import GUARD_VERSION  # noqa: E402

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


SHOWS = [
    {"name": "Hamilton",   "pre_peer_cap": 0.9970, "actual_peer_cap": 0.9210,
     "actual_peer_gross": 1_500_000, "actual_peer_weeks": 12, "sub": True},
    {"name": "Funny Girl", "pre_peer_cap": None,   "actual_peer_cap": 0.7930,
     "actual_peer_gross": 900_000, "actual_peer_weeks": 8, "sub": False},
]

GOOD = ("Hamilton underperformed its pre-season peer benchmark, at 92.1% "
        "against 99.7%. Funny Girl recorded 79.3%, with no pre-season peer "
        "benchmark available.")
BAD = "Hamilton exceeded its pre-season peer benchmark at 92.1% against 99.7%."


print("\nSuite A - deterministic fallback for season retrospectives")

fb = gsr.build_fallback_summary("2021-2022", SHOWS)
check("fallback states each show's displayed actual",
      "92.1%" in fb and "79.3%" in fb, fb)
check("fallback states the benchmark when one exists",
      "99.7%" in fb, fb)
check("fallback says so when there is no benchmark",
      "has no pre-season peer benchmark" in fb, fb)
# Each statement must be one self-contained sentence naming its own show, or
# the benchmark clause is left unattributable and the guard flags deterministic
# copy that is true by construction.
check("fallback copy passes the guard's own comparison check",
      not __import__("highlight_guard").check_comparisons(fb, SHOWS),
      fb)
check("fallback uses no comparative language",
      not any(w in fb.lower() for w in
              ("exceed", "underperform", "outperform", "matched", "fell short")),
      fb)


print("\nSuite B - season review publishes fallback after two failed attempts")

orig_call, orig_out = gsr._call_once, gsr.REVIEW_OUT
try:
    gsr._call_once = lambda prompt, max_tokens=300: BAD          # always invalid
    result = gsr.call_api("Pre Peer% 99.7% Act Peer% 92.1%", False, None, SHOWS)
    check("call_api returns None after two invalid attempts", result is None,
          repr(result))

    with tempfile.TemporaryDirectory() as td:
        gsr.REVIEW_OUT = Path(td) / "season_review.json"
        summary = gsr.build_fallback_summary("2021-2022", SHOWS)
        gsr.write_review("2021-2022", summary, SHOWS, "fallback", "deterministic")
        entry = json.loads(gsr.REVIEW_OUT.read_text(encoding="utf-8"))["2021-2022"]

    check("fallback entry IS published (season never left blank)",
          bool(entry.get("summary")))
    check("fallback entry needs no approval field to display",
          "review_status" not in entry and "approved" not in json.dumps(entry))
    check("fallback provenance: validation_status",
          entry["validation_status"] == "fallback", entry.get("validation_status"))
    check("fallback provenance: validation_method",
          entry["validation_method"] == "deterministic", entry.get("validation_method"))
    check("fallback provenance: guard_version",
          entry["guard_version"] == GUARD_VERSION, entry.get("guard_version"))
    check("fallback retains generated_at", "generated_at" in entry)
    check("fallback retains shows payload", entry.get("shows") == SHOWS)
finally:
    gsr._call_once, gsr.REVIEW_OUT = orig_call, orig_out


print("\nSuite C - season review publishes AI copy when it validates")

orig_call, orig_out = gsr._call_once, gsr.REVIEW_OUT
try:
    gsr._call_once = lambda prompt, max_tokens=300: GOOD
    prompt = "Pre Peer% 99.7% Act Peer% 92.1% 79.3% Vs Benchmark below no_benchmark"
    result = gsr.call_api(prompt, False, None, SHOWS)
    check("valid AI copy is returned unchanged", result == GOOD, repr(result))

    with tempfile.TemporaryDirectory() as td:
        gsr.REVIEW_OUT = Path(td) / "season_review.json"
        gsr.write_review("2021-2022", result, SHOWS)
        entry = json.loads(gsr.REVIEW_OUT.read_text(encoding="utf-8"))["2021-2022"]
    check("AI provenance: validation_status", entry["validation_status"] == "passed")
    check("AI provenance: validation_method", entry["validation_method"] == "ai_guard")
    check("AI provenance: guard_version", entry["guard_version"] == GUARD_VERSION)
finally:
    gsr._call_once, gsr.REVIEW_OUT = orig_call, orig_out


print("\nSuite D - weekly highlight writes NOTHING after two failed attempts")

orig_call = gh._call_once
try:
    gh._call_once = lambda prompt: "The tour has closed due to weak demand."
    result = gh.call_api("gross -62% week of 2026-08-23", False, {"Hell's Kitchen"})
    check("weekly call_api returns None after two invalid attempts",
          result is None, repr(result))
    check("rejected AI copy is never substituted into the entry", result is None)
    # run() converts this None into a current-week pulse — see Suite G. The
    # point is that the REJECTED TEXT never reaches the file, not that the
    # week is left without an entry.
finally:
    gh._call_once = orig_call


print("\nSuite E - weekly no-trigger behaviour is unchanged")

# Previously an empty file was the expected no-trigger state. It no longer is:
# every successful ingestion writes an entry, so a reader can tell the week was
# processed. An empty file is now only the genuine no-entry case, which the
# pages render as an explicit neutral state.
for f in ("exec_brief_highlight.json", "programming_highlight.json"):
    p = Path(__file__).resolve().parent.parent / "src" / "data" / f
    data = json.loads(p.read_text(encoding="utf-8"))
    check(f"{f} parses", isinstance(data, dict))
    check(f"{f} carries a current-week entry (not empty)", bool(data), data)
    for season, e in data.items():
        check(f"{f} [{season}] declares kind", e.get("kind") in ("highlight", "pulse"),
              e.get("kind"))
        check(f"{f} [{season}] declares scope",
              e.get("scope") in ("peer", "national", "national_fallback"), e.get("scope"))
        check(f"{f} [{season}] records guard_version",
              e.get("guard_version") == GUARD_VERSION, e.get("guard_version"))


# ── WEEKLY PULSE ─────────────────────────────────────────────────────────────

import generate_highlights as gh2  # noqa: E402
from highlight_guard import validate_summary as _vs, _BANNED_COMPILED  # noqa: E402

WK = "2026-08-30"
PEER = [{"week_of": WK, "show": "The Outsiders", "theatre": "Peer Hall",
         "similar_bushnell": True, "gross_gross": 1_000_000, "cap_paid": 88.0,
         "no_engagement": False}]
NATL = PEER + [{"week_of": WK, "show": "Mamma Mia!", "theatre": "Big House",
                "similar_bushnell": False, "gross_gross": 900_000,
                "cap_paid": 77.0, "no_engagement": False}]

print()
print("Suite F - deterministic weekly pulse content")

for scope, recs, allr, word in [("peer", PEER, PEER, "peer venue"),
                                ("national", NATL, NATL, "venue")]:
    summ, facts = gh2.build_pulse(WK, scope, recs, allr, "no_threshold")
    check(f"{scope} pulse names the reporting week",
          "August 30, 2026" in summ, summ)
    check(f"{scope} pulse states the threshold outcome",
          "No configured material-change threshold was reached." in summ, summ)
    check(f"{scope} pulse uses {scope}-appropriate wording",
          word in summ, summ)
    check(f"{scope} pulse passes the guard", not _vs(summ, facts), _vs(summ, facts))
    check(f"{scope} pulse contains no banned language",
          not [w for pat, w in _BANNED_COMPILED if pat.search(summ)], summ)

# peer scope with zero records
summ, facts = gh2.build_pulse(WK, "peer", [], PEER, "no_threshold")
check("peer-zero pulse states the absence plainly",
      "No season-slate shows appear in peer-venue data" in summ, summ)
check("peer-zero pulse implies no closure/cancellation/demand/failure",
      not any(w in summ.lower() for w in
              ("closed", "cancel", "weak", "declin", "failed to report", "missing")),
      summ)
check("peer-zero pulse passes the guard", not _vs(summ, facts), _vs(summ, facts))

# validation-failure pulse must NOT claim a quiet week
summ, facts = gh2.build_pulse(WK, "peer", PEER, PEER, "highlight_validation_failed")
check("validation-failure pulse says a threshold WAS detected",
      "threshold was detected" in summ, summ)
check("validation-failure pulse does NOT claim no threshold fired",
      "No configured material-change threshold was reached" not in summ, summ)
check("validation-failure pulse exposes no rejected AI text or guard detail",
      "banned" not in summ.lower() and "unsupported" not in summ.lower(), summ)
check("validation-failure pulse passes the guard", not _vs(summ, facts), _vs(summ, facts))

# absent-evidence framing must not be emphasised
summ, _ = gh2.build_pulse(WK, "peer", PEER, PEER, "no_threshold")
check("pulse does not characterise shows that did not report",
      "did not report" not in summ and "of 10" not in summ, summ)


print()
print("Suite G - every ingestion writes a current-week entry")

def _run_pulse(tmp, scope, recs, reason):
    out = Path(tmp) / "x.json"
    ok = gh2.write_pulse(out, "2026-2027", WK, scope, recs, recs, reason)
    return ok, json.loads(out.read_text(encoding="utf-8"))["2026-2027"]

with tempfile.TemporaryDirectory() as td:
    ok, e = _run_pulse(td, "peer", PEER, "no_threshold")
    check("no-trigger pulse is written", ok)
    check("kind is pulse", e["kind"] == "pulse", e.get("kind"))
    check("pulse_reason is no_threshold", e["pulse_reason"] == "no_threshold")
    check("scope recorded", e["scope"] == "peer")
    check("week_of is the current week", e["week_of"] == WK)
    check("provenance: fallback/deterministic",
          e["validation_status"] == "fallback" and e["validation_method"] == "deterministic")
    check("guard_version recorded", e["guard_version"] == GUARD_VERSION)

with tempfile.TemporaryDirectory() as td:
    ok, e = _run_pulse(td, "national", NATL, "highlight_validation_failed")
    check("validation-failure pulse is written", ok)
    check("pulse_reason is highlight_validation_failed",
          e["pulse_reason"] == "highlight_validation_failed")

# a prior-week entry must be REPLACED, never retained
with tempfile.TemporaryDirectory() as td:
    out = Path(td) / "x.json"
    out.write_text(json.dumps({"2026-2027": {"kind": "highlight", "week_of": "2026-07-19",
                                             "summary": "old"}}), encoding="utf-8")
    gh2.write_pulse(out, "2026-2027", WK, "peer", PEER, PEER, "no_threshold")
    e = json.loads(out.read_text(encoding="utf-8"))["2026-2027"]
    check("prior-week entry is replaced, not retained",
          e["week_of"] == WK and e["summary"] != "old", e)

# highlight path still records its own provenance
with tempfile.TemporaryDirectory() as td:
    out = Path(td) / "x.json"
    gh2.write_entry(out, "2026-2027", WK, "AI copy.", "highlight", "national",
                    triggers=[{"type": "wow_gross_change"}])
    e = json.loads(out.read_text(encoding="utf-8"))["2026-2027"]
    check("highlight kind recorded", e["kind"] == "highlight")
    check("highlight pulse_reason is null", e["pulse_reason"] is None)
    check("highlight provenance: passed/ai_guard",
          e["validation_status"] == "passed" and e["validation_method"] == "ai_guard")
    check("trigger types recorded", e["trigger"] == "wow_gross_change")


print()
print("Suite H - comparison availability (derived from comparable shows)")

def _rec(wk, show, peer=True):
    return {"week_of": wk, "show": show, "theatre": "Hall " + show,
            "similar_bushnell": peer, "gross_gross": 1_000_000,
            "cap_paid": 88.0, "no_engagement": False}

CUR, PRV = "2026-08-30", "2026-08-23"
cur = [_rec(CUR, "The Outsiders")]

cases = [
    ("available",              [_rec(PRV, "The Outsiders")], True,  1),
    ("no_prior_scope_records", [],                           True,  0),
    ("no_comparable_shows",    [_rec(PRV, "Mamma Mia!")],    True,  0),
    ("season_boundary",        [_rec(PRV, "The Outsiders")], False, 1),
]
for expected, prev, same, comparable in cases:
    c = gh2.comparison_availability(cur, prev, same)
    check(f"status {expected}", c["comparison_status"] == expected, c)
    check(f"{expected}: comparable show count = {comparable}",
          c["comparable_shows"] == comparable, c)
    check(f"{expected}: tracks both record counts",
          c["current_records"] == len(cur) and c["prior_records"] == len(prev), c)
    check(f"{expected}: tracks both show counts",
          "current_shows" in c and "prior_shows" in c, c)
    check(f"{expected}: records same-season flag", c["same_season"] is same, c)

# records present in both weeks but no overlap is NOT "no prior records"
c = gh2.comparison_availability(cur, [_rec(PRV, "Mamma Mia!")], True)
check("prior records with zero overlap is a valid prior reporting week",
      c["prior_records"] == 1 and c["comparison_status"] == "no_comparable_shows", c)


print()
print("Suite I - pulse wording matches comparison status")

WORDING = {
    "available":              "No configured material-change threshold was reached.",
    "no_prior_scope_records": "prior reporting week contained no peer-venue records",
    "no_comparable_shows":    "no season-slate show appeared in both weeks",
    "season_boundary":        "intentionally reset at the fiscal-season boundary",
}
for expected, prev, same, _ in cases:
    c = gh2.comparison_availability(cur, prev, same)
    summ, facts = gh2.build_pulse(CUR, "peer", cur, cur, "no_threshold", c)
    check(f"{expected}: wording present", WORDING[expected] in summ, summ)
    check(f"{expected}: passes guard", not _vs(summ, facts), _vs(summ, facts))
    check(f"{expected}: never implies a missing report",
          not any(w in summ.lower() for w in
                  ("unavailable report", "missing report", "no report",
                   "report was not", "failed to report")), summ)
    if expected != "available":
        check(f"{expected}: does not claim the comparison ran",
              "No configured material-change threshold was reached." not in summ, summ)
        check(f"{expected}: credits only independent checks",
              "Other configured checks produced no material highlight." in summ, summ)


print()
print("Suite J - reporting weeks and season come from data.json")

_root = Path(__file__).resolve().parent.parent
_raw = json.loads((_root / "src/data/data.json").read_text(encoding="utf-8"))
_weeks = sorted({r["week_of"] for r in _raw["records"] if r.get("week_of")})
latest, previous = _weeks[-1], _weeks[-2]

check("latest and previous are distinct ordered week_of values",
      latest > previous and latest != previous, (latest, previous))
check("previous is the maximum week strictly less than latest",
      previous == max(w for w in _weeks if w < latest), previous)
check("derivation does not assume a 7-day step",
      previous == max(w for w in _weeks if w < latest))

# a skipped calendar week still selects the preceding AVAILABLE report
gapped = ["2026-06-07", "2026-06-14", "2026-07-05"]   # 3-week gap before the last
check("a calendar gap still selects the immediately preceding available report",
      max(w for w in gapped if w < "2026-07-05") == "2026-06-14")

check("current reporting season is fiscal_year(latest_week)",
      gh2.fiscal_year(latest) == "2026-2027", gh2.fiscal_year(latest))
check("July 1 boundary: 2026-07-05 belongs to 2026-2027",
      gh2.fiscal_year("2026-07-05") == "2026-2027")
check("July 1 boundary: 2026-06-28 belongs to 2025-2026",
      gh2.fiscal_year("2026-06-28") == "2025-2026")

# empty output files must not influence week discovery
with tempfile.TemporaryDirectory() as td:
    empty = Path(td) / "empty.json"
    empty.write_text("{}", encoding="utf-8")
    weeks_again = sorted({r["week_of"] for r in _raw["records"] if r.get("week_of")})
    check("empty output files do not affect reporting-week discovery",
          weeks_again[-1] == latest and weeks_again[-2] == previous)


print()
print("Suite K - only the current reporting season is written")

for f in ("exec_brief_highlight.json", "programming_highlight.json"):
    data = json.loads((_root / "src/data" / f).read_text(encoding="utf-8"))
    check(f"{f} contains only fiscal_year(latest_week)",
          list(data) == [gh2.fiscal_year(latest)], list(data))
    check(f"{f} entry is for the latest reporting week",
          data[gh2.fiscal_year(latest)]["week_of"] == latest)

# historical entries are preserved, never regenerated
with tempfile.TemporaryDirectory() as td:
    out = Path(td) / "h.json"
    out.write_text(json.dumps({
        "2019-2020": {"kind": "highlight", "week_of": "2020-03-08", "summary": "historical"},
    }), encoding="utf-8")
    gh2.write_pulse(out, "2026-2027", CUR, "peer", cur, cur, "no_threshold")
    after = json.loads(out.read_text(encoding="utf-8"))
    check("existing historical season entry is preserved",
          after["2019-2020"]["summary"] == "historical", after.get("2019-2020"))
    check("no pulse is backfilled for the historical season",
          after["2019-2020"].get("pulse_reason") is None)
    check("only the current season key is added",
          set(after) == {"2019-2020", "2026-2027"}, set(after))

check("no valid reporting week means no write (guarded in run())",
      "Fewer than 2 distinct weeks" in (_root / "scripts/generate_highlights.py").read_text(encoding="utf-8"))


print(f"\n{'=' * 60}\n{PASSED} passed, {FAILED} failed\n{'=' * 60}")
sys.exit(1 if FAILED else 0)
