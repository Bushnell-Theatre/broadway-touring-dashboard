# Backend / Shared Logic Refactor Notes

This pass intentionally avoids CSS and visual design changes. It focuses on the project's backend-like logic: local data pipeline scripts, validation, shared JavaScript modules, and safer wiring between pages.

## What changed

### Python pipeline

- Added `scripts/dashboard_config.py` so script paths are no longer hard-coded in multiple places.
- Added `scripts/validate_data.py` to create `src/data/validation_report.json`.
- Added `scripts/run_pipeline.py` as a single controlled entry point for append, rebuild, and validation-only workflows.
- Rewrote `scripts/watcher.py` to:
  - use `sys.executable` instead of a generic `python` command,
  - support `BWAY_WATCH_FOLDER` and `BWAY_REPO_FOLDER` environment overrides,
  - wait until OneDrive/Excel finishes writing a file before processing it,
  - correctly read `seasons.json` whether a season entry is an object with `shows` or a plain list,
  - fix the stale exception variable in show enrichment,
  - run validation after data/context/show updates,
  - include `src/data/validation_report.json` in commits,
  - allow `BWAY_SKIP_GIT=1` for test processing without committing.

### Frontend shared logic

- Added `src/js/core/validation.js`.
- Expanded `src/js/core/data.js` to normalize records/seasons and load `validation_report.json`.
- Expanded `src/js/core/signals.js` into a more complete Demand / Revenue / Peer / Confidence profile layer.
- Expanded shared `components.js`, `charts.js`, `peers.js`, and `seasons.js`.

## Important limitation

The large inline page scripts still exist. This pass strengthens the shared backend/wiring layer and prepares the pages for deduplication, but it does not fully remove every duplicate function from the HTML files yet. That next pass should be smaller and focused on replacing page-local calculations with calls into `BTD.signals`, `BTD.components`, and `BTD.charts`.

## Recommended test sequence

```bash
python scripts/validate_data.py
python scripts/run_pipeline.py --validate-only
python -m http.server 8000 --directory src
```

Then visit:

- http://localhost:8000/
- http://localhost:8000/programming.html
- http://localhost:8000/exec_summary.html
- http://localhost:8000/dashboard.html

## Environment variables

```text
BWAY_WATCH_FOLDER  Optional override for the incoming XLSX folder
BWAY_REPO_FOLDER   Optional override for the local repo root
BWAY_SKIP_GIT=1    Process files without committing or pushing
```
