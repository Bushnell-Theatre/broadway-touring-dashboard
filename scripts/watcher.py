"""
Broadway Touring Dashboard — Weekly File Watcher
Bushnell Center for the Performing Arts

Monitors the Broadway League report uploads folder for new XLSX files.
When a new file is detected:
  1.    Runs process_touring.py --append to update data.json
  2.    Runs scrape_shows.py to enrich any new show names in shows.json
  2.5.  Runs scrape_context.py to refresh context.json (weather + econ)
  2.75. Runs generate_highlights.py to write AI weekly highlight blurbs
  2.8.  Runs generate_season_review.py to write end-of-season AI retrospective
  3.    Commits updated files to a dedicated data-import branch, merges that
        straight to main, and pushes — auto-deploying to production. main is
        then fast-forward merged back into dev so dev never drifts behind on
        data files. This branch is separate from dev on purpose: the watcher
        runs unattended, so it must never be able to pick up or interfere
        with whatever feature work is in progress on dev.

Steps 2.75 and 2.8 are non-fatal: if either fails the pipeline logs a
warning and continues to the git commit.

If folding the deploy back into dev conflicts with in-progress work there,
the merge is aborted and dev is left clean — production still got the
update, but a human needs to `git merge main` into dev manually afterward.

Startup behaviour
-----------------
On launch the watcher scans the watch folder for any XLSX files whose
week_of date is not yet in data.json and processes them automatically.
This catches files that arrived while the watcher was down. The log
prints a summary line when the scan is complete so you can confirm the
watcher has gone live:

    Startup scan complete — 2026-08-07 09:03:12 | 285 file(s) checked |
    1 processed | 284 already current | 0 unreadable
    Watcher is now LIVE — listening for new files.

OneDrive compatibility
----------------------
OneDrive-synced folders do not always fire on_created when a file
syncs from the cloud — they often fire on_modified on a placeholder
instead. The handler responds to on_created, on_modified, and on_moved
and deduplicates by (path, mtime) so each unique file version is
processed exactly once.

Requirements:
    pip install watchdog

Usage:
    python watcher.py

Keep this running in the background. It will log all activity to watcher.log
in the same directory as this script.
"""

import os
import json
import sys
import subprocess
import logging
import time
from datetime import datetime
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ── CONFIGURATION ───────────────────────────────────────────────────────

WATCH_FOLDER = r"C:\Users\rnunley\Bushnell Center for the Performing Arts\AI Taskforce Group-Testing-Development - Broadway League Report Uploads\reports"
REPO_FOLDER = r"C:\Users\rnunley\OneDrive - Bushnell Center for the Performing Arts\Documents\GitHub\broadway-touring-dashboard"
# Dedicated branch for automated weekly commits. Cut fresh from main and
# merged straight back into main on every run — never touches dev, so
# in-progress feature work is never at risk from an unattended auto-deploy.
DATA_BRANCH = "data-import"
SCRIPT_PATH    = os.path.join(REPO_FOLDER, "scripts", "process_touring.py")
CONTEXT_PATH   = os.path.join(REPO_FOLDER, "scripts", "scrape_context.py")
HIGHLIGHTS_PATH = os.path.join(REPO_FOLDER, "scripts", "generate_highlights.py")
REVIEW_PATH    = os.path.join(REPO_FOLDER, "scripts", "generate_season_review.py")
DATA_JSON      = os.path.join(REPO_FOLDER, "src", "data", "data.json")
SEASONS_JSON   = os.path.join(REPO_FOLDER, "src", "data", "seasons.json")
CONTEXT_JSON   = os.path.join(REPO_FOLDER, "src", "data", "context.json")
EXEC_HIGHLIGHT_JSON = os.path.join(REPO_FOLDER, "src", "data", "exec_brief_highlight.json")
PROG_HIGHLIGHT_JSON = os.path.join(REPO_FOLDER, "src", "data", "programming_highlight.json")
SEASON_REVIEW_JSON  = os.path.join(REPO_FOLDER, "src", "data", "season_review.json")
LOG_FILE       = os.path.join(os.path.dirname(__file__), "watcher.log")

# ── LOGGING ─────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

# ── PROCESSING ──────────────────────────────────────────────────────────


