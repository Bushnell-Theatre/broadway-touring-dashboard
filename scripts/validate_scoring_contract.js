#!/usr/bin/env node
/**
 * validate_scoring_contract.js
 *
 * Validates the filter and evidence-boundary rules defined in
 * docs/SCORING_CONTRACT.md §"Filter taxonomy" without requiring a browser
 * context or signals.js to be loaded.
 *
 * Tests the logic that lives in profileShowCanonical() in page-common.js and
 * verifies caller evidence-window compliance by inspecting source text.
 *
 * Run: node scripts/validate_scoring_contract.js
 *
 * Exit 0 — all checks passed.
 * Exit 1 — one or more checks failed (see output).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/* ── Test harness ─────────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;

function ok(label, condition, detail) {
  if (condition) {
    console.log('  ✅ PASS:', label);
    passed++;
  } else {
    console.log('  ❌ FAIL:', label);
    if (detail) console.log('       →', detail);
    failed++;
  }
}

function section(title) {
  console.log('\n' + title);
  console.log('─'.repeat(title.length));
}

/* ── Re-implementation of the filter-construction logic under test ────────── */
/* Matches exactly what profileShowCanonical() does in page-common.js.         */

function buildFilters(options, activeGlobals) {
  options       = options || {};
  activeGlobals = activeGlobals || {};
  return {
    tier:   options.tier   !== undefined ? options.tier   : (activeGlobals.tier   || ''),
    sub:    options.sub    !== undefined ? options.sub    : (activeGlobals.sub    || ''),
    peer:   '',   // display filter — always forced to neutral
    equity: '',   // display filter — always forced to neutral
    engage: ''    // display filter — always forced to neutral
  };
}

/* ── Re-implementation of the date-boundary logic under test ─────────────── */

function applyDateBounds(rows, dateFrom, dateTo) {
  if (dateFrom) rows = rows.filter(function (r) { return r.week_of && r.week_of >= dateFrom; });
  if (dateTo)   rows = rows.filter(function (r) { return r.week_of && r.week_of <= dateTo; });
  return rows;
}

/* ── Helper: read source file as string ────────────────────────────────────── */

