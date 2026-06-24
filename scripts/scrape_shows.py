"""
scrape_shows.py
---------------
Reads src/data/data.json, extracts distinct show names for the current
Broadway League fiscal season (July 1 – June 30), then enriches each
show with production metadata from Wikidata and Wikipedia.

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
ROOT       = Path(__file__).resolve().parent.parent
DATA_IN    = ROOT / "src" / "data" / "data.json"
DATA_OUT   = ROOT / "src" / "data" / "shows.json"

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

# ── LOAD SHOWS FROM DATA.JSON ─────────────────────────────────────────────────
def load_season_shows(season):
    print(f"Reading {DATA_IN} ...")
    with open(DATA_IN, encoding="utf-8") as f:
        records = json.load(f)

    start, end = season_bounds(season)
    shows = set()
    for r in records:
        week = r.get("week_of", "")
        if start <= week <= end:
            show = r.get("show", "").strip()
            if show:
                shows.add(show)

    print(f"Found {len(shows)} distinct shows in {season}")
    return sorted(shows)

# ── SPARQL HELPERS ────────────────────────────────────────────────────────────
SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
WIKIDATA_API    = "https://www.wikidata.org/w/api.php"
_USER_AGENT = "BushnellDashboard/1.0 (broadway-touring-dashboard; contact: broadway@bushnell.org)"

def _sparql_client():
    sparql = SPARQLWrapper(SPARQL_ENDPOINT)
    sparql.addCustomHttpHeader("User-Agent", _USER_AGENT)
    sparql.setReturnFormat(JSON)
    return sparql

def _run_sparql(sparql, max_retries=3):
    """Execute a configured SPARQLWrapper query with retries."""
    for attempt in range(1, max_retries + 1):
        try:
            return sparql.query().convert()
        except Exception as e:
            if attempt == max_retries:
                raise
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
        print(f"  Item fetch error for {wikidata_id}: {e}")
        return None

def _commons_image_url(filename):
    """Convert a Wikimedia Commons filename to a direct image URL."""
    encoded = quote(filename.replace(" ", "_"), safe="")
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{encoded}?width=400"

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
        print(f"  Wikidata exact-match error for '{show_name}': {e}")

    # Fuzzy fallback via wbsearchentities
    print(f"  Exact match failed — trying fuzzy search...")
    time.sleep(0.5)
    wikidata_id = _search_wikidata(show_name)
    if wikidata_id:
        print(f"  Fuzzy match: {wikidata_id}")
        time.sleep(0.5)
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
def enrich_show(show, season):
    """
    Fetch all metadata for a single show name. Returns a fully-populated record.
    Exposed at module level so watcher.py can call it directly.
    """
    record = {
        "show":               show,
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

    wd = query_wikidata(show)
    time.sleep(1)

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
        time.sleep(1)

        summary = query_wikipedia(wd.get("wikipedia_url"))
        if summary:
            record["wikipedia_summary"] = summary
            print(f"  Wikipedia: {summary[:80]}...")
        time.sleep(1)
    else:
        print(f"  No Wikidata match found")

    return record


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    season = current_season()
    if "--season" in sys.argv:
        idx = sys.argv.index("--season")
        if idx + 1 < len(sys.argv):
            season = sys.argv[idx + 1]

    print(f"\nScraping show metadata for season: {season}")
    print("=" * 60)

    shows = load_season_shows(season)

    existing = {}
    if DATA_OUT.exists():
        with open(DATA_OUT, encoding="utf-8") as f:
            existing = {s["show"]: s for s in json.load(f)}
        print(f"Loaded {len(existing)} existing records from shows.json")

    results = []

    for i, show in enumerate(shows, 1):
        print(f"\n[{i}/{len(shows)}] {show}")

        if show in existing:
            rec = existing[show]
            scraped_on = rec.get("scraped_on", "")
            if scraped_on:
                age = (date.today() - date.fromisoformat(scraped_on)).days
                if age < 30:
                    print(f"  Skipping — cached {age} days ago")
                    results.append(rec)
                    continue

        results.append(enrich_show(show, season))

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
