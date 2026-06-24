"""
scrape_shows.py
---------------
Reads src/data/seasons.json for the Bushnell's curated show list, then
enriches each show with production metadata from Wikidata and Wikipedia.

seasons.json maps each fiscal season to a list of show entries with two fields:
  "name"        — clean display name used for Wikidata search and shows.json key
  "league_name" — exact Broadway League string used to match records in data.json

Output: src/data/shows.json

Run manually:
    python scrape_shows.py [--season 2024-2025]

Called automatically by watcher.py after each data update (new shows only).

Dependencies:
    pip install requests SPARQLWrapper
"""

import json
import time
import sys
from datetime import date
from pathlib import Path
from urllib.parse import quote

import requests
from SPARQLWrapper import SPARQLWrapper, JSON

# ── PATHS ─────────────────────────────────────────────────────────────────────
ROOT        = Path(__file__).resolve().parent.parent
DATA_IN     = ROOT / "src" / "data" / "data.json"
SEASONS_IN  = ROOT / "src" / "data" / "seasons.json"
DATA_OUT    = ROOT / "src" / "data" / "shows.json"

# ── SEASON LOGIC ──────────────────────────────────────────────────────────────
def current_season():
    """Return the current fiscal season string e.g. '2025-2026'."""
    today = date.today()
    year  = today.year if today.month >= 7 else today.year - 1
    return f"{year}-{year + 1}"

def season_bounds(season_str):
    """Return (start_date, end_date) strings for a fiscal season."""
    year = int(season_str.split("-")[0])
    return f"{year}-07-01", f"{year + 1}-06-30"

# ── LOAD SHOWS FROM SEASONS.JSON ─────────────────────────────────────────────
def load_season_shows(season):
    """
    Returns a list of dicts with 'name' and 'league_name' for the given season.
    'name' is the clean display name used for Wikidata search.
    'league_name' is the exact Broadway League string for matching data.json.
    Falls back to deriving from data.json if the season isn't in seasons.json.
    """
    if SEASONS_IN.exists():
        with open(SEASONS_IN, encoding="utf-8") as f:
            seasons = json.load(f)
        if season in seasons:
            entry = seasons[season]
            shows = entry.get("shows", entry) if isinstance(entry, dict) else entry
            print(f"Loaded {len(shows)} shows from seasons.json for {season}")
            return shows
        print(f"Season {season} not found in seasons.json — falling back to data.json")

    # Fallback: derive from data.json (league_name = name)
    print(f"Reading {DATA_IN} ...")
    with open(DATA_IN, encoding="utf-8") as f:
        raw = json.load(f)
    records = raw.get("records", raw) if isinstance(raw, dict) else raw

    start, end = season_bounds(season)
    league_names = sorted({
        r.get("show", "").strip()
        for r in records
        if start <= r.get("week_of", "") <= end
        and r.get("theatre") == "Bushnell"
        and r.get("show", "").strip()
    })
    shows = [{"name": n, "league_name": n} for n in league_names]
    print(f"Found {len(shows)} distinct Bushnell shows in {season} (from data.json)")
    return shows

# ── SPARQL HELPERS ────────────────────────────────────────────────────────────
SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
WIKIDATA_API    = "https://www.wikidata.org/w/api.php"
_USER_AGENT = "BushnellDashboard/1.0 (broadway-touring-dashboard; contact: broadway@bushnell.org)"

def _sparql_client():
    sparql = SPARQLWrapper(SPARQL_ENDPOINT)
    sparql.addCustomHttpHeader("User-Agent", _USER_AGENT)
    sparql.setReturnFormat(JSON)
    return sparql

def _run_sparql(sparql, max_retries=4):
    """Execute a configured SPARQLWrapper query with retries and 429 backoff."""
    for attempt in range(1, max_retries + 1):
        try:
            return sparql.query().convert()
        except Exception as e:
            if attempt == max_retries:
                raise
            # Wikidata rate-limit: back off for 60s then retry
            if "429" in str(e):
                wait = 60
                print(f"  Rate limited (429) — waiting {wait}s before retry...")
            else:
                wait = 2 ** attempt
            print(f"  SPARQL attempt {attempt} failed ({e}), retrying in {wait}s...")
            time.sleep(wait)

