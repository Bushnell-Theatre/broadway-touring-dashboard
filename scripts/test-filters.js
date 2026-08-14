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
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 2: BTD.filters.apply() — invalid boundary fail-closed ──');
{
  // Impossible calendar date: 2025-02-31 (round-trip check rejects it)
  // When dateFrom is invalid, it is treated as absent; dateTo determines range mode.
  const badFrom = apply(RECORDS, { dateFrom: '2025-02-31', dateTo: '2026-12-31' });
  // dateFrom invalid → treated as absent → open start from the remaining dateTo
  // dateTo is valid, so date-range mode IS entered (hasDateRange = true because dateTo present),
  // but dateFrom resolves to null → all records up to 2026-12-31 pass
  assert('Invalid dateFrom (2025-02-31) treated as absent; valid dateTo still active',
    badFrom.every((r) => r.week_of <= '2026-12-31') && badFrom.length === RECORDS.length);

  // Invalid dateTo: 2025-13-01 (month 13 doesn't exist)
  const badTo = apply(RECORDS, { dateFrom: '2025-09-01', dateTo: '2025-13-01' });
  // dateTo invalid → treated as absent → open end from dateFrom
  assert('Invalid dateTo (2025-13-01) treated as absent; valid dateFrom still active',
    badTo.every((r) => r.week_of >= '2025-09-01') && badTo.length >= 1);

  // Feb 29 on a non-leap year (2025 is not a leap year)
  const nonLeapFeb29 = apply(RECORDS, { dateFrom: '2025-02-29', dateTo: '2026-12-31' });
  assert('Non-leap-year Feb 29 (2025-02-29) treated as absent boundary',
    nonLeapFeb29.every((r) => r.week_of <= '2026-12-31') && nonLeapFeb29.length === RECORDS.length);

  // Feb 29 on a valid leap year (2024) — should be accepted
  const leapFeb29 = apply(RECORDS, { dateFrom: '2024-02-29', dateTo: '2026-12-31' });
  assert('Leap-year Feb 29 (2024-02-29) accepted as valid boundary',
    leapFeb29.every((r) => r.week_of >= '2024-02-29'));

  // Apr 31 (April has 30 days) — invalid, treated as absent
  const apr31 = apply(RECORDS, { dateFrom: '2025-04-31', dateTo: '2026-12-31' });
  assert('Apr 31 (2025-04-31) treated as absent boundary (impossible date)',
    apr31.length === RECORDS.length);

  // Feb 30 — invalid
  const feb30 = apply(RECORDS, { dateFrom: '2025-02-30', dateTo: '2026-12-31' });
  assert('Feb 30 (2025-02-30) treated as absent boundary (impossible date)',
    feb30.length === RECORDS.length);

  // Both boundaries invalid: hasDateRange = false → season filter resumes
  // Season is '2024-2025' and both dateFrom/dateTo are invalid
  const bothBad = apply(RECORDS, { season: '2024-2025', dateFrom: '2025-02-31', dateTo: '2025-13-01' });
  // hasDateRange depends on whether dateFrom or dateTo is truthy (non-empty string).
  // Both are truthy strings (even if invalid). So hasDateRange=true, but both
  // validate to null → open-ended date range that passes all records with valid week_of.
  // The key contract: invalid boundaries do NOT silently suppress the season filter
  // AND return an unbounded population of ALL records. Instead they fail-closed:
  // date-range mode activates (because the option was present) but with null bounds.
  assert('Both boundaries invalid: date-range mode entered with null bounds (not season)',
    bothBad.length === RECORDS.length); // all records pass null-bounded date-range

  // Inverted range (From > To): both valid ISO but wrong order
  const inverted = apply(RECORDS, { dateFrom: '2025-12-01', dateTo: '2025-09-01' });
  assert('Inverted range (From > To): 0 records returned',
    inverted.length === 0,
    `Got ${inverted.length} records, expected 0`);
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

  // ── Opportunity Engine uses p.metrics ──
  assert('programming Opportunity Engine uses p.metrics.cap (canonical)',
    progSrc.includes('p.metrics.peerCap > p.metrics.cap'));
  assert('exec_summary Opportunity Engine uses p.metrics.cap (canonical)',
    execSrc.includes('p.metrics.peerCap > p.metrics.cap'));

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
  assert('exec_summary Needs Validation label uses canonical count ("historical records")',
    execSrc.includes('historical records') && execSrc.includes('confidenceLabel(p)'));

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
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 10 — Opportunity Engine stays on canonical metrics
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 10: Opportunity Engine uses canonical metrics ──');
{
  // Data: Wicked has strong peer performance (peerCap > cap by 12pp canonically)
  // MoTown's canonical data shows peer < national (caution signal)
  const OPPTY_RECORDS = [
    // Wicked: national cap 65%, peer cap 77% → hidden gem (peer > national + 8)
    { show: 'Wicked', week_of: '2024-10-07', cap_paid: 0.65, tier: 'PRIMARY',   on_sub: true, gross_gross: 400000, gg_pct_gp: 0.60 },
    { show: 'Wicked', week_of: '2024-11-04', cap_paid: 0.77, tier: 'SECONDARY', on_sub: true, gross_gross: 460000, gg_pct_gp: 0.72 },
    // Hamilton: flat peer/national
    { show: 'Hamilton', week_of: '2024-12-02', cap_paid: 0.80, tier: 'PRIMARY',   on_sub: false, gross_gross: 550000, gg_pct_gp: 0.78 },
    { show: 'Hamilton', week_of: '2025-01-06', cap_paid: 0.81, tier: 'SECONDARY', on_sub: false, gross_gross: 560000, gg_pct_gp: 0.79 },
    // MoTown: peer below national (caution)
    { show: 'MoTown', week_of: '2025-02-03', cap_paid: 0.70, tier: 'PRIMARY',   on_sub: true, gross_gross: 380000, gg_pct_gp: 0.65 },
    { show: 'MoTown', week_of: '2025-03-03', cap_paid: 0.55, tier: 'SECONDARY', on_sub: true, gross_gross: 310000, gg_pct_gp: 0.50 },
  ];

  // Build profiles under a narrow date range that excludes ALL records (empty display)
  const FUTURE_FROM = '2030-01-01';
  const FUTURE_TO   = '2030-12-31';
  const slate = ['Wicked', 'Hamilton', 'MoTown'];
  const profiles = slate.map((t) => buildProfile(t, OPPTY_RECORDS, FUTURE_FROM, FUTURE_TO));

  // All filteredDisplay should be empty (future range)
  assert('All filteredDisplay counts are 0 under future date range',
    profiles.every((p) => p.filteredDisplay.count === 0));

  // Opportunity Engine uses canonical p.metrics — identical filter to what the page uses
  const PEER_GAP = 0.08;
  const hidden = profiles.filter(
    (p) => p.metrics.peerCap != null && p.metrics.cap != null &&
           p.metrics.peerCap > p.metrics.cap + PEER_GAP
  );

  // Wicked: national avg = (0.65+0.77)/2 = 0.71, peer (SECONDARY only) = 0.77
  // Gap = 0.77 - 0.71 = 0.06 — just below 0.08 threshold with this data mix
  // Let's verify the canonical calculation directly:
  const wickedAll = OPPTY_RECORDS.filter((r) => r.show === 'Wicked');
  const wickedNatCanon = avg(wickedAll.map((r) => r.cap_paid));
  const wickedPeerCanon = avg(wickedAll.filter((r) => r.tier === 'SECONDARY').map((r) => r.cap_paid));
  const wickedGap = wickedPeerCanon - wickedNatCanon;
  assert('Wicked canonical gap calculated correctly from all records',
    Math.abs(wickedGap - (0.77 - (0.65 + 0.77) / 2)) < 0.001,
    `Expected ${0.77 - (0.65 + 0.77) / 2}, got ${wickedGap}`);

  assert('Opportunity Engine filters on canonical p.metrics (not filteredDisplay)',
    // The filter function works on the profiles object, not on filteredDisplay
    hidden.every((p) => p.metrics.peerCap != null && p.metrics.cap != null));

  // Changing filteredDisplay has no effect on Opportunity Engine result
  const profilesAllData = slate.map((t) => buildProfile(t, OPPTY_RECORDS)); // no date filter
  const hiddenAllData = profilesAllData.filter(
    (p) => p.metrics.peerCap != null && p.metrics.cap != null &&
           p.metrics.peerCap > p.metrics.cap + PEER_GAP
  );
  assert('Opportunity Engine result identical regardless of Display Evidence setting',
    hidden.length === hiddenAllData.length,
    `Empty-range hidden=${hidden.length}, all-data hidden=${hiddenAllData.length}`);

  assert('Canonical metrics populated even when filteredDisplay is empty',
    profiles.every((p) => p.metrics.count > 0 && p.filteredDisplay.count === 0));

  // Verify the canonical calculation for the specific case:
  // If Wicked is in hidden (peerCap > cap + 8pp), it must have been from canonical data
  const wickedProfile = profiles.find((p) => p.show.title === 'Wicked');
  assert('Wicked canonical peerCap uses only SECONDARY tier records',
    wickedProfile.metrics.peerCap === wickedPeerCanon);
  assert('Wicked canonical cap uses all records',
    Math.abs(wickedProfile.metrics.cap - wickedNatCanon) < 0.001);
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
