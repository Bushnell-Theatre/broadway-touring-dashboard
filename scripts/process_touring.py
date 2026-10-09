"""
Broadway Touring Report Processor
Bushnell Center for the Performing Arts

Processes weekly Broadway League XLSX touring reports and outputs a single
clean data.json file for use by the Sales Intelligence Dashboard.

Usage:
    python process_touring.py <input_dir> <output_file>
    python process_touring.py --append   <file.xlsx> <data.json>
    python process_touring.py --revision <file.xlsx> <data.json>
    python process_touring.py --audit    <reports_dir> <data.json> [--week YYYY-MM-DD]

    input_dir   : folder containing one or more .xlsx touring report files
    output_file : path for the output data.json (e.g. ./data.json)

--append auto-detects a revision from the filename (see REVISION DETECTION)
and routes to --revision, so the watcher needs no change to benefit.

--audit is strictly read-only and never writes to data.json.

Example:
    python process_touring.py ./reports ./data.json
"""

import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone

import openpyxl

# ── CONSTANTS ───────────────────────────────────────────────────────────

BUSHNELL_AVG = 2722
LOWER_BOUND = BUSHNELL_AVG * 0.9
UPPER_BOUND = BUSHNELL_AVG * 1.1

NE_DETECT = re.compile(r'(^|\s)n/e(\s|$)', re.IGNORECASE)
NE_REMOVE = re.compile(r'(^|\s)n/e(\s|$)', re.IGNORECASE)
LAYOFF = re.compile(r'layoff', re.IGNORECASE)

# ── HEADER ALIASES ──────────────────────────────────────────────────────

ALIASES = {
    'show': ['show', 'showname', 'production'],
    'theatre': ['theatre', 'theater', 'venue', 'theatrename'],
    'city': ['city', 'market', 'location'],
    'ticketRange': ['ticketrange', 'regticketrange', 'ticketpricerange'],
    'topPrice': ['topprice', 'toppaidprice', 'top', 'premium'],
    'numPerf': ['numperf', 'performances', 'perfs', 'perf'],
    'grossGross': ['grossgross', 'gross', 'gg'],
    'grossPotential': ['grosspotential', 'potential', 'gp'],
    'ggPctGP': ['ggpctgp', 'ggpgp', 'gpctgp', 'gggp'],
    'paidTix': ['paidtix', 'paidattn', 'paidattendance', 'paid', 'paidtickets', 'paidticket'],
    'totalTix': ['totaltix', 'totalattn', 'totalattendance', 'total', 'totaltickets', 'totalticket'],
    'capacity': ['capacity', 'totalcapacity', 'cap'],
    'capPaid': ['cappaid', 'capacitypaid'],
    'capTotal': ['captotal', 'capacitytotal'],
    'onSub': ['onsub', 'sub', 'subscription'],
    'avgAdm': ['avgadm', 'avgpaidadmission', 'avgpaid', 'averagepaidadmission'],
}

# ── HELPERS ─────────────────────────────────────────────────────────────


def normalize_header(value):
    return re.sub(r'[^a-z0-9]', '',
                  str(value or '').lower().replace('\n', ' '))


def build_lookup():
    lookup = {}
    for field, aliases in ALIASES.items():
        for alias in aliases:
            key = normalize_header(alias)
            if key not in lookup:
                lookup[key] = field
    return lookup


def map_columns(header_row):
    lookup = build_lookup()
    col_map = {}
    for i, cell in enumerate(header_row):
        key = normalize_header(cell)
        if key in lookup and lookup[key] not in col_map:
            col_map[lookup[key]] = i
    return col_map


def find_header(rows):
    """Return index of the header row (first row containing 'show' and 'theatre')."""
    for i, row in enumerate(rows[:5]):
        cells = [str(c or '').strip().lower().replace('\n', ' ') for c in row]
        if 'show' in cells and ('theatre' in cells or 'theater' in cells):
            return i
    return None


