#!/usr/bin/env python3
"""
build_awards.py
---------------
Builds a normalized awards dataset for Broadway touring intelligence.

Primary output:
  src/data/awards.json

Optional merge target:
  src/data/shows.json

Supported award bodies are intentionally source-aware. Official/primary sources
should be preferred. The parser is HTML-tolerant but conservative: if a source
layout changes, it writes partial data rather than guessing.

Examples:
  python scripts/build_awards.py --all --years 2016-2026 --merge-shows
  python scripts/build_awards.py --source tony --years 2024,2025 --refresh --merge-shows
  python scripts/build_awards.py --input-html tony:2025:downloads/tony-2025.html --merge-shows
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"
CACHE_DIR = ROOT / "scripts" / "cache" / "awards"
AWARDS_OUT = DATA_DIR / "awards.json"
SHOWS_JSON = DATA_DIR / "shows.json"
ALIASES_JSON = DATA_DIR / "title_aliases.json"

USER_AGENT = "BushnellDashboard/1.0 (broadway-touring-dashboard; contact: broadway@bushnell.org)"

AWARD_BODIES = {
    "tony": {
        "display": "Tony Awards",
        "kind": "broadway_production",
        "url": "https://www.tonyawards.com/nominees/year/{year}/category/any/show/any/",
    },
    "olivier": {
        "display": "Olivier Awards",
        "kind": "west_end_london",
        "url": "https://officiallondontheatre.com/olivier-awards/winners/olivier-winners-{year}/",
    },
    "drama_desk": {
        "display": "Drama Desk Awards",
        "kind": "critical_theatre_field",
        "url": "https://dramadesks.com/{year}-awards/",
    },
    "grammy": {
        "display": "Grammy Awards",
        "kind": "cast_album_music",
        "url": "https://www.grammy.com/awards/categories/best-musical-theater-album",
    },
}

DEFAULT_YEARS = list(range(datetime.now().year, datetime.now().year - 11, -1))

CATEGORY_HINTS = {
    "tony": ["best musical", "best revival", "best book", "best original score", "best performance", "best direction", "best choreography", "best scenic", "best costume", "best lighting", "best sound", "best orchestrations"],
    "olivier": ["best new musical", "best musical revival", "best actor", "best actress", "best director", "best theatre choreographer", "outstanding musical contribution"],
    "drama_desk": ["outstanding musical", "outstanding revival", "outstanding book", "outstanding music", "outstanding lyrics", "outstanding director", "outstanding choreography"],
    "grammy": ["best musical theater album"],
}

TITLE_STOPWORDS = {
    "winner", "nominee", "nominees", "nominated", "award", "awards", "category",
    "musical", "theater", "theatre", "broadway", "production", "original cast recording",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_title(value: str) -> str:
    text = html.unescape(str(value or "")).strip().lower()
    text = re.sub(r"\([^)]*\)", " ", text)
    text = text.replace("&", " and ")
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
    value = re.sub(r"\s+", " ", value).strip()
    return value


def load_aliases() -> Dict[str, str]:
    if not ALIASES_JSON.exists():
        return {}
    raw = json.loads(ALIASES_JSON.read_text(encoding="utf-8"))
    aliases = {}
    for k, v in raw.items():
        aliases[normalize_title(k)] = normalize_title(v)
    return aliases


def canonical_key(title: str, aliases: Optional[Dict[str, str]] = None) -> str:
    key = normalize_title(title)
    aliases = aliases or {}
    return aliases.get(key, key)


@dataclass
class AwardRecord:
    show: str
    show_key: str
    award_body: str
    award_body_key: str
    award_year: int
    category: str
    result: str  # winner | nominee
    source_url: str
    source_type: str = "official"
    confidence: str = "medium"
    notes: str = ""

    def as_dict(self):
        return {
            "show": self.show,
            "show_key": self.show_key,
            "award_body": self.award_body,
            "award_body_key": self.award_body_key,
            "award_year": self.award_year,
            "category": self.category,
            "result": self.result,
            "source_url": self.source_url,
            "source_type": self.source_type,
            "confidence": self.confidence,
            "notes": self.notes,
        }


def parse_years(raw: str) -> List[int]:
    if not raw:
        return DEFAULT_YEARS
    out = []
    for part in str(raw).split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            a, b = [int(x) for x in part.split('-', 1)]
            step = 1 if b >= a else -1
            out.extend(range(a, b + step, step))
        else:
            out.append(int(part))
    return sorted(set(out), reverse=True)


def cache_path(source: str, year: int, url: str) -> Path:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return CACHE_DIR / source / f"{year}-{digest}.html"


def fetch_html(source: str, year: int, url: str, refresh: bool = False, sleep: float = 0.5) -> Optional[str]:
    path = cache_path(source, year, url)
    if path.exists() and not refresh:
        return path.read_text(encoding="utf-8", errors="ignore")
    try:
        print(f"Fetching {source} {year}: {url}")
        resp = requests.get(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"}, timeout=25)
        if resp.status_code != 200:
            print(f"  HTTP {resp.status_code}; skipping")
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(resp.text, encoding="utf-8")
        if sleep:
            time.sleep(sleep)
        return resp.text
    except Exception as exc:
        print(f"  Fetch failed: {exc}")
        return None


def likely_title(text: str) -> bool:
    t = normalize_title(text)
    if not t or len(t) < 2 or len(t) > 80:
        return False
    words = t.split()
    if all(w in TITLE_STOPWORDS for w in words):
        return False
    if len(words) > 9:
        return False
    return True


def find_category_near(text: str, index: int, source: str) -> str:
    window = text[max(0, index - 600):index + 200]
    low = window.lower()
    for hint in CATEGORY_HINTS.get(source, []):
        if hint in low:
            # Return display-ish category from source text if possible.
            m = re.search(r"(?i)(best|outstanding)[a-z0-9 ,:'’&\-]+", window)
            if m:
                return clean_text(m.group(0))[:120]
            return hint.title()
    return AWARD_BODIES[source]["display"]


def parse_tony(html_text: str, year: int, url: str, aliases: Dict[str, str]) -> List[AwardRecord]:
    """Parse official Tony archive HTML. Conservative but catches common nominee card patterns."""
    records: List[AwardRecord] = []
    # First, parse structured snippets around nominee/show cards.
    card_re = re.compile(r"(?is)<(?:article|div|li)[^>]*(?:nominee|award|show|card|winner)[^>]*>(.*?)</(?:article|div|li)>")
    chunks = card_re.findall(html_text)
    if not chunks:
        chunks = re.split(r"(?i)category|nominee|winner", html_text)
    seen = set()
    for chunk in chunks:
        text = clean_text(chunk)
        if len(text) < 3:
            continue
        result = "winner" if re.search(r"(?i)winner|won", text) else "nominee"
        category = find_category_near(clean_text(html_text), max(0, clean_text(html_text).lower().find(text[:40].lower())), "tony")
        # Common official pages include show titles in links/spans; pull quoted/title-case fragments.
        candidates = re.findall(r"(?is)<(?:h[1-6]|a|span|strong|em)[^>]*>(.*?)</(?:h[1-6]|a|span|strong|em)>", chunk)
        if not candidates:
            candidates = [text]
        for cand in candidates:
            title = clean_text(cand)
            if not likely_title(title):
                continue
            low = title.lower()
            if any(x in low for x in ["tony award", "nominees", "winners", "category", "view all"]):
                continue
            key = (canonical_key(title, aliases), year, category, result)
            if key in seen:
                continue
            seen.add(key)
            records.append(AwardRecord(title, canonical_key(title, aliases), "Tony Awards", "tony", year, category, result, url, confidence="medium"))
    return records


def parse_generic(html_text: str, source: str, year: int, url: str, aliases: Dict[str, str]) -> List[AwardRecord]:
    """Generic official-page award parser for Olivier/Drama Desk/Grammy pages."""
    body = AWARD_BODIES[source]
    text = clean_text(html_text)
    records: List[AwardRecord] = []
    seen = set()

    # Search for winner markers and nearby titles.
    patterns = [
        r"(?is)(winner|won)[:\s\-–]+([^<\n\r]{2,100})",
        r"(?is)(nominee|nominated)[:\s\-–]+([^<\n\r]{2,100})",
        r"(?is)<(?:strong|b|em|a|h[1-6])[^>]*>(.*?)</(?:strong|b|em|a|h[1-6])>",
    ]
    for pat in patterns:
        for m in re.finditer(pat, html_text):
            raw = m.group(2) if m.lastindex and m.lastindex >= 2 else m.group(1)
            title = clean_text(raw)
            if not likely_title(title):
                continue
            low = normalize_title(title)
            if any(w in low for w in ["award", "category", "nomination", "winner", "official", "privacy"]):
                continue
            result = "winner" if re.search(r"(?i)winner|won", m.group(0)) else "nominee"
            category = find_category_near(text, max(0, text.lower().find(clean_text(m.group(0))[:40].lower())), source)
            key = (canonical_key(title, aliases), year, category, result)
            if key in seen:
                continue
            seen.add(key)
            records.append(AwardRecord(title, canonical_key(title, aliases), body["display"], source, year, category, result, url, confidence="low"))
    return records


def parse_source_html(source: str, year: int, html_text: str, url: str, aliases: Dict[str, str]) -> List[AwardRecord]:
    if source == "tony":
        return parse_tony(html_text, year, url, aliases)
    return parse_generic(html_text, source, year, url, aliases)


def build_summary(records: List[dict]) -> Dict[str, dict]:
    summary = defaultdict(lambda: defaultdict(lambda: {"nominations": 0, "wins": 0, "categories": [], "years": [], "drivers": []}))
    for r in records:
        key = r["show_key"]
        body = r["award_body_key"]
        bucket = summary[key][body]
        if r["result"] == "winner":
            bucket["wins"] += 1
            bucket["nominations"] += 1
        else:
            bucket["nominations"] += 1
        if r["category"] and r["category"] not in bucket["categories"]:
            bucket["categories"].append(r["category"])
        if r["award_year"] not in bucket["years"]:
            bucket["years"].append(r["award_year"])
    out = {}
    for show_key, bodies in summary.items():
        out[show_key] = {}
        for body, vals in bodies.items():
            vals["years"] = sorted(vals["years"], reverse=True)
            vals["drivers"] = []
            if vals["wins"]:
                vals["drivers"].append(f"{AWARD_BODIES.get(body, {}).get('display', body)} winner")
            elif vals["nominations"]:
                vals["drivers"].append(f"{AWARD_BODIES.get(body, {}).get('display', body)} nominee")
            out[show_key][body] = vals
    return out


def recognition_signal(award_summary: dict) -> dict:
    score = 0
    drivers = []
    weights = {
        "tony": {"win": 12, "nom": 3, "max": 45},
        "olivier": {"win": 8, "nom": 2, "max": 25},
        "drama_desk": {"win": 6, "nom": 2, "max": 20},
        "grammy": {"win": 6, "nom": 2, "max": 15},
    }
    for body, vals in (award_summary or {}).items():
        w = weights.get(body, {"win": 4, "nom": 1, "max": 10})
        subtotal = min(w["max"], vals.get("wins", 0) * w["win"] + max(0, vals.get("nominations", 0) - vals.get("wins", 0)) * w["nom"])
        score += subtotal
        if vals.get("wins"):
            drivers.append(f"{AWARD_BODIES.get(body, {}).get('display', body)}: {vals['wins']} wins / {vals.get('nominations', 0)} nominations")
        elif vals.get("nominations"):
            drivers.append(f"{AWARD_BODIES.get(body, {}).get('display', body)}: {vals.get('nominations', 0)} nominations")
    score = min(100, score)
    label = "High" if score >= 60 else "Moderate" if score >= 25 else "Limited" if score > 0 else "Unknown"
    return {"value": score, "label": label, "drivers": drivers}


def merge_into_shows(awards_payload: dict) -> int:
    if not SHOWS_JSON.exists():
        print(f"No {SHOWS_JSON}; skipping shows.json merge")
        return 0
    shows = json.loads(SHOWS_JSON.read_text(encoding="utf-8"))
    aliases = load_aliases()
    summary = awards_payload.get("summary_by_show", {})
    changed = 0
    for rec in shows:
        key = canonical_key(rec.get("name") or rec.get("show") or rec.get("league_name") or "", aliases)
        award_summary = summary.get(key)
        if not award_summary:
            continue
        rec["awards"] = award_summary
        rec.setdefault("signals", {})["recognition"] = recognition_signal(award_summary)
        tony = award_summary.get("tony") or {}
        if tony:
            rec["tony_nominations"] = int(tony.get("nominations", rec.get("tony_nominations", 0)) or 0)
            rec["tony_wins"] = int(tony.get("wins", rec.get("tony_wins", 0)) or 0)
            rec.setdefault("sources", {})["tony_nominations"] = "awards.json"
            rec.setdefault("sources", {})["tony_wins"] = "awards.json"
        rec.setdefault("sources", {})["awards"] = "awards.json"
        changed += 1
    SHOWS_JSON.write_text(json.dumps(shows, indent=2, ensure_ascii=False), encoding="utf-8")
    return changed


def load_existing_awards() -> List[dict]:
    if not AWARDS_OUT.exists():
        return []
    raw = json.loads(AWARDS_OUT.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        return raw.get("records", [])
    return raw if isinstance(raw, list) else []


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=list(AWARD_BODIES), action="append", help="Award source to fetch; repeatable")
    ap.add_argument("--all", action="store_true", help="Fetch all configured award sources")
    ap.add_argument("--years", default=",".join(str(y) for y in DEFAULT_YEARS), help="Years like 2016-2026 or 2024,2025")
    ap.add_argument("--refresh", action="store_true", help="Re-fetch cached official pages")
    ap.add_argument("--merge-shows", "--merge", action="store_true", help="Merge award rollups into shows.json")
    ap.add_argument("--show", help="Only keep records matching this canonical show name")
    ap.add_argument("--input-html", action="append", default=[], metavar="SOURCE:YEAR:FILE", help="Parse a saved official HTML page")
    args = ap.parse_args(argv)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    aliases = load_aliases()
    years = parse_years(args.years)
    sources = list(AWARD_BODIES) if args.all or not args.source else args.source

    records: List[dict] = []
    for spec in args.input_html:
        try:
            source, year_s, file_s = spec.split(":", 2)
            year = int(year_s)
            text = Path(file_s).read_text(encoding="utf-8", errors="ignore")
            url = f"local://{file_s}"
            parsed = parse_source_html(source, year, text, url, aliases)
            records.extend([p.as_dict() for p in parsed])
        except Exception as exc:
            print(f"Could not parse --input-html {spec}: {exc}")

    for source in sources:
        conf = AWARD_BODIES[source]
        source_years = years if source != "grammy" else [max(years)]
        for year in source_years:
            url = conf["url"].format(year=year)
            html_text = fetch_html(source, year, url, refresh=args.refresh)
            if not html_text:
                continue
            parsed = parse_source_html(source, year, html_text, url, aliases)
            print(f"  Parsed {len(parsed)} {conf['display']} records for {year}")
            records.extend([p.as_dict() for p in parsed])

    # Deduplicate and optionally filter.
    seen = set()
    deduped = []
    show_filter = canonical_key(args.show, aliases) if args.show else None
    for r in records:
        if show_filter and r.get("show_key") != show_filter:
            continue
        key = (r.get("show_key"), r.get("award_body_key"), r.get("award_year"), r.get("category"), r.get("result"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)

    payload = {
        "generated_at": now_iso(),
        "source_count": len(sources),
        "records": sorted(deduped, key=lambda r: (r["show_key"], r["award_body_key"], -int(r["award_year"]), r["category"], r["result"])),
        "summary_by_show": build_summary(deduped),
        "notes": [
            "Award counts are source-derived and title-normalized through title_aliases.json.",
            "Use official award sites as primary sources. Public media should not override official award counts.",
        ],
    }
    AWARDS_OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(deduped)} award records to {AWARDS_OUT}")

    if args.merge_shows:
        changed = merge_into_shows(payload)
        print(f"Merged awards into {changed} shows in {SHOWS_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
