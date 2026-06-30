#!/usr/bin/env python3
"""
build_media_signals.py
----------------------
Builds a conservative public-media enrichment layer from curated public-source
records. This script does not perform open-ended search. Instead, it accepts
known public source URLs/headlines/summaries, optionally fetches page text, and
rolls them into source-backed media signals.

Inputs:
  src/data/media_sources.json   (curated list of public-source items)
  src/data/title_aliases.json   (optional title normalization)

Outputs:
  src/data/media_signals.json

Optional merge target:
  src/data/shows.json

Example:
  python scripts/build_media_signals.py --merge-shows
  python scripts/build_media_signals.py --fetch --merge-shows
"""
from __future__ import annotations

import argparse
import html
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"
SOURCES_JSON = DATA_DIR / "media_sources.json"
SIGNALS_OUT = DATA_DIR / "media_signals.json"
SHOWS_JSON = DATA_DIR / "shows.json"
ALIASES_JSON = DATA_DIR / "title_aliases.json"
USER_AGENT = "BushnellDashboard/1.0 (broadway-touring-dashboard; contact: broadway@bushnell.org)"

PUBLISHER_WEIGHTS = {
    "official": 5,
    "playbill": 4,
    "broadway.com": 4,
    "new york times": 4,
    "nyt": 4,
    "variety": 4,
    "deadline": 3,
    "theatermania": 3,
    "broadwayworld": 2,
    "local": 3,
}

