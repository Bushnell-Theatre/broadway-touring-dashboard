"""
Broadway Touring Dashboard — Weekly File Watcher
Bushnell Center for the Performing Arts

Monitors the Broadway League report uploads folder for new XLSX files.
When a new file is detected:
  1.    Runs process_touring.py --append to update data.json
  2.5.  Runs scrape_context.py to refresh context.json (weather + econ)
        (numbered 2.5, not 2 — step 2 was scrape_shows.py, since removed;
        the code's own inline comment still just says "Step 2")
  2.75. Runs generate_highlights.py to write AI weekly highlight blurbs
  2.8.  Runs generate_season_review.py to write end-of-season AI retrospective
  3.    Publishes the updated data files: builds a commit from origin/main's
        tree with only those files overlaid, pushes it to main — auto-
        deploying to production — and folds the same commit into dev so dev
        never drifts behind main on data files.

Steps 2.75 and 2.8 are non-fatal: if either fails the pipeline logs a
warning and continues to the publish step.

The watcher never checks out a branch and never touches the repository
index. It runs unattended in a repo a human may be working in, so the
commit is assembled with git plumbing in a scratch index instead: by
construction it can contain nothing but the data files listed above, and
no in-progress work can be swept into it. See GIT PUBLISHING below.

If folding the deploy into dev conflicts with work already on dev, dev is
left alone — production still got the update, but a human needs to merge
main into dev manually afterward.

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
import tempfile
import time
from datetime import datetime
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ── CONFIGURATION ───────────────────────────────────────────────────────

WATCH_FOLDER = r"C:\Users\rnunley\Bushnell Center for the Performing Arts\AI Taskforce Group-Testing-Development - Broadway League Report Uploads\reports"
REPO_FOLDER = r"C:\Users\rnunley\OneDrive - Bushnell Center for the Performing Arts\Documents\GitHub\broadway-touring-dashboard"
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

    # Step 3: Publish the updated data files (see GIT PUBLISHING below)
    files_to_add = ["src/data/data.json"]
    if context_updated:
        files_to_add.append("src/data/context.json")
    if exec_highlight_updated:
        files_to_add.append("src/data/exec_brief_highlight.json")
    if prog_highlight_updated:
        files_to_add.append("src/data/programming_highlight.json")
    if season_review_updated:
        files_to_add.append("src/data/season_review.json")

    publish(fname, files_to_add)


# ── GIT PUBLISHING ──────────────────────────────────────────────────────
#
# The watcher runs unattended in a repo a human may be actively working in,
# so it never checks out a branch, never moves HEAD, and never touches the
# repository index.
#
# That restraint is not theoretical. This script used to run `git checkout
# main` / `checkout -B data-import` in the shared working tree. An
# interactive session that happened to be committing at the same moment had
# HEAD moved out from under it, and its commits landed on main and
# auto-deployed to production. Checking out a branch in a tree somebody else
# is using is the whole problem; the dedicated data-import branch did not
# help, because the hazard was the checkout, not the branch.
#
# So the commit is assembled with plumbing instead: take the tree of
# origin/main, overlay ONLY the data files this script owns, and write the
# result with commit-tree. Whatever state the working tree is in, nothing
# else can end up in the commit — a structural guarantee rather than a
# convention somebody has to remember.


def _git(args, index_file=None):
    """Run a git command against REPO_FOLDER. Never checks anything out."""
    env = None
    if index_file:
        env = os.environ.copy()
        env["GIT_INDEX_FILE"] = index_file
    return subprocess.run(["git", "-C", REPO_FOLDER] + args,
                          capture_output=True, text=True, env=env)


def _git_out(args, index_file=None):
    """Stripped stdout of a git command, or None if it failed."""
    r = _git(args, index_file)
    return r.stdout.strip() if r.returncode == 0 else None


def _scratch_index(kind):
    """Path for a throwaway index — never the repository's own index."""
    return os.path.join(tempfile.gettempdir(),
                        f"btd-watcher-{kind}-{os.getpid()}.index")