def process_new_file(filepath):
    """Run append mode, then commit updated files to GitHub."""
    fname = os.path.basename(filepath)
    log.info(f"New file detected: {fname}")

    # Give OneDrive a moment to finish syncing the file
    time.sleep(5)

    if not os.path.isfile(filepath):
        log.warning(
            f"File no longer present after sync wait — skipped: {fname}")
        return

    # Step 1: Append to data.json
    log.info(f"Running: process_touring.py --append {fname}")
    result = subprocess.run(
        ["python", SCRIPT_PATH, "--append", filepath, DATA_JSON],
        capture_output=True, text=True
    )
    if result.stdout:
        for line in result.stdout.strip().splitlines():
            log.info(f"  {line}")
    if result.returncode != 0:
        log.error(f"process_touring.py failed for {fname}")
        if result.stderr:
            log.error(result.stderr)
        return

    # Step 2: Refresh context.json (weather + econ for new weeks)
    log.info("Running: scrape_context.py")
    ctx_result = subprocess.run(
        ["python", CONTEXT_PATH],
        capture_output=True, text=True, cwd=REPO_FOLDER
    )
    if ctx_result.stdout:
        for line in ctx_result.stdout.strip().splitlines():
            log.info(f"  {line}")
    if ctx_result.returncode != 0:
        log.warning("scrape_context.py failed — context.json may be stale")
        if ctx_result.stderr:
            log.warning(ctx_result.stderr.strip())
    context_updated = ctx_result.returncode == 0

    # Step 2.75: Generate AI weekly highlight blurbs
    # Failure is non-fatal — logs a warning and pipeline continues.
    log.info("Running: generate_highlights.py")
    hl_result = subprocess.run(
        ["python", HIGHLIGHTS_PATH],
        capture_output=True, text=True, cwd=REPO_FOLDER
    )
    if hl_result.stdout:
        for line in hl_result.stdout.strip().splitlines():
            log.info(f"  {line}")
    if hl_result.returncode != 0:
        log.warning("generate_highlights.py failed — highlight files may be stale")
        if hl_result.stderr:
            log.warning(hl_result.stderr.strip())
    exec_highlight_updated = hl_result.returncode == 0 and os.path.isfile(EXEC_HIGHLIGHT_JSON)
    prog_highlight_updated = hl_result.returncode == 0 and os.path.isfile(PROG_HIGHLIGHT_JSON)

    # Step 2.8: Generate AI end-of-season reviews (fires at most once per season)
    # Failure is non-fatal — logs a warning and pipeline continues.
    log.info("Running: generate_season_review.py")
    rv_result = subprocess.run(
        ["python", REVIEW_PATH],
        capture_output=True, text=True, cwd=REPO_FOLDER
    )
    if rv_result.stdout:
        for line in rv_result.stdout.strip().splitlines():
            log.info(f"  {line}")
    if rv_result.returncode != 0:
        log.warning("generate_season_review.py failed — season_review.json may be stale")
        if rv_result.stderr:
            log.warning(rv_result.stderr.strip())
    season_review_updated = rv_result.returncode == 0 and os.path.isfile(SEASON_REVIEW_JSON)

    # Step 3: Git add, commit, push
    files_to_add = ["src/data/data.json"]
    if context_updated:
        files_to_add.append("src/data/context.json")
    if exec_highlight_updated:
        files_to_add.append("src/data/exec_brief_highlight.json")
    if prog_highlight_updated:
        files_to_add.append("src/data/programming_highlight.json")
    if season_review_updated:
        files_to_add.append("src/data/season_review.json")

    log.info(f"Committing {', '.join(files_to_add)} to GitHub...")
    commit_msg = f"Weekly update: {fname} — {
        datetime.now().strftime('%Y-%m-%d %H:%M')}"

    # The watcher runs on its own branch (DATA_BRANCH), cut fresh from main
    # each run, and merges straight to main — it never touches dev. This
    # keeps automated weekly data imports fully separate from whatever
    # feature work is in progress on dev, so the watcher can deploy without
    # any risk of picking up or clobbering in-progress changes, and nobody
    # has to remember to manually deploy a data-only update.
    #
    # After merging to main, main is fast-forward merged back into dev so
    # dev never drifts behind main on data files — this prevents a data.json
    # merge conflict the next time a feature branch merges dev into main.
    add_cmd = ["git", "-C", REPO_FOLDER, "add"] + files_to_add
    git_commands = [
        ["git", "-C", REPO_FOLDER, "fetch", "origin"],
        ["git", "-C", REPO_FOLDER, "checkout", "main"],
        ["git", "-C", REPO_FOLDER, "pull", "--ff-only", "origin", "main"],
        ["git", "-C", REPO_FOLDER, "checkout", "-B", DATA_BRANCH, "main"],
        add_cmd,
        ["git", "-C", REPO_FOLDER, "commit", "-m", commit_msg],
        ["git", "-C", REPO_FOLDER, "checkout", "main"],
        # --ff-only: DATA_BRANCH is always exactly one commit ahead of the
        # main we just pulled, so this must be a fast-forward. If it isn't
        # (main moved between the pull and here), fail loudly rather than
        # create an unexpected merge commit unattended.
        ["git", "-C", REPO_FOLDER, "merge", "--ff-only", DATA_BRANCH],
        ["git", "-C", REPO_FOLDER, "push", "origin", "main"],
        ["git", "-C", REPO_FOLDER, "branch", "-D", DATA_BRANCH],
        ["git", "-C", REPO_FOLDER, "checkout", "dev"],
        ["git", "-C", REPO_FOLDER, "pull", "origin", "dev"],
        ["git", "-C", REPO_FOLDER, "merge", "main", "-m", f"sync: fold {fname} update into dev"],
        ["git", "-C", REPO_FOLDER, "push", "origin", "dev"],
    ]

    for cmd in git_commands:
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            log.error(f"Git command failed: {' '.join(cmd)}")
            if r.stderr:
                log.error(r.stderr.strip())

            # The main deploy already succeeded if we get this far into the
            # command list — only the dev-sync step can still fail (e.g. a
            # conflict with in-progress feature work on dev). Leave the repo
            # clean on dev rather than mid-merge, and flag that dev needs a
            # manual `git merge main` to pick up the data update.
            if cmd == ["git", "-C", REPO_FOLDER, "merge", "main", "-m", f"sync: fold {fname} update into dev"]:
                subprocess.run(["git", "-C", REPO_FOLDER, "merge", "--abort"],
                                capture_output=True, text=True)
                log.error(
                    f"Production deploy for {fname} succeeded, but folding it back "
                    "into dev conflicted with in-progress work there. Merge aborted "
                    "— dev is left clean. A human needs to `git merge main` into dev "
                    "manually to resolve before the next feature merges to main."
                )
            else:
                log.error(
                    "Aborting git pipeline for this file — repo may be left on "
                    f"branch '{DATA_BRANCH}' or 'main' rather than 'dev'. Check "
                    "state manually before the next run."
                )
            return
        if r.stdout.strip():
            log.info(f"  {r.stdout.strip()}")

    log.info(f"Done. Deployed to production for {fname}")
    log.info("-" * 60)