def _escape_sparql_string(s):
    """Escape a string for safe embedding in a SPARQL string literal."""
    return s.replace("\\", "\\\\").replace('"', '\\"')

def _fetch_wikidata_item(wikidata_id):
    """
    Pull structured fields for a single Wikidata item via SPARQL.
    Returns the same dict shape as query_wikidata(), or None on failure.
    """
    sparql = _sparql_client()
    query = f"""
    SELECT DISTINCT ?item ?openDate ?closeDate ?composerLabel ?lyricistLabel ?article ?image
    WHERE {{
      BIND(wd:{wikidata_id} AS ?item)
      OPTIONAL {{ ?item wdt:P571 ?openDate . }}
      OPTIONAL {{ ?item wdt:P576 ?closeDate . }}
      OPTIONAL {{ ?item wdt:P18  ?image . }}
      OPTIONAL {{ ?item wdt:P86  ?composer .
                 ?composer rdfs:label ?composerLabel . FILTER(LANG(?composerLabel)="en") }}
      OPTIONAL {{ ?item wdt:P676 ?lyricist .
                 ?lyricist rdfs:label ?lyricistLabel . FILTER(LANG(?lyricistLabel)="en") }}
      OPTIONAL {{
        ?article schema:about ?item ;
                 schema:inLanguage "en" ;
                 schema:isPartOf <https://en.wikipedia.org/> .
      }}
    }}
    LIMIT 1
    """
    try:
        sparql.setQuery(query)
        results = _run_sparql(sparql)
        bindings = results["results"]["bindings"]
        if not bindings:
            return None
        b = bindings[0]
        return {
            "wikidata_id":   wikidata_id,
            "opening_date":  b["openDate"]["value"][:10]      if "openDate"      in b else None,
            "closing_date":  b["closeDate"]["value"][:10]     if "closeDate"     in b else None,
            "composer":      b["composerLabel"]["value"]       if "composerLabel" in b else None,
            "lyricist":      b["lyricistLabel"]["value"]       if "lyricistLabel" in b else None,
            "wikipedia_url": b["article"]["value"]             if "article"       in b else None,
            "image_url":     _commons_image_url(b["image"]["value"].split("/")[-1]) if "image" in b else None,
        }
    except Exception as e:
        if "429" in str(e):
            print(f"  SPARQL rate-limited — falling back to REST API for {wikidata_id}...")
            time.sleep(2)
            return _fetch_wikidata_item_rest(wikidata_id)
        print(f"  Item fetch error for {wikidata_id}: {e}")
        return None

def _commons_image_url(filename):
    """Convert a Wikimedia Commons filename to a direct image URL."""
    encoded = quote(filename.replace(" ", "_"), safe="")
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{encoded}?width=400"


def _get_entity_label(entity_id):
    """Fetch the English label for a Wikidata entity ID via REST API."""
    if not entity_id:
        return None
    try:
        resp = requests.get(
            WIKIDATA_API,
            params={"action": "wbgetentities", "ids": entity_id,
                    "format": "json", "props": "labels", "languages": "en"},
            timeout=10,
            headers={"User-Agent": _USER_AGENT},
        )
        if resp.status_code != 200:
            return None
        entity = resp.json().get("entities", {}).get(entity_id, {})
        return entity.get("labels", {}).get("en", {}).get("value")
    except Exception:
        return None


