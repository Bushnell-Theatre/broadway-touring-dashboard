"""
scrape_context.py — Build src/data/context.json
Bushnell Center for the Performing Arts

Pulls NOAA weather (Hartford Bradley Airport) and FRED economic indicators
for every week_of date in data.json, writing a week-keyed context file that
dashboard tabs can use to annotate performance anomalies.

Usage:
    cd scripts
    python scrape_context.py

Dependencies:
    pip install requests python-dotenv
"""

import json
import os
import sys
import time
import traceback
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv

# ── PATHS ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR   = Path(__file__).parent
REPO_ROOT    = SCRIPT_DIR.parent
DATA_JSON    = REPO_ROOT / "src" / "data" / "data.json"
CONTEXT_JSON = REPO_ROOT / "src" / "data" / "context.json"
ENV_FILE     = REPO_ROOT / ".env"

# ── CONFIG ────────────────────────────────────────────────────────────────────

NOAA_BASE    = "https://www.ncdc.noaa.gov/cdo-web/api/v2/data"
NOAA_STATION = "GHCND:USW00014740"   # Hartford Bradley Airport (KBDL)
NOAA_HEADERS = {"token": "", "User-Agent": "BushnellDashboard/1.0"}
# NOAA CDO does not require an API key for basic data access;
# the token field is left blank intentionally.

FRED_BASE    = "https://api.stlouisfed.org/fred/series/observations"
FRED_SERIES  = {
    "consumer_confidence": "UMCSENT",   # U-Mich Consumer Sentiment (monthly)
    "ct_unemployment":     "CTURN",     # Connecticut Unemployment Rate (monthly)
}

CACHE_SKIP_DAYS   = 90   # skip weeks older than this if already cached
CACHE_REFRESH_DAYS = 60  # always re-fetch weeks within this many days

NOAA_RETRY_DELAY = 1.0   # seconds between NOAA requests (rate limit)
FRED_RETRY_DELAY = 0.3

# ── SETUP ─────────────────────────────────────────────────────────────────────

load_dotenv(ENV_FILE)
FRED_API_KEY = os.getenv("FRED_API_KEY", "")

if not FRED_API_KEY:
    print("WARNING: FRED_API_KEY not found in .env — economic data will be null")


# ── HELPERS ───────────────────────────────────────────────────────────────────

def parse_date(s):
    """Parse YYYY-MM-DD string to date object."""
    return datetime.strptime(s, "%Y-%m-%d").date()


def week_end(week_start: date) -> date:
    """Return the last day of the 7-day window starting at week_start."""
    return week_start + timedelta(days=6)


def to_ym(d: date) -> str:
    """Return YYYY-MM string for monthly lookups."""
    return d.strftime("%Y-%m")


def f_to_tenth(v):
    """Round to one decimal or return None."""
    return round(float(v), 1) if v is not None else None


# ── DATA.JSON — WEEK LIST ─────────────────────────────────────────────────────

def load_weeks() -> list[str]:
    """Return sorted list of distinct week_of dates from data.json."""
    if not DATA_JSON.exists():
        sys.exit(f"ERROR: {DATA_JSON} not found. Run from scripts/ folder.")
    with open(DATA_JSON, encoding="utf-8") as f:
        raw = json.load(f)
    records = raw.get("records", raw) if isinstance(raw, dict) else raw
    weeks = sorted({r["week_of"] for r in records if r.get("week_of")})
    print(f"Found {len(weeks)} distinct weeks in data.json "
          f"({weeks[0]} → {weeks[-1]})")
    return weeks


# ── CACHE ─────────────────────────────────────────────────────────────────────

def load_cache() -> dict:
    if CONTEXT_JSON.exists():
        with open(CONTEXT_JSON, encoding="utf-8") as f:
            data = json.load(f)
        print(f"Loaded existing context.json ({len(data)} weeks cached)")
        return data
    return {}


def should_skip(week_str: str, cache: dict) -> bool:
    """Return True if the week is cached and old enough to skip."""
    if week_str not in cache:
        return False
    today = date.today()
    week_date = parse_date(week_str)
    age_days = (today - week_date).days
    return age_days > CACHE_SKIP_DAYS and age_days > CACHE_REFRESH_DAYS


# ── NOAA WEATHER ──────────────────────────────────────────────────────────────