# ── FILE SYSTEM HANDLER ─────────────────────────────────────────────────

class XLSXHandler(FileSystemEventHandler):
    """
    Watches for new XLSX files in the reports folder.

    OneDrive-synced folders often do NOT fire on_created when a file syncs
    from the cloud — they fire on_modified on a placeholder instead. To
    handle this reliably we respond to on_created, on_modified, AND
    on_moved, then deduplicate with a seen-set keyed by (path, mtime) so
    a legitimate re-upload of a revised file is still picked up.
    """

    def __init__(self, already_processed: set):
        # Seed with files that existed at startup (already processed or
        # intentionally skipped during the startup scan).
        self._seen = set(already_processed)

    def _candidate(self, path):
        fname = os.path.basename(path)
        if not path.lower().endswith('.xlsx'):
            return
        if fname.startswith('~'):
            return  # Office temp file
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            return
        key = (path, round(mtime))
        if key not in self._seen:
            self._seen.add(key)
            process_new_file(path)

    def on_created(self, event):
        if not event.is_directory:
            self._candidate(event.src_path)

    def on_modified(self, event):
        # OneDrive fires modified (not created) when syncing a new file
        # from the cloud. We treat it like created — dedup via (path, mtime).
        if not event.is_directory:
            self._candidate(event.src_path)

    def on_moved(self, event):
        # Handles files renamed/moved into the watch folder
        if not event.is_directory:
            self._candidate(event.dest_path)


# ── STARTUP SCAN ────────────────────────────────────────────────────────