def _fetch_wikidata_item_rest(wikidata_id):
    """
    Fetch structured metadata for a Wikidata item via the wbgetentities REST API.
    Used as a fallback when the SPARQL endpoint is rate-limited or unavailable.
    """
    try:
        resp = requests.get(
            WIKIDATA_API,
            params={"action": "wbgetentities", "ids": wikidata_id,
                    "format": "json", "props": "claims|sitelinks", "languages": "en"},
            timeout=15,
            headers={"User-Agent": _USER_AGENT},
        )
        if resp.status_code == 429:
            print(f"  REST API also rate-limited for {wikidata_id}")
            return None
        if resp.status_code != 200:
            return None
        entity = resp.json().get("entities", {}).get(wikidata_id, {})
        if not entity or entity.get("missing"):
            return None

        claims   = entity.get("claims", {})
        sitelinks = entity.get("sitelinks", {})

        def claim_time(prop):
            cs = claims.get(prop, [])
            if not cs:
                return None
            t = cs[0].get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("time", "")
            return t.lstrip("+")[:10] if t else None

        def claim_entity_id(prop):
            cs = claims.get(prop, [])
            if not cs:
                return None
            v = cs[0].get("mainsnak", {}).get("datavalue", {}).get("value", {})
            return v.get("id") if isinstance(v, dict) else None

        def claim_str(prop):
            cs = claims.get(prop, [])
            if not cs:
                return None
            return cs[0].get("mainsnak", {}).get("datavalue", {}).get("value")

        composer_label = _get_entity_label(claim_entity_id("P86"))
        lyricist_label = _get_entity_label(claim_entity_id("P676"))

        wiki_url = None
        if "enwiki" in sitelinks:
            title = sitelinks["enwiki"].get("title", "")
            if title:
                wiki_url = "https://en.wikipedia.org/wiki/" + quote(title.replace(" ", "_"))

        image_val = claim_str("P18")
        image_url = None
        if isinstance(image_val, str) and image_val:
            image_url = _commons_image_url(image_val.split("/")[-1])

        return {
            "wikidata_id":   wikidata_id,
            "opening_date":  claim_time("P571"),
            "closing_date":  claim_time("P576"),
            "composer":      composer_label,
            "lyricist":      lyricist_label,
            "wikipedia_url": wiki_url,
            "image_url":     image_url,
        }
    except Exception as e:
        print(f"  REST fetch error for {wikidata_id}: {e}")
        return None

# ── WIKIDATA SEARCH FALLBACK ──────────────────────────────────────────────────
def _search_wikidata(show_name):
    """
    Use wbsearchentities to find a Wikidata item by fuzzy name.
    Returns the first result whose description mentions 'musical', or None.
    """
    try:
        resp = requests.get(
            WIKIDATA_API,
            params={
                "action":   "wbsearchentities",
                "search":   show_name,
                "language": "en",
                "type":     "item",
                "limit":    5,
                "format":   "json",
            },
            timeout=10,
            headers={"User-Agent": _USER_AGENT},
        )
        if resp.status_code == 429:
            print(f"  Rate limited (429) on search — waiting 60s...")
            time.sleep(60)
            return None
        if resp.status_code != 200:
            return None
        for result in resp.json().get("search", []):
            desc = result.get("description", "").lower()
            if "musical" in desc or "broadway" in desc:
                return result["id"]
        return None
    except Exception as e:
        print(f"  Wikidata search error for '{show_name}': {e}")
        return None

# ── WIKIDATA SPARQL ───────────────────────────────────────────────────────────
def query_wikidata(show_name):
    """
    Query Wikidata for a Broadway musical by name.
    Tries exact label match first; falls back to wbsearchentities fuzzy search.
    Returns an enrichment dict or None if not found.
    """
    sparql = _sparql_client()
    escaped = _escape_sparql_string(show_name)

    query = f"""
    SELECT DISTINCT ?item ?openDate ?closeDate ?composerLabel ?lyricistLabel ?article ?image
    WHERE {{
      VALUES ?label {{ "{escaped}"@en }}
      ?item rdfs:label ?label .
      ?item wdt:P31/wdt:P279* wd:Q2743 .
      OPTIONAL {{ ?item wdt:P571 ?openDate . }}
      OPTIONAL {{ ?item wdt:P576 ?closeDate . }}
      OPTIONAL {{ ?item wdt:P18  ?image . }}
      OPTIONAL {{ ?item wdt:P86  ?composer .
                 ?composer rdfs:label ?composerLabel . FILTER(LANG(?composerLabel)="en") }}
      OPTIONAL {{ ?item wdt:P676 ?lyricist .
                 ?lyricist rdfs:label ?lyricistLabel . FILTER(LANG(?lyricistLabel)="en") }}
      OPTIONAL {{
        ?article schema:about ?item ;
                 schema:inLanguage "en" ;
                 schema:isPartOf <https://en.wikipedia.org/> .
      }}
    }}
    LIMIT 1
    """

    try:
        sparql.setQuery(query)
        results = _run_sparql(sparql)
        bindings = results["results"]["bindings"]

        if bindings:
            b = bindings[0]
            return {
                "wikidata_id":   b["item"]["value"].split("/")[-1] if "item" in b else None,
                "opening_date":  b["openDate"]["value"][:10]       if "openDate"       in b else None,
                "closing_date":  b["closeDate"]["value"][:10]      if "closeDate"      in b else None,
                "composer":      b["composerLabel"]["value"]        if "composerLabel"  in b else None,
                "lyricist":      b["lyricistLabel"]["value"]        if "lyricistLabel"  in b else None,
                "wikipedia_url": b["article"]["value"]              if "article"        in b else None,
                "image_url":     _commons_image_url(b["image"]["value"].split("/")[-1]) if "image" in b else None,
            }

    except Exception as e:
        if "429" in str(e):
            print(f"  SPARQL rate-limited for '{show_name}' — skipping to fuzzy+REST path...")
        else:
            print(f"  Wikidata exact-match error for '{show_name}': {e}")

    # Fuzzy fallback via wbsearchentities
    print(f"  Exact match failed — trying fuzzy search...")
    time.sleep(3)
    wikidata_id = _search_wikidata(show_name)
    if wikidata_id:
        print(f"  Fuzzy match: {wikidata_id}")
        time.sleep(3)
        return _fetch_wikidata_item(wikidata_id)

    return None


