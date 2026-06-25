# Show scrape fix notes

## Problem observed

`scripts/scrape_shows.py` failed before doing any work when `SPARQLWrapper` was not installed:

```text
ModuleNotFoundError: No module named 'SPARQLWrapper'
```

That made show enrichment brittle even though most of the script already had REST/API fallbacks.

## Fixes made

- Made `SPARQLWrapper` optional.
- Added a small requests-based SPARQL fallback client.
- Added `BWAY_SPARQL_TIMEOUT`, `BWAY_SPARQL_429_WAIT`, and `BWAY_SCRAPE_SLEEP_SCALE` environment controls.
- Added `--force`, `--stale-days N`, and `--show NAME` debug options.
- Changed `--season` and `--show` behavior so debug/partial scrapes preserve existing `shows.json` records instead of shrinking the file to only the requested subset.
- Added `requirements.txt` so dependencies are explicit.

## Useful commands

```bash
python scripts/scrape_shows.py --season 2026-2027 --show "Mamma Mia!" --force
python scripts/scrape_shows.py --season 2026-2027 --force
python scripts/scrape_shows.py --stale-days 30
```

For fast local failure testing without long backoff waits:

```bash
BWAY_SCRAPE_SLEEP_SCALE=0 BWAY_SPARQL_TIMEOUT=5 python scripts/scrape_shows.py --season 2026-2027 --show "Mamma Mia!" --force
```

On Windows PowerShell:

```powershell
$env:BWAY_SCRAPE_SLEEP_SCALE="0"
$env:BWAY_SPARQL_TIMEOUT="5"
python scripts/scrape_shows.py --season 2026-2027 --show "Mamma Mia!" --force
```