KEYWORDS = {
    "positive": ["rave", "acclaim", "praised", "hit", "beloved", "breakout", "winner", "sold out", "strong reviews", "critical success"],
    "negative": ["controversy", "controversial", "lawsuit", "backlash", "poor reviews", "closing early", "criticized", "cancelled", "canceled"],
    "tour_confirmed": ["national tour", "touring", "tour launches", "tour will launch", "on tour", "north american tour", "u.s. tour"],
    "family": ["family", "family-friendly", "all ages", "kids", "children"],
    "younger": ["younger audiences", "gen z", "teen", "students", "youth"],
    "subscriber": ["classic", "revival", "beloved", "traditional", "broadway favorite", "audience favorite"],
    "edgy": ["mature", "explicit", "edgy", "dark", "adult themes", "content advisory"],
    "local": ["hartford", "connecticut", "ct ", "bushnell", "new england", "local"],
    "ip": ["based on", "adaptation", "film", "movie", "novel", "brand", "franchise"],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_title(value: str) -> str:
    text = html.unescape(str(value or "")).strip().lower().replace("&", " and ")
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if text.startswith("the "):
        text = text[4:]
    return text


def clean_text(value: str) -> str:
    value = html.unescape(value or "")
    value = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.I)
    value = re.sub(r"<style[\s\S]*?</style>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def load_aliases() -> Dict[str, str]:
    if not ALIASES_JSON.exists():
        return {}
    raw = json.loads(ALIASES_JSON.read_text(encoding="utf-8"))
    return {normalize_title(k): normalize_title(v) for k, v in raw.items()}


def canonical_key(title: str, aliases: Optional[Dict[str, str]] = None) -> str:
    key = normalize_title(title)
    return (aliases or {}).get(key, key)


def ensure_media_sources_template() -> None:
    if SOURCES_JSON.exists():
        return
    SOURCES_JSON.write_text(json.dumps({
        "notes": [
            "Curate public media items here. Use official/primary sources for tour announcements where possible.",
            "Do not use this file for official award counts; use awards.json for award bodies.",
        ],
        "records": [
            {
                "show": "Example Show",
                "source_url": "https://example.com/article",
                "publisher": "Playbill",
                "published_date": "2026-01-01",
                "headline": "Example Show launches North American tour",
                "summary": "Public-source summary or excerpt written in your own words.",
                "source_type": "tour_announcement"
            }
        ]
    }, indent=2), encoding="utf-8")


def fetch_page_text(url: str) -> str:
    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"}, timeout=20)
        if resp.status_code != 200:
            return ""
        return clean_text(resp.text)[:6000]
    except Exception:
        return ""


def keyword_hits(text: str, keys: List[str]) -> List[str]:
    low = text.lower()
    return [k for k in keys if k.lower() in low]


def source_weight(item: dict) -> int:
    p = str(item.get("publisher") or item.get("source_type") or "").lower()
    for key, weight in PUBLISHER_WEIGHTS.items():
        if key in p:
            return weight
    return 2


def label_from_score(score: int, low="Low", mid="Moderate", high="High") -> str:
    if score >= 60:
        return high
    if score >= 25:
        return mid
    if score > 0:
        return low
    return "Unknown"


def classify_show(items: List[dict]) -> dict:
    awareness_score = min(100, sum(source_weight(i) * 8 for i in items))
    positive = []
    negative = []
    tour = []
    fit_tags = defaultdict(int)
    local = []
    drivers = []
    for item in items:
        text = " ".join(str(item.get(k) or "") for k in ["headline", "summary", "page_text", "source_type", "publisher"])
        pos = keyword_hits(text, KEYWORDS["positive"])
        neg = keyword_hits(text, KEYWORDS["negative"])
        tr = keyword_hits(text, KEYWORDS["tour_confirmed"])
        if pos:
            positive.append(item)
        if neg:
            negative.append(item)
        if tr or str(item.get("source_type", "")).lower() == "tour_announcement":
            tour.append(item)
        for tag in ["family", "younger", "subscriber", "edgy", "ip"]:
            if keyword_hits(text, KEYWORDS[tag]):
                fit_tags[tag] += 1
        if keyword_hits(text, KEYWORDS["local"]):
            local.append(item)
        if item.get("headline"):
            drivers.append(str(item["headline"])[:140])

    risk_score = min(100, len(negative) * 35)
    press_label = label_from_score(awareness_score)
    critical = "Positive" if len(positive) > len(negative) and positive else "Negative / Watch" if negative else "Mixed / Unknown"
    tour_label = "Confirmed" if tour else "Unknown"
    risk_label = "High" if risk_score >= 60 else "Moderate" if risk_score >= 25 else "Low" if items else "Unknown"

    audience_tags = []
    tag_names = {
        "family": "Family-friendly",
        "younger": "Younger-audience potential",
        "subscriber": "Subscriber-friendly",
        "edgy": "Mature / edgy",
        "ip": "Known IP / adaptation",
    }
    for tag, count in sorted(fit_tags.items(), key=lambda kv: (-kv[1], kv[0])):
        audience_tags.append(tag_names.get(tag, tag))

    return {
        "press_awareness": {"value": awareness_score, "label": press_label, "drivers": drivers[:5]},
        "critical_reception": {"label": critical, "positive_source_count": len(positive), "risk_source_count": len(negative)},
        "tour_viability": {"label": tour_label, "source_count": len(tour)},
        "reputation_risk": {"value": risk_score, "label": risk_label, "drivers": [i.get("headline") for i in negative[:5] if i.get("headline")]},
        "audience_fit": {"label": ", ".join(audience_tags[:3]) if audience_tags else "Unknown", "tags": audience_tags},
        "local_market": {"label": "Relevant" if local else "Unknown", "source_count": len(local)},
        "source_count": len(items),
    }


def build_payload(fetch: bool = False) -> dict:
    ensure_media_sources_template()
    aliases = load_aliases()
    raw = json.loads(SOURCES_JSON.read_text(encoding="utf-8"))
    records = raw.get("records", raw if isinstance(raw, list) else [])
    normalized = []
    grouped = defaultdict(list)
    for item in records:
        if not item or not item.get("show") or str(item.get("show")).lower().startswith("example"):
            continue
        item = dict(item)
        if fetch and item.get("source_url") and not item.get("page_text"):
            item["page_text"] = fetch_page_text(item["source_url"])
        item["show_key"] = canonical_key(item.get("show", ""), aliases)
        normalized.append(item)
        grouped[item["show_key"]].append(item)

    summary = {show_key: classify_show(items) for show_key, items in grouped.items()}
    return {
        "generated_at": now_iso(),
        "records": normalized,
        "summary_by_show": summary,
        "notes": [
            "Media signals are public-source context, not official award counts or financial performance.",
            "Use multiple reputable sources for reputation-risk conclusions.",
        ],
    }


def merge_into_shows(payload: dict) -> int:
    if not SHOWS_JSON.exists():
        return 0
    aliases = load_aliases()
    shows = json.loads(SHOWS_JSON.read_text(encoding="utf-8"))
    summary = payload.get("summary_by_show", {})
    changed = 0
    for rec in shows:
        key = canonical_key(rec.get("name") or rec.get("show") or rec.get("league_name") or "", aliases)
        sig = summary.get(key)
        if not sig:
            continue
        rec.setdefault("signals", {})["media"] = sig
        rec.setdefault("sources", {})["media_signals"] = "media_signals.json"
        changed += 1
    SHOWS_JSON.write_text(json.dumps(shows, indent=2, ensure_ascii=False), encoding="utf-8")
    return changed


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="Fetch page text for source URLs before classifying")
    ap.add_argument("--merge-shows", "--merge", action="store_true", help="Merge media signal rollups into shows.json")
    args = ap.parse_args(argv)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = build_payload(fetch=args.fetch)
    SIGNALS_OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(payload.get('records', []))} media source records to {SIGNALS_OUT}")
    if args.merge_shows:
        changed = merge_into_shows(payload)
        print(f"Merged media signals into {changed} shows in {SHOWS_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
