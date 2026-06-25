"""Broadway Touring Dashboard — weekly file watcher.

Watches the upload folder for new Broadway League XLSX reports, appends them to
`src/data/data.json`, refreshes enrichment/context/validation outputs, then
commits and pushes changed files.

Environment overrides:
  BWAY_WATCH_FOLDER  path to incoming XLSX reports
  BWAY_REPO_FOLDER   path to the local repo checkout
  BWAY_SKIP_GIT=1    process files without git commit/push
"""
from __future__ import annotations

import importlib.util
import json
import logging
import os
import subprocess
import sys
import time
from datetime import date, datetime
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from dashboard_config import data_path, repo_root, script_path, watch_folder

REPO_FOLDER = repo_root()
WATCH_FOLDER = watch_folder()
SCRIPT_PATH = script_path("process_touring.py")
SCRAPE_PATH = script_path("scrape_shows.py")
CONTEXT_PATH = script_path("scrape_context.py")
VALIDATE_PATH = script_path("validate_data.py")
DATA_JSON = data_path("data.json")
SEASONS_JSON = data_path("seasons.json")
SHOWS_JSON = data_path("shows.json")
CONTEXT_JSON = data_path("context.json")
VALIDATION_JSON = data_path("validation_report.json")
LOG_FILE = Path(__file__).with_name("watcher.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[logging.FileHandler(LOG_FILE, encoding="utf-8"), logging.StreamHandler()],
)
log = logging.getLogger(__name__)


def run(cmd: list[str], *, cwd: Path | None = None, required: bool = True) -> subprocess.CompletedProcess:
    """Run a command and log stdout/stderr consistently."""
    log.info("Running: %s", " ".join(map(str, cmd)))
    result = subprocess.run(cmd, cwd=str(cwd or REPO_FOLDER), capture_output=True, text=True)
    for line in (result.stdout or "").strip().splitlines():
        log.info("  %s", line)
    for line in (result.stderr or "").strip().splitlines():
        (log.error if required else log.warning)("  %s", line)
    if required and result.returncode != 0:
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(map(str, cmd))}")
    return result


def wait_until_ready(path: Path, timeout: int = 90, quiet_seconds: float = 2.0) -> bool:
    """Wait until OneDrive/Excel finishes writing a detected file."""
    start = time.time()
    last_size = -1
    stable_since: float | None = None
    while time.time() - start < timeout:
        if not path.exists():
            time.sleep(1)
            continue
        try:
            size = path.stat().st_size
            with path.open("rb") as f:
                f.read(1)
        except OSError:
            time.sleep(1)
            continue
        if size == last_size and size > 0:
            stable_since = stable_since or time.time()
            if time.time() - stable_since >= quiet_seconds:
                return True
        else:
            last_size = size
            stable_since = None
        time.sleep(1)
    return False


def current_season() -> str:
    today = date.today()
    year = today.year if today.month >= 7 else today.year - 1
    return f"{year}-{year + 1}"


def season_bounds(season_str: str) -> tuple[str, str]:
    year = int(season_str.split("-")[0])
    return f"{year}-07-01", f"{year + 1}-06-30"


def load_json(path: Path, default):
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def season_entries_from_json(season: str) -> list[dict]:
    seasons = load_json(SEASONS_JSON, {})
    if not isinstance(seasons, dict):
        return []
    entry = seasons.get(season, {})
    if isinstance(entry, dict):
        shows = entry.get("shows", [])
    elif isinstance(entry, list):
        shows = entry
    else:
        shows = []
    normalized = []
    for show in shows or []:
        if isinstance(show, str):
            normalized.append({"name": show, "league_name": show})
        elif isinstance(show, dict):
            name = show.get("name") or show.get("title") or show.get("league_name")
            if name:
                normalized.append({**show, "name": name, "league_name": show.get("league_name") or show.get("match") or name})
    return normalized


def season_entries_from_data(season: str) -> list[dict]:
    start, end = season_bounds(season)
    raw = load_json(DATA_JSON, {})
    records = raw.get("records", raw) if isinstance(raw, dict) else raw
    names = sorted({
        str(r.get("show", "")).strip()
        for r in records or []
        if start <= str(r.get("week_of", "")) <= end
        and str(r.get("theatre", "")).strip().lower() == "bushnell"
        and str(r.get("show", "")).strip()
    })
    return [{"name": n, "league_name": n} for n in names]


