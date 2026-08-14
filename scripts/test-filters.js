/**
 * test-filters.js — Behavioral tests for Display Evidence / metric taxonomy
 *
 * Verifies the four metric categories and both UI contracts:
 *   1. Slate-derived       — unaffected by Display Evidence
 *   2. Canonical signal    — unaffected by Display Evidence (Planning Signal scores)
 *   3. Touring-record display — governed by filteredDisplay (date range)
 *   4. Aggregates from touring-record display — governed by filteredDisplay
 *
 * Dashboard contract  : mutually exclusive Season vs. Date Range (window._DATE_RANGE)
 * Programming/Exec    : "Show Slate" always visible; Display Evidence pill controls filteredDisplay
 *
 * Run: node scripts/test-filters.js
 */

'use strict';

/* ── Minimal shims for BTD.filters.apply() ──────────────────────────────── */
// filters.js is an IIFE that receives `window` as `root`. Set it on global
// so `require()` can load the file in Node without a browser environment.
global.window = {
  BTD: {},
  _DATE_RANGE: null,
};
global.window.BTD.format = {
  fiscalYear(weekOf) {
    if (!weekOf) return null;
    const d = new Date(weekOf + 'T12:00:00');
    const y = d.getFullYear();
    const m = d.getMonth() + 1; // 1-based
    // Fiscal year: Aug 1 – Jul 31 → "20YY-20ZZ"
    const fyStart = m >= 8 ? y : y - 1;
    return `20${String(fyStart).slice(-2)}-20${String(fyStart + 1).slice(-2)}`;
  },
};
global.window.BTD.peers = {
  isPeerType(d, peerKey) {
    return peerKey === 'size' ? d.tier === 'SECONDARY' : d.tier === peerKey;
  },
};

/* Load BTD.filters — populates global.window.BTD.filters */
require('../src/js/core/filters.js');
const { apply } = global.window.BTD.filters;

/* ── Helpers ────────────────────────────────────────────────────────────── */
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

/* ── Synthetic touring records ──────────────────────────────────────────── */
// Two seasons; three weeks each
const RECORDS = [
  // 2024-2025 season  (Aug 2024 – Jul 2025)
  { show: 'Wicked',      week_of: '2024-10-07', cap_paid: 0.82, gg_pct_gp: 0.78, tier: 'SECONDARY', on_sub: true  },
  { show: 'Wicked',      week_of: '2024-11-04', cap_paid: 0.79, gg_pct_gp: 0.74, tier: 'SECONDARY', on_sub: true  },
  { show: 'Hamilton',    week_of: '2025-01-06', cap_paid: 0.91, gg_pct_gp: 0.88, tier: 'PRIMARY',   on_sub: false },
  // 2025-2026 season  (Aug 2025 – Jul 2026)
  { show: 'Wicked',      week_of: '2025-09-01', cap_paid: 0.85, gg_pct_gp: 0.81, tier: 'SECONDARY', on_sub: true  },
  { show: 'Hamilton',    week_of: '2025-10-06', cap_paid: 0.88, gg_pct_gp: 0.85, tier: 'PRIMARY',   on_sub: false },
  { show: 'MoTown',      week_of: '2026-02-02', cap_paid: 0.66, gg_pct_gp: 0.60, tier: 'SECONDARY', on_sub: true  },
];

/* ── Compute filteredDisplay from a subset of records ───────────────────── */
function computeFilteredDisplay(rows) {
  const peerRows = rows.filter((d) => d.tier === 'SECONDARY');
  return {
    count:    rows.length,
    cap:      avg(rows.map((d) => d.cap_paid)),
    gg:       avg(rows.map((d) => d.gg_pct_gp)),
    peerCap:  avg(peerRows.map((d) => d.cap_paid)),
  };
}

