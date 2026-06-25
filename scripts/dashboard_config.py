"""Shared configuration helpers for Broadway Touring Dashboard scripts.

The scripts are intentionally runnable from a checked-out repo without a build
step. Paths can be overridden with environment variables so the watcher is not
hard-coded to one laptop path.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
DATA_DIR = SRC / "data"

DATA_JSON = DATA_DIR / "data.json"
SEASONS_JSON = DATA_DIR / "seasons.json"
PEERS_JSON = DATA_DIR / "peers.json"
SHOWS_JSON = DATA_DIR / "shows.json"
CONTEXT_JSON = DATA_DIR / "context.json"
VALIDATION_JSON = DATA_DIR / "validation_report.json"

DEFAULT_WATCH_FOLDER = (
    "C:\\Users\\rnunley\\Bushnell Center for the Performing Arts\\"
    "AI Taskforce Group-Testing-Development - Broadway League Report Uploads\\reports"
)

def env_path(name: str, default: str | Path) -> Path:
    """Return a Path from an environment variable, falling back to default."""
    return Path(os.getenv(name, str(default))).expanduser()


def repo_root() -> Path:
    return env_path("BWAY_REPO_FOLDER", ROOT).resolve()


def watch_folder() -> Path:
    return env_path("BWAY_WATCH_FOLDER", DEFAULT_WATCH_FOLDER)


def data_path(filename: str) -> Path:
    return repo_root() / "src" / "data" / filename


def script_path(filename: str) -> Path:
    return repo_root() / "scripts" / filename