def query_tony_awards(wikidata_id):
    """
    Given a Wikidata item ID (e.g. 'Q123456'), return (nominations, wins).
    Uses separate OPTIONAL blocks to count nominations (P1411) and wins (P166).
    """
    if not wikidata_id:
        return 0, 0

    sparql = _sparql_client()

    query = f"""
    SELECT
      (COUNT(DISTINCT ?nomAward) AS ?nominations)
      (COUNT(DISTINCT ?winAward) AS ?wins)
    WHERE {{
      OPTIONAL {{
        wd:{wikidata_id} wdt:P1411 ?nomAward .
        ?nomAward wdt:P361 wd:Q102627 .
      }}
      OPTIONAL {{
        wd:{wikidata_id} wdt:P166 ?winAward .
        ?winAward wdt:P361 wd:Q102627 .
      }}
    }}
    """

    try:
        sparql.setQuery(query)
        results = _run_sparql(sparql)
        bindings = results["results"]["bindings"]

        if bindings:
            b = bindings[0]
            noms = int(b.get("nominations", {}).get("value", 0))
            wins = int(b.get("wins",        {}).get("value", 0))
            return noms, wins
        return 0, 0

    except Exception as e:
        print(f"  Tony query error for {wikidata_id}: {e}")
        return 0, 0


# ── WIKIPEDIA ─────────────────────────────────────────────────────────────────
def query_wikipedia(wikipedia_url, max_retries=3):
    """
    Fetch the opening paragraph (summary) from a Wikipedia article.
    Returns a plain-text string or None.
    """
    if not wikipedia_url:
        return None

    title = wikipedia_url.rstrip("/").split("/wiki/")[-1]
    api_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}"

    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.get(api_url, timeout=10, headers={"User-Agent": _USER_AGENT})
            if resp.status_code == 200:
                return resp.json().get("extract", None)
            if resp.status_code == 404:
                return None
            if attempt < max_retries:
                wait = 2 ** attempt
                print(f"  Wikipedia HTTP {resp.status_code}, retrying in {wait}s...")
                time.sleep(wait)
        except Exception as e:
            if attempt == max_retries:
                print(f"  Wikipedia error for '{title}': {e}")
                return None
            wait = 2 ** attempt
            print(f"  Wikipedia attempt {attempt} failed ({e}), retrying in {wait}s...")
            time.sleep(wait)

    return None