def build_data_commit(files, message):
    """
    Build a commit that is origin/main with `files` overlaid on top.

    Returns the new commit sha; "" if the data is already identical to
    origin/main (nothing to deploy); None on failure.
    """
    parent = _git_out(["rev-parse", "--verify", "origin/main"])
    if not parent:
        log.error("Cannot resolve origin/main — is the fetch working?")
        return None

    index = _scratch_index("build")
    try:
        if _git(["read-tree", parent], index).returncode != 0:
            log.error("Could not read origin/main into the scratch index.")
            return None

        for rel in files:
            abs_path = os.path.join(REPO_FOLDER, rel.replace("/", os.sep))
            # --path applies .gitattributes filters (line-ending
            # normalisation) for the destination path, exactly as `git add`
            # would have done.
            blob = _git_out(["hash-object", "-w", "--path", rel, abs_path])
            if not blob:
                log.error(f"Could not hash {rel}.")
                return None
            if _git(["update-index", "--add", "--cacheinfo",
                     f"100644,{blob},{rel}"], index).returncode != 0:
                log.error(f"Could not stage {rel} in the scratch index.")
                return None

        tree = _git_out(["write-tree"], index)
    finally:
        if os.path.exists(index):
            os.remove(index)

    if not tree:
        log.error("Could not write the data tree.")
        return None
    if tree == _git_out(["rev-parse", f"{parent}^{{tree}}"]):
        return ""

    commit = _git_out(["commit-tree", tree, "-p", parent, "-m", message])
    if not commit:
        log.error("Could not create the data commit.")
        return None
    return commit


def fold_into_dev(data_commit, fname):
    """
    Work out what dev should point at, without checking dev out.

    A fast-forward when dev carries no work of its own; otherwise a merge
    commit built in a scratch index. Returns None if the merge conflicts,
    which means a human has to resolve it.
    """
    dev = _git_out(["rev-parse", "--verify", "origin/dev"])
    if not dev:
        log.error("Cannot resolve origin/dev.")
        return None
    if _git(["merge-base", "--is-ancestor", dev, data_commit]).returncode == 0:
        return data_commit          # plain fast-forward, no merge commit

    base = _git_out(["merge-base", dev, data_commit])
    if not base:
        return None

    index = _scratch_index("merge")
    try:
        if _git(["read-tree", "-m", "--aggressive", base, dev, data_commit],
                index).returncode != 0:
            return None
        # write-tree fails if any path is left unmerged — that is how a
        # conflict is detected here, with no working tree involved.
        tree = _git_out(["write-tree"], index)
    finally:
        if os.path.exists(index):
            os.remove(index)

    if not tree:
        return None
    return _git_out(["commit-tree", tree, "-p", dev, "-p", data_commit,
                     "-m", f"sync: fold {fname} update into dev"])


