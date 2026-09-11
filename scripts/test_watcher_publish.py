"""
Tests for watcher.publish() — the unattended weekly deploy.

Run:
    python scripts/test_watcher_publish.py

Everything runs against a throwaway repo with a local bare "origin"; the
real repository is never touched.

Case 2 is a regression test for an actual incident. The watcher used to
run `git checkout main` in the shared working tree. A developer was
committing at that moment, HEAD had been moved out from under their
session, and their commits landed on main and auto-deployed. The watcher
must never move HEAD, never switch branches, and never be able to sweep
anything but its own data files into a commit — no matter what state the
working tree is in when it fires.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WATCHER = Path(__file__).resolve().parent / "watcher.py"

ROOT = Path(tempfile.mkdtemp(prefix="btd-watcher-test-"))
ORIGIN = ROOT / "origin.git"
WORK = ROOT / "work"

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


def git(*args: str):
    return subprocess.run(["git", "-C", str(WORK), *args],
                          capture_output=True, text=True)


def out(*args: str) -> str:
    """A git command that MUST succeed — setup must never fail quietly."""
    r = git(*args)
    if r.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout.strip()


def write(rel: str, text: str) -> None:
    p = WORK / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8", newline="\n")


def read(rel: str) -> str:
    return (WORK / rel).read_text(encoding="utf-8")


def weeks(*args: str):
    return json.loads(out(*args))["weeks"]


def data(*ws) -> str:
    return json.dumps({"weeks": list(ws)}) + "\n"


def build_repo() -> None:
    subprocess.run(["git", "init", "-q", "--bare", str(ORIGIN)], check=True)
    subprocess.run(["git", "clone", "-q", str(ORIGIN), str(WORK)],
                   check=True, capture_output=True)
    out("config", "user.email", "watcher@test")
    out("config", "user.name", "watcher")
    write("src/data/data.json", data("w1"))
    write("dashboard.html", "<h1>v1</h1>\n")
    out("add", "-A")
    out("commit", "-qm", "base")
    out("branch", "-M", "main")
    out("push", "-q", "-u", "origin", "main")
    out("push", "-q", "origin", "main:dev")
    out("fetch", "-q", "origin")
    out("branch", "dev", "origin/dev")
    out("checkout", "-q", "dev")


def load_watcher():
    """Import watcher.py pointed at the throwaway repo, quietly."""
    spec = importlib.util.spec_from_file_location("watcher_under_test", WATCHER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.REPO_FOLDER = str(WORK)
    # watcher.py configures logging at import; don't let test runs append to
    # the real watcher.log.
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(logging.NullHandler())
    return mod


try:
    build_repo()
    w = load_watcher()
    DATA = ["src/data/data.json"]

    print("\n--- 1. normal weekly run: dev == main, nothing else in flight ---")
    write("src/data/data.json", data("w1", "w2"))
    w.publish("TouringReport_wk2.xlsx", DATA)

    check("branch unchanged", out("branch", "--show-current") == "dev")
    check("origin/dev == origin/main",
          out("rev-parse", "origin/dev") == out("rev-parse", "origin/main"))
    check("local dev fast-forwarded",
          out("rev-parse", "dev") == out("rev-parse", "origin/dev"))
    check("local main fast-forwarded",
          out("rev-parse", "main") == out("rev-parse", "origin/main"))
    check("working tree left clean", out("status", "--porcelain") == "",
          out("status", "--porcelain"))
    check("data deployed to production",
          weeks("show", "origin/main:src/data/data.json") == ["w1", "w2"])
    check("commit touched only the data file",
          out("diff", "--name-only", "origin/main~1", "origin/main")
          == "src/data/data.json")

    print("\n--- 2. REGRESSION: a human is mid-session with uncommitted work ---")
    write("dashboard.html", "<h1>work in progress</h1>\n")
    write("src/data/data.json", data("w1", "w2", "w3"))
    head_before = out("rev-parse", "HEAD")
    w.publish("TouringReport_wk3.xlsx", DATA)

    check("HEAD not moved under the session",
          out("rev-parse", "HEAD") == head_before)
    check("still on dev", out("branch", "--show-current") == "dev")
    check("in-progress file untouched",
          read("dashboard.html") == "<h1>work in progress</h1>\n")
    check("in-progress file NOT swept into the deploy",
          "dashboard.html" not in out("diff", "--name-only",
                                      "origin/main~1", "origin/main"),
          out("diff", "--name-only", "origin/main~1", "origin/main"))
    check("deploy still reached production",
          weeks("show", "origin/main:src/data/data.json") == ["w1", "w2", "w3"])
    check("regenerated data still in the working tree",
          json.loads(read("src/data/data.json"))["weeks"] == ["w1", "w2", "w3"])

    print("\n--- 3. a session commits and pushes to dev while the watcher runs ---")
    out("add", "dashboard.html", "src/data/data.json")
    out("commit", "-qm", "wip: session commit")
    # Case 2 correctly left local dev behind, so the developer pulls first,
    # exactly as they would in real life.
    out("pull", "-q", "--rebase", "origin", "dev")
    session_commit = out("rev-parse", "HEAD")
    out("push", "-q", "origin", "dev")
    check("setup: session commit is on origin/dev",
          git("merge-base", "--is-ancestor", session_commit,
              "origin/dev").returncode == 0)

    write("src/data/data.json", data("w1", "w2", "w3", "w4"))
    w.publish("TouringReport_wk4.xlsx", DATA)

    check("session commit did NOT reach production",
          git("merge-base", "--is-ancestor", session_commit,
              "origin/main").returncode != 0)
    check("production got the data anyway",
          weeks("show", "origin/main:src/data/data.json")[-1] == "w4")
    check("dev got a merge commit folding main in",
          len(out("rev-list", "--parents", "-n", "1", "origin/dev").split()) == 3,
          out("rev-list", "--parents", "-n", "1", "origin/dev"))
    check("dev kept the session's own work",
          out("show", "origin/dev:dashboard.html") == "<h1>work in progress</h1>")
    check("dev has the new data",
          weeks("show", "origin/dev:src/data/data.json")[-1] == "w4")

    print("\n--- 4. dev and main both changed the data file (conflict) ---")
    out("fetch", "-q", "origin")
    out("merge", "-q", "--ff-only", "origin/dev")
    write("src/data/data.json", data("conflicting"))
    out("add", "-A")
    out("commit", "-qm", "someone edited data.json on dev")
    out("push", "-q", "origin", "dev")
    dev_before = out("rev-parse", "origin/dev")
    check("setup: origin/dev is ahead of origin/main",
          git("merge-base", "--is-ancestor", dev_before,
              "origin/main").returncode != 0)

    write("src/data/data.json", data("w1", "w2", "w3", "w4", "w5"))
    w.publish("TouringReport_wk5.xlsx", DATA)

    check("production still deployed",
          weeks("show", "origin/main:src/data/data.json")[-1] == "w5")
    check("dev left untouched on conflict",
          out("rev-parse", "origin/dev") == dev_before)
    check("repo not left mid-merge", not (WORK / ".git" / "MERGE_HEAD").exists())
    check("still on dev, HEAD intact", out("branch", "--show-current") == "dev")
    check("new data NOT reverted in the working tree",
          json.loads(read("src/data/data.json"))["weeks"][-1] == "w5")

    print("\n--- 5. re-run with unchanged data ---")
    before = out("rev-parse", "origin/main")
    w.publish("TouringReport_wk5.xlsx", DATA)
    check("no empty commit pushed", out("rev-parse", "origin/main") == before)

    print("\n--- 6. repo sitting on a feature branch ---")
    out("checkout", "-q", "-b", "feat/something")
    feat_before = out("rev-parse", "feat/something")
    write("src/data/data.json", data("w1", "w2", "w3", "w4", "w5", "w6"))
    w.publish("TouringReport_wk6.xlsx", DATA)
    check("still on the feature branch",
          out("branch", "--show-current") == "feat/something")
    check("feature branch ref not moved",
          out("rev-parse", "feat/something") == feat_before)
    check("production deployed from a feature-branch checkout",
          weeks("show", "origin/main:src/data/data.json")[-1] == "w6")

    print("\n--- 7. housekeeping ---")
    leftovers = [f for f in os.listdir(tempfile.gettempdir())
                 if f.startswith("btd-watcher-") and f.endswith(".index")]
    check("scratch index files cleaned up", not leftovers, str(leftovers))
finally:
    def _force(func, path, _exc):
        os.chmod(path, 0o700)
        func(path)
    shutil.rmtree(ROOT, onerror=_force)

print(f"\n{'=' * 60}\n{PASSED} passed, {FAILED} failed\n{'=' * 60}")
sys.exit(1 if FAILED else 0)