# ── CORE ENRICHMENT ───────────────────────────────────────────────────────────
def enrich_show(show_entry, season):
    """
    Fetch all metadata for a show. show_entry is a dict with 'name' and
    'league_name'. 'name' is used for Wikidata search; 'league_name' is
    stored so callers can match back to data.json records.
    Exposed at module level so watcher.py can call it directly.
    """
    name        = show_entry["name"]
    league_name = show_entry.get("league_name", name)

    record = {
        "name":               name,
        "league_name":        league_name,
        "season":             season,
        "scraped_on":         date.today().isoformat(),
        "opening_date":       None,
        "closing_date":       None,
        "composer":           None,
        "lyricist":           None,
        "tony_nominations":   0,
        "tony_wins":          0,
        "wikipedia_url":      None,
        "wikipedia_summary":  None,
        "image_url":          None,
        "wikidata_id":        None,
    }

    wd = query_wikidata(name)
    time.sleep(3)

    if wd:
        record.update({
            "opening_date":  wd.get("opening_date"),
            "closing_date":  wd.get("closing_date"),
            "composer":      wd.get("composer"),
            "lyricist":      wd.get("lyricist"),
            "wikipedia_url": wd.get("wikipedia_url"),
            "image_url":     wd.get("image_url"),
            "wikidata_id":   wd.get("wikidata_id"),
        })
        print(f"  Wikidata: opened {wd.get('opening_date','?')} | composer: {wd.get('composer','?')}")

        noms, wins = query_tony_awards(wd.get("wikidata_id"))
        record["tony_nominations"] = noms
        record["tony_wins"]        = wins
        print(f"  Tonys: {wins} wins / {noms} nominations")
        time.sleep(3)

        summary = query_wikipedia(wd.get("wikipedia_url"))
        if summary:
            record["wikipedia_summary"] = summary
            print(f"  Wikipedia: {summary[:80]}...")
        time.sleep(1)
    else:
        print(f"  No Wikidata match found")

    return record


# ── MAIN ──────────────────────────────────────────────────────────────────────
def all_seasons():
    """Return all season IDs from seasons.json, sorted newest first."""
    if SEASONS_IN.exists():
        with open(SEASONS_IN, encoding="utf-8") as f:
            data = json.load(f)
        return sorted(data.keys(), reverse=True)
    return [current_season()]


def main():
    # --season X  → single season; default → all seasons in seasons.json
    if "--season" in sys.argv:
        idx = sys.argv.index("--season")
        seasons_to_scrape = [sys.argv[idx + 1]] if idx + 1 < len(sys.argv) else [current_season()]
    else:
        seasons_to_scrape = all_seasons()

    print(f"\nScraping show metadata for: {', '.join(seasons_to_scrape)}")
    print("=" * 60)

    # Load all existing records keyed by show name
    existing = {}
    if DATA_OUT.exists():
        with open(DATA_OUT, encoding="utf-8") as f:
            existing = {s["name"]: s for s in json.load(f)}
        print(f"Loaded {len(existing)} existing records from shows.json")

    # Collect unique shows across all target seasons (newest season wins on dupe)
    seen_names = {}
    for season in seasons_to_scrape:
        for entry in load_season_shows(season):
            name = entry["name"]
            if name not in seen_names:
                seen_names[name] = (entry, season)

    all_entries = list(seen_names.values())
    print(f"Total unique shows across all seasons: {len(all_entries)}")

    results = []
    for i, (entry, season) in enumerate(all_entries, 1):
        name = entry["name"]
        print(f"\n[{i}/{len(all_entries)}] {name}  (season: {season}, league: {entry.get('league_name', name)})")

        if name in existing:
            rec = existing[name]
            scraped_on = rec.get("scraped_on", "")
            if scraped_on:
                age = (date.today() - date.fromisoformat(scraped_on)).days
                if age < 30:
                    print(f"  Skipping — cached {age} days ago")
                    results.append(rec)
                    continue

        results.append(enrich_show(entry, season))

    DATA_OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_OUT, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\n{'=' * 60}")
    print(f"Done. Wrote {len(results)} records to {DATA_OUT}")

    matched   = sum(1 for r in results if r["wikidata_id"])
    with_tony = sum(1 for r in results if r["tony_nominations"] > 0)
    with_wiki = sum(1 for r in results if r["wikipedia_summary"])
    with_img  = sum(1 for r in results if r["image_url"])
    print(f"  Wikidata matches:    {matched}/{len(results)}")
    print(f"  Tony data:           {with_tony}/{len(results)}")
    print(f"  Wikipedia summaries: {with_wiki}/{len(results)}")
    print(f"  Poster images:       {with_img}/{len(results)}")


if __name__ == "__main__":
    main()
