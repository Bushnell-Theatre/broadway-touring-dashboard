"""
Broadway Touring Dashboard — Data Validation Script
Produces validation_report.json and validation_report.html

Run: py -3 validate.py
     python3 validate.py
     python validate.py
"""

import json, re, sys, datetime, io
from pathlib import Path
from collections import defaultdict

# Force UTF-8 console output on Windows
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "src" / "data"

# ── helpers ──────────────────────────────────────────────────────────────────

def load(name):
    p = DATA_DIR / name
    if not p.exists():
        print(f"  [MISSING] {p}")
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)

def pct(n, d):
    return round(100 * n / d, 1) if d else 0

def norm(s):
    return re.sub(r"[^a-z0-9 ]+", " ", str(s or "").lower()).strip()

# ── load data ─────────────────────────────────────────────────────────────────

print("Loading data files…")
raw        = load("data.json")
seasons_raw = load("seasons.json")
peers_raw  = load("peers.json")
context_raw = load("context.json")

records = raw["records"] if isinstance(raw, dict) and "records" in raw else (raw or [])
generated_at = raw.get("generated_at", "unknown") if isinstance(raw, dict) else "unknown"

total = len(records)
print(f"  {total:,} records loaded")

# ── initialise report ─────────────────────────────────────────────────────────

report = {
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "data_generated_at": generated_at,
    "record_count": total,
    "checks": [],
    "summary": {}
}

issues = []   # list of {check, severity, record_count, pct, detail, examples}

def add(check, severity, count, detail, examples=None, category="data"):
    issues.append({
        "category": category,
        "check": check,
        "severity": severity,        # "error" | "warning" | "info"
        "record_count": count,
        "pct_of_total": pct(count, total),
        "detail": detail,
        "examples": (examples or [])[:8],
    })
    label = {"error": "❌", "warning": "⚠️ ", "info": "ℹ️ "}[severity]
    print(f"  {label} [{severity.upper():7}] {check}: {count:,} records — {detail}")

# ─────────────────────────────────────────────────────────────────────────────
# 1. REQUIRED FIELDS
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 1. Required field presence ──")

REQUIRED = ["week_of", "tier", "show", "theatre", "city", "canonical_key"]
for field in REQUIRED:
    missing = [r for r in records if not r.get(field)]
    if missing:
        add(f"missing_{field}", "error", len(missing),
            f"'{field}' is null or empty",
            [r.get("canonical_key", "?") for r in missing])
    else:
        print(f"  ✓ {field}: all {total:,} records present")

# ─────────────────────────────────────────────────────────────────────────────
# 2. DUPLICATE CANONICAL KEYS
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 2. Duplicate canonical keys ──")

key_counts = defaultdict(int)
for r in records:
    key_counts[r.get("canonical_key", "")] += 1
dupes = {k: v for k, v in key_counts.items() if v > 1}
if dupes:
    add("duplicate_canonical_key", "error", sum(dupes.values()),
        f"{len(dupes)} unique canonical keys appear more than once",
        list(dupes.keys()))
else:
    print(f"  ✓ No duplicate canonical keys")

# ─────────────────────────────────────────────────────────────────────────────
# 3. NULL RATES BY FINANCIAL FIELD
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 3. Null rates by financial field ──")

FINANCIAL = ["gross_gross", "gross_potential", "gg_pct_gp",
             "paid_tix", "total_tix", "capacity",
             "cap_paid", "cap_total", "avg_adm", "num_perf"]

active = [r for r in records if not r.get("no_engagement")]
layoffs = [r for r in records if r.get("no_engagement")]

print(f"  Active engagements: {len(active):,}  |  Layoff/dark weeks: {len(layoffs):,}")

for field in FINANCIAL:
    null_active = [r for r in active if r.get(field) is None]
    if null_active:
        null_rate = len(null_active) / len(active)
        sev = "error" if null_rate > 0.10 else ("warning" if null_rate > 0.01 else "info")
        add(f"null_{field}_in_active", sev, len(null_active),
            f"{field} is null on {pct(len(null_active),len(active))}% of active (non-layoff) records",
            [r.get("canonical_key") for r in null_active])
    else:
        print(f"  ✓ {field}: no nulls in active records")

