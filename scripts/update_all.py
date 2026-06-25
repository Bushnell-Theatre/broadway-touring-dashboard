#!/usr/bin/env python3
"""
update_all.py
-------------
Manual full-pipeline update for the Broadway Touring Intelligence Dashboard.
Equivalent to the watcher firing on a new file, with parallel execution of
independent stages and all enrichment steps included.

Usage:
  python scripts/update_all.py --append path/to/new_report.xlsx
  python scripts/update_all.py --rebuild path/to/xlsx_folder
  python scripts/update_all.py          (enrichment refresh only — no new touring data)

Flags:
  --skip-git       Process data without committing or pushing to GitHub
  --skip-context   Skip NOAA/FRED weather and economic context refresh
  --skip-awards    Skip award data refresh (build_awards.py)
  --skip-media     Skip media signal refresh (build_media_signals.py)
  --skip-shows     Skip show metadata enrichment (scrape_shows.py)

Pipeline stages:
  Stage 1 — parallel (no shared output):
      process_touring.py   → data.json
      scrape_context.py    → context.json
      build_awards.py      → awards.json       (no merge yet)
      build_media_signals.py → media_signals.json  (no merge yet)

  Stage 2 — sequential (all write to shows.json):
      scrape_shows.py
      build_awards.py --merge-shows
      build_media_signals.py --merge-shows

  Stage 3:
      validate_data.py     → validation_report.json

  Stage 4:
      git add changed data files → commit → push
"""
from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"
SCRIPTS_DIR = ROOT / "scripts"
LOG_FILE = SCRIPTS_DIR / "update_all.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)

PY = sys.executable

DATA_FILES = [
    DATA_DIR / "data.json",
    DATA_DIR / "shows.json",
    DATA_DIR / "context.json",
    DATA_DIR / "awards.json",
    DATA_DIR / "media_signals.json",
    DATA_DIR / "validation_report.json",
]


# ---------------------------------------------------------------------------
# Subprocess helpers
# ---------------------------------------------------------------------------

def run(label: str, cmd: list, required: bool = True) -> bool:
    """Run a subprocess, stream output to the logger, return success."""
    log.info("[%s] Starting: %s", label, " ".join(str(c) for c in cmd))
    try:
        result = subprocess.run(
            cmd,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        )
        for line in (result.stdout or "").strip().splitlines():
            log.info("[%s]   %s", label, line)
        for line in (result.stderr or "").strip().splitlines():
            (log.error if result.returncode != 0 and required else log.warning)(
                "[%s]   %s", label, line
            )
        if result.returncode == 0:
            log.info("[%s] Done.", label)
            return True
        else:
            (log.error if required else log.warning)(
                "[%s] Exited %s", label, result.returncode
            )
            return False
    except Exception as exc:
        log.error("[%s] Failed: %s", label, exc)
        return False


def run_parallel(tasks: list[tuple[str, list, bool]]) -> dict[str, bool]:
    """Run multiple (label, cmd, required) tasks in parallel threads."""
    results = {}
    with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        futures = {
            pool.submit(run, label, cmd, required): label
            for label, cmd, required in tasks
        }
        for future in as_completed(futures):
            label = futures[future]
            try:
                results[label] = future.result()
            except Exception as exc:
                log.error("[%s] Unhandled error: %s", label, exc)
                results[label] = False
    return results


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

def git_changed_data_files() -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(ROOT), "status", "--porcelain", "src/data"],
        capture_output=True, text=True,
    )
    files = []
    for line in (result.stdout or "").splitlines():
        path = line[3:].strip()
        if path:
            files.append(path)
    return files