def startup_scan():
    """
    On startup, check the watch folder for any XLSX files whose week_of
    is not yet represented in data.json. Process any that are missing.

    This catches files that arrived while the watcher was down.
    Returns the set of (path, mtime) keys for all files found, so the
    handler can seed its seen-set and won't reprocess them.
    """
    seen_keys = set()

    if not os.path.isdir(WATCH_FOLDER):
        return seen_keys

    # Load the weeks already in data.json
    known_weeks = set()
    if os.path.isfile(DATA_JSON):
        try:
            with open(DATA_JSON, encoding='utf-8') as f:
                existing = json.load(f)
            records = existing if isinstance(existing, list) else existing.get('records', [])
            known_weeks = {r.get('week_of') for r in records if r.get('week_of')}
        except Exception as e:
            log.warning(f"Startup scan: could not read data.json: {e}")

    import openpyxl
    import re

    def extract_week(filepath):
        """Extract week_of from sheet names in the workbook."""
        try:
            wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
            for sname in wb.sheetnames:
                m = re.search(r'(\d{1,2})[-_](\d{1,2})[-_](\d{2,4})', sname)
                if m:
                    mm, dd, yy = m.group(1).zfill(2), m.group(2).zfill(2), m.group(3)
                    if len(yy) == 2:
                        yy = '20' + yy
                    return f"{yy}-{mm}-{dd}"
        except Exception:
            pass
        return None

    xlsx_files = [
        os.path.join(WATCH_FOLDER, f)
        for f in os.listdir(WATCH_FOLDER)
        if f.lower().endswith('.xlsx') and not f.startswith('~')
    ]

    if not xlsx_files:
        log.info("Startup scan: no XLSX files in watch folder.")
        return seen_keys

    log.info(f"Startup scan: found {len(xlsx_files)} XLSX file(s) in watch folder.")

    n_processed = 0
    n_skipped = 0
    n_unreadable = 0

    for fpath in xlsx_files:
        try:
            mtime = os.path.getmtime(fpath)
        except OSError:
            continue
        key = (fpath, round(mtime))
        seen_keys.add(key)

        week = extract_week(fpath)
        fname = os.path.basename(fpath)

        if week is None:
            log.info(f"Startup scan: {fname} — could not determine week, skipping.")
            n_unreadable += 1
        elif week in known_weeks:
            log.info(f"Startup scan: {fname} — week {week} already in data.json, skipping.")
            n_skipped += 1
        else:
            log.info(f"Startup scan: {fname} — week {week} NOT in data.json, processing now.")
            process_new_file(fpath)
            n_processed += 1
            # Re-read known_weeks so a multi-file catch-up doesn't double-process
            try:
                with open(DATA_JSON, encoding='utf-8') as f:
                    existing = json.load(f)
                records = existing if isinstance(existing, list) else existing.get('records', [])
                known_weeks = {r.get('week_of') for r in records if r.get('week_of')}
            except Exception:
                pass

    log.info("=" * 60)
    log.info(
        f"Startup scan complete — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | "
        f"{len(xlsx_files)} file(s) checked | "
        f"{n_processed} processed | {n_skipped} already current | {n_unreadable} unreadable"
    )
    log.info("Watcher is now LIVE — listening for new files.")
    log.info("=" * 60)

    return seen_keys


# ── MAIN ────────────────────────────────────────────────────────────────

def main():
    if not os.path.isdir(WATCH_FOLDER):
        log.error(f"Watch folder not found: {WATCH_FOLDER}")
        log.error("Is OneDrive synced? Check the path and try again.")
        return

    if not os.path.isfile(SCRIPT_PATH):
        log.error(f"process_touring.py not found at: {SCRIPT_PATH}")
        return

    log.info("=" * 60)
    log.info("Broadway Touring Dashboard — File Watcher Started")
    log.info(f"Watching: {WATCH_FOLDER}")
    log.info(f"Repo:     {REPO_FOLDER}")
    log.info("=" * 60)

    # Scan for any files that arrived while the watcher was down
    already_processed = startup_scan()

    # Pass seen keys to handler so it doesn't reprocess startup files
    handler = XLSXHandler(already_processed)
    observer = Observer()
    observer.schedule(handler, WATCH_FOLDER, recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(10)
    except KeyboardInterrupt:
        log.info("Watcher stopped by user.")
        observer.stop()
    observer.join()


if __name__ == '__main__':
    main()