# ─────────────────────────────────────────────────────────────────────────────
# 4. ABOVE-100 / IMPOSSIBLE BOUNDS
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 4. Above-100 capacity and gross bounds ──")

def above100(field, label):
    recs = [r for r in records if r.get(field) is not None and r[field] > 100]
    if recs:
        # Classify
        severe = [r for r in recs if r[field] > 115]
        moderate = [r for r in recs if 105 < r[field] <= 115]
        mild = [r for r in recs if 100 < r[field] <= 105]
        detail = (f"{label} > 100 on {len(recs):,} records "
                  f"(mild ≤105%: {len(mild)}, moderate ≤115%: {len(moderate)}, severe >115%: {len(severe)}). "
                  f"Expected: dynamic pricing, premium ticket upgrades, comps, SRO sales, or reporting period mismatches can all push gross above stated potential.")
        sev = "info"
        add(f"{field}_above_100", sev, len(recs), detail,
            [{"key": r.get("canonical_key"), "value": r[field]} for r in severe[:5]])
    else:
        print(f"  ✓ {field}: no above-100 values")

above100("cap_paid",  "Paid capacity %")
above100("cap_total", "Total capacity %")
above100("gg_pct_gp", "GG% of gross potential")

# Gross exceeds potential
gg_over = [r for r in records
           if r.get("gross_gross") and r.get("gross_potential")
           and r["gross_gross"] > r["gross_potential"]]
if gg_over:
    detail = (f"gross_gross > gross_potential on {len(gg_over):,} records. "
              f"Expected: dynamic pricing, premium upgrades, and SRO sales routinely push gross above stated potential.")
    add("gross_exceeds_potential", "info", len(gg_over), detail,
        [{"key": r.get("canonical_key"),
          "gross": r["gross_gross"], "potential": r["gross_potential"]}
         for r in sorted(gg_over, key=lambda r: r["gross_gross"]-r["gross_potential"], reverse=True)[:5]])
else:
    print(f"  ✓ gross_gross ≤ gross_potential on all records")

# ─────────────────────────────────────────────────────────────────────────────
# 5. DATE VALIDITY
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 5. Date validity ──")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
bad_dates = [r for r in records
             if r.get("week_of") and not DATE_RE.match(str(r["week_of"]))]
if bad_dates:
    add("invalid_week_of_format", "error", len(bad_dates),
        "week_of does not match YYYY-MM-DD",
        [r.get("canonical_key") for r in bad_dates])
else:
    print("  ✓ All week_of values match YYYY-MM-DD")

# Future dates
today = datetime.date.today().isoformat()
future = [r for r in records if r.get("week_of", "") > today]
if future:
    add("future_week_of", "info", len(future),
        f"week_of is in the future (after {today}). Expected for planned/confirmed bookings.",
        [r.get("canonical_key") for r in future[:5]])
else:
    print("  ✓ No future week_of dates")

# COVID gap: shutdown began ~March 12 2020, touring resumed Oct 2021
covid_start, covid_end = "2020-03-15", "2021-10-17"
covid = [r for r in records
         if covid_start <= (r.get("week_of") or "") <= covid_end
         and not r.get("no_engagement")]
if covid:
    add("active_records_in_covid_gap", "warning", len(covid),
        f"Active records found between {covid_start} and {covid_end} (expected Broadway League shutdown gap — shows in this window may have reported partial weeks before closure)",
        [r.get("canonical_key") for r in covid[:5]])
else:
    print(f"  ✓ No active records in COVID shutdown window")

# ─────────────────────────────────────────────────────────────────────────────
# 6. SEASON TITLE MATCHING
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 6. Season title matching ──")

