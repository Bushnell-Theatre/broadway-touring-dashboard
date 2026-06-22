"""
Broadway Touring Dashboard — Weekly File Watcher
Bushnell Center for the Performing Arts

Monitors the Broadway League report uploads folder for new XLSX files.
When a new file is detected, runs process_touring.py --append and then
commits the updated data.json to GitHub.

Requirements:
    pip install watchdog

Usage:
    python watcher.py

Keep this running in the background. It will log all activity to watcher.log
in the same directory as this script.
"""

import os
import subprocess
import logging
import time
from datetime import datetime
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ── CONFIGURATION ─────────────────────────────────────────────────────────────

WATCH_FOLDER  = r"C:\Users\rnunley\Bushnell Center for the Performing Arts\AI Taskforce Group-Testing-Development - Broadway League Report Uploads\reports"
REPO_FOLDER   = r"C:\Users\rnunley\OneDrive - Bushnell Center for the Performing Arts\Documents\GitHub\broadway-touring-dashboard"
SCRIPT_PATH   = os.path.join(REPO_FOLDER, "scripts", "process_touring.py")
DATA_JSON     = os.path.join(REPO_FOLDER, "src", "data", "data.json")
LOG_FILE      = os.path.join(os.path.dirname(__file__), "watcher.log")

# ── LOGGING ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

# ── PROCESSING ────────────────────────────────────────────────────────────────

def process_new_file(filepath):
    """Run append mode then commit to GitHub."""
    fname = os.path.basename(filepath)
    log.info(f"New file detected: {fname}")

    # Give OneDrive a moment to finish syncing the file
    time.sleep(5)

    if not os.path.isfile(filepath):
        log.warning(f"File no longer present after sync wait — skipped: {fname}")
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

    # Step 2: Git add, commit, push
    log.info("Committing data.json to GitHub...")
    commit_msg = f"Weekly update: {fname} — {datetime.now().strftime('%Y-%m-%d %H:%M')}"

    git_commands = [
        ["git", "-C", REPO_FOLDER, "add", "src/data/data.json"],
        ["git", "-C", REPO_FOLDER, "commit", "-m", commit_msg],
        ["git", "-C", REPO_FOLDER, "push"],
    ]

    for cmd in git_commands:
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            log.error(f"Git command failed: {' '.join(cmd)}")
            if r.stderr:
                log.error(r.stderr.strip())
            return
        if r.stdout.strip():
            log.info(f"  {r.stdout.strip()}")

    log.info(f"Done. Dashboard updated for {fname}")
    log.info("-" * 60)


# ── FILE SYSTEM HANDLER ───────────────────────────────────────────────────────

class XLSXHandler(FileSystemEventHandler):
    def __init__(self):
        self._seen = set()

    def on_created(self, event):
        if event.is_directory:
            return
        path = event.src_path
        if path.lower().endswith('.xlsx') and not os.path.basename(path).startswith('~'):
            if path not in self._seen:
                self._seen.add(path)
                process_new_file(path)

    def on_moved(self, event):
        # Handles files moved/renamed into the watch folder
        if event.is_directory:
            return
        path = event.dest_path
        if path.lower().endswith('.xlsx') and not os.path.basename(path).startswith('~'):
            if path not in self._seen:
                self._seen.add(path)
                process_new_file(path)


# ── MAIN ──────────────────────────────────────────────────────────────────────

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

    handler = XLSXHandler()
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