def fetch_noaa_week(week_start: date) -> dict:
    """
    Pull daily GHCND observations for the week and aggregate to weekly stats.
    Returns a weather dict (all fields may be None if no data available).
    """
    end = week_end(week_start)
    params = {
        "datasetid":  "GHCND",
        "stationid":  NOAA_STATION,
        "startdate":  week_start.isoformat(),
        "enddate":    end.isoformat(),
        "datatypeid": "TMAX,TMIN,PRCP,SNOW",
        "limit":      100,
        "units":      "standard",
    }
    try:
        r = requests.get(NOAA_BASE, params=params, headers=NOAA_HEADERS, timeout=15)
        r.raise_for_status()
        body = r.json()
    except Exception as exc:
        print(f"    NOAA error for {week_start}: {exc}")
        return _empty_weather()

    results = body.get("results", [])
    if not results:
        return _empty_weather()

    tmax_vals, tmin_vals, prcp_sum, snow_sum = [], [], 0.0, 0.0
    for obs in results:
        dt = obs.get("datatype")
        v  = obs.get("value")
        if v is None:
            continue
        v = float(v)
        if dt == "TMAX":
            tmax_vals.append(v)
        elif dt == "TMIN":
            tmin_vals.append(v)
        elif dt == "PRCP":
            prcp_sum += v
        elif dt == "SNOW":
            snow_sum += v

    tmax = max(tmax_vals) if tmax_vals else None
    tmin = min(tmin_vals) if tmin_vals else None
    # NOAA standard units: temperature in °F (tenths), precip/snow in inches (tenths)
    # CDO /data with units=standard returns tenths for temp, hundredths for precip
    # Divide accordingly:
    tmax_f     = f_to_tenth(tmax / 10) if tmax is not None else None
    tmin_f     = f_to_tenth(tmin / 10) if tmin is not None else None
    precip_in  = f_to_tenth(prcp_sum / 100)
    snow_in    = f_to_tenth(snow_sum / 10)

    significant = bool(
        (snow_in  is not None and snow_in  >= 1.0) or
        (precip_in is not None and precip_in >= 0.5)
    )
    summary = _weather_summary(tmax_f, tmin_f, precip_in, snow_in)

    return {
        "station":    "Hartford Bradley Airport (KBDL)",
        "tmax_f":     tmax_f,
        "tmin_f":     tmin_f,
        "precip_in":  precip_in,
        "snow_in":    snow_in,
        "significant": significant,
        "summary":    summary,
    }


def _empty_weather() -> dict:
    return {
        "station":    "Hartford Bradley Airport (KBDL)",
        "tmax_f":     None,
        "tmin_f":     None,
        "precip_in":  None,
        "snow_in":    None,
        "significant": False,
        "summary":    None,
    }


def _weather_summary(tmax, tmin, precip, snow) -> str | None:
    parts = []
    if snow is not None and snow >= 1.0:
        parts.append(f"Snow event — {snow}in accumulation")
    elif snow is not None and snow > 0:
        parts.append(f"Trace snow — {snow}in")
    if precip is not None and precip >= 0.5 and (snow is None or snow < 1.0):
        parts.append(f"Heavy rain — {precip}in")
    elif precip is not None and 0.1 <= precip < 0.5 and not parts:
        parts.append(f"Light precipitation — {precip}in")
    if tmax is not None and tmax <= 20:
        parts.append(f"Extreme cold (max {tmax}°F)")
    elif tmax is not None and tmax >= 95:
        parts.append(f"Extreme heat (max {tmax}°F)")
    return "; ".join(parts) if parts else None


# ── FRED ECONOMIC ─────────────────────────────────────────────────────────────