if seasons_raw:
    today = datetime.date.today()
    # Broadway seasons run Sep–Aug; before Sep we're still in the prior season
    current_season_start = today.year if today.month >= 9 else today.year - 1
    show_norms = {norm(r.get("show","")): r.get("show") for r in records}
    unmatched_past, unmatched_future, matched_counts = [], [], {}
    for season_id, season in seasons_raw.items():
        try:
            season_start_year = int(season_id.split("-")[0])
            is_future = season_start_year > current_season_start
        except Exception:
            is_future = False
        for show in season.get("shows", []):
            league_name = show.get("league_name") or show.get("name", "")
            n = norm(league_name)
            hits = [r for r in records if n and n in norm(r.get("show",""))]
            matched_counts[(season_id, league_name)] = len(hits)
            if len(hits) == 0:
                entry = {"season": season_id, "show": league_name}
                (unmatched_future if is_future else unmatched_past).append(entry)
    if unmatched_past:
        add("unmatched_season_titles", "warning", len(unmatched_past),
            f"{len(unmatched_past)} past/current season shows have 0 matching records in data.json",
            unmatched_past, category="seasons")
    else:
        print(f"  ✓ All past/current season titles match at least one record")
    if unmatched_future:
        add("unmatched_future_season_titles", "info", len(unmatched_future),
            f"{len(unmatched_future)} future season shows have no data yet — expected for upcoming tours",
            unmatched_future, category="seasons")

    # Shows with very few records
    thin = [(k, v) for k, v in matched_counts.items() if 0 < v < 3]
    if thin:
        add("thin_match_season_titles", "info", len(thin),
            f"{len(thin)} season titles matched fewer than 3 records (low confidence scores)",
            [{"season": s, "show": t, "records": n} for (s,t),n in thin],
            category="seasons")
    else:
        print(f"  ✓ All matched season titles have ≥3 records")

# ─────────────────────────────────────────────────────────────────────────────
# 7. PEER METADATA COVERAGE
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 7. Peer metadata coverage ──")

if peers_raw:
    venues = peers_raw.get("venues", [])
    no_types = [v for v in venues if not v.get("peer_types")]
    no_synopsis = [v for v in venues if not v.get("synopsis")]
    print(f"  Total peer venues: {len(venues)}")
    if no_types:
        add("peer_missing_types", "warning", len(no_types),
            f"{len(no_types)} peer venues have no peer_types classification",
            [v.get("theatre","?") for v in no_types], category="peers")
    else:
        print(f"  ✓ All peer venues classified")
    if no_synopsis:
        add("peer_missing_synopsis", "info", len(no_synopsis),
            f"{len(no_synopsis)} peer venues have no synopsis (minor — cosmetic only)",
            [v.get("theatre","?") for v in no_synopsis], category="peers")

# ─────────────────────────────────────────────────────────────────────────────
# 8. BUSHNELL-SPECIFIC RECORDS
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 8. Bushnell-specific records ──")

bushnell = [r for r in records if r.get("theatre","").lower() == "bushnell"]
print(f"  Bushnell records: {len(bushnell):,}")
if not bushnell:
    add("no_bushnell_records", "warning", 0,
        "No records where theatre == 'Bushnell'. Bushnell vs Market comparisons will be blank.",
        category="data")
else:
    bushnell_shows = set(norm(r.get("show","")) for r in bushnell)
    print(f"  Unique Bushnell shows: {len(bushnell_shows)}")
    b_no_perf = [r for r in bushnell if not r.get("no_engagement") and r.get("gross_gross") is None]
    if b_no_perf:
        add("bushnell_active_missing_financials", "warning", len(b_no_perf),
            "Bushnell active records missing gross_gross",
            [r.get("canonical_key") for r in b_no_perf], category="data")
    else:
        print(f"  ✓ All active Bushnell records have financials")

# ─────────────────────────────────────────────────────────────────────────────
# 9. ENGAGEMENT FLAG CONSISTENCY
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 9. Engagement flag consistency ──")

# no_engagement=True but has financial data
layoff_with_data = [r for r in records
                    if r.get("no_engagement") and r.get("gross_gross") is not None]
if layoff_with_data:
    add("layoff_has_financials", "warning", len(layoff_with_data),
        "no_engagement=True but gross_gross is populated. May indicate a flag or field mismatch.",
        [r.get("canonical_key") for r in layoff_with_data])
else:
    print("  ✓ No layoff records have financial data")

# Active but zero gross
zero_gross = [r for r in records
              if not r.get("no_engagement")
              and r.get("gross_gross") is not None
              and r["gross_gross"] == 0]
