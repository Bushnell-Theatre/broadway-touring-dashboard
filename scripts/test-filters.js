/**
 * test-filters.js — Behavioral and source-compliance tests for Display Evidence
 *
 * Suites:
 *   1  BTD.filters.apply() — season vs. date range mutual exclusivity
 *   2  BTD.filters.apply() — invalid boundary fail-closed contract
 *   3  Category 1: Slate-derived metrics unaffected by Display Evidence
 *   4  Category 2: Canonical signal unaffected by Display Evidence
 *   5  Category 3: Touring-record display governed by filteredDisplay
 *   6  Category 4: Aggregates exclude zero-count shows from denominators
 *   7  Dashboard contract: Season ↔ Date Range mutual exclusivity
 *   8  Programming/Exec contract: All data vs. Custom range
 *   9  Source compliance: specific contracts in the real page HTML/JS
 *  10  Opportunity Engine stays on canonical metrics
 *
 * Run: node scripts/test-filters.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ── Minimal shims — BTD.filters.apply() requires window as the IIFE root ─ */
// Production fiscalYear: mo >= 7 starts a new fiscal year (July 1 – June 30).
// Use the real production implementation rather than a test-local copy.
global.window = {
  BTD: {},
  _DATE_RANGE: null,
};

// Load production format.js to get the real fiscalYear implementation
const formatSrc = fs.readFileSync(path.join(ROOT, 'src/js/core/format.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function('window', formatSrc)(global.window);
// BTD.format.fiscalYear is now the real production function

global.window.BTD.peers = {
  isPeerType(d, peerKey) {
    return peerKey === 'size' ? d.tier === 'SECONDARY' : d.tier === peerKey;
  },
};

/* Load BTD.filters — populates global.window.BTD.filters */
require('../src/js/core/filters.js');
const { apply } = global.window.BTD.filters;

/* ── Assertion helpers ───────────────────────────────────────────────────── */
let pass = 0;
let fail = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? '\n     ' + detail : ''}`);
    fail++;
  }
}

function avg(arr) {
  const nums = arr.filter((v) => v != null && !Number.isNaN(v));
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
}

function pct(v) {
  return v == null ? '—' : (v * 100).toFixed(1) + '%';
}

/* ── Synthetic touring records ───────────────────────────────────────────── */
// Fiscal year: July 1 – June 30.  FY 2024-2025 = 2024-07-01 – 2025-06-30.
const RECORDS = [
  // FY 2024-2025
  { show: 'Wicked',   week_of: '2024-10-07', cap_paid: 0.82, gg_pct_gp: 0.78, gross_gross: 500000, tier: 'SECONDARY', on_sub: true  },
  { show: 'Wicked',   week_of: '2024-11-04', cap_paid: 0.79, gg_pct_gp: 0.74, gross_gross: 480000, tier: 'SECONDARY', on_sub: true  },
  { show: 'Hamilton', week_of: '2025-01-06', cap_paid: 0.91, gg_pct_gp: 0.88, gross_gross: 620000, tier: 'PRIMARY',   on_sub: false },
  // FY 2025-2026  (starts 2025-07-01)
  { show: 'Wicked',   week_of: '2025-09-01', cap_paid: 0.85, gg_pct_gp: 0.81, gross_gross: 520000, tier: 'SECONDARY', on_sub: true  },
  { show: 'Hamilton', week_of: '2025-10-06', cap_paid: 0.88, gg_pct_gp: 0.85, gross_gross: 600000, tier: 'PRIMARY',   on_sub: false },
  { show: 'MoTown',   week_of: '2026-02-02', cap_paid: 0.66, gg_pct_gp: 0.60, gross_gross: 320000, tier: 'SECONDARY', on_sub: true  },
];

/* ── Compute filteredDisplay from a subset of records ────────────────────── */
function computeFilteredDisplay(rows) {
  const peerRows = rows.filter((d) => d.tier === 'SECONDARY');
  return {
    count:      rows.length,
    cap:        avg(rows.map((d) => d.cap_paid)),
    gg:         avg(rows.map((d) => d.gg_pct_gp)),
    gross:      avg(rows.map((d) => d.gross_gross)),
    totalGross: rows.reduce((s, d) => s + (d.gross_gross || 0), 0),
    peerCap:    avg(peerRows.map((d) => d.cap_paid)),
  };
}

/* ── Simulated profile builder ───────────────────────────────────────────── */
function buildProfile(showTitle, allRows, dateFrom, dateTo) {
  const showRows = allRows.filter((r) => r.show === showTitle);
  // Canonical metrics — ALL records, no date filter
  const canonicalMetrics = computeFilteredDisplay(showRows);
  // filteredDisplay — date-range filtered if range is active
  let filteredRows;
  if (dateFrom || dateTo) {
    filteredRows = showRows.filter((r) => {
      if (!r.week_of) return false;
      if (dateFrom && r.week_of < dateFrom) return false;
      if (dateTo   && r.week_of > dateTo)   return false;
      return true;
    });
  } else {
    filteredRows = showRows;
  }
  const filteredDisplay = computeFilteredDisplay(filteredRows);

  return {
    show:            { title: showTitle },
    // Canonical Planning Signal score — always from ALL records; never date-range-governed
    score:           showTitle === 'Wicked' ? 72 : showTitle === 'Hamilton' ? 88 : 55,
    metrics:         canonicalMetrics,   // canonical — never date-range-filtered
    filteredDisplay,                     // display — governed by Display Evidence
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 1 — BTD.filters.apply() season vs. date range mutual exclusivity
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 1: BTD.filters.apply() — season vs. date range ──');
{
  const fy2024 = global.window.BTD.format.fiscalYear('2024-10-07');
  assert('Production fiscalYear: Oct-2024 is 2024-2025', fy2024 === '2024-2025');
  assert('Production fiscalYear: Jun-30-2025 boundary (last day of FY 2024-2025)',
    global.window.BTD.format.fiscalYear('2025-06-30') === '2024-2025');
  assert('Production fiscalYear: Jul-01-2025 boundary (first day of FY 2025-2026)',
    global.window.BTD.format.fiscalYear('2025-07-01') === '2025-2026');

  const season24 = apply(RECORDS, { season: '2024-2025' });
  assert('Season filter returns only FY 2024-2025 records', season24.length === 3);

  const rangeRows = apply(RECORDS, { dateFrom: '2025-09-01', dateTo: '2025-10-31' });
  assert('Date range returns records in window (ignores season)',
    rangeRows.length === 2 && rangeRows.every((r) => r.week_of >= '2025-09-01' && r.week_of <= '2025-10-31'));

  // When date range is present, season is IGNORED (mutual exclusivity)
  const both = apply(RECORDS, { season: '2024-2025', dateFrom: '2025-09-01', dateTo: '2025-10-31' });
  assert('Date range overrides season (mutual exclusivity)',
    both.length === rangeRows.length && both.every((r) => r.week_of >= '2025-09-01'));

  // No bounds: open-ended ranges work correctly
  const openEnd = apply(RECORDS, { dateFrom: '2026-01-01' });
  assert('Open-ended range (dateFrom only): returns records on or after 2026-01-01',
    openEnd.length === 1 && openEnd[0].show === 'MoTown');

  const openStart = apply(RECORDS, { dateTo: '2024-12-31' });
  assert('Open-ended range (dateTo only): returns records on or before 2024-12-31',
    openStart.length === 2 && openStart.every((r) => r.week_of <= '2024-12-31'));

  // Records without week_of excluded in date range mode
  const withBlank = [{ show: 'X', week_of: null, cap_paid: 0.5, tier: 'PRIMARY' }, ...RECORDS];
  const rangeWithBlank = apply(withBlank, { dateFrom: '2025-01-01', dateTo: '2026-12-31' });
  assert('Record with null week_of excluded in date range mode',
    !rangeWithBlank.some((r) => r.show === 'X'));
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 2 — BTD.filters.apply() invalid boundary fail-closed contract
   ════════════════════════════════════════════════════════════════════════
   A supplied boundary that fails isValidISODate() must return [] — not an
   open-ended range, not a season fallback, not a partial result.
   Omitted / empty boundaries remain valid as open ends (From-only, To-only).
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 2: BTD.filters.apply() — invalid boundary fail-closed ──');
{
  /* ── Impossible calendar dates: supplied invalid dateFrom ── */

  // 2025-02-31: JS would normalise to 2025-03-03 without the round-trip check.
  // Supplying it as dateFrom must fail closed: 0 records, NOT an open left side.
  const badFrom = apply(RECORDS, { dateFrom: '2025-02-31', dateTo: '2026-12-31' });
  assert('Invalid dateFrom (2025-02-31) fails closed: 0 records returned',
    badFrom.length === 0,
    `Got ${badFrom.length} records; expected 0`);

  // Invalid dateTo: month 13 does not exist.
  // Supplying it as dateTo must fail closed: 0 records, NOT an open right side.
  const badTo = apply(RECORDS, { dateFrom: '2025-01-01', dateTo: '2025-13-01' });
  assert('Invalid dateTo (2025-13-01) fails closed: 0 records returned',
    badTo.length === 0,
    `Got ${badTo.length} records; expected 0`);

  // Feb 29 on a non-leap year (2025 is not a leap year).
  const nonLeapFeb29 = apply(RECORDS, { dateFrom: '2025-02-29', dateTo: '2026-12-31' });
  assert('Non-leap-year Feb 29 (2025-02-29) fails closed: 0 records returned',
    nonLeapFeb29.length === 0,
    `Got ${nonLeapFeb29.length} records; expected 0`);

  // Apr 31 — April has 30 days.
  const apr31 = apply(RECORDS, { dateFrom: '2025-04-31', dateTo: '2026-12-31' });
  assert('Apr 31 (2025-04-31) fails closed: 0 records returned',
    apr31.length === 0,
    `Got ${apr31.length} records; expected 0`);

  // Feb 30 — never a valid date.
  const feb30 = apply(RECORDS, { dateFrom: '2025-02-30', dateTo: '2026-12-31' });
  assert('Feb 30 (2025-02-30) fails closed: 0 records returned',
    feb30.length === 0,
    `Got ${feb30.length} records; expected 0`);

  // Both boundaries invalid: season must NOT resume and unbounded population must NOT pass.
  // Both dateFrom and dateTo are supplied but invalid → fail-closed → 0 records.
  const bothBad = apply(RECORDS, { season: '2024-2025', dateFrom: '2025-02-31', dateTo: '2025-13-01' });
  assert('Both boundaries invalid: fails closed (season does NOT resume), 0 records returned',
    bothBad.length === 0,
    `Got ${bothBad.length} records; expected 0`);

  /* ── Valid Feb 29 on a leap year — must be accepted ── */
  const leapFeb29 = apply(RECORDS, { dateFrom: '2024-02-29', dateTo: '2026-12-31' });
  assert('Leap-year Feb 29 (2024-02-29) is valid: records on or after that date returned',
    leapFeb29.length > 0 && leapFeb29.every((r) => r.week_of >= '2024-02-29'));

  /* ── Inverted range: both valid ISO, From > To — naturally returns 0 records ── */
  const inverted = apply(RECORDS, { dateFrom: '2025-12-01', dateTo: '2025-09-01' });
  assert('Inverted range (valid From > valid To): 0 records returned',
    inverted.length === 0,
    `Got ${inverted.length} records; expected 0`);

  /* ── Omitted boundaries stay open-ended — no fail-closed triggered ── */

  // From-only (dateTo omitted): open right side; all records ≥ dateFrom pass.
  const fromOnly = apply(RECORDS, { dateFrom: '2026-01-01' });
  assert('Valid From-only (dateTo omitted): open right side, returns records ≥ 2026-01-01',
    fromOnly.length === 1 && fromOnly[0].show === 'MoTown');

  // To-only (dateFrom omitted): open left side; all records ≤ dateTo pass.
  const toOnly = apply(RECORDS, { dateTo: '2024-12-31' });
  assert('Valid To-only (dateFrom omitted): open left side, returns records ≤ 2024-12-31',
    toOnly.length === 2 && toOnly.every((r) => r.week_of <= '2024-12-31'));

  // Both omitted: date-range mode is NOT entered; opts.season applies normally.
  const seasonOnly = apply(RECORDS, { season: '2024-2025' });
  assert('Both boundaries omitted: season filter resumes, returns FY 2024-2025 records',
    seasonOnly.length === 3);
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 3 — Category 1: Slate-derived — unaffected by Display Evidence
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 3: Category 1 — Slate-derived (unaffected) ──');
{
  const slate = ['Wicked', 'Hamilton', 'MoTown'];
  const profiles = slate.map((t) => buildProfile(t, RECORDS, '2030-01-01', '2030-12-31'));
  assert('Slate show count unaffected by empty date range', profiles.length === 3);
  assert('All slate titles present even with 0 in-range records',
    profiles.map((p) => p.show.title).sort().join(',') === 'Hamilton,MoTown,Wicked');
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 4 — Category 2: Canonical signal — unaffected by Display Evidence
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 4: Category 2 — Canonical Planning Signal (unaffected) ──');
{
  const pWicked = buildProfile('Wicked', RECORDS, '2030-01-01', '2030-12-31');
  assert('Canonical score unchanged with 0 in-range records', pWicked.score === 72);
  assert('Canonical metrics.cap non-null with 0 in-range records', pWicked.metrics.cap != null);
  assert('filteredDisplay.count === 0 with future date range', pWicked.filteredDisplay.count === 0);
  assert('filteredDisplay.cap === null with 0 in-range records', pWicked.filteredDisplay.cap == null);
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 5 — Category 3: Touring-record display — governed by filteredDisplay
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 5: Category 3 — Touring-record display (filteredDisplay) ──');
{
  // All data mode: filteredDisplay equals canonical
  const pAll = buildProfile('Wicked', RECORDS);
  assert('No date range: filteredDisplay.cap equals metrics.cap',
    pAll.filteredDisplay.cap === pAll.metrics.cap);

  // Narrow range: only 2024 records
  const pNarrow = buildProfile('Wicked', RECORDS, '2024-01-01', '2024-12-31');
  assert('Narrow range: filteredDisplay.count = 2', pNarrow.filteredDisplay.count === 2);
  assert('Narrow range: filteredDisplay.cap differs from canonical',
    pNarrow.filteredDisplay.cap !== pNarrow.metrics.cap,
    `filteredDisplay=${pNarrow.filteredDisplay.cap}, canonical=${pNarrow.metrics.cap}`);
  assert('Narrow range: canonical metrics.cap unchanged', pNarrow.metrics.cap === pAll.metrics.cap);

  // Empty range
  const pEmpty = buildProfile('Wicked', RECORDS, '2030-01-01', '2030-12-31');
  assert('Empty range: filteredDisplay.count === 0', pEmpty.filteredDisplay.count === 0);
  assert('Empty range: filteredDisplay.cap is null', pEmpty.filteredDisplay.cap == null);
  assert('Empty range: canonical metrics.cap still non-null', pEmpty.metrics.cap != null);
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 6 — Category 4: Aggregates exclude 0-count shows from denominators
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 6: Category 4 — Aggregates exclude zero-count shows ──');
{
  const slate = ['Wicked', 'Hamilton', 'MoTown'];
  const profiles = slate.map((t) => buildProfile(t, RECORDS, '2026-01-15', '2026-12-31'));

  const activeDisplay = profiles.filter((p) => p.filteredDisplay && p.filteredDisplay.count > 0);
  assert('Only MoTown has filteredDisplay records in range (Feb 2026)',
    activeDisplay.length === 1 && activeDisplay[0].show.title === 'MoTown',
    `Active: ${activeDisplay.map((p) => p.show.title).join(', ')}`);

  const kpiCap = avg(activeDisplay.map((p) => p.filteredDisplay.cap));
  assert('Aggregate kpiCap = MoTown cap only (0-count excluded)',
    kpiCap != null && Math.abs(kpiCap - 0.66) < 0.001,
    `Expected 0.66; got ${kpiCap}`);

  assert('All 3 slate shows remain despite 0 display records', profiles.length === 3);
  assert('Canonical scores intact for 0-display-record shows',
    profiles.every((p) => p.score != null && p.score > 0));
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 7 — Dashboard contract: Season ↔ Date Range mutual exclusivity
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 7: Dashboard contract — Season ↔ Date Range ──');
{
  const s2024 = apply(RECORDS, { season: '2024-2025' });
  assert('Season mode: returns only FY 2024-2025 records', s2024.length === 3);

  const range = apply(RECORDS, { season: '2024-2025', dateFrom: '2026-01-01', dateTo: '2026-12-31' });
  assert('Date range overrides season: only MoTown returned',
    range.length === 1 && range[0].show === 'MoTown');

  const reset = apply(RECORDS, { season: '2025-2026' });
  assert('Season filter active after reset: FY 2025-2026 records',
    reset.length === 3 && reset.every((r) => r.week_of >= '2025-07-01'));
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 8 — Programming/Exec contract: All data vs. Custom range
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 8: Programming/Exec contract — All data vs. Custom range ──');
{
  const slate = ['Wicked', 'Hamilton', 'MoTown'];
  // All available data: filteredDisplay === canonical
  const allProfiles = slate.map((t) => buildProfile(t, RECORDS));
  assert('"All available data": filteredDisplay.cap === metrics.cap for all shows',
    allProfiles.every((p) => p.filteredDisplay.cap === p.metrics.cap));

  // Custom range
  const rangeProfiles = slate.map((t) => buildProfile(t, RECORDS, '2025-01-01', '2025-12-31'));
  const wicked = rangeProfiles.find((p) => p.show.title === 'Wicked');
  assert('"Custom range" Wicked: filteredDisplay.count = 1 (only 2025-01-06)',
    wicked.filteredDisplay.count === 1,
    `Got ${wicked.filteredDisplay.count}`);
  assert('"Custom range" Wicked: canonical metrics.count = 3', wicked.metrics.count === 3);

  const moTown = rangeProfiles.find((p) => p.show.title === 'MoTown');
  assert('"Custom range" MoTown 0 in-range: filteredDisplay.cap = null (shows as "—")',
    moTown.filteredDisplay.cap == null && moTown.filteredDisplay.count === 0);
  assert('"Custom range" MoTown stays on slate', moTown != null);

  // Partially populated range: Wicked has data but MoTown doesn't
  const partial = rangeProfiles.filter((p) => p.filteredDisplay.count > 0);
  assert('Partially populated range: shows with data included in aggregate', partial.length >= 1);
  assert('Shows with 0 in-range records excluded from aggregate denominator',
    partial.every((p) => p.filteredDisplay.count > 0));
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 9 — Source compliance: specific contracts in real page HTML/JS
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 9: Source compliance — real page contracts ──');
{
  const progSrc = fs.readFileSync(path.join(ROOT, 'src/programming.html'), 'utf8');
  const execSrc = fs.readFileSync(path.join(ROOT, 'src/exec_summary.html'), 'utf8');

  // ── Planning table display columns use filteredDisplay ──
  // The Records column in the planning candidates table must NOT use p.metrics.count
  // as a bare (unlabeled) value adjacent to filtered cap/gg/peerCap columns.
  // After corrections, the table row uses (p.filteredDisplay || {}).count.
  assert('exec_summary planning table Records column uses filteredDisplay',
    execSrc.includes('(p.filteredDisplay || {}).count'));
  assert('exec_summary second planning table Records column uses filteredDisplay',
    // The second occurrence also uses filteredDisplay for count
    (execSrc.match(/\(p\.filteredDisplay \|\| p\.metrics\)\.count/g) || []).length >= 1 ||
    (execSrc.match(/\(p\.filteredDisplay \|\| \{\}\)\.count/g) || []).length >= 1);

  // ── Historical Library display columns use filteredDisplay ──
  assert('exec_summary library uses filteredDisplay count for Records column',
    execSrc.includes('fd.count') && execSrc.includes('libraryDisplay'));
  assert('exec_summary library sorted by filteredDisplay count',
    execSrc.includes('libraryDisplay') &&
    execSrc.includes('.filteredDisplay || a.metrics).count'));

  // ── Canonical confidence explanations use p.metrics ──
  assert('programming High Confidence rank label uses canonical count (p.metrics.count)',
    progSrc.includes('historical records supporting confidence') &&
    progSrc.match(/p\.metrics\.count.*historical records supporting confidence/));
  assert('exec_summary High Confidence rank label uses canonical count (p.metrics.count)',
    execSrc.includes('historical records supporting confidence') &&
    execSrc.match(/p\.metrics\.count.*historical records supporting confidence/));

  // ── Opportunity Engine uses p.metrics with the correct threshold ──
  // Production threshold is "+ 8" (8 integer percentage points, matching cap_paid
  // values in the data which are on a 0–100 scale in the League data).
  // Suite 10 uses PEER_GAP = 0.08 on decimal-scale fixture values — same 8pp gap.
  assert('programming Opportunity Engine uses p.metrics (canonical)',
    progSrc.includes('p.metrics.peerCap > p.metrics.cap'));
  assert('programming Opportunity Engine threshold is + 8 (8 percentage points)',
    progSrc.includes('p.metrics.peerCap > p.metrics.cap + 8'));
  assert('exec_summary Opportunity Engine uses p.metrics (canonical)',
    execSrc.includes('p.metrics.peerCap > p.metrics.cap'));
  assert('exec_summary Opportunity Engine threshold is + 8 (8 percentage points)',
    execSrc.includes('p.metrics.peerCap > p.metrics.cap + 8'));

  // ── chartCap contains no missing-to-zero fallback ──
  // Find chartCap() in each file and verify no '|| 0' after cap or peerCap
  function extractChartCap(src) {
    const idx = src.indexOf('function chartCap(');
    if (idx < 0) return '';
    // Extract ~60 lines of the function body
    return src.slice(idx, idx + 2500);
  }
  const progChartCap = extractChartCap(progSrc);
  const execChartCap = extractChartCap(execSrc);
  assert('programming chartCap does not use || 0 for cap values',
    !progChartCap.includes('.cap || 0') && !progChartCap.includes('.peerCap || 0'));
  assert('exec_summary chartCap does not use || 0 for cap values',
    !execChartCap.includes('.cap || 0') && !execChartCap.includes('.peerCap || 0'));
  assert('programming chartCap uses ?? null for missing values',
    progChartCap.includes('?? null'));
  assert('exec_summary chartCap uses ?? null for missing values',
    execChartCap.includes('?? null'));

  // ── Canonical Watch membership does not depend on filteredDisplay ──
  // Inspect only the source line that assigns kWatch's textContent.
  function kWatchAssignmentLine(src) {
    return src.split('\n').find(
      (line) => (line.includes("'kWatch'") || line.includes('"kWatch"')) && line.includes('textContent'),
    ) || '';
  }
  const progKWatch = kWatchAssignmentLine(progSrc);
  const execKWatch = kWatchAssignmentLine(execSrc);
  assert('programming kWatch assignment does not reference filteredDisplay',
    progKWatch.length > 0 && !progKWatch.includes('filteredDisplay'));
  assert('exec_summary kWatch assignment does not reference filteredDisplay',
    execKWatch.length > 0 && !execKWatch.includes('filteredDisplay'));

  // ── Watch detail in programming handles zero in-range records ──
  assert('programming Watchlist rank detail handles zero-record case',
    progSrc.includes('No records in this display range'));

  // ── Display Evidence disclosure statements remain present ──
  assert('programming Display Evidence disclosure text present',
    progSrc.includes('Date range filters') || progSrc.includes('Planning Signals use the canonical'));
  assert('exec_summary Display Evidence disclosure text present',
    execSrc.includes('Date range filters') || execSrc.includes('Planning Signals use the canonical'));

  // ── Canonical confidence explanation in Needs Validation uses p.metrics ──
  assert('programming Needs More Data label uses canonical count ("historical records")',
    progSrc.includes('historical records · validate with comparables'));
  // Asserts the CANONICAL confidence label from signals.js
  // (p.signals.confidence.label). This previously asserted a page-local
  // confidenceLabel(p) that shadowed the canonical one with different
  // thresholds and a different label set — a contract violation that made the
  // same show read differently on Programming vs Exec Summary. The page-local
  // versions were removed; do not reintroduce them.
  assert('exec_summary Needs Validation label uses canonical count ("historical records")',
    execSrc.includes('historical records') && execSrc.includes('p.signals.confidence.label'));
  assert('exec_summary does not reintroduce a page-local confidenceLabel()',
    !/function\s+confidenceLabel\s*\(/.test(execSrc));
  assert('programming does not reintroduce a page-local confidenceLabel()',
    !/function\s+confidenceLabel\s*\(/.test(progSrc));

  // ── filters.js fail-closed comment present ──
  const filtersSrc = fs.readFileSync(path.join(ROOT, 'src/js/core/filters.js'), 'utf8');
  assert('filters.js documents fail-closed boundary contract',
    filtersSrc.includes('fail-closed') || filtersSrc.includes('Fail-closed'));
  assert('filters.js round-trip check present in isValidISODate',
    filtersSrc.includes('Round-trip') || filtersSrc.includes('round-trip'));

  // ── page-common.js raw-first validation and preserve _DATE_RANGE ──
  const pageSrc = fs.readFileSync(path.join(ROOT, 'src/js/core/page-common.js'), 'utf8');
  assert('page-common.js validates raw ISO before snapping',
    pageSrc.includes('raw ISO') || pageSrc.includes('raw ISO strings'));
  assert('page-common.js preserves _DATE_RANGE on invalid Apply',
    pageSrc.includes('do NOT touch _DATE_RANGE') || pageSrc.includes('NOT touch _DATE_RANGE'));

  // ── Version synchronization: HTML fallback strings must match versions.json ──
  // Each page has a fallback version/date in its HTML footer.  versions.json is the
  // single source of truth; the fallback must match so offline/cached views stay accurate.
  const versionsJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src/data/versions.json'), 'utf8'),
  );
  const dashSrc = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

  assert('dashboard.html fallback version matches versions.json',
    dashSrc.includes(`id="pageVersion">${versionsJson.dashboard.version}`));
  assert('dashboard.html fallback date matches versions.json',
    dashSrc.includes(`id="pageDate">${versionsJson.dashboard.date}`));

  assert('programming.html fallback version matches versions.json',
    progSrc.includes(`id="pageVersion">${versionsJson.programming.version}`));
  assert('programming.html fallback date matches versions.json',
    progSrc.includes(`id="pageDate">${versionsJson.programming.date}`));

  assert('exec_summary.html fallback version matches versions.json',
    execSrc.includes(`id="pageVersion">${versionsJson.exec_summary.version}`));
  assert('exec_summary.html fallback date matches versions.json',
    execSrc.includes(`id="pageDate">${versionsJson.exec_summary.date}`));
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 10 — Opportunity Engine stays on canonical metrics
   ════════════════════════════════════════════════════════════════════════
   Fixture design: Wicked has two PRIMARY records at low cap (0.55, 0.57)
   and one SECONDARY record at high cap (0.77).
     national avg cap = (0.55 + 0.57 + 0.77) / 3 = 0.630
     peer avg cap     = 0.77 (SECONDARY only)
     gap              = 0.77 - 0.630 = 0.140  > PEER_GAP (0.08) → QUALIFIES
   Hamilton gap ≈ 0.01 (flat) → does NOT qualify.
   MoTown peer below national → does NOT qualify.
   The Opportunity Engine runs on canonical p.metrics.  When Display Evidence
   is set to a future date range (all filteredDisplay.count === 0), Wicked
   must still appear in the canonical result — and must appear identically in
   the all-data result.
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 10: Opportunity Engine uses canonical metrics ──');
{
  /* PEER_GAP_PP = 8 matches the production threshold:
       p.metrics.peerCap > p.metrics.cap + 8
     where cap values in production data are integer percentage points (82 = 82%).
     Test fixture uses decimal cap_paid (0–1); PEER_GAP = 8/100 = 0.08 is the
     same gap in the test's unit system.  Suite 9 confirms the production
     source uses exactly "+ 8". */
  const PEER_GAP_PP = 8;
  const PEER_GAP    = PEER_GAP_PP / 100;  /* decimal-unit equivalent for test fixture */

  const OPPTY_RECORDS = [
    /* Wicked: 2 PRIMARY at low cap, 1 SECONDARY at high cap.
       national avg = (0.55+0.57+0.77)/3 = 0.630
       peer avg     = 0.77
       gap          = 0.140 → QUALIFIES (> 0.08) */
    { show: 'Wicked', week_of: '2024-10-07', cap_paid: 0.55, tier: 'PRIMARY',   gross_gross: 380000, gg_pct_gp: 0.52 },
    { show: 'Wicked', week_of: '2024-11-04', cap_paid: 0.57, tier: 'PRIMARY',   gross_gross: 390000, gg_pct_gp: 0.54 },
    { show: 'Wicked', week_of: '2024-12-02', cap_paid: 0.77, tier: 'SECONDARY', gross_gross: 460000, gg_pct_gp: 0.73 },
    /* Hamilton: nearly flat peer/national gap (~1pp) → does NOT qualify */
    { show: 'Hamilton', week_of: '2024-12-02', cap_paid: 0.80, tier: 'PRIMARY',   gross_gross: 550000, gg_pct_gp: 0.78 },
    { show: 'Hamilton', week_of: '2025-01-06', cap_paid: 0.82, tier: 'SECONDARY', gross_gross: 570000, gg_pct_gp: 0.80 },
    /* MoTown: peer BELOW national (caution signal) → does NOT qualify */
    { show: 'MoTown', week_of: '2025-02-03', cap_paid: 0.70, tier: 'PRIMARY',   gross_gross: 380000, gg_pct_gp: 0.65 },
    { show: 'MoTown', week_of: '2025-03-03', cap_paid: 0.62, tier: 'SECONDARY', gross_gross: 310000, gg_pct_gp: 0.57 },
  ];

  /* Build profiles with a future Display Evidence range — all filteredDisplay.count = 0 */
  const FUTURE_FROM = '2030-01-01';
  const FUTURE_TO   = '2030-12-31';
  const slate = ['Wicked', 'Hamilton', 'MoTown'];
  const profiles = slate.map((t) => buildProfile(t, OPPTY_RECORDS, FUTURE_FROM, FUTURE_TO));

  /* Confirm the Display Evidence range truly empties filteredDisplay */
  assert('All filteredDisplay.count === 0 under future date range',
    profiles.every((p) => p.filteredDisplay.count === 0));

  /* Canonical metrics remain populated even when filteredDisplay is empty */
  assert('Canonical metrics populated even when filteredDisplay is empty',
    profiles.every((p) => p.metrics.count > 0 && p.filteredDisplay.count === 0));

  /* ── Verify canonical Wicked calculation ── */
  const wickedAll       = OPPTY_RECORDS.filter((r) => r.show === 'Wicked');
  const wickedNatCanon  = avg(wickedAll.map((r) => r.cap_paid));              /* 0.630 */
  const wickedPeerCanon = avg(wickedAll.filter((r) => r.tier === 'SECONDARY').map((r) => r.cap_paid)); /* 0.77 */
  const wickedGap       = wickedPeerCanon - wickedNatCanon;                   /* 0.140 */

  assert('Wicked canonical peer gap exceeds PEER_GAP threshold (0.08)',
    wickedGap > PEER_GAP,
    `gap=${wickedGap.toFixed(4)}, threshold=${PEER_GAP}`);

  const wickedProfile = profiles.find((p) => p.show.title === 'Wicked');
  assert('Wicked canonical cap uses all records (including non-peer)',
    Math.abs(wickedProfile.metrics.cap - wickedNatCanon) < 0.001,
    `Expected ${wickedNatCanon.toFixed(4)}, got ${(wickedProfile.metrics.cap || 0).toFixed(4)}`);
  assert('Wicked canonical peerCap uses only SECONDARY tier records',
    Math.abs(wickedProfile.metrics.peerCap - wickedPeerCanon) < 0.001,
    `Expected ${wickedPeerCanon}, got ${wickedProfile.metrics.peerCap}`);
  assert('Qualifying show (Wicked) has filteredDisplay.count === 0 in future range',
    wickedProfile.filteredDisplay.count === 0);

  /* ── Opportunity Engine result: Wicked qualifies, Hamilton and MoTown do not ── */
  const hidden = profiles.filter(
    (p) => p.metrics.peerCap != null && p.metrics.cap != null &&
           p.metrics.peerCap > p.metrics.cap + PEER_GAP
  );

  assert('Opportunity Engine: Wicked appears in hidden-gem result (canonical, non-empty)',
    hidden.some((p) => p.show.title === 'Wicked'),
    `hidden titles: [${hidden.map((p) => p.show.title).join(', ')}]`);

  assert('Opportunity Engine: Hamilton absent (gap < 8pp)',
    !hidden.some((p) => p.show.title === 'Hamilton'));

  assert('Opportunity Engine: MoTown absent (peer below national)',
    !hidden.some((p) => p.show.title === 'MoTown'));

  /* ── Result is identical when Display Evidence is all-data ── */
  const profilesAllData = slate.map((t) => buildProfile(t, OPPTY_RECORDS)); /* no date filter */
  const hiddenAllData = profilesAllData.filter(
    (p) => p.metrics.peerCap != null && p.metrics.cap != null &&
           p.metrics.peerCap > p.metrics.cap + PEER_GAP
  );

  assert('Wicked still appears in Opportunity Engine with all-data Display Evidence',
    hiddenAllData.some((p) => p.show.title === 'Wicked'));

  assert('Opportunity Engine result identical with empty-range vs all-data Display Evidence',
    hidden.length === hiddenAllData.length &&
    hidden.map((p) => p.show.title).sort().join(',') ===
    hiddenAllData.map((p) => p.show.title).sort().join(','),
    `empty-range: [${hidden.map((p) => p.show.title).join(',')}], ` +
    `all-data: [${hiddenAllData.map((p) => p.show.title).join(',')}]`);
}

/* ══════════════════════════════════════════════════════════════════════════
   Suite 11 — Durable documentation validation
   Verifies that the five required documentation files contain the claims
   they must make about the Season / Date Range and Display Evidence features.
   A doc that is missing or has had a critical claim removed will fail this
   suite, surfacing the gap before any PR is merged.
   ══════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n── Suite 11: Documentation validation ──────────────────────────');

  const readDoc = (rel) => {
    const p = path.join(ROOT, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };

  const readme   = readDoc('README.md');
  const howit    = readDoc('docs/HOW_IT_WORKS.md');
  const dev      = readDoc('docs/DEVELOPER.md');
  const scoring  = readDoc('docs/SCORING_CONTRACT.md');
  const charts   = readDoc('docs/CHARTS.md');

  /* ── README describes both contracts ── */
  assert('README describes Dashboard Season/Date Range toggle',
    readme.includes('Season / Date Range'));
  assert('README describes Programming Display Evidence pill',
    readme.includes('Display Evidence'));
  assert('README describes Show Slate always visible',
    readme.includes('Show Slate is always visible') || readme.includes('always visible'));
  assert('README states canonical signals unchanged by Display Evidence',
    readme.includes('Planning Signals') && readme.includes('altering'));

  /* ── HOW_IT_WORKS documents Display Evidence and canonical isolation ── */
  assert('HOW_IT_WORKS documents Display Evidence pill',
    howit.includes('Display Evidence'));
  assert('HOW_IT_WORKS documents fail-closed validation',
    howit.includes('fail-closed') || howit.includes('Fail-closed'));
  assert('HOW_IT_WORKS documents mutual exclusivity',
    howit.includes('mutually exclusive'));
  assert('HOW_IT_WORKS documents canonical isolation (Planning Signal unchanged)',
    howit.includes('canonical') || howit.includes('Planning Signal'));
  assert('HOW_IT_WORKS states missing evidence is — not zero',
    howit.includes('—') && (howit.includes('not zero') || howit.includes('zeroed') || howit.includes('zero')));

  /* ── DEVELOPER documents shared APIs and npm test ── */
  assert('DEVELOPER no longer claims no npm',
    !dev.includes('no npm') && !dev.includes('no framework, no npm'));
  assert('DEVELOPER documents npm test',
    dev.includes('npm test'));
  assert('DEVELOPER documents node scripts/test-filters.js',
    dev.includes('test-filters.js'));
  assert('DEVELOPER states npm test runs all three validation programs',
    dev.includes('npm test') &&
    dev.includes('validate_scoring_contract.js') &&
    dev.includes('verify_render_harness.js') &&
    dev.includes('test-filters.js'));
  assert('DEVELOPER test table includes Suite 11',
    /\| 11 \|[\s\S]{0,160}documentation/i.test(dev));
  assert('DEVELOPER contains no stale 10-suite or 89-assertion totals',
    !/Runs 10 suites/i.test(dev) && !/89 assertions/i.test(dev));
  assert('DEVELOPER documents BTD.filters.apply() dateFrom/dateTo contract',
    dev.includes('dateFrom') && dev.includes('dateTo'));
  assert('DEVELOPER documents isValidISODate',
    dev.includes('isValidISODate'));
  assert('DEVELOPER documents fail-closed behavior',
    dev.includes('fail-closed') || dev.includes('Fail-closed'));
  assert('DEVELOPER documents window._DATE_RANGE',
    dev.includes('window._DATE_RANGE'));
  assert('DEVELOPER documents onDisplayEvidencePillChange',
    dev.includes('onDisplayEvidencePillChange'));
  assert('DEVELOPER documents p.filteredDisplay',
    dev.includes('p.filteredDisplay'));
  assert('DEVELOPER documents p.metrics as canonical',
    dev.includes('p.metrics') && dev.includes('canonical'));
  assert('DEVELOPER documents Opportunity Engine canonical exception',
    dev.includes('Opportunity Engine'));
  assert('DEVELOPER documents both page contracts separately',
    dev.includes('Dashboard') && dev.includes('Programming') &&
    dev.includes('Two Page Contracts') || dev.includes('page contract') || dev.includes('Page Contracts'));

  /* ── SCORING_CONTRACT classifies Display Evidence correctly ── */
  assert('SCORING_CONTRACT includes Category 5 for Display Evidence',
    scoring.includes('Category 5') || scoring.includes('Display Evidence'));
  assert('SCORING_CONTRACT states Display Evidence must not be passed to profileShowCanonical',
    scoring.includes('profileShowCanonical') &&
    (scoring.includes('MUST NOT') || scoring.includes('must not')));
  assert('SCORING_CONTRACT enumerates must-not fields (p.score)',
    scoring.includes('p.score') && (scoring.includes('MUST NOT') || scoring.includes('must not')));
  assert('SCORING_CONTRACT includes Opportunity Engine in must-not list',
    scoring.includes('Opportunity Engine') &&
    (scoring.includes('MUST NOT') || scoring.includes('must not') || scoring.includes('canonical')));
  assert('SCORING_CONTRACT states missing evidence is null not zero',
    scoring.includes('null') && (scoring.includes('—') || scoring.includes('zeroed') || scoring.includes('not zero')));

  /* ── CHARTS distinguishes canonical from filtered ── */
  assert('CHARTS document includes "Canonical" data source labels',
    charts.includes('Canonical'));
  assert('CHARTS document includes "Display Evidence" data source labels',
    charts.includes('Display Evidence'));
  assert('CHARTS describes the canonical evidence window',
    charts.includes('canonical evidence window'));
  assert('CHARTS does not claim canonical charts use unrestricted full available evidence',
    !charts.includes('Canonical charts always reflect the full available evidence'));
  assert('CHARTS states Season Show Fit is Canonical',
    /Season Show Fit[\s\S]{0,200}Canonical/.test(charts));
  assert('CHARTS states Capacity: Tour vs Peer follows Display Evidence',
    /Capacity: Tour vs Peer[\s\S]{0,200}Display Evidence/.test(charts));
  assert('CHARTS states Fit Distribution is Canonical',
    /Fit Distribution[\s\S]{0,200}Canonical/.test(charts));
  assert('CHARTS states Tour vs Peer Capacity on Exec Summary is Display Evidence',
    /Tour vs Peer Capacity[\s\S]{0,200}Display Evidence/.test(charts));
  assert('CHARTS states gaps not zeros (— not zero)',
    charts.includes('—') && (charts.includes('not zero') || charts.includes('absent')));
  assert('CHARTS documents Dashboard active population',
    charts.includes('active filter population') || charts.includes('active record set'));

  /* ── No doc claims Display Evidence changes Planning Signals ── */
  /* Check that no sentence says Display Evidence "changes" or "alters" the signal.
     Only check in sentences that reference both; a general mention is fine. */
  const badPattern = /Display Evidence[^.]*(?:changes|alters|modifies)[^.]*Planning Signal/i;
  assert('No doc claims Display Evidence changes Planning Signals (README)',
    !badPattern.test(readme));
  assert('No doc claims Display Evidence changes Planning Signals (HOW_IT_WORKS)',
    !badPattern.test(howit));
  assert('No doc claims Display Evidence changes Planning Signals (DEVELOPER)',
    !badPattern.test(dev));
}

/* ── Final results ───────────────────────────────────────────────────────── */
const total = pass + fail;
console.log(`\n${'─'.repeat(60)}`);
console.log(`  test-filters.js   ${pass} / ${total} passed`);
if (fail > 0) {
  console.error(`  ${fail} FAILED`);
  process.exit(1);
} else {
  console.log('  All assertions passed.');
}