def import_scraper():
    spec = importlib.util.spec_from_file_location("scrape_shows", SCRAPE_PATH)
    if not spec or not spec.loader:
        raise RuntimeError(f"Could not load scraper at {SCRAPE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def enrich_new_shows() -> bool:
    season = current_season()
    season_entries = season_entries_from_json(season)
    if season_entries:
        log.info("Loaded %s shows from seasons.json for %s", len(season_entries), season)
    else:
        season_entries = season_entries_from_data(season)
        log.info("Derived %s shows from data.json for %s", len(season_entries), season)

    known = load_json(SHOWS_JSON, [])
    known_by_name = {s.get("name"): s for s in known if isinstance(s, dict) and s.get("name")}
    new_entries = [e for e in season_entries if e.get("name") and e.get("name") not in known_by_name]
    if not new_entries:
        log.info("No new shows to enrich.")
        return False

    try:
        scraper = import_scraper()
    except Exception as exc:
        log.error("Could not import scrape_shows.py: %s", exc)
        return False

    log.info("Enriching %s new show(s): %s", len(new_entries), ", ".join(e["name"] for e in new_entries))
    updated = False
    for entry in new_entries:
        try:
            log.info("  Scraping: %s (league: %s)", entry["name"], entry.get("league_name", entry["name"]))
            known_by_name[entry["name"]] = scraper.enrich_show(entry, season)
            updated = True
        except Exception as exc:
            log.error("  Failed to enrich '%s': %s", entry.get("name"), exc)

    if updated:
        with SHOWS_JSON.open("w", encoding="utf-8") as f:
            json.dump(list(known_by_name.values()), f, indent=2, ensure_ascii=False)
        log.info("shows.json updated (%s total records)", len(known_by_name))
    return updated


def refresh_context() -> bool:
    result = run([sys.executable, str(CONTEXT_PATH)], cwd=REPO_FOLDER, required=False)
    if result.returncode != 0:
        log.warning("scrape_context.py failed; context.json may be stale.")
        return False
    return True


def validate_data() -> bool:
    result = run([sys.executable, str(VALIDATE_PATH)], cwd=REPO_FOLDER, required=False)
    if result.returncode != 0:
        log.warning("validate_data.py failed; validation_report.json may be stale.")
        return False
    return True


def changed_files() -> list[str]:
    result = run(["git", "-C", str(REPO_FOLDER), "status", "--porcelain", "src/data"], required=False)
    files = []
    for line in (result.stdout or "").splitlines():
        path = line[3:].strip()
        if path:
            files.append(path)
    return files


def commit_and_push(fname: str, files_to_add: list[str]) -> None:
    if os.getenv("BWAY_SKIP_GIT") == "1":
        log.info("BWAY_SKIP_GIT=1; skipping git commit/push.")
        return
    if not files_to_add:
        log.info("No changed data files to commit.")
        return
    commit_msg = f"Weekly update: {fname} - {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    run(["git", "-C", str(REPO_FOLDER), "add"] + files_to_add)
    # Avoid failing the whole watcher when there is nothing new after validation.
    result = run(["git", "-C", str(REPO_FOLDER), "commit", "-m", commit_msg], required=False)
    if result.returncode != 0:
        log.warning("No commit created or git commit failed. Push skipped.")
        return
    run(["git", "-C", str(REPO_FOLDER), "push"])


def process_new_file(filepath: str | Path) -> None:
    path = Path(filepath)
    fname = path.name
    log.info("New file detected: %s", fname)
    if not wait_until_ready(path):
        log.warning("File was not ready after waiting; skipped: %s", fname)
        return

    try:
        run([sys.executable, str(SCRIPT_PATH), "--append", str(path), str(DATA_JSON)], cwd=REPO_FOLDER)
        shows_updated = enrich_new_shows()
        context_updated = refresh_context()
        validation_updated = validate_data()
    except Exception as exc:
        log.error("Processing failed for %s: %s", fname, exc)
        return

    files_to_add = ["src/data/data.json"]
    if shows_updated:
        files_to_add.append("src/data/shows.json")
    if context_updated:
        files_to_add.append("src/data/context.json")
    if validation_updated:
        files_to_add.append("src/data/validation_report.json")

    # Include any additional data files that actually changed.
    for path_str in changed_files():
        if path_str not in files_to_add:
            files_to_add.append(path_str)
    try:
        commit_and_push(fname, files_to_add)
        log.info("Done. Dashboard updated for %s", fname)
    except Exception as exc:
        log.error("Git publish failed for %s: %s", fname, exc)
    log.info("-" * 60)


class XLSXHandler(FileSystemEventHandler):
    def __init__(self) -> None:
        self._seen: set[str] = set()

    def _handle(self, raw_path: str) -> None:
        path = Path(raw_path)
        if path.suffix.lower() != ".xlsx" or path.name.startswith("~"):
            return
        key = str(path.resolve())
        if key in self._seen:
            return
        self._seen.add(key)
        process_new_file(path)

    def on_created(self, event):
        if not event.is_directory:
            self._handle(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._handle(event.dest_path)


def main() -> None:
    if not WATCH_FOLDER.is_dir():
        log.error("Watch folder not found: %s", WATCH_FOLDER)
        log.error("Set BWAY_WATCH_FOLDER or check OneDrive sync.")
        return
    if not SCRIPT_PATH.is_file():
        log.error("process_touring.py not found at: %s", SCRIPT_PATH)
        return
    log.info("=" * 60)
    log.info("Broadway Touring Dashboard - File Watcher Started")
    log.info("Watching: %s", WATCH_FOLDER)
    log.info("Repo:     %s", REPO_FOLDER)
    log.info("=" * 60)

    handler = XLSXHandler()
    observer = Observer()
    observer.schedule(handler, str(WATCH_FOLDER), recursive=False)
    observer.start()
    try:
        while True:
            time.sleep(10)
    except KeyboardInterrupt:
        log.info("Watcher stopped by user.")
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