def commit_and_push(label: str, skip_git: bool) -> None:
    if skip_git:
        log.info("--skip-git: skipping commit and push.")
        return

    changed = git_changed_data_files()
    if not changed:
        log.info("No data files changed — nothing to commit.")
        return

    log.info("Changed files: %s", ", ".join(changed))
    msg = f"Data update — {label} — {datetime.now().strftime('%Y-%m-%d %H:%M')}"

    subprocess.run(["git", "-C", str(ROOT), "add"] + changed, check=True)
    result = subprocess.run(
        ["git", "-C", str(ROOT), "commit", "-m", msg],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        log.warning("Nothing new to commit (already clean).")
        return

    log.info("Committed: %s", msg)
    subprocess.run(["git", "-C", str(ROOT), "push"], check=True)
    log.info("Pushed to origin. Azure deployment triggered.")


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Full Broadway dashboard data pipeline.")
    source = ap.add_mutually_exclusive_group()
    source.add_argument("--append", metavar="FILE", help="Append a single new XLSX report")
    source.add_argument("--rebuild", metavar="FOLDER", help="Full rebuild from a folder of XLSX files")
    ap.add_argument("--skip-git", action="store_true", help="Skip git commit and push")
    ap.add_argument("--skip-context", action="store_true", help="Skip NOAA/FRED context refresh")
    ap.add_argument("--skip-awards", action="store_true", help="Skip award data refresh")
    ap.add_argument("--skip-media", action="store_true", help="Skip media signal refresh")
    ap.add_argument("--skip-shows", action="store_true", help="Skip show metadata enrichment")
    args = ap.parse_args()

    label = (
        Path(args.append).name if args.append
        else Path(args.rebuild).name if args.rebuild
        else "enrichment-refresh"
    )

    log.info("=" * 60)
    log.info("Broadway Touring Dashboard — Full Update")
    log.info("Run label: %s", label)
    log.info("=" * 60)

    # ------------------------------------------------------------------
    # Stage 1 — parallel (independent outputs)
    # ------------------------------------------------------------------
    stage1: list[tuple[str, list, bool]] = []

    if args.append:
        stage1.append((
            "touring-data",
            [PY, str(SCRIPTS_DIR / "process_touring.py"), "--append", args.append, str(DATA_DIR / "data.json")],
            True,
        ))
    elif args.rebuild:
        stage1.append((
            "touring-data",
            [PY, str(SCRIPTS_DIR / "process_touring.py"), args.rebuild, str(DATA_DIR / "data.json")],
            True,
        ))

    if not args.skip_context:
        stage1.append((
            "context",
            [PY, str(SCRIPTS_DIR / "scrape_context.py")],
            False,
        ))

    if not args.skip_awards:
        stage1.append((
            "awards",
            [PY, str(SCRIPTS_DIR / "build_awards.py"), "--all", "--years", "2016-2026"],
            False,
        ))

    if not args.skip_media:
        stage1.append((
            "media",
            [PY, str(SCRIPTS_DIR / "build_media_signals.py")],
            False,
        ))

    if stage1:
        log.info("--- Stage 1: parallel fetch (%s tasks) ---", len(stage1))
        s1_results = run_parallel(stage1)
        if not s1_results.get("touring-data", True):
            log.error("Touring data step failed — aborting.")
            return 1
    else:
        log.info("--- Stage 1: no fetch tasks (enrichment-only refresh) ---")

    # ------------------------------------------------------------------
    # Stage 2 — sequential (all write to shows.json)
    # ------------------------------------------------------------------
    log.info("--- Stage 2: sequential shows enrichment ---")

    if not args.skip_shows:
        run("shows-meta", [PY, str(SCRIPTS_DIR / "scrape_shows.py")], required=False)

    if not args.skip_awards:
        run("awards-merge", [PY, str(SCRIPTS_DIR / "build_awards.py"), "--all", "--years", "2016-2026", "--merge-shows"], required=False)

    if not args.skip_media:
        run("media-merge", [PY, str(SCRIPTS_DIR / "build_media_signals.py"), "--merge-shows"], required=False)

    # ------------------------------------------------------------------
    # Stage 3 — validate
    # ------------------------------------------------------------------
    log.info("--- Stage 3: validate ---")
    run(
        "validate",
        [PY, str(SCRIPTS_DIR / "validate_data.py"),
         "--data", str(DATA_DIR / "data.json"),
         "--out", str(DATA_DIR / "validation_report.json")],
        required=False,
    )

    # ------------------------------------------------------------------
    # Stage 4 — commit and push
    # ------------------------------------------------------------------
    log.info("--- Stage 4: publish ---")
    try:
        commit_and_push(label, skip_git=args.skip_git)
    except Exception as exc:
        log.error("Git publish failed: %s", exc)
        return 1

    log.info("=" * 60)
    log.info("Update complete: %s", label)
    log.info("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
