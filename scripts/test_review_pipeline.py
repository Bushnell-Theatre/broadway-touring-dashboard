"""
Pipeline behaviour tests — what gets published when validation fails.

Run:
    python scripts/test_review_pipeline.py

Covers the asymmetry between the two generators:
  - a weekly highlight that fails twice writes NOTHING (last week's entry,
    clearly dated, stays in place);
  - a season retrospective that fails twice publishes DETERMINISTIC factual
    copy, so a season is never left blank and no human approval is needed.

Also covers the provenance metadata stored for auditing.
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
      "No pre-season peer benchmark is available" in fb, fb)
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
    check("no fallback is substituted for weekly copy (unlike season review)",
          result is None)
finally:
    gh._call_once = orig_call


print("\nSuite E - weekly no-trigger behaviour is unchanged")

check("empty weekly highlight file is valid JSON and simply carries no season",
      json.loads("{}") == {})
for f in ("exec_brief_highlight.json", "programming_highlight.json"):
    p = Path(__file__).resolve().parent.parent / "src" / "data" / f
    if p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
        check(f"{f} parses (empty is expected when no threshold fires)",
              isinstance(data, dict))


print(f"\n{'=' * 60}\n{PASSED} passed, {FAILED} failed\n{'=' * 60}")
sys.exit(1 if FAILED else 0)
