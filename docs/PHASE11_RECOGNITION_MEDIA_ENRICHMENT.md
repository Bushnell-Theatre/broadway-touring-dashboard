# Phase 11 — Recognition and Media Enrichment

## Purpose

Phase 11 adds a non-financial enrichment layer to the Broadway Touring Intelligence Dashboard. The goal is to make award recognition, public-media awareness, tour viability, reputation risk, audience fit, and local-market relevance visible without confusing those signals with demand, revenue, or net profitability.

## New data files

- `src/data/awards.json` — normalized official/primary award records and rollups by show.
- `src/data/media_sources.json` — curated public-media source inputs.
- `src/data/media_signals.json` — rollups generated from public-media sources.
- `src/data/title_aliases.json` — title normalization map across Broadway League, award sites, Wikipedia, media sources, and local naming.

## New scripts

### `scripts/build_awards.py`

Builds `awards.json` from configured award sources and can merge rollups into `shows.json`.

Examples:

```bash
python scripts/build_awards.py --all --years 2016-2026 --merge-shows
python scripts/build_awards.py --source tony --years 2024,2025 --refresh --merge-shows
python scripts/build_awards.py --input-html tony:2025:downloads/tony-2025.html --merge-shows
```

Supported award bodies:

- Tony Awards
- Olivier Awards
- Drama Desk Awards
- Grammy Awards, especially musical theater album recognition

Official/primary sources should remain the preferred source for award facts. Public media should not overwrite official award counts.

### `scripts/build_media_signals.py`

Builds `media_signals.json` from curated public-media source records and can merge the results into `shows.json`.

Examples:

```bash
python scripts/build_media_signals.py --merge-shows
python scripts/build_media_signals.py --fetch --merge-shows
```

This script does not perform open-ended web search. It classifies known public-source records using conservative keyword heuristics. Add source records to `src/data/media_sources.json`.

## Scraper integration

`scripts/scrape_shows.py` now applies local enrichment overrides from:

- `awards.json`
- `media_signals.json`
- `title_aliases.json`

This means show scraping can still use Wikidata/Wikipedia/IBDB for production metadata, while local award and media rollups become the stable source of truth for recognition and public-media context.

## Frontend integration

The shared `BTD.data` layer now loads:

- shows
- awards
- media signals
- title aliases

The shared `BTD.signals.profileShow()` result now includes additional non-financial signals:

- `recognition`
- `press`
- `tour`
- `risk`
- `audience`
- `local`

These sit beside, but do not replace:

- Demand Signal
- Revenue Signal
- Peer Signal
- Confidence Signal

## Governance rule

Recognition and media signals are context signals. They should help explain why a title may deserve discussion, but they should not be treated as financial proof. Awards, press buzz, and tour announcements do not equal revenue, margin, or net contribution.