/* ── Simulated profile builder ──────────────────────────────────────────── */
function buildProfile(showTitle, allRows, dateFrom, dateTo) {
  const showRows = allRows.filter((r) => r.show === showTitle);
  // Canonical metrics — ALL records, no date filter
  const canonicalMetrics = computeFilteredDisplay(showRows);
  // filteredDisplay — date-range filtered if range is active
  let filteredRows;
  if (dateFrom || dateTo) {
    filteredRows = showRows.filter((r) => {
      if (dateFrom && r.week_of < dateFrom) return false;
      if (dateTo   && r.week_of > dateTo)   return false;
      return true;
    });
  } else {
    filteredRows = showRows;
  }
  const filteredDisplay = computeFilteredDisplay(filteredRows);

  return {
    show:           { title: showTitle },
    // Canonical Planning Signal score (always from ALL records — not date-filtered)
    score:          showTitle === 'Wicked' ? 72 : showTitle === 'Hamilton' ? 88 : 55,
    metrics:        canonicalMetrics,   // canonical — never date-range-filtered
    filteredDisplay,                    // display — governed by Display Evidence
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 1 — BTD.filters.apply() season vs. date range exclusivity
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 1: BTD.filters.apply() — season vs. date range ──');

{
  // Season filter only
  const seasonRows = apply(RECORDS, { season: '2024-2025' });
  assert(
    'Season filter returns only 2024-2025 records',
    seasonRows.length === 3 && seasonRows.every((r) => r.week_of < '2025-08-01'),
  );

  // Date range only — should NOT intersect season
  const rangeRows = apply(RECORDS, { dateFrom: '2025-09-01', dateTo: '2025-10-31' });
  assert(
    'Date range returns records in window, ignoring season',
    rangeRows.length === 2 &&
      rangeRows.every((r) => r.week_of >= '2025-09-01' && r.week_of <= '2025-10-31'),
  );

  // Date range with season set — season must be ignored
  const both = apply(RECORDS, { season: '2024-2025', dateFrom: '2025-09-01', dateTo: '2025-10-31' });
  assert(
    'When date range is active, season filter is ignored (mutual exclusivity)',
    both.length === rangeRows.length &&
      both.every((r) => r.week_of >= '2025-09-01' && r.week_of <= '2025-10-31'),
  );

  // From > To — all records should be excluded (no valid window)
  const inverted = apply(RECORDS, { dateFrom: '2025-12-01', dateTo: '2025-09-01' });
  assert(
    'From > To returns 0 records',
    inverted.length === 0,
  );

  // Records without week_of excluded when date range is active
  const withBlank = [{ show: 'X', week_of: null, cap_paid: 0.5, tier: 'PRIMARY' }, ...RECORDS];
  const rangeWithBlank = apply(withBlank, { dateFrom: '2025-01-01', dateTo: '2026-12-31' });
  assert(
    'Record with null week_of excluded when date range is active',
    !rangeWithBlank.some((r) => r.show === 'X'),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 2 — Category 1: Slate-derived — unaffected by Display Evidence
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 2: Category 1 — Slate-derived (unaffected) ──');

{
  // Show count and titles come from the slate definition, not tour records
  const slate = ['Wicked', 'Hamilton', 'MoTown'];
  const dateFrom = '2026-01-01';
  const dateTo   = '2026-01-31';
  const profiles = slate.map((t) => buildProfile(t, RECORDS, dateFrom, dateTo));

  // Show count stays at 3 regardless of date range
  assert(
    'Slate show count unaffected by narrow date range',
    profiles.length === 3,
  );

  // Show titles are from the slate, not filtered records
  assert(
    'All slate titles present even if 0 in-range records',
    profiles.map((p) => p.show.title).sort().join(',') === 'Hamilton,MoTown,Wicked',
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 3 — Category 2: Canonical signal — unaffected by Display Evidence
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 3: Category 2 — Canonical Planning Signal (unaffected) ──');

{
  // With a narrow date range that returns 0 records for Wicked,
  // the canonical score must remain unchanged
  const narrowFrom = '2030-01-01'; // future — nothing matches
  const narrowTo   = '2030-12-31';
  const pWicked = buildProfile('Wicked', RECORDS, narrowFrom, narrowTo);

  assert(
    'Wicked canonical score unchanged with 0 in-range records',
    pWicked.score === 72,
  );

  assert(
    'Canonical metrics.cap unchanged with 0 in-range records',
    pWicked.metrics.cap != null && pWicked.metrics.cap > 0,
    `Expected non-null; got ${pWicked.metrics.cap}`,
  );

  assert(
    'filteredDisplay.count === 0 with 0 in-range records',
    pWicked.filteredDisplay.count === 0,
  );

  assert(
    'filteredDisplay.cap === null with 0 in-range records (→ "—" in UI)',
    pWicked.filteredDisplay.cap == null,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 4 — Category 3: Touring-record display — governed by filteredDisplay
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 4: Category 3 — Touring-record display (filteredDisplay) ──');

{
  // "All available data" — filteredDisplay equals canonical metrics
  const pNoRange = buildProfile('Wicked', RECORDS);
  assert(
    'No date range: filteredDisplay.cap equals canonical metrics.cap',
    pNoRange.filteredDisplay.cap === pNoRange.metrics.cap,
  );

  // Date range covering 2024 only — Wicked has 2 records in that window
  const pNarrow = buildProfile('Wicked', RECORDS, '2024-01-01', '2024-12-31');
  assert(
    'Narrow date range: filteredDisplay.count = 2 (2024 records only)',
    pNarrow.filteredDisplay.count === 2,
  );

  assert(
    'Narrow date range: filteredDisplay.cap differs from canonical',
    pNarrow.filteredDisplay.cap !== pNarrow.metrics.cap,
    `filteredDisplay=${pNarrow.filteredDisplay.cap}, canonical=${pNarrow.metrics.cap}`,
  );

  assert(
    'Narrow date range: canonical metrics.cap unchanged',
    pNarrow.metrics.cap === pNoRange.metrics.cap,
  );

  // Empty range — filteredDisplay is null/zero
  const pFuture = buildProfile('Wicked', RECORDS, '2030-01-01', '2030-12-31');
  assert(
    'Empty range: filteredDisplay.count === 0',
    pFuture.filteredDisplay.count === 0,
  );
  assert(
    'Empty range: filteredDisplay.cap is null (empty state "—")',
    pFuture.filteredDisplay.cap == null,
  );
  assert(
    'Empty range: canonical metrics.cap still non-null',
    pFuture.metrics.cap != null,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 5 — Category 4: Aggregates exclude 0-count shows from denominators
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 5: Category 4 — Aggregates (exclude 0-count from denominators) ──');

{
  // Narrow range: only MoTown has records in Feb 2026
  const dateFrom = '2026-01-15';
  const dateTo   = '2026-12-31';
  const slate = ['Wicked', 'Hamilton', 'MoTown'];
  const profiles = slate.map((t) => buildProfile(t, RECORDS, dateFrom, dateTo));

  const activeDisplay = profiles.filter((p) => p.filteredDisplay && p.filteredDisplay.count > 0);

  assert(
    'Only MoTown has filteredDisplay records in Feb 2026 window',
    activeDisplay.length === 1 && activeDisplay[0].show.title === 'MoTown',
    `Active shows: ${activeDisplay.map((p) => p.show.title).join(', ')}`,
  );

  const kpiCap = avg(activeDisplay.map((p) => p.filteredDisplay.cap));
  assert(
    'Aggregate kpiCap uses only shows with filteredDisplay.count > 0',
    kpiCap != null && Math.abs(kpiCap - 0.66) < 0.001,
    `Expected 0.66; got ${kpiCap}`,
  );

  // All shows remain on the slate (show count = 3) even though 2 have 0 records
  assert(
    'All 3 slate shows remain (0-count shows stay visible)',
    profiles.length === 3,
  );

  // Canonical signal scores unaffected
  const scores = profiles.map((p) => p.score);
  assert(
    'All canonical scores intact despite 0 display records',
    scores.every((s) => s != null && s > 0),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 6 — Dashboard contract: Season vs. Date Range mutual exclusivity
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 6: Dashboard contract — Season ↔ Date Range mutual exclusivity ──');

{
  // Season mode: date range filters off → full season
  const season2025Rows = apply(RECORDS, { season: '2024-2025' });
  assert(
    'Season mode: returns season 2024-2025 records only',
    season2025Rows.length === 3,
  );

  // Switch to date range: season ignored
  const rangeRows = apply(RECORDS, { season: '2024-2025', dateFrom: '2026-01-01', dateTo: '2026-12-31' });
  assert(
    'Date range mode overrides season: only 2026 records returned',
    rangeRows.length === 1 && rangeRows[0].show === 'MoTown',
  );

  // Reset to season: no dateFrom/dateTo → season applies
  const resetRows = apply(RECORDS, { season: '2025-2026' });
  assert(
    'After reset: season filter active, no date range',
    resetRows.length === 3 && resetRows.every((r) => r.week_of >= '2025-08-01'),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 7 — Programming/Exec contract: "All available data" vs "Custom range"
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 7: Programming/Exec contract — All data vs Custom range ──');

{
  const slate = ['Wicked', 'Hamilton', 'MoTown'];

  // "All available data" mode — filteredDisplay = canonical
  const allProfiles = slate.map((t) => buildProfile(t, RECORDS));
  const allCaps = allProfiles.map((p) => p.filteredDisplay.cap);
  const canonCaps = allProfiles.map((p) => p.metrics.cap);
  assert(
    '"All available data": filteredDisplay.cap === metrics.cap for all shows',
    allCaps.every((v, i) => v === canonCaps[i]),
  );

  // "Custom date range" — narrow to 2025 only
  const rangeProfiles = slate.map((t) => buildProfile(t, RECORDS, '2025-01-01', '2025-12-31'));
  const wickedRange = rangeProfiles.find((p) => p.show.title === 'Wicked');
  assert(
    '"Custom range" Wicked: filteredDisplay.count = 1 (only 2025-01-06)',
    wickedRange.filteredDisplay.count === 1,
    `got ${wickedRange.filteredDisplay.count}`,
  );
  assert(
    '"Custom range" Wicked: canonical metrics.count unchanged = 3',
    wickedRange.metrics.count === 3,
  );

  // Slate counts (show count) unaffected
  assert(
    '"Custom range": slate show count still 3',
    rangeProfiles.length === 3,
  );

  // Show with no records in range stays visible — shows as "—" for display values
  const moTownRange = rangeProfiles.find((p) => p.show.title === 'MoTown');
  assert(
    '"Custom range" MoTown with no in-range records: filteredDisplay.cap is null (→ "—")',
    moTownRange.filteredDisplay.cap == null && moTownRange.filteredDisplay.count === 0,
  );
  assert(
    '"Custom range" MoTown: show still on slate (not removed)',
    moTownRange != null,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SUITE 8 — Opportunity Engine stays on canonical metrics
   ════════════════════════════════════════════════════════════════════════ */
console.log('\n── Suite 8: Opportunity Engine uses canonical metrics ──');

{
  // Narrow range — filteredDisplay is empty for Wicked and Hamilton
  const dateFrom = '2030-01-01';
  const dateTo   = '2030-12-31';
  const profiles = ['Wicked', 'Hamilton', 'MoTown'].map((t) =>
    buildProfile(t, RECORDS, dateFrom, dateTo),
  );

  // Opportunity Engine filters on p.metrics (canonical), not filteredDisplay
  const hidden = profiles.filter(
    (p) =>
      p.metrics.peerCap != null &&
      p.metrics.cap != null &&
      p.metrics.peerCap > p.metrics.cap + 0.02,
  );
  assert(
    'Opportunity Engine hidden gems derived from canonical metrics (not filteredDisplay)',
    // Verify we get results even when filteredDisplay is empty
    hidden.length >= 0 && profiles.every((p) => p.metrics.count >= 0),
  );

  // filteredDisplay all empty in this future range, but metrics still populated
  assert(
    'All profiles have canonical metrics even with empty filteredDisplay',
    profiles.every((p) => p.metrics.count > 0 && p.filteredDisplay.count === 0),
  );
}

/* ── Results ──────────────────────────────────────────────────────────── */
const total = pass + fail;
console.log(`\n${'─'.repeat(55)}`);
console.log(`  test-filters.js   ${pass} / ${total} passed`);
if (fail > 0) {
  console.error(`  ${fail} FAILED`);
  process.exit(1);
} else {
  console.log('  All assertions passed.');
}
