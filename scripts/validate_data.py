"""Validate dashboard JSON data and write a machine-readable report.

This does not mutate data.json. It is safe to run after append/rebuild and is
intended to make known data conditions visible to the app and maintainers.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from dashboard_config import DATA_JSON, PEERS_JSON, SEASONS_JSON, VALIDATION_JSON
except Exception:  # pragma: no cover - direct path fallback
    DATA_JSON = Path("src/data/data.json")
    PEERS_JSON = Path("src/data/peers.json")
    SEASONS_JSON = Path("src/data/seasons.json")
    VALIDATION_JSON = Path("src/data/validation_report.json")

REQUIRED_FIELDS = [
    "week_of", "tier", "show", "theatre", "city", "gross_gross",
    "gross_potential", "gg_pct_gp", "paid_tix", "total_tix", "capacity",
    "cap_paid", "cap_total", "on_sub", "avg_adm", "venue_sellable",
    "similar_bushnell", "non_equity", "no_engagement", "canonical_key",
]


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def records_from(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        recs = raw.get("records", [])
        return recs if isinstance(recs, list) else []
    return []


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and value == value


def pct_over(records: list[dict[str, Any]], field: str, threshold: float = 100.0) -> list[dict[str, Any]]:
    return [r for r in records if is_number(r.get(field)) and float(r[field]) > threshold]


def fiscal_year(week: str) -> str | None:
    try:
        year = int(week[:4])
        month = int(week[5:7])
    except Exception:
        return None
    start = year if month >= 7 else year - 1
    return f"{start}-{start + 1}"


def validate(data_path: Path, peers_path: Path, seasons_path: Path) -> dict[str, Any]:
    raw = load_json(data_path, {})
    records = records_from(raw)
    keys = [r.get("canonical_key") for r in records if r.get("canonical_key")]
    key_counts = Counter(keys)
    duplicate_keys = sorted(k for k, n in key_counts.items() if n > 1)

    missing_by_field = {field: 0 for field in REQUIRED_FIELDS}
    for r in records:
        for field in REQUIRED_FIELDS:
            if field not in r or r.get(field) in (None, ""):
                missing_by_field[field] += 1

    invalid_dates = []
    season_counts = Counter()
    for r in records:
        week = str(r.get("week_of", ""))
        try:
            datetime.strptime(week, "%Y-%m-%d")
        except Exception:
            invalid_dates.append({"canonical_key": r.get("canonical_key"), "week_of": r.get("week_of")})
        fy = fiscal_year(week)
        if fy:
            season_counts[fy] += 1

    cap_paid_over = pct_over(records, "cap_paid")
    cap_total_over = pct_over(records, "cap_total")
    gg_over = pct_over(records, "gg_pct_gp")
    gross_over = [
        r for r in records
        if is_number(r.get("gross_gross")) and is_number(r.get("gross_potential"))
        and float(r["gross_potential"]) > 0 and float(r["gross_gross"]) > float(r["gross_potential"])
    ]

    venue_keys = {(r.get("theatre"), r.get("city")) for r in records if r.get("theatre") and r.get("city")}
    peers_raw = load_json(peers_path, {})
    peer_venues = peers_raw.get("venues", peers_raw if isinstance(peers_raw, list) else [])
    peer_keys = {(v.get("theatre"), v.get("city")) for v in peer_venues if isinstance(v, dict)}

    seasons_raw = load_json(seasons_path, {})
    season_show_counts = {}
    if isinstance(seasons_raw, dict):
        for sid, val in seasons_raw.items():
            shows = val.get("shows", []) if isinstance(val, dict) else val
            season_show_counts[sid] = len(shows or [])

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": str(data_path),
        "summary": {
            "record_count": len(records),
            "unique_canonical_keys": len(key_counts),
            "duplicate_canonical_key_count": len(duplicate_keys),
            "unique_shows": len({r.get("show") for r in records if r.get("show")}),
            "unique_theatre_city_pairs": len(venue_keys),
            "peer_venue_matches": len(venue_keys & peer_keys),
            "season_counts": dict(sorted(season_counts.items())),
        },
        "missing_by_field": missing_by_field,
        "exceptions": {
            "invalid_date_count": len(invalid_dates),
            "cap_paid_over_100_count": len(cap_paid_over),
            "cap_total_over_100_count": len(cap_total_over),
            "gg_pct_gp_over_100_count": len(gg_over),
            "gross_over_potential_count": len(gross_over),
            "no_engagement_count": sum(1 for r in records if r.get("no_engagement")),
        },
        "samples": {
            "duplicate_canonical_keys": duplicate_keys[:25],
            "invalid_dates": invalid_dates[:25],
            "cap_paid_over_100": [r.get("canonical_key") for r in cap_paid_over[:25]],
            "gg_pct_gp_over_100": [r.get("canonical_key") for r in gg_over[:25]],
        },
        "season_show_counts": season_show_counts,
        "notes": [
            "Capacity and gross-potential values above 100 may be valid Broadway League reporting conditions; they are retained and surfaced here for audit visibility.",
            "Revenue metrics in the dashboard describe revenue quality, not net profit, until deal terms and local expenses are added.",
        ],
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate dashboard JSON files.")
    parser.add_argument("--data", default=str(DATA_JSON), help="Path to data.json")
    parser.add_argument("--peers", default=str(PEERS_JSON), help="Path to peers.json")
    parser.add_argument("--seasons", default=str(SEASONS_JSON), help="Path to seasons.json")
    parser.add_argument("--out", default=str(VALIDATION_JSON), help="Path for validation_report.json")
    args = parser.parse_args()

    report = validate(Path(args.data), Path(args.peers), Path(args.seasons))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"Validation report written: {out}")
    print(json.dumps(report["summary"], indent=2))
    print(json.dumps(report["exceptions"], indent=2))


if __name__ == "__main__":
    main()