if zero_gross:
    add("active_zero_gross", "warning", len(zero_gross),
        "Active engagement records where gross_gross == 0",
        [r.get("canonical_key") for r in zero_gross])
else:
    print("  ✓ No active records with zero gross")

# ─────────────────────────────────────────────────────────────────────────────
# 10. CONTEXT COVERAGE
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 10. Context (weather/economic) coverage ──")

if context_raw:
    ctx_weeks = set(context_raw.keys())
    data_weeks = set(r["week_of"] for r in records if r.get("week_of"))
    uncovered = data_weeks - ctx_weeks
    covered_pct = pct(len(data_weeks) - len(uncovered), len(data_weeks))
    print(f"  Context weeks: {len(ctx_weeks):,}  |  Data weeks: {len(data_weeks):,}  |  Coverage: {covered_pct}%")
    if uncovered:
        add("weeks_without_context", "info", len(uncovered),
            f"{len(uncovered)} data week_of values have no matching context entry. "
            f"Coverage is {covered_pct}%.",
            sorted(uncovered)[:10], category="context")
    else:
        print("  ✓ All data weeks have context entries")
    # Economic data gaps
    no_econ = [k for k,v in context_raw.items() if not v.get("economic")]
    if no_econ:
        add("context_missing_economic", "info", len(no_econ),
            f"{len(no_econ)} context weeks have no economic data",
            no_econ[:5], category="context")
    else:
        print("  ✓ All context weeks have economic data")

# ─────────────────────────────────────────────────────────────────────────────
# 11. FIELD VALUE DISTRIBUTION SANITY
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 11. Field distribution sanity ──")

def check_range(field, lo, hi, label):
    out = [r for r in records
           if r.get(field) is not None and (r[field] < lo or r[field] > hi)]
    if out:
        sev = "warning" if len(out) < 50 else "error"
        add(f"{field}_out_of_range", sev, len(out),
            f"{label} outside expected range [{lo}, {hi}]",
            [{"key": r.get("canonical_key"), "value": r[field]} for r in out[:5]])
    else:
        print(f"  ✓ {field} in range [{lo}, {hi}]")

check_range("avg_adm", 0, 500, "Avg paid admission ($)")
check_range("num_perf", 1, 14, "Number of performances")
check_range("top_price", 0, 1000, "Top paid price ($)")

# Negative values
for field in ["gross_gross", "gross_potential", "paid_tix", "total_tix", "capacity"]:
    neg = [r for r in records if r.get(field) is not None and r[field] < 0]
    if neg:
        add(f"{field}_negative", "error", len(neg),
            f"{field} has negative values",
            [r.get("canonical_key") for r in neg])
    else:
        print(f"  ✓ {field}: no negative values")

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

errors   = [i for i in issues if i["severity"] == "error"]
warnings = [i for i in issues if i["severity"] == "warning"]
infos    = [i for i in issues if i["severity"] == "info"]

report["checks"]  = issues
report["summary"] = {
    "total_records":   total,
    "active_records":  len(active),
    "layoff_records":  len(layoffs),
    "errors":          len(errors),
    "warnings":        len(warnings),
    "info":            len(infos),
    "overall_status":  "FAIL" if errors else ("REVIEW" if warnings else "PASS"),
}

# ── write JSON report ─────────────────────────────────────────────────────────

json_path = ROOT / "validation_report.json"
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
print(f"\n  → {json_path}")

# ── write HTML report ─────────────────────────────────────────────────────────

def sev_color(s):
    return {"error": "#c0392b", "warning": "#d68910", "info": "#2471a3"}[s]

def sev_bg(s):
    return {"error": "#fdf2f0", "warning": "#fefdf0", "info": "#f0f6fd"}[s]

rows_html = ""
for chk in issues:
    ex = chk["examples"]
    ex_html = ""
    if ex:
        items = [json.dumps(e) if not isinstance(e, str) else e for e in ex]
        ex_html = "<ul>" + "".join(f"<li><code>{i}</code></li>" for i in items) + "</ul>"
    rows_html += f"""
<tr style="background:{sev_bg(chk['severity'])}">
  <td><strong style="color:{sev_color(chk['severity'])}">{chk['severity'].upper()}</strong></td>
  <td><code>{chk['check']}</code></td>
  <td style="color:#555;font-size:.8rem">{chk['category']}</td>
  <td class="num">{chk['record_count']:,}</td>
  <td class="num">{chk['pct_of_total']}%</td>
  <td>{chk['detail']}</td>
  <td style="font-size:.75rem;color:#555">{ex_html}</td>
</tr>"""

