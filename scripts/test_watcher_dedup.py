"""
Tests for watcher.should_ingest() — what counts as a new report.

Run:
    python scripts/test_watcher_dedup.py

A report only ever changes because somebody drops a new or edited workbook
on SharePoint. Everything else — above all OneDrive re-stamping a file's
modified time when it finishes syncing — must not start a run.

This is a regression test for a real incident. The watcher keyed on
(path, mtime), OneDrive bumped the mtime of a file it had just synced, and
the entire pipeline ran a second time for one report: a second context
scrape, a second season review, and a second deploy to production. The
duplicate run then failed in a way that asked a human to merge by hand.
"""

from __future__ import annotations

import importlib.util
import logging
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

WATCHER = Path(__file__).resolve().parent / "watcher.py"

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


def load_watcher():
    spec = importlib.util.spec_from_file_location("watcher_dedup_test", WATCHER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(logging.NullHandler())
    return mod


w = load_watcher()
ROOT = Path(tempfile.mkdtemp(prefix="btd-dedup-test-"))

try:
    report = ROOT / "TouringReport_Wk21.xlsx"
    report.write_bytes(b"week 21 numbers")

    check("a report never seen before is ingested",
          w.should_ingest(str(report)) is True)
    check("the same bytes are not ingested twice",
          w.should_ingest(str(report)) is False)

    print("\n--- OneDrive re-stamps the modified time after syncing ---")
    old_mtime = report.stat().st_mtime
    os.utime(report, (old_mtime + 120, old_mtime + 120))
    check("mtime changed, so the old key would have fired",
          report.stat().st_mtime != old_mtime)
    check("a touched but unchanged file is still skipped",
          w.should_ingest(str(report)) is False)

    print("\n--- somebody drops an edited workbook over the old one ---")
    report.write_bytes(b"week 21 numbers, corrected")
    check("edited contents at the same path are ingested",
          w.should_ingest(str(report)) is True)
    check("and only once", w.should_ingest(str(report)) is False)

    print("\n--- somebody re-uploads the same workbook under a new name ---")
    # The filename is what marks a revision (process_touring.py reads REV /
    # REVISED from it), so the same bytes under a new name is a different
    # instruction and must still run.
    revised = ROOT / "TouringReport_Wk21 - REVISED.xlsx"
    revised.write_bytes(report.read_bytes())
    check("identical bytes at a NEW path are ingested",
          w.should_ingest(str(revised)) is True)
    check("the original path stays settled",
          w.should_ingest(str(report)) is False)

    print("\n--- a file that cannot be read ---")
    check("unreadable reports report None, not a false 'new'",
          w.should_ingest(str(ROOT / "does_not_exist.xlsx")) is None)

    print("\n--- remember_ingested() settles a file without running it ---")
    startup = ROOT / "TouringReport_Wk20.xlsx"
    startup.write_bytes(b"week 20 numbers")
    w.remember_ingested(str(startup))
    check("a file the startup scan skipped is not ingested later",
          w.should_ingest(str(startup)) is False)
    check("remember_ingested on a missing file is harmless",
          w.remember_ingested(str(ROOT / "nope.xlsx")) is None)
finally:
    shutil.rmtree(ROOT, ignore_errors=True)

print(f"\n{'=' * 60}\n{PASSED} passed, {FAILED} failed\n{'=' * 60}")
sys.exit(1 if FAILED else 0)