function src(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 1: Filter construction — options.tier / options.sub override     */
/* ══════════════════════════════════════════════════════════════════════════ */

section('1. Filter construction — options.tier / options.sub override');

var activeGlobals = { tier: 'Primary', sub: '1', peer: 'size', equity: 'yes', engage: 'no' };

// 1a. explicit tier: '' overrides active global tier
var f = buildFilters({ tier: '' }, activeGlobals);
ok("explicit tier: '' overrides page global 'Primary'",
   f.tier === '',
   "got: " + JSON.stringify(f.tier));

// 1b. explicit sub: '' overrides active global sub
f = buildFilters({ sub: '' }, activeGlobals);
ok("explicit sub: '' overrides page global '1'",
   f.sub === '',
   "got: " + JSON.stringify(f.sub));

// 1c. omitted tier inherits page global
f = buildFilters({}, activeGlobals);
ok("omitted options.tier inherits page global 'Primary'",
   f.tier === 'Primary',
   "got: " + JSON.stringify(f.tier));

// 1d. omitted sub inherits page global
f = buildFilters({}, activeGlobals);
ok("omitted options.sub inherits page global '1'",
   f.sub === '1',
   "got: " + JSON.stringify(f.sub));

// 1e. explicit tier: 'Secondary' overrides 'Primary'
f = buildFilters({ tier: 'Secondary' }, activeGlobals);
ok("explicit tier: 'Secondary' overrides page global 'Primary'",
   f.tier === 'Secondary',
   "got: " + JSON.stringify(f.tier));

// 1f. null options uses page globals (null !== undefined, so uses option value null)
// Note: passing options.tier = null IS !== undefined, so it WOULD override to null.
// The contract says callers pass '' not null, but verify behavior is predictable.
f = buildFilters({ tier: null }, activeGlobals);
ok("explicit tier: null is !== undefined, overrides to null (callers should use '' not null)",
   f.tier === null,
   "got: " + JSON.stringify(f.tier));

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 2: Peer, Equity, Engage never reach scoring                      */
/* ══════════════════════════════════════════════════════════════════════════ */

section('2. Peer, Equity, Engage are always stripped to neutral value');

var globalsWithAll = { tier: 'Primary', sub: '1', peer: 'proximity', equity: 'yes', engage: 'no' };

// 2a. peer always ''
f = buildFilters({}, globalsWithAll);
ok("peer always '' regardless of global 'proximity'",
   f.peer === '',
   "got: " + JSON.stringify(f.peer));

// 2b. equity always ''
ok("equity always '' regardless of global 'yes'",
   f.equity === '',
   "got: " + JSON.stringify(f.equity));

// 2c. engage always ''
ok("engage always '' regardless of global 'no'",
   f.engage === '',
   "got: " + JSON.stringify(f.engage));

// 2d. peer not overrideable by options
f = buildFilters({ peer: 'market' }, globalsWithAll);
ok("options.peer is ignored — peer is always ''",
   f.peer === '',
   "got: " + JSON.stringify(f.peer));

// 2e. equity not overrideable by options
f = buildFilters({ equity: 'yes' }, globalsWithAll);
ok("options.equity is ignored — equity is always ''",
   f.equity === '',
   "got: " + JSON.stringify(f.equity));

// 2f. engage not overrideable by options
f = buildFilters({ engage: 'no' }, globalsWithAll);
ok("options.engage is ignored — engage is always ''",
   f.engage === '',
   "got: " + JSON.stringify(f.engage));

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 3: Date boundary — inclusive bounds, missing week_of exclusion   */
/* ══════════════════════════════════════════════════════════════════════════ */

section('3. Date boundary logic — inclusive bounds and missing week_of');

var rows = [
  { show: 'Test Show', week_of: '2024-07-01' },
  { show: 'Test Show', week_of: '2024-12-01' },
  { show: 'Test Show', week_of: '2025-06-30' },
  { show: 'Test Show', week_of: '2025-07-01' },   // first day of next season
  { show: 'Test Show', week_of: null },             // missing week_of
  { show: 'Test Show', week_of: undefined },        // undefined week_of
  { show: 'Test Show' }                             // no week_of key
];

// 3a. dateTo is inclusive — the boundary date itself is included
var bounded = applyDateBounds(rows, undefined, '2025-06-30');
ok("dateTo '2025-06-30' is inclusive — record on that date is included",
   bounded.some(function (r) { return r.week_of === '2025-06-30'; }),
   "rows after dateTo: " + JSON.stringify(bounded.map(function (r) { return r.week_of; })));

// 3b. dateTo excludes records after the boundary
ok("dateTo '2025-06-30' excludes '2025-07-01'",
   !bounded.some(function (r) { return r.week_of === '2025-07-01'; }),
   "rows: " + JSON.stringify(bounded.map(function (r) { return r.week_of; })));

// 3c. dateFrom is inclusive — the boundary date itself is included
bounded = applyDateBounds(rows, '2024-07-01', undefined);
ok("dateFrom '2024-07-01' is inclusive — record on that date is included",
   bounded.some(function (r) { return r.week_of === '2024-07-01'; }),
   "rows: " + JSON.stringify(bounded.map(function (r) { return r.week_of; })));

// 3d. records with null week_of are excluded when any boundary is active
bounded = applyDateBounds(rows, '2024-01-01', '2025-12-31');
ok("records with null week_of are excluded when date bounds are active",
   !bounded.some(function (r) { return r.week_of == null; }),
   "rows: " + JSON.stringify(bounded.map(function (r) { return r.week_of; })));

// 3e. records with undefined week_of are excluded when any boundary is active
ok("records with undefined week_of are excluded when date bounds are active",
   !bounded.some(function (r) { return r.week_of === undefined; }),
   "rows: " + JSON.stringify(bounded.map(function (r) { return r.week_of; })));

// 3f. records with missing week_of key are excluded when any boundary is active
ok("records with no week_of property are excluded when date bounds are active",
   !bounded.some(function (r) { return !('week_of' in r) || r.week_of == null; }),
   "rows: " + JSON.stringify(bounded.map(function (r) { return r.week_of; })));

// 3g. no bounds — all records pass (including those with null/missing week_of)
bounded = applyDateBounds(rows, undefined, undefined);
ok("no date bounds — all records pass (including null week_of)",
   bounded.length === rows.length,
   "expected " + rows.length + " rows, got " + bounded.length);

// 3h. season + narrower range — intersection works correctly
var seasonRows = rows.filter(function (r) {
  if (!r.week_of) return false;
  return r.week_of >= '2024-07-01' && r.week_of <= '2025-06-30';
});
var intersected = applyDateBounds(seasonRows, '2024-10-01', '2025-03-31');
ok("season + narrower date range — intersection keeps only 2024-12-01",
   intersected.length === 1 && intersected[0].week_of === '2024-12-01',
   "rows: " + JSON.stringify(intersected.map(function (r) { return r.week_of; })));

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 4: Caller source compliance — historical cutoff is wired         */
/* ══════════════════════════════════════════════════════════════════════════ */

section('4. Caller source compliance — historical cutoff is wired in both pages');

var programmingSource = src('src/programming.html');
var execSource        = src('src/exec_summary.html');

// 4a. programming.html supplies dateTo for past seasons
ok("programming.html: dateTo = season.end for past seasons",
   programmingSource.includes('dateTo:   isPast ? season.end : undefined'),
   "pattern not found in programming.html");

// 4b. exec_summary.html supplies dateTo for past seasons
ok("exec_summary.html: dateTo = season.end for past seasons",
   execSource.includes('dateTo:   isPast ? season.end : undefined'),
   "pattern not found in exec_summary.html");

// 4c. programming.html does NOT apply dateFrom (intentional — all prior history).
// Strips comment lines (* … and // …) before checking so the rationale comment
// that explains the absence does not trigger a false positive.
var progCodeLines = programmingSource.split('\n')
  .filter(function (l) { var t = l.trim(); return !t.startsWith('*') && !t.startsWith('//'); });
ok("programming.html: dateFrom is not applied (all prior touring history used)",
   !progCodeLines.some(function (l) { return /dateFrom\s*:/.test(l); }),
   "unexpected dateFrom code assignment found in programming.html");

// 4d. exec_summary.html does NOT apply dateFrom
var execCodeLines = execSource.split('\n')
  .filter(function (l) { var t = l.trim(); return !t.startsWith('*') && !t.startsWith('//'); });
ok("exec_summary.html: dateFrom is not applied (all prior touring history used)",
   !execCodeLines.some(function (l) { return /dateFrom\s*:/.test(l); }),
   "unexpected dateFrom code assignment found in exec_summary.html");

// 4e. programming.html uses seasonMode to detect past seasons
ok("programming.html: seasonMode() is used to detect past seasons",
   programmingSource.includes("BTD.page.seasonMode(season.id) === 'past'"),
   "seasonMode check not found in programming.html");

// 4f. exec_summary.html uses seasonMode to detect past seasons
ok("exec_summary.html: seasonMode() is used to detect past seasons",
   execSource.includes("seasonMode(season.id) === 'past'"),
   "seasonMode check not found in exec_summary.html");

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 5: page-common.js — explicit whitelist is in place               */
/* ══════════════════════════════════════════════════════════════════════════ */

section('5. page-common.js — explicit filter whitelist');

var commonSource = src('src/js/core/page-common.js');

// 5a. peer forced to '' in profileShowCanonical
ok("page-common.js: peer forced to '' in profileShowCanonical",
   commonSource.includes("peer:   '',   // display filter"),
   "peer: '' assignment not found");

// 5b. equity forced to '' in profileShowCanonical
ok("page-common.js: equity forced to '' in profileShowCanonical",
   commonSource.includes("equity: '',   // display filter"),
   "equity: '' assignment not found");

// 5c. engage forced to '' in profileShowCanonical
ok("page-common.js: engage forced to '' in profileShowCanonical",
   commonSource.includes("engage: ''    // display filter"),
   "engage: '' assignment not found");

// 5d. options.tier override guard uses !== undefined
ok("page-common.js: options.tier override uses !== undefined guard",
   commonSource.includes("options.tier   !== undefined ? options.tier   : active.tier"),
   "tier override pattern not found");

// 5e. options.sub override guard uses !== undefined
ok("page-common.js: options.sub override uses !== undefined guard",
   commonSource.includes("options.sub    !== undefined ? options.sub    : active.sub"),
   "sub override pattern not found");

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 6: Contract document — key invariants present                    */
/* ══════════════════════════════════════════════════════════════════════════ */

section('6. SCORING_CONTRACT.md — key invariants documented');

var contractSource = src('docs/SCORING_CONTRACT.md');

ok("contract: no recency component stated for Confidence",
   contractSource.includes('no recency component'),
   "no-recency statement not found");

ok("contract: Confidence scaled ranges documented",
   contractSource.includes('0 → 40 records') && contractSource.includes('0 → 30 weeks'),
   "confidence scaled ranges not found");

// The contract uses markdown backticks around dateFrom so the phrase is
// "`dateFrom` is intentionally absent" — test with a case-insensitive regex.
ok("contract: dateFrom intentional absence documented",
   /`dateFrom`.*intentionally absent/i.test(contractSource),
   "dateFrom rationale not found");

// The contract uses markdown bold (**not**) so the literal text is
// "**not** pre-rounding raw values" — search for the plain phrase without the bold markers.
ok("contract: decomp described as not pre-rounding raw values",
   /not\*?\*? pre-rounding raw values/.test(contractSource),
   "decomp description not found");

ok("contract: three score types defined (Baseline / Context-filtered / Scenario)",
   contractSource.includes('Baseline Planning Signal') &&
   contractSource.includes('Context-filtered Planning Signal') &&
   contractSource.includes('Scenario score'),
   "score-type taxonomy not found");

ok("contract: UI disclosure required for context-filtered score",
   contractSource.includes('UI disclosure is required') || contractSource.includes('disclosure'),
   "disclosure requirement not found");

// Category 3 heading still legitimately says "Post-calculation analytical".
// The fix required was only for Category 4 — verify Category 4 does not
// say "post-calculation" and does say "before aggregation".
ok("contract: Category 4 says 'before aggregation', not 'post-calculation'",
   /Category 4[^#]*before aggregation/s.test(contractSource) &&
   !/Category 4[^#]*post-calculation/s.test(contractSource),
   "Category 4 wording not corrected");

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SUMMARY                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

console.log('\n' + '═'.repeat(60));
console.log('Scoring contract validation complete');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('═'.repeat(60));

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