s = report["summary"]
status_color = {"PASS": "#1e8449", "REVIEW": "#d68910", "FAIL": "#c0392b"}[s["overall_status"]]

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Broadway Touring Dashboard — Validation Report</title>
<style>
  body {{ font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 24px 32px; background: #f9f9f9; color: #222; }}
  h1 {{ font-size: 1.4rem; margin-bottom: 4px; }}
  .meta {{ color: #666; font-size: .82rem; margin-bottom: 24px; }}
  .kpi-row {{ display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }}
  .kpi {{ background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 14px 20px; min-width: 130px; text-align: center; }}
  .kpi .val {{ font-size: 1.8rem; font-weight: 700; }}
  .kpi .lbl {{ font-size: .72rem; color: #888; text-transform: uppercase; letter-spacing: .04em; margin-top: 2px; }}
  table {{ width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); font-size: .82rem; }}
  th {{ background: #f0f0f0; text-align: left; padding: 10px 12px; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: #555; }}
  td {{ padding: 9px 12px; border-top: 1px solid #eee; vertical-align: top; }}
  .num {{ text-align: right; }}
  code {{ background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: .8rem; }}
  ul {{ margin: 4px 0; padding-left: 18px; }}
  li {{ margin-bottom: 2px; }}
  .status {{ display: inline-block; padding: 4px 14px; border-radius: 20px; font-weight: 700; font-size: 1rem; color: #fff; background: {status_color}; }}
</style>
</head>
<body>
<h1>Broadway Touring Dashboard — Data Validation Report</h1>
<div class="meta">
  Data generated: {report['data_generated_at']} &nbsp;|&nbsp;
  Report generated: {report['generated_at']} &nbsp;|&nbsp;
  Overall status: <span class="status">{s['overall_status']}</span>
</div>
<div class="kpi-row">
  <div class="kpi"><div class="val">{s['total_records']:,}</div><div class="lbl">Total Records</div></div>
  <div class="kpi"><div class="val">{s['active_records']:,}</div><div class="lbl">Active Engagements</div></div>
  <div class="kpi"><div class="val">{s['layoff_records']:,}</div><div class="lbl">Layoff / Dark Weeks</div></div>
  <div class="kpi"><div class="val" style="color:{sev_color('error')}">{s['errors']}</div><div class="lbl">Errors</div></div>
  <div class="kpi"><div class="val" style="color:{sev_color('warning')}">{s['warnings']}</div><div class="lbl">Warnings</div></div>
  <div class="kpi"><div class="val" style="color:{sev_color('info')}">{s['info']}</div><div class="lbl">Info</div></div>
</div>
<table>
<thead><tr>
  <th>Severity</th><th>Check</th><th>Category</th>
  <th class="num">Records</th><th class="num">% of Total</th>
  <th>Detail</th><th>Examples</th>
</tr></thead>
<tbody>{rows_html}</tbody>
</table>
<p style="margin-top:24px;font-size:.75rem;color:#aaa">
  Run <code>py -3 validate.py</code> to regenerate. Source: validate.py
</p>
</body>
</html>"""

html_path = ROOT / "validation_report.html"
with open(html_path, "w", encoding="utf-8") as f:
    f.write(html)
print(f"  → {html_path}")

# ── console summary ───────────────────────────────────────────────────────────

print(f"""
╔══════════════════════════════════════╗
  Overall status : {s['overall_status']}
  Errors         : {s['errors']}
  Warnings       : {s['warnings']}
  Info           : {s['info']}
╚══════════════════════════════════════╝""")

if errors:
    print("\nErrors to resolve:")
    for e in errors:
        print(f"  ❌ {e['check']}: {e['record_count']:,} records")
if warnings:
    print("\nWarnings to review:")
    for w in warnings:
        print(f"  ⚠️  {w['check']}: {w['record_count']:,} records")