def sync_local_refs(data_commit, files):
    """
    Bring the local main/dev refs up to what was just pushed, without ever
    switching branches.

    A branch that is not checked out is moved with a ref-only fetch. The
    branch that IS checked out is fast-forwarded only when the working
    tree's sole modifications are the data files this run published, and
    their contents match what was published byte for byte — so restoring
    them before the fast-forward cannot lose anything. Anything else in the
    working tree and this stops and says so: moving somebody's branch out
    from under them is exactly what this script must not do.
    """
    current = _git_out(["symbolic-ref", "--quiet", "--short", "HEAD"])

    for branch in ("main", "dev"):
        if branch == current:
            continue                # checked out — a ref fetch would refuse
        r = _git(["fetch", "origin", f"{branch}:{branch}"])
        if r.returncode != 0:
            log.warning(f"Could not fast-forward local {branch}: "
                        f"{r.stderr.strip()}")

    if not current:
        log.info("Repo HEAD is detached — local branches left as they are.")
        return
    if current not in ("main", "dev"):
        log.info(f"Repo is on '{current}' — left untouched. It picks this "
                 f"update up the next time it merges dev.")
        return

    # Only touch the working tree when this branch actually ends up
    # carrying the data commit. If folding into dev conflicted, dev still
    # holds older data, and restoring the files below would quietly revert
    # the freshly generated ones — so leave them alone and say so.
    if _git(["merge-base", "--is-ancestor", data_commit,
             f"origin/{current}"]).returncode != 0:
        log.info(f"origin/{current} does not carry this update, so the "
                 f"working tree was left exactly as it is.")
        return

    # Tracked paths that differ from HEAD, staged or not. Untracked files
    # are irrelevant: this commit only touches already-tracked paths under
    # src/data, so nothing untracked can collide with the fast-forward.
    diff = _git_out(["diff", "--name-only", "HEAD"])
    if diff is None:
        log.warning("Could not read the working tree state; "
                    f"local '{current}' left alone.")
        return
    dirty = {line.strip() for line in diff.splitlines() if line.strip()}

    stray = dirty - set(files)
    if stray:
        log.info(f"Local '{current}' is behind origin/{current}, but the "
                 f"working tree has other changes ({', '.join(sorted(stray))}). "
                 f"Left it alone — run `git pull --ff-only` when you are ready.")
        return

    for rel in sorted(dirty):
        abs_path = os.path.join(REPO_FOLDER, rel.replace("/", os.sep))
        if (_git_out(["hash-object", "--path", rel, abs_path])
                != _git_out(["rev-parse", f"{data_commit}:{rel}"])):
            log.info(f"{rel} in the working tree differs from what was "
                     f"published — left '{current}' alone. Run "
                     f"`git pull --ff-only` yourself.")
            return

    if dirty:
        # Verified identical to what was just pushed, so restoring these
        # loses nothing and lets the fast-forward through.
        if _git(["checkout", "--"] + sorted(dirty)).returncode != 0:
            log.warning(f"Could not restore the published data files — local "
                        f"'{current}' left behind origin/{current}.")
            return

    r = _git(["merge", "--ff-only", f"origin/{current}"])
    if r.returncode == 0:
        log.info(f"Local '{current}' fast-forwarded to origin/{current}.")
    else:
        log.warning(f"Could not fast-forward local '{current}': "
                    f"{r.stderr.strip()}")


def publish(fname, files):
    """Commit the data files, deploy them to main, then fold them into dev."""
    log.info(f"Publishing {', '.join(files)} ...")

    if _git(["fetch", "origin"]).returncode != 0:
        log.error("git fetch failed — nothing published for this file.")
        return

    message = (f"Weekly update: {fname} — "
               f"{datetime.now().strftime('%Y-%m-%d %H:%M')}")
    data_commit = build_data_commit(files, message)
    if data_commit is None:
        log.error(f"Aborting publish for {fname}. The repo was not modified.")
        return
    if data_commit == "":
        log.info("Data files are already identical to origin/main — "
                 "nothing to deploy.")
        log.info("-" * 60)
        return

    # Rejected if origin/main moved since the fetch above: the commit is
    # parented on that exact sha, so a non-fast-forward means somebody else
    # pushed and this run's tree is stale. Fail rather than force.
    r = _git(["push", "origin", f"{data_commit}:refs/heads/main"])
    if r.returncode != 0:
        log.error(f"Could not push to main: {r.stderr.strip()}")
        log.error(f"Nothing was deployed for {fname}. The repo was not "
                  f"modified — re-drop the file to retry.")
        return
    log.info(f"Deployed to production for {fname} ({data_commit[:7]}).")

    dev_target = fold_into_dev(data_commit, fname)
    if dev_target is None:
        log.error(f"Production deploy for {fname} succeeded, but folding it "
                  f"into dev conflicts with work already on dev. dev was left "
                  f"untouched — a human needs to merge main into dev manually "
                  f"before the next feature merges to main.")
    else:
        r = _git(["push", "origin", f"{dev_target}:refs/heads/dev"])
        if r.returncode != 0:
            log.error(f"Could not push to dev: {r.stderr.strip()}")
            log.error("Production has the update; dev does not. Merge main "
                      "into dev manually.")
        else:
            log.info("Folded into dev.")

    sync_local_refs(data_commit, files)
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
