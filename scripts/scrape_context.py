"""
scrape_context.py -- Build src/data/context.json
Bushnell Center for the Performing Arts

Pulls NOAA Storm Events (Hartford County, CT) and FRED economic indicators
for every week_of date in data.json, writing a week-keyed context file that
dashboard tabs can use to annotate performance anomalies.

Storm events come from NOAA's public bulk CSV files -- no token required.
Economic data requires a free FRED API key in .env (FRED_API_KEY).

Usage:
    cd scripts
    python scrape_context.py

Dependencies:
    pip install requests python-dotenv
"""

import csv
import gzip
import io
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv

# -- PATHS ---------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
DATA_JSON = REPO_ROOT / "src" / "data" / "data.json"
CONTEXT_JSON = REPO_ROOT / "src" / "data" / "context.json"
CACHE_DIR = SCRIPT_DIR / "cache" / "storm_events"
ENV_FILE = REPO_ROOT / ".env"

# -- CONFIG --------------------------------------------------------------

# NOAA Storm Events public bulk files (no API token needed)
STORM_BASE = "https://www1.ncdc.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
STORM_STATE = "CONNECTICUT"
# County events (CZ_TYPE=C) use CZ_NAME="HARTFORD"
# Zone events (CZ_TYPE=Z, used for winter weather) use CZ_NAME like
# "NORTHERN HARTFORD"
STORM_COUNTY = "HARTFORD"   # substring match against CZ_NAME for both C and Z records

# Event types that could plausibly affect Bushnell audience attendance
NOTABLE_TYPES = {
    "HEAVY SNOW",
    "BLIZZARD",
    "ICE STORM",
    "WINTER STORM",
    "WINTER WEATHER",
    "LAKE-EFFECT SNOW",
    "SLEET",
    "HEAVY RAIN",
    "FLOOD",
    "FLASH FLOOD",
    "COASTAL FLOOD",
    "DENSE FOG",
    "FREEZING FOG",
    "HIGH WIND",
    "STRONG WIND",
    "THUNDERSTORM WIND",
    "TORNADO",
    "FUNNEL CLOUD",
    "TROPICAL STORM",
    "HURRICANE",
    "HURRICANE (TYPHOON)",
    "TROPICAL DEPRESSION",
    "EXTREME COLD/WIND CHILL",
    "COLD/WIND CHILL",
    "FROST/FREEZE",
    "EXCESSIVE HEAT",
    "HEAT",
}

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
FRED_SERIES = {
    "consumer_confidence": "UMCSENT",   # U-Mich Consumer Sentiment (monthly)
    "ct_unemployment": "CTURN",     # Connecticut Unemployment Rate (monthly)
}
FRED_RETRY_DELAY = 0.3

# -- SETUP ---------------------------------------------------------------

load_dotenv(ENV_FILE)
FRED_API_KEY = os.getenv("FRED_API_KEY", "")

if not FRED_API_KEY:
    print("WARNING: FRED_API_KEY not set in .env -- economic data will be null")


# -- HELPERS -------------------------------------------------------------

