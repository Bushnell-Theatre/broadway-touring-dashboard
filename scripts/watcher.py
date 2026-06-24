"""
Broadway Touring Dashboard — Weekly File Watcher
Bushnell Center for the Performing Arts

Monitors the Broadway League report uploads folder for new XLSX files.
When a new file is detected:
  1. Runs process_touring.py --append to update data.json
  2. Runs scrape_shows.py to enrich any new show names in shows.json
  3. Commits both files to GitHub and pushes

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
from datetime import date, datetime
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ── CONFIGURATION ─────────────────────────────────────────────────────────────

WATCH_FOLDER  = r"C:\Users\rnunley\Bushnell Center for the Performing Arts\AI Taskforce Group-Testing-Development - Broadway League Report Uploads\reports"
REPO_FOLDER   = r"C:\Users\rnunley\OneDrive - Bushnell Center for the Performing Arts\Documents\GitHub\broadway-touring-dashboard"
SCRIPT_PATH   = os.path.join(REPO_FOLDER, "scripts", "process_touring.py")
SCRAPE_PATH   = os.path.join(REPO_FOLDER, "scripts", "scrape_shows.py")
DATA_JSON     = os.path.join(REPO_FOLDER, "src", "data", "data.json")
SEASONS_JSON  = os.path.join(REPO_FOLDER, "src", "data", "seasons.json")
SHOWS_JSON    = os.path.join(REPO_FOLDER, "src", "data", "shows.json")
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

# ── SHOW ENRICHMENT ───────────────────────────────────────────────────────────

def _current_season():
    today = date.today()
    year  = today.year if today.month >= 7 else today.year - 1
    return f"{year}-{year + 1}"

def _season_bounds(season_str):
    year = int(season_str.split("-")[0])
    return f"{year}-07-01", f"{year + 1}-06-30"

def enrich_new_shows():
    """
    Detect shows in seasons.json that are missing from shows.json, then
    call scrape_shows.enrich_show() for each. Returns True if shows.json was updated.
    Prefers seasons.json; falls back to deriving league names from data.json.
    """
    season = _current_season()

    # Load show list from seasons.json if available
    season_entries = []
    if os.path.isfile(SEASONS_JSON):
        try:
            with open(SEASONS_JSON, encoding="utf-8") as f:
                seasons = json.load(f)
            season_entries = seasons.get(season, [])
            if season_entries:
                log.info(f"Loaded {len(season_entries)} shows from seasons.json for {season}")
        except Exception as e:
            log.warning(f"Could not read seasons.json: {e}")

    # Fallback: derive from data.json
    if not season_entries:
        start, end = _season_bounds(season)
        try:
            with open(DATA_JSON, encoding="utf-8") as f:
                raw = json.load(f)
            records = raw.get("records", raw) if isinstance(raw, dict) else raw
        except Exception as e:
            log.error(f"Could not read data.json: {e}")
            return False
        league_names = sorted({
            r.get("show", "").strip()
            for r in records
            if start <= r.get("week_of", "") <= end
            and r.get("theatre") == "Bushnell"
            and r.get("show", "").strip()
        })
        season_entries = [{"name": n, "league_name": n} for n in league_names]

    data_shows = {e["name"] for e in season_entries}

    # Load existing shows.json
    known_shows = set()
    if os.path.isfile(SHOWS_JSON):
        try:
            with open(SHOWS_JSON, encoding="utf-8") as f:
                known_shows = {s["name"] for s in json.load(f)}
        except Exception as e:
            log.warning(f"Could not read shows.json: {e}")

    new_entries = [e for e in season_entries if e["name"] not in known_shows]
    if not new_entries:
        log.info("No new shows to enrich.")
        return False

    log.info(f"Enriching {len(new_entries)} new show(s): {', '.join(e['name'] for e in new_entries)}")

    # Import scrape_shows at runtime so watcher doesn't require SPARQLWrapper at startup
    try:
        scrape_dir = os.path.dirname(SCRAPE_PATH)
        if scrape_dir not in sys.path:
            sys.path.insert(0, scrape_dir)
        import importlib.util
        spec = importlib.util.spec_from_file_location("scrape_shows", SCRAPE_PATH)
        scrape = importlib.util.load_from_spec(spec)
        spec.loader.exec_module(scrape)
    except Exception as e:
        log.error(f"Could not import scrape_shows.py: {e}")
        return False

    # Load existing shows.json records to preserve cached entries
    existing = {}
    if os.path.isfile(SHOWS_JSON):
        try:
            with open(SHOWS_JSON, encoding="utf-8") as f:
                existing = {s["name"]: s for s in json.load(f)}
        except Exception:
            pass

    for entry in new_entries:
        log.info(f"  Scraping: {entry['name']}  (league: {entry.get('league_name', entry['name'])})")
        try:
            record = scrape.enrich_show(entry, season)
            existing[entry["name"]] = record
        except Exception as e:
            log.error(f"  Failed to enrich '{show}': {e}")

    try:
        with open(SHOWS_JSON, "w", encoding="utf-8") as f:
            json.dump(list(existing.values()), f, indent=2, ensure_ascii=False)
        log.info(f"shows.json updated ({len(existing)} total records)")
        return True
    except Exception as e:
        log.error(f"Could not write shows.json: {e}")
        return False

# ── PROCESSING ────────────────────────────────────────────────────────────────

def process_new_file(filepath):
    """Run append mode, enrich new shows, then commit both files to GitHub."""
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

    # Step 2: Enrich any new shows
    shows_updated = enrich_new_shows()

    # Step 3: Git add, commit, push
    files_to_add = ["src/data/data.json"]
    if shows_updated:
        files_to_add.append("src/data/shows.json")

    log.info(f"Committing {', '.join(files_to_add)} to GitHub...")
    commit_msg = f"Weekly update: {fname} — {datetime.now().strftime('%Y-%m-%d %H:%M')}"

    add_cmd = ["git", "-C", REPO_FOLDER, "add"] + files_to_add
    git_commands = [
        add_cmd,
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