def extract_date(sheet_name):
    """Extract ISO date string (YYYY-MM-DD) from sheet name."""
    m = re.search(r'(\d{1,2})[-_](\d{1,2})[-_](\d{2,4})', sheet_name)
    if not m:
        return None
    mm = m.group(1).zfill(2)
    dd = m.group(2).zfill(2)
    yy = m.group(3)
    if len(yy) == 2:
        yy = '20' + yy
    return f"{yy}-{mm}-{dd}"


def parse_number(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return None if (v != v) else float(v)  # NaN check
    s = str(v).strip()
    if not s or s == '-' or s.lower() == 'n/a':
        return None
    neg = s.startswith('(') and s.endswith(')')
    cleaned = re.sub(r'[$%(),]', '', s).strip()
    try:
        n = float(cleaned)
        return -n if neg else n
    except ValueError:
        return None


def parse_percent(v):
    n = parse_number(v)
    if n is None:
        return None
    return n * 100 if 0 < n < 5 else n


def parse_bool(v):
    return str(v or '').strip().lower() in ('x', 'yes', 'y', 'true', '1')


def normalize_key(s):
    return re.sub(r'[^a-z0-9 ]', '', s.lower()).strip()


# ── ROW PROCESSING ──────────────────────────────────────────────────────

def process_row(row, col_map, week_of, tier):
    def get(field):
        idx = col_map.get(field)
        return row[idx] if idx is not None and idx < len(row) else None

    def text(field):
        return str(get(field) or '').strip()

    raw_show = text('show')
    raw_theatre = text('theatre')
    raw_city = text('city')

    if not raw_show or not raw_city:
        return None

    # nonEquity: n/e present in show, theatre, or city
    non_equity = (
        bool(NE_DETECT.search(raw_show)) or
        bool(NE_DETECT.search(raw_theatre)) or
        bool(NE_DETECT.search(raw_city))
    )

    # Clean show name — strip n/e marker
    show = NE_REMOVE.sub(' ', raw_show)
    show = re.sub(r'\s{2,}', ' ', show).strip()

    if not show or 'for engagements' in show.lower():
        return None

    num_perf = parse_number(get('numPerf'))
    gross_gross = parse_number(get('grossGross'))

    # noEngagement: layoff in any field OR missing perf/gross data
    no_engagement = (
        bool(LAYOFF.search(raw_show)) or
        bool(LAYOFF.search(raw_theatre)) or
        bool(LAYOFF.search(raw_city)) or
        num_perf is None or
        gross_gross is None
    )

    capacity = parse_number(get('capacity'))
    venue_sellable = round(
        capacity / num_perf,
        2) if capacity and num_perf else None

    similar_bushnell = (
        venue_sellable is not None and
        LOWER_BOUND <= venue_sellable <= UPPER_BOUND
    )

    canonical_key = '|'.join([
        week_of,
        normalize_key(show),
        normalize_key(raw_theatre),
        normalize_key(raw_city),
        tier.lower()
    ])

    return {
        'week_of': week_of,
        'tier': tier,
        'show': show,
        'theatre': raw_theatre,
        'city': raw_city,
        'ticket_range': text('ticketRange') or None,
        'top_price': parse_number(get('topPrice')),
        'num_perf': num_perf,
        'gross_gross': gross_gross,
        'gross_potential': parse_number(get('grossPotential')),
        'gg_pct_gp': parse_percent(get('ggPctGP')),
        'paid_tix': parse_number(get('paidTix')),
        'total_tix': parse_number(get('totalTix')),
        'capacity': capacity,
        'cap_paid': parse_percent(get('capPaid')),
        'cap_total': parse_percent(get('capTotal')),
        'on_sub': parse_bool(get('onSub')),
        'avg_adm': parse_number(get('avgAdm')),
        'venue_sellable': venue_sellable,
        'similar_bushnell': similar_bushnell,
        'non_equity': non_equity,
        'no_engagement': no_engagement,
        'canonical_key': canonical_key,
    }


# ── FILE PROCESSING ─────────────────────────────────────────────────────

def process_file(filepath, log):
    records = []
    fname = os.path.basename(filepath)

    try:
        wb = openpyxl.load_workbook(filepath, data_only=True)
    except Exception as e:
        log.append(f"ERROR  | {fname} | Could not open: {e}")
        return records

    for sname in wb.sheetnames:
        upper = sname.upper()
        if 'PRIMARY' not in upper and 'SECONDARY' not in upper:
            continue

        tier = 'Primary' if 'PRIMARY' in upper else 'Secondary'
        week_of = extract_date(sname)

        if not week_of:
            log.append(
                f"WARN   | {fname} | {sname} | No date found in sheet name — skipped")
            continue

        ws = wb[sname]
        rows = list(ws.iter_rows(values_only=True))

        h_idx = find_header(rows)
        if h_idx is None:
            log.append(
                f"WARN   | {fname} | {sname} | No header row found — skipped")
            continue

        col_map = map_columns(rows[h_idx])
        missing = [f for f in ALIASES if f not in col_map]
        if missing:
            log.append(
                f"WARN   | {fname} | {sname} | Missing columns: {missing}")

        sheet_records = 0
        for row in rows[h_idx + 1:]:
            rec = process_row(row, col_map, week_of, tier)
            if rec:
                records.append(rec)
                sheet_records += 1

        log.append(
            f"OK     | {fname} | {sname} | {sheet_records} records | week={week_of}")

    return records


# ── REVISION DETECTION ──────────────────────────────────────────────────
#
# A revised weekly report is identified by a REV / REVISED token in its
# FILENAME. The token must stand alone — delimited by a non-alphanumeric on the
# left and by something other than a letter on the right — so that words which
# merely contain the letters "rev" ("Preview", "Revenue", "Review", "Reverb")
# are not mistaken for revision markers.
#
# Recognised, case-insensitively:
#     " - REV.xlsx"   " - REV2.xlsx"   "_REV.xlsx"
#     " (REV).xlsx"   " - REVISED.xlsx"
#
# A trailing integer is captured as the revision ordinal and is the ONLY
# ordering signal this module will accept between revisions of one week.
# Filename sort order and filesystem mtime are deliberately NOT used.

REVISION_TOKEN = re.compile(
    r'(?<![A-Za-z0-9])REV(?:ISED)?(\d*)(?![A-Za-z])', re.IGNORECASE)


def revision_marker(path):
    """(is_revision, ordinal) for a filename. ordinal is None when unnumbered."""
    stem = os.path.splitext(os.path.basename(path))[0]
    m = REVISION_TOKEN.search(stem)
    if not m:
        return False, None
    digits = m.group(1)
    return True, (int(digits) if digits else None)


# ── RECORD COMPARISON ───────────────────────────────────────────────────
#
# canonical_key identifies a record; every other field is a business value.
# Two records with the same key but different business values are a CONFLICT:
# either a revision to apply, or — in plain append mode — an error.


def business_diff(old_rec, new_rec):
    """{field: (old, new)} for every business value that differs."""
    fields = (set(old_rec) | set(new_rec)) - {'canonical_key'}
    return {f: (old_rec.get(f), new_rec.get(f))
            for f in sorted(fields) if old_rec.get(f) != new_rec.get(f)}


def classify_incoming(stored_by_key, incoming):
    """Split incoming records into additions, updates and identical.

    additions : [record]                 key not present in stored data
    updates   : [(stored, incoming, diff)]  key present, business values differ
    identical : [record]                 key present, nothing to change
    """
    additions, updates, identical = [], [], []
    for rec in incoming:
        stored = stored_by_key.get(rec['canonical_key'])
        if stored is None:
            additions.append(rec)
            continue
        diff = business_diff(stored, rec)
        if diff:
            updates.append((stored, rec, diff))
        else:
            identical.append(rec)
    return additions, updates, identical


def week_gross(records):
    return sum(r['gross_gross'] for r in records if r.get('gross_gross') is not None)


def fmt_money(v):
    return f"{v:,.0f}"


# ── ATOMIC WRITE + POST-WRITE VALIDATION ────────────────────────────────


def _build_output(records):
    records = sorted(records, key=lambda r: (r['week_of'], r['show']))
    return {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'record_count': len(records),
        'records': records,
    }


def validate_payload(payload, expected_count, log):
    """Structural checks run against the candidate file BEFORE it goes live."""
    problems = []
    recs = payload.get('records')
    if not isinstance(recs, list):
        problems.append("records is not a list")
        recs = []
    if len(recs) != expected_count:
        problems.append(
            f"record count {len(recs)} != expected {expected_count}")
    if payload.get('record_count') != len(recs):
        problems.append(
            f"record_count header {payload.get('record_count')} != {len(recs)} records")
    keys = [r.get('canonical_key') for r in recs]
    if any(not k for k in keys):
        problems.append("one or more records have no canonical_key")
    if len(set(keys)) != len(keys):
        problems.append(f"{len(keys) - len(set(keys))} duplicate canonical keys")
    for pr in problems:
        log.append(f"ERROR  | Validation: {pr}")
    return not problems


def write_data_atomic(data_json, records, log):
    """Write via a temp file that is validated before it replaces the live one.

    The live data.json is never opened for writing. If anything fails, it is
    left exactly as it was and the caller must exit non-zero so that no
    publication commit happens.
    """
    payload = _build_output(records)
    tmp = data_json + '.tmp'
    bak = data_json + '.bak'

    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    try:
        with open(tmp, 'r', encoding='utf-8') as f:
            written = json.load(f)
    except Exception as e:
        os.remove(tmp)
        log.append(f"ERROR  | Candidate file is not readable JSON: {e}")
        return False

    if not validate_payload(written, len(records), log):
        os.remove(tmp)
        log.append("ERROR  | Candidate rejected — data.json left unchanged")
        return False

    if os.path.isfile(data_json):
        shutil.copy2(data_json, bak)
        log.append(f"INFO   | Previous data retained at {os.path.basename(bak)}")
    os.replace(tmp, data_json)
    return True


# ── DEDUPLICATION ───────────────────────────────────────────────────────

def deduplicate(records, log):
    seen = {}
    dupes = 0
    for rec in records:
        key = rec['canonical_key']
        if key not in seen:
            seen[key] = rec
        else:
            dupes += 1
    log.append(
        f"INFO   | Deduplication: {
            len(records)} in, {dupes} dupes removed, {
            len(seen)} out")
    return list(seen.values())


# ── MAIN — FULL REBUILD ─────────────────────────────────────────────────

def main_rebuild(input_dir, output_file):
    """Process all XLSX files in a directory and write a fresh data.json."""
    if not os.path.isdir(input_dir):
        print(f"Error: '{input_dir}' is not a directory")
        sys.exit(1)

    xlsx_files = sorted([
        os.path.join(input_dir, f)
        for f in os.listdir(input_dir)
        if f.lower().endswith('.xlsx') and not f.startswith('~')
    ])

    if not xlsx_files:
        print(f"No .xlsx files found in '{input_dir}'")
        sys.exit(1)

    log = []
    log.append(f"INFO   | MODE: full rebuild")
    log.append(
        f"INFO   | Processing {
            len(xlsx_files)} files from '{input_dir}'")

    all_records = []
    for fpath in xlsx_files:
        records = process_file(fpath, log)
        all_records.extend(records)

    all_records = deduplicate(all_records, log)
    all_records.sort(key=lambda r: (r['week_of'], r['show']))

    output = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'record_count': len(all_records),
        'records': all_records,
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print('\n'.join(log))
    print(f"\nDone. {len(all_records)} records written to '{output_file}'")


# ── MAIN — APPEND MODE ──────────────────────────────────────────────────

def main_append(new_file, data_json):
    """
    Append a single new weekly XLSX file into an existing data.json.
    Deduplicates by canonical key — existing records are never overwritten.

    Usage:
        python process_touring.py --append <new_file.xlsx> <data.json>
    """
    if not os.path.isfile(new_file):
        print(f"Error: '{new_file}' not found")
        sys.exit(1)

    if not os.path.isfile(data_json):
        print(f"Error: '{data_json}' not found")
        sys.exit(1)

    log = []
    log.append(f"INFO   | MODE: append")
    log.append(f"INFO   | New file: {os.path.basename(new_file)}")
    log.append(f"INFO   | Target: {data_json}")

    # Load existing data
    with open(data_json, 'r', encoding='utf-8') as f:
        existing = json.load(f)

    existing_records = existing if isinstance(
        existing, list) else existing.get(
        'records', [])
    existing_keys = {r['canonical_key'] for r in existing_records}
    log.append(f"INFO   | Existing records: {len(existing_records)}")

    # Process new file
    new_records = process_file(new_file, log)

    # Append only records not already present. An existing key whose business
    # values differ is a conflict, collected here and reported below.
    stored_by_key = {r['canonical_key']: r for r in existing_records}
    added = 0
    dupes = 0
    conflicts = []
    for rec in new_records:
        stored = stored_by_key.get(rec['canonical_key'])
        if stored is None:
            existing_records.append(rec)
            existing_keys.add(rec['canonical_key'])
            stored_by_key[rec['canonical_key']] = rec
            added += 1
            continue
        diff = business_diff(stored, rec)
        if diff:
            conflicts.append((stored, rec, diff))
        else:
            dupes += 1

    log.append(
        f"INFO   | New records added: {added} | Identical duplicates skipped: {dupes}")

    # A plain file must not restate an existing engagement with different
    # numbers. That is a revision, and a revision has to be named as one —
    # silently skipping it is how a correction gets lost.
    if conflicts:
        log.append(
            f"ERROR  | {len(conflicts)} existing record(s) restated with DIFFERENT values")
        log.append(
            "ERROR  | Append mode never overwrites, so these changes would be lost.")
        log.append(
            "ERROR  | If this file is a correction, rename it with a REV / REVISED "
            "marker (e.g. '... - REVISED.xlsx') and re-drop it.")
        for stored, incoming, diff in conflicts:
            log.append(
                f"ERROR  |   {incoming['week_of']} | {incoming['show']} | "
                f"{incoming['theatre']} | {incoming['city']}")
            for field, (o, n) in diff.items():
                log.append(f"ERROR  |       {field}: {o} -> {n}")
        log.append("ERROR  | data.json left unchanged. No publication.")
        print('\n'.join(log))
        sys.exit(1)

    if not write_data_atomic(data_json, existing_records, log):
        print('\n'.join(log))
        sys.exit(1)

    print('\n'.join(log))
    print(
        f"\nDone. {added} records added. Total: {
            len(existing_records)} records in '{data_json}'")


# ── MAIN — REVISION MODE ────────────────────────────────────────────────

def main_revision(new_file, data_json):
    """
    Apply a revised weekly XLSX over an existing data.json by UPSERT.

        python process_touring.py --revision <file.xlsx> <data.json>

    Semantics, deliberately chosen:
      · a key not in the store is INSERTED
      · a key in the store whose business values differ is REPLACED
      · a key in the store whose values are identical is LEFT ALONE
      · a stored record ABSENT from the revision is RETAINED

    The last rule is the important one. A REV/REVISED workbook is not
    guaranteed to be a complete population for its week — it may carry only
    the corrected tab, or only the rows that changed. Deleting stored records
    merely because the revision does not mention them would throw away good
    data on the strength of an assumption we cannot make. Absences are
    therefore reported for a human to review, never acted on unattended.
    """
    if not os.path.isfile(new_file):
        print(f"Error: '{new_file}' not found")
        sys.exit(1)
    if not os.path.isfile(data_json):
        print(f"Error: '{data_json}' not found")
        sys.exit(1)

    fname = os.path.basename(new_file)
    _, ordinal = revision_marker(new_file)

    log = []
    log.append("INFO   | MODE: revision")
    log.append(f"INFO   | Source file: {fname}")
    if ordinal is not None:
        log.append(f"INFO   | Revision ordinal: {ordinal}")
    log.append(f"INFO   | Target: {data_json}")

    with open(data_json, 'r', encoding='utf-8') as f:
        existing = json.load(f)
    records = existing if isinstance(existing, list) else existing.get('records', [])
    log.append(f"INFO   | Existing records: {len(records)}")

    incoming = process_file(new_file, log)

    # Guard 1 — a revision that parses to nothing is a parse failure, not an
    # instruction to change anything.
    if not incoming:
        log.append("ERROR  | Revision parsed to 0 records — refusing to proceed.")
        log.append("ERROR  | data.json left unchanged. No publication.")
        print('\n'.join(log))
        sys.exit(1)

    # Guard 2 — exactly one reporting week.
    weeks = sorted({r['week_of'] for r in incoming})
    if len(weeks) != 1:
        log.append(
            f"ERROR  | Revision covers {len(weeks)} reporting weeks {weeks} — expected exactly 1.")
        log.append("ERROR  | data.json left unchanged. No publication.")
        print('\n'.join(log))
        sys.exit(1)
    week = weeks[0]
    log.append(f"INFO   | Reporting week: {week}")

    stored_week = [r for r in records if r['week_of'] == week]
    before_count = len(stored_week)
    before_gross = week_gross(stored_week)

    stored_by_key = {r['canonical_key']: r for r in records}
    additions, updates, identical = classify_incoming(stored_by_key, incoming)

    # Apply the upsert in place. No deletions, by design.
    index_by_key = {r['canonical_key']: i for i, r in enumerate(records)}
    for stored, new_rec, _diff in updates:
        records[index_by_key[stored['canonical_key']]] = new_rec
    records.extend(additions)

    after_week = [r for r in records if r['week_of'] == week]
    after_count = len(after_week)
    after_gross = week_gross(after_week)

    incoming_keys = {r['canonical_key'] for r in incoming}
    retained = [r for r in stored_week if r['canonical_key'] not in incoming_keys]

    log.append(f"INFO   | Added records:     {len(additions)}")
    log.append(f"INFO   | Updated records:   {len(updates)}")
    log.append(f"INFO   | Identical records: {len(identical)}")
    log.append(f"INFO   | Removed records:   0 (revision mode never deletes)")
    log.append(f"INFO   | Week {week} record count: {before_count} -> {after_count}")
    log.append(
        f"INFO   | Week {week} gross: {fmt_money(before_gross)} -> {fmt_money(after_gross)} "
        f"(delta {after_gross - before_gross:+,.0f})")
    log.append(f"INFO   | Total records: {len(records)}")

    for stored, new_rec, diff in updates:
        log.append(
            f"INFO   | UPDATED | {new_rec['show']} | {new_rec['theatre']} | {new_rec['city']}")
        for field, (o, n) in diff.items():
            log.append(f"INFO   |     {field}: {o} -> {n}")
    for rec in additions:
        log.append(
            f"INFO   | ADDED   | {rec['show']} | {rec['theatre']} | {rec['city']}")

    log.append(
        f"INFO   | {len(retained)} stored record(s) for {week} were absent from this "
        "revision and were RETAINED. Revision files are not guaranteed to be a "
        "complete population for their week, so absence is never treated as a "
        "deletion instruction.")
    if len(incoming_keys) < before_count:
        log.append(
            "WARN   | Revision contains fewer records than the stored week. "
            "Missing stored records were retained; review may be required.")
        for rec in retained:
            log.append(
                f"WARN   |   retained: {rec['show']} | {rec['theatre']} | {rec['city']}")

    if not write_data_atomic(data_json, records, log):
        print('\n'.join(log))
        sys.exit(1)

    print('\n'.join(log))
    print(
        f"\nDone. {len(additions)} added, {len(updates)} updated, "
        f"{len(identical)} identical, 0 removed. "
        f"Total: {len(records)} records in '{data_json}'")


# ── MAIN — HISTORICAL AUDIT (READ-ONLY) ─────────────────────────────────

def main_audit(reports_dir, data_json, only_week=None):
    """
    Reconcile stored data against the archived source workbooks. READ-ONLY —
    this never writes to data.json or to any other file.

        python process_touring.py --audit <reports_dir> <data.json> [--week YYYY-MM-DD]

    Source-derived truth is built per week by applying the original files
    first and then any recognised revision files, using the same record-level
    upsert semantics as --revision.

    Where two revisions for one week cannot be ordered from their filenames —
    for example two unnumbered REVISED files — the ambiguity is REPORTED and
    neither is applied. Filename sort order and filesystem mtime are never
    used to break the tie, because neither reflects which revision the League
    actually issued last.
    """
    if not os.path.isdir(reports_dir):
        print(f"Error: '{reports_dir}' is not a directory")
        sys.exit(1)
    if not os.path.isfile(data_json):
        print(f"Error: '{data_json}' not found")
        sys.exit(1)

    files = [f for f in os.listdir(reports_dir)
             if f.lower().endswith('.xlsx') and not f.startswith('~')]
    if not files:
        print(f"No .xlsx files found in '{reports_dir}'")
        sys.exit(1)

    with open(data_json, 'r', encoding='utf-8') as f:
        stored_doc = json.load(f)
    stored_records = (stored_doc if isinstance(stored_doc, list)
                      else stored_doc.get('records', []))

    print(f"AUDIT (read-only) — {len(files)} workbooks in {reports_dir}")
    print(f"Comparing against {data_json} ({len(stored_records)} records)")
    if only_week:
        print(f"Restricted to week {only_week}")
    print("")

    # Parse every workbook once, grouping its records by week.
    parse_log = []
    by_week = {}      # week -> {'originals': [(fname, {key: rec})], 'revisions': [(ordinal, fname, {key: rec})]}
    for n, fname in enumerate(sorted(files), 1):
        if n % 25 == 0:
            print(f"  ... parsed {n}/{len(files)} workbooks")
        path = os.path.join(reports_dir, fname)
        recs = process_file(path, parse_log)
        if not recs:
            continue
        is_rev, ordinal = revision_marker(fname)
        for wk in sorted({r['week_of'] for r in recs}):
            if only_week and wk != only_week:
                continue
            slot = by_week.setdefault(wk, {'originals': [], 'revisions': []})
            wk_recs = {r['canonical_key']: r for r in recs if r['week_of'] == wk}
            if is_rev:
                slot['revisions'].append((ordinal, fname, wk_recs))
            else:
                slot['originals'].append((fname, wk_recs))

    stored_by_week = {}
    for r in stored_records:
        stored_by_week.setdefault(r['week_of'], {})[r['canonical_key']] = r

    weeks_with_revisions = sorted(w for w, v in by_week.items() if v['revisions'])
    print("")
    print(f"Weeks represented in sources : {len(by_week)}")
    print(f"Weeks with revision files    : {len(weeks_with_revisions)}")
    print("")

    total_ambiguous = 0
    total_conflicts = 0
    total_mismatched_weeks = 0

    for wk in sorted(by_week):
        slot = by_week[wk]
        if not slot['revisions'] and not only_week:
            continue  # uninteresting: no revision was ever issued for this week

        print("=" * 70)
        print(f"WEEK {wk}")
        print(f"  original files : {[f for f, _ in slot['originals']] or 'none'}")
        print(f"  revision files : {[f for _, f, _ in slot['revisions']] or 'none'}")

        # Build source-derived truth: originals first, then revisions.
        derived = {}
        for fname, recs in slot['originals']:
            for k, rec in recs.items():
                if k in derived and business_diff(derived[k], rec):
                    total_conflicts += 1
                    print(f"  CONFLICT between original files on key: {k}")
                derived.setdefault(k, rec)

        # Revision precedence: ordinal only. Unnumbered counts as ordinal 1.
        buckets = {}
        for ordinal, fname, recs in slot['revisions']:
            buckets.setdefault(1 if ordinal is None else ordinal, []).append((fname, recs))

        ambiguous = {o: [f for f, _ in v] for o, v in buckets.items() if len(v) > 1}
        if ambiguous:
            total_ambiguous += 1
            print("  AMBIGUOUS REVISION PRECEDENCE — not applied, needs a human:")
            for ordinal, names in sorted(ambiguous.items()):
                print(f"    ordinal {ordinal}: {names}")
            print("    Rename them with explicit ordinals (REV2, REV3) to resolve.")

        for ordinal in sorted(buckets):
            if ordinal in ambiguous:
                continue
            fname, recs = buckets[ordinal][0]
            for k, rec in recs.items():
                derived[k] = rec

        stored_wk = stored_by_week.get(wk, {})
        derived_keys, stored_keys = set(derived), set(stored_wk)

        only_stored = sorted(stored_keys - derived_keys)
        only_source = sorted(derived_keys - stored_keys)
        differing = [k for k in (derived_keys & stored_keys)
                     if business_diff(stored_wk[k], derived[k])]
        total_conflicts += len(differing)

        d_gross = week_gross(list(derived.values()))
        s_gross = week_gross(list(stored_wk.values()))

        print(f"  stored records {len(stored_wk)} | source-derived {len(derived)}")
        print(f"  gross  stored {fmt_money(s_gross)} | source-derived {fmt_money(d_gross)} "
              f"| delta {d_gross - s_gross:+,.0f}")

        if differing:
            print(f"  VALUES DIFFER from the latest identifiable revision ({len(differing)}):")
            for k in sorted(differing):
                rec = derived[k]
                print(f"    {rec['show']} | {rec['theatre']} | {rec['city']}")
                for field, (o, n) in business_diff(stored_wk[k], rec).items():
                    print(f"        {field}: stored {o} -> source {n}")
        else:
            print("  stored values MATCH the latest identifiable revision")

        if only_stored:
            print(f"  in stored data but ABSENT from source files ({len(only_stored)}) — retained:")
            for k in only_stored:
                rec = stored_wk[k]
                print(f"    {rec['show']} | {rec['theatre']} | {rec['city']}")
        if only_source:
            print(f"  in source files but ABSENT from stored data ({len(only_source)}):")
            for k in only_source:
                rec = derived[k]
                print(f"    {rec['show']} | {rec['theatre']} | {rec['city']}")

        if differing or only_stored or only_source:
            total_mismatched_weeks += 1

    print("=" * 70)
    print("AUDIT SUMMARY")
    print(f"  weeks needing attention        : {total_mismatched_weeks}")
    print(f"  record-level conflicts         : {total_conflicts}")
    print(f"  weeks with ambiguous revisions : {total_ambiguous}")
    print("  No files were modified.")


# ── ENTRY POINT ─────────────────────────────────────────────────────────

USAGE = """Usage:
  python process_touring.py <input_dir> <output_file>
  python process_touring.py --append   <file.xlsx> <data.json>
  python process_touring.py --revision <file.xlsx> <data.json>
  python process_touring.py --audit    <reports_dir> <data.json> [--week YYYY-MM-DD]"""


def main():
    argv = sys.argv
    mode = argv[1] if len(argv) >= 2 else None

    if mode == '--append':
        if len(argv) != 4:
            print(USAGE)
            sys.exit(1)
        # A file named as a revision is routed to revision mode automatically,
        # so the unattended watcher picks up corrections without any change to
        # watcher.py. Plain filenames keep the original append behaviour.
        is_rev, _ = revision_marker(argv[2])
        if is_rev:
            main_revision(argv[2], argv[3])
        else:
            main_append(argv[2], argv[3])

    elif mode == '--revision':
        if len(argv) != 4:
            print(USAGE)
            sys.exit(1)
        main_revision(argv[2], argv[3])

    elif mode == '--audit':
        if len(argv) not in (4, 6):
            print(USAGE)
            sys.exit(1)
        only_week = None
        if len(argv) == 6:
            if argv[4] != '--week':
                print(USAGE)
                sys.exit(1)
            only_week = argv[5]
        main_audit(argv[2], argv[3], only_week)

    else:
        if len(argv) != 3:
            print(USAGE)
            sys.exit(1)
        main_rebuild(argv[1], argv[2])


if __name__ == '__main__':
    main()