def parse_date(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def to_ym(d):
    return d.strftime("%Y-%m")


def round1(v):
    return round(float(v), 1) if v is not None else None


def date_range_strs(start_str, end_str):
    """Yield YYYY-MM-DD strings from start to end inclusive (capped at 30 days)."""
    d = datetime.strptime(start_str, "%Y-%m-%d").date()
    end = datetime.strptime(end_str, "%Y-%m-%d").date()
    cap = d + timedelta(days=30)
    while d <= end and d <= cap:
        yield d.isoformat()
        d += timedelta(days=1)


# -- DATA.JSON WEEK LIST -------------------------------------------------

def load_weeks():
    if not DATA_JSON.exists():
        sys.exit(f"ERROR: {DATA_JSON} not found. Run from scripts/ folder.")
    with open(DATA_JSON, encoding="utf-8") as f:
        raw = json.load(f)
    records = raw.get("records", raw) if isinstance(raw, dict) else raw
    weeks = sorted({r["week_of"] for r in records if r.get("week_of")})
    print(
        f"Found {len(weeks)} distinct weeks in data.json ({weeks[0]} to {weeks[-1]})")
    return weeks


# -- NOAA STORM EVENTS ---------------------------------------------------

def list_storm_event_files():
    """
    Fetch the NOAA CSV directory listing and return the latest filename per year
    for StormEvents_details files.
    """
    r = requests.get(STORM_BASE, timeout=30)
    r.raise_for_status()
    pattern = re.compile(
        r'(StormEvents_details-ftp_v[\d.]+_d(\d{4})_c\d+\.csv\.gz)')
    files = {}
    for m in pattern.finditer(r.text):
        fname, year = m.group(1), int(m.group(2))
        files[year] = fname   # last match per year = most recent version
    return {y: STORM_BASE + f for y, f in sorted(files.items())}


def download_year(year, url):
    """
    Return raw gzip bytes for a storm events year file, using disk cache.
    Current and prior year are always re-downloaded (data gets updated).
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fname = url.split("/")[-1]
    cache_path = CACHE_DIR / fname
    current_year = date.today().year

    if cache_path.exists() and year < current_year - 1:
        return cache_path.read_bytes()

    print(f"  Downloading {year} storm events...")
    r = requests.get(url, timeout=120, stream=True)
    r.raise_for_status()
    raw = r.content
    cache_path.write_bytes(raw)
    return raw


def parse_events(raw_bytes):
    """
    Parse a gzip-compressed storm events CSV and return Hartford County events
    that match NOTABLE_TYPES.
    """
    events = []
    with gzip.open(io.BytesIO(raw_bytes), "rt", encoding="latin-1") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("STATE", "").upper() != STORM_STATE:
                continue
            if row.get("CZ_TYPE", "").upper() not in ("C", "Z"):
                continue
            if STORM_COUNTY not in row.get("CZ_NAME", "").upper():
                continue

            etype = row.get("EVENT_TYPE", "").upper().strip()
            if etype not in NOTABLE_TYPES:
                continue

            begin_str = row.get("BEGIN_DATE_TIME", "")
            try:
                begin = datetime.strptime(
                    begin_str, "%d-%b-%y %H:%M:%S").date()
            except ValueError:
                continue

            end_str = row.get("END_DATE_TIME", "")
            try:
                end = datetime.strptime(end_str, "%d-%b-%y %H:%M:%S").date()
            except ValueError:
                end = begin

            mag = row.get("MAGNITUDE", "").strip()
            mag_type = row.get("MAGNITUDE_TYPE", "").strip()
            narrative = (row.get("EVENT_NARRATIVE") or row.get(
                "EPISODE_NARRATIVE") or "").strip()
            if len(narrative) > 300:
                narrative = narrative[:297] + "..."

            events.append({
                "type": etype.title(),
                "begin": begin.isoformat(),
                "end": end.isoformat(),
                "magnitude": f"{mag} {mag_type}".strip() if mag else None,
                "narrative": narrative or None,
            })
    return events


def build_events_index(weeks):
    """
    Download NOAA storm event CSVs for all years covered by weeks, filter to
    Hartford County, and return a dict keyed by YYYY-MM-DD date string.
    """
    if not weeks:
        return {}

    year_min = int(weeks[0][:4])
    year_max = int(weeks[-1][:4])

    print("Fetching NOAA storm events directory...")
    try:
        file_map = list_storm_event_files()
    except Exception as exc:
        print(f"  WARNING: Could not fetch storm events listing: {exc}")
        return {}

    by_date = {}
    for year in range(year_min, year_max + 1):
        if year not in file_map:
            print(f"  No storm events file found for {year}")
            continue
        try:
            raw = download_year(year, file_map[year])
            events = parse_events(raw)
            print(f"  {year}: {len(events)} Hartford County notable events")
            for ev in events:
                for d in date_range_strs(ev["begin"], ev["end"]):
                    by_date.setdefault(d, []).append(ev)
        except Exception as exc:
            print(f"  WARNING: Failed to load {year}: {exc}")

    return by_date


def get_weather_for_week(week_start, events_by_date):
    """
    Collect distinct notable storm events that overlap the given week.
    Returns a weather dict ready for context.json.
    """
    seen = {}   # (type, begin) -> event, for dedup
    for offset in range(7):
        d = (week_start + timedelta(days=offset)).isoformat()
        for ev in events_by_date.get(d, []):
            key = (ev["type"], ev["begin"])
            seen[key] = ev

    event_list = sorted(seen.values(), key=lambda e: e["begin"])

    if event_list:
        types = list(dict.fromkeys(e["type"] for e in event_list))
        summary = "; ".join(types[:3])
        if len(types) > 3:
            summary += f" (+{len(types) - 3} more)"
    else:
        summary = None

    return {
        "events": event_list,
        "significant": bool(event_list),
        "summary": summary,
    }


# -- FRED ECONOMIC -------------------------------------------------------

def fetch_fred_series(series_id):
    if not FRED_API_KEY:
        return {}
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "observation_start": "2019-01-01",
    }
    try:
        r = requests.get(FRED_BASE, params=params, timeout=15)
        r.raise_for_status()
        obs = r.json().get("observations", [])
    except Exception as exc:
        print(f"    FRED error for {series_id}: {exc}")
        return {}

    result = {}
    for o in obs:
        v = o.get("value", ".")
        if v != ".":
            try:
                result[o["date"][:7]] = float(v)
            except (ValueError, KeyError):
                pass
    return result


def build_fred_cache():
    if not FRED_API_KEY:
        return {k: {} for k in FRED_SERIES}
    print("Fetching FRED economic series...")
    cache = {}
    for key, sid in FRED_SERIES.items():
        cache[key] = fetch_fred_series(sid)
        print(f"  {sid}: {len(cache[key])} monthly observations")
        time.sleep(FRED_RETRY_DELAY)
    return cache


def get_economic_for_week(week_start, fred):
    def latest_before(series, ym):
        candidates = [k for k in series if k <= ym]
        return series[max(candidates)] if candidates else None

    ym = to_ym(week_start)
    prior_month = (
        date(
            week_start.year,
            week_start.month,
            1) -
        timedelta(
            days=1))
    ym_prev = to_ym(prior_month)

    cc_now = latest_before(fred.get("consumer_confidence", {}), ym)
    cc_prev = latest_before(fred.get("consumer_confidence", {}), ym_prev)
    unemp = latest_before(fred.get("ct_unemployment", {}), ym)

    trend = None
    if cc_now is not None and cc_prev is not None:
        delta = cc_now - cc_prev
        trend = "rising" if delta > 1.0 else "falling" if delta < -1.0 else "stable"

    return {
        "consumer_confidence": round1(cc_now),
        "ct_unemployment": round1(unemp),
        "confidence_trend": trend,
        "source_month": ym,
    }


# -- MAIN ----------------------------------------------------------------

def main():
    weeks = load_weeks()

    # Load pre-existing context to preserve any hand-edited fields
    context = {}
    if CONTEXT_JSON.exists():
        with open(CONTEXT_JSON, encoding="utf-8") as f:
            context = json.load(f)
        print(f"Loaded existing context.json ({len(context)} weeks)")

    # Bulk-fetch storm events for all years at once
    events_by_date = build_events_index(weeks)

    # Bulk-fetch FRED economic series
    fred = build_fred_cache()

    sig_weeks = 0
    for week_str in weeks:
        week_date = parse_date(week_str)
        weather = get_weather_for_week(week_date, events_by_date)
        economic = get_economic_for_week(week_date, fred)

        context[week_str] = {
            "weather": weather,
            "economic": economic,
        }
        if weather["significant"]:
            sig_weeks += 1

    CONTEXT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(CONTEXT_JSON, "w", encoding="utf-8") as f:
        json.dump(context, f, indent=2, ensure_ascii=False)

    total = len(weeks)
    print()
    print("=" * 60)
    print(f"context.json written: {CONTEXT_JSON}")
    print(f"Total weeks:          {total}")
    print(f"Weeks with events:    {sig_weeks} ({100 * sig_weeks // total}%)")
    cc_ok = sum(
        1 for w in weeks if context.get(
            w,
            {}).get(
            "economic",
            {}).get("consumer_confidence") is not None)
    print(f"Economic coverage:    {cc_ok}/{total}")
    print("=" * 60)


if __name__ == "__main__":
    main()