def fetch_fred_series(series_id: str) -> dict[str, float]:
    """
    Return dict of {YYYY-MM: value} for all available observations.
    Returns empty dict if FRED key is missing or request fails.
    """
    if not FRED_API_KEY:
        return {}
    params = {
        "series_id":        series_id,
        "api_key":          FRED_API_KEY,
        "file_type":        "json",
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
                ym = o["date"][:7]   # YYYY-MM
                result[ym] = float(v)
            except (ValueError, KeyError):
                pass
    return result


def build_fred_cache() -> dict[str, dict[str, float]]:
    """Fetch all FRED series once and return as {series_key: {YYYY-MM: value}}."""
    if not FRED_API_KEY:
        return {k: {} for k in FRED_SERIES}
    print("Fetching FRED economic series...")
    cache = {}
    for key, sid in FRED_SERIES.items():
        cache[key] = fetch_fred_series(sid)
        print(f"  {sid}: {len(cache[key])} monthly observations")
        time.sleep(FRED_RETRY_DELAY)
    return cache


def get_economic_for_week(week_start: date, fred: dict[str, dict]) -> dict:
    """
    Map a week_of date to the most recent available monthly FRED observation.
    """
    def latest_at_or_before(series_data: dict, ym: str):
        """Return the most recent value with key <= ym."""
        candidates = [k for k in series_data if k <= ym]
        if not candidates:
            return None
        return series_data[max(candidates)]

    ym_current = to_ym(week_start)
    # Prior month for trend comparison
    first_of_month = date(week_start.year, week_start.month, 1)
    prior = first_of_month - timedelta(days=1)
    ym_prior = to_ym(prior)

    cc_series  = fred.get("consumer_confidence", {})
    unemp_series = fred.get("ct_unemployment",  {})

    cc_now   = latest_at_or_before(cc_series,    ym_current)
    cc_prev  = latest_at_or_before(cc_series,    ym_prior)
    unemp    = latest_at_or_before(unemp_series, ym_current)

    # Trend: rising / falling / stable (within 1 point)
    trend = None
    if cc_now is not None and cc_prev is not None:
        delta = cc_now - cc_prev
        if delta > 1.0:
            trend = "rising"
        elif delta < -1.0:
            trend = "falling"
        else:
            trend = "stable"

    return {
        "consumer_confidence": f_to_tenth(cc_now)  if cc_now  is not None else None,
        "ct_unemployment":     f_to_tenth(unemp)   if unemp   is not None else None,
        "confidence_trend":    trend,
        "source_month":        ym_current,
    }


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    today = date.today()
    weeks = load_weeks()
    context = load_cache()
    fred = build_fred_cache()

    weather_hit = 0
    econ_hit    = 0
    processed   = 0
    skipped     = 0

    for week_str in weeks:
        if should_skip(week_str, context):
            skipped += 1
            continue

        week_date = parse_date(week_str)
        age_days  = (today - week_date).days
        processed += 1

        print(f"  {week_str}  (age {age_days}d) ...", end=" ", flush=True)

        # ── Weather ──────────────────────────────────────────────────────────
        try:
            weather = fetch_noaa_week(week_date)
            time.sleep(NOAA_RETRY_DELAY)
        except Exception:
            print(f"\n    Unexpected weather error:\n{traceback.format_exc()}")
            weather = _empty_weather()

        if weather.get("tmax_f") is not None:
            weather_hit += 1
            tag = weather["summary"] or f"max {weather['tmax_f']}°F"
        else:
            tag = "no weather data"

        # ── Economic ─────────────────────────────────────────────────────────
        try:
            economic = get_economic_for_week(week_date, fred)
        except Exception:
            print(f"\n    Unexpected econ error:\n{traceback.format_exc()}")
            economic = {k: None for k in
                        ["consumer_confidence", "ct_unemployment",
                         "confidence_trend", "source_month"]}

        if economic.get("consumer_confidence") is not None:
            econ_hit += 1

        # ── Merge into context ────────────────────────────────────────────────
        context[week_str] = {
            "weather":  weather,
            "economic": economic,
        }

        print(f"weather={tag}  |  econ cc={economic.get('consumer_confidence')} "
              f"unemp={economic.get('ct_unemployment')}")

    # ── Write output ──────────────────────────────────────────────────────────
    CONTEXT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(CONTEXT_JSON, "w", encoding="utf-8") as f:
        json.dump(context, f, indent=2, ensure_ascii=False)

    total = len(weeks)
    print()
    print("=" * 60)
    print(f"context.json written → {CONTEXT_JSON}")
    print(f"Total weeks:        {total}")
    print(f"Processed:          {processed}   Skipped (cached): {skipped}")
    if processed:
        print(f"Weather coverage:   {weather_hit}/{processed} "
              f"({100*weather_hit//processed}%)")
        print(f"Economic coverage:  {econ_hit}/{processed} "
              f"({100*econ_hit//processed}%)")
    print("=" * 60)


if __name__ == "__main__":
    main()
