#!/usr/bin/env node
/**
 * validate_scoring_contract.js
 *
 * Validates the filter and evidence-boundary rules defined in
 * docs/SCORING_CONTRACT.md §"Filter taxonomy".
 *
 * PRIMARY: Executes the real BTD.page.profileShowCanonical() implementation
 * via a lightweight vm harness. Behavioral tests capture what the actual
 * function passes to BTD.filters.apply and BTD.signals.profileShow.
 *
 * SUPPLEMENTARY: Static source-compliance checks verify that callers supply
 * the required date cutoffs and that the contract document is internally
 * consistent. These supplement—not substitute for—the vm harness.
 *
 * Run: node scripts/validate_scoring_contract.js
 *
 * Exit 0 — all checks passed.
 * Exit 1 — one or more checks failed (see output).
 */

'use strict';

const vm   = require('vm');
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

function src(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  VM HARNESS SETUP                                                          */
/*                                                                            */
/*  Stubs for BTD.filters.apply and BTD.signals.profileShow capture what      */
/*  the real profileShowCanonical() passes to each collaborator.              */
/*  The stubs apply enough filter logic for date-boundary tests to work.      */
/* ══════════════════════════════════════════════════════════════════════════ */

var lastFilters       = null;  // {tier, sub, peer, equity, engage} passed to filters.apply
var lastScorerRows    = null;  // rows[] received by signals.profileShow
var lastScorerOptions = null;  // options received by signals.profileShow

/* Minimal BTD.filters.apply stub.
 * Captures the filters object and applies basic tier/sub logic so that date
 * filtering (which runs after this call) sees a realistic row set. Peer,
 * equity, and engage are always expected to be '' — they are recorded but
 * never used to filter, matching the canonical entry point's contract.     */
function stubFiltersApply(rows, filters) {
  lastFilters = {
    tier:   filters.tier,
    sub:    filters.sub,
    peer:   filters.peer,
    equity: filters.equity,
    engage: filters.engage
  };
  return (rows || []).filter(function (r) {
    if (filters.tier && r.tier !== filters.tier) return false;
    if (filters.sub !== '' && filters.sub != null) {
      if (String(r.on_sub) !== String(filters.sub)) return false;
    }
    // peer / equity / engage never filter in canonical calls
    return true;
  });
}

/* BTD.signals.profileShow stub.
 * Captures rows and options so assertions can verify what the scorer received
 * after all upstream filtering (tier/sub whitelist + date bounds) was applied. */
function stubProfileShow(show, rows, options) {
  lastScorerRows    = (rows || []).slice();
  lastScorerOptions = Object.assign({}, options);
  return {
    score: 50,
    planning:       { read: 'Discuss', note: '' },
    signals: {
      demand:     { value: 60, label: 'Moderate', drivers: [] },
      revenue:    { value: 60, label: 'Moderate', drivers: [] },
      peer:       { value: 60, label: 'Moderate', drivers: [] },
      confidence: { value: 60, label: 'Moderate', drivers: [] }
    },
    decomp:         { canonical: true, demand: 60, revenue: 60, peer: 60, confidence: 60, peerTypes: '' },
    isFutureNewTour: false
  };
}

/* Stub window — page-common.js ends with })(window); so the IIFE receives
 * this object as its `root`. Global filter state (ACTIVE_TIER etc.) is read
 * from this object by activeFilters() inside the module.                    */
var windowStub = {
  BTD: {
    filters: { apply: stubFiltersApply },
    signals: { profileShow: stubProfileShow }
    // BTD.state is intentionally absent — activeFilters() falls back to ACTIVE_* globals
  },
  ACTIVE_TIER:   '',
  ACTIVE_SUB:    '',
  ACTIVE_PEER:   '',
  ACTIVE_EQUITY: '',
  ACTIVE_ENGAGE: ''
};

/* Install as Node.js global so `window` resolves inside vm.runInThisContext */
global.window = windowStub;

/* Load and execute the real page-common.js into the Node.js global context.
 * After this, global.window.BTD.page.profileShowCanonical is the real function. */
try {
  vm.runInThisContext(
    fs.readFileSync(path.join(__dirname, '..', 'src/js/core/page-common.js'), 'utf8'),
    { filename: 'page-common.js' }
  );
} catch (e) {
  console.error('\n❌ FATAL: Failed to load page-common.js into vm context:');
  console.error(e.message);
  process.exit(1);
}

var profileShowCanonical = global.window.BTD && global.window.BTD.page && global.window.BTD.page.profileShowCanonical;
if (typeof profileShowCanonical !== 'function') {
  console.error('\n❌ FATAL: BTD.page.profileShowCanonical is not a function after loading page-common.js');
  process.exit(1);
}

/* Helper: set page-global filter state and reset capture variables.         */
function setGlobals(g) {
  global.window.ACTIVE_TIER   = g.tier   !== undefined ? g.tier   : '';
  global.window.ACTIVE_SUB    = g.sub    !== undefined ? g.sub    : '';
  global.window.ACTIVE_PEER   = g.peer   !== undefined ? g.peer   : '';
  global.window.ACTIVE_EQUITY = g.equity !== undefined ? g.equity : '';
  global.window.ACTIVE_ENGAGE = g.engage !== undefined ? g.engage : '';
  lastFilters       = null;
  lastScorerRows    = null;
  lastScorerOptions = null;
}

/* Canonical test-row set. Covers multiple tier values, subscription values,
 * week_of values spanning two seasons, and null/missing week_of records.   */
var testRows = [
  { show: 'Test Show', week_of: '2024-07-01', tier: 'Primary',   on_sub: '1' },
  { show: 'Test Show', week_of: '2024-12-01', tier: 'Secondary', on_sub: '0' },
  { show: 'Test Show', week_of: '2025-06-30', tier: 'Primary',   on_sub: '0' },
  { show: 'Test Show', week_of: '2025-07-01', tier: 'Primary',   on_sub: '1' }, // post-cutoff
  { show: 'Test Show', week_of: null,          tier: 'Primary',   on_sub: '0' }, // null week_of
  { show: 'Test Show', week_of: undefined,     tier: 'Secondary', on_sub: '1' }  // undefined week_of
];

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 1: VM harness — real profileShowCanonical behavior               */
/* ══════════════════════════════════════════════════════════════════════════ */

section('1. VM harness — real profileShowCanonical (actual page-common.js)');

/* 1a. explicit tier: '' overrides active global 'Primary' */
setGlobals({ tier: 'Primary', sub: '' });
profileShowCanonical('Test Show', testRows, { tier: '' });
ok("explicit tier: '' overrides page global 'Primary'",
   lastFilters !== null && lastFilters.tier === '',
   "lastFilters.tier: " + JSON.stringify(lastFilters && lastFilters.tier));

/* 1b. explicit sub: '' overrides active global '1' */
setGlobals({ tier: '', sub: '1' });
profileShowCanonical('Test Show', testRows, { sub: '' });
ok("explicit sub: '' overrides page global '1'",
   lastFilters !== null && lastFilters.sub === '',
   "lastFilters.sub: " + JSON.stringify(lastFilters && lastFilters.sub));

/* 1c. omitted options.tier inherits page global */
setGlobals({ tier: 'Primary', sub: '' });
profileShowCanonical('Test Show', testRows, {});
ok("omitted options.tier inherits page global 'Primary'",
   lastFilters !== null && lastFilters.tier === 'Primary',
   "lastFilters.tier: " + JSON.stringify(lastFilters && lastFilters.tier));

/* 1d. omitted options.sub inherits page global */
setGlobals({ tier: '', sub: '1' });
profileShowCanonical('Test Show', testRows, {});
ok("omitted options.sub inherits page global '1'",
   lastFilters !== null && lastFilters.sub === '1',
   "lastFilters.sub: " + JSON.stringify(lastFilters && lastFilters.sub));

/* 1e. explicit tier: 'Secondary' overrides page global 'Primary' */
setGlobals({ tier: 'Primary', sub: '' });
profileShowCanonical('Test Show', testRows, { tier: 'Secondary' });
ok("explicit tier: 'Secondary' overrides page global 'Primary'",
   lastFilters !== null && lastFilters.tier === 'Secondary',
   "lastFilters.tier: " + JSON.stringify(lastFilters && lastFilters.tier));

/* 1f. peer is always '' regardless of page global */
setGlobals({ tier: '', sub: '', peer: 'proximity' });
profileShowCanonical('Test Show', testRows, {});
ok("peer stripped to '' — page global 'proximity' never reaches scorer",
   lastFilters !== null && lastFilters.peer === '',
   "lastFilters.peer: " + JSON.stringify(lastFilters && lastFilters.peer));

/* 1g. equity is always '' regardless of page global */
setGlobals({ tier: '', sub: '', equity: 'yes' });
profileShowCanonical('Test Show', testRows, {});
ok("equity stripped to '' — page global 'yes' never reaches scorer",
   lastFilters !== null && lastFilters.equity === '',
   "lastFilters.equity: " + JSON.stringify(lastFilters && lastFilters.equity));

/* 1h. engage is always '' regardless of page global */
setGlobals({ tier: '', sub: '', engage: 'no' });
profileShowCanonical('Test Show', testRows, {});
ok("engage stripped to '' — page global 'no' never reaches scorer",
   lastFilters !== null && lastFilters.engage === '',
   "lastFilters.engage: " + JSON.stringify(lastFilters && lastFilters.engage));

/* 1i. dateTo is inclusive — boundary date itself reaches scorer */
setGlobals({ tier: '', sub: '' });
profileShowCanonical('Test Show', testRows, { dateTo: '2025-06-30' });
ok("dateTo '2025-06-30' is inclusive — record on boundary date reaches scorer",
   lastScorerRows !== null && lastScorerRows.some(function (r) { return r.week_of === '2025-06-30'; }),
   "scorer week_of values: " + JSON.stringify((lastScorerRows || []).map(function (r) { return r.week_of; })));

/* 1j. dateTo excludes records after the boundary */
ok("dateTo '2025-06-30' excludes post-cutoff record '2025-07-01'",
   lastScorerRows !== null && !lastScorerRows.some(function (r) { return r.week_of === '2025-07-01'; }),
   "scorer week_of values: " + JSON.stringify((lastScorerRows || []).map(function (r) { return r.week_of; })));

/* 1k. records with null week_of are excluded when dateTo is active */
ok("null week_of record excluded when dateTo is active",
   lastScorerRows !== null && !lastScorerRows.some(function (r) { return r.week_of == null; }),
   "scorer week_of values: " + JSON.stringify((lastScorerRows || []).map(function (r) { return r.week_of; })));

/* 1l. historical cutoff: all records reaching scorer are ≤ season.end */
ok("historical cutoff '2025-06-30': all scorer rows have week_of ≤ cutoff",
   lastScorerRows !== null &&
   lastScorerRows.every(function (r) { return r.week_of && r.week_of <= '2025-06-30'; }),
   "scorer week_of values: " + JSON.stringify((lastScorerRows || []).map(function (r) { return r.week_of; })));

/* 1m. dateFrom is inclusive — boundary date itself reaches scorer */
setGlobals({ tier: '', sub: '' });
profileShowCanonical('Test Show', testRows, { dateFrom: '2024-07-01' });
ok("dateFrom '2024-07-01' is inclusive — record on boundary date reaches scorer",
   lastScorerRows !== null && lastScorerRows.some(function (r) { return r.week_of === '2024-07-01'; }),
   "scorer week_of values: " + JSON.stringify((lastScorerRows || []).map(function (r) { return r.week_of; })));

/* 1n. dateFrom + dateTo together — only the intersection reaches scorer.
 * Window 2024-12-01 to 2024-12-31: exactly one record ('2024-12-01') falls
 * inside. '2024-07-01' is before dateFrom; '2025-06-30' and '2025-07-01'
 * are after dateTo; null/undefined week_of records are also excluded.      */
setGlobals({ tier: '', sub: '' });
profileShowCanonical('Test Show', testRows, { dateFrom: '2024-12-01', dateTo: '2024-12-31' });
ok("dateFrom + dateTo intersection: only '2024-12-01' in [2024-12-01, 2024-12-31] reaches scorer",
   lastScorerRows !== null &&
   lastScorerRows.length === 1 &&
   lastScorerRows[0].week_of === '2024-12-01',
   "scorer week_of values: " + JSON.stringify((lastScorerRows || []).map(function (r) { return r.week_of; })));

/* 1o. seasonId is forwarded to scorer options (not used as row filter) */
setGlobals({ tier: '', sub: '' });
profileShowCanonical('Test Show', testRows, { seasonId: '2024-2025' });
ok("seasonId forwarded to scorer in options (not a row filter)",
   lastScorerOptions !== null && lastScorerOptions.seasonId === '2024-2025',
   "scorer options: " + JSON.stringify(lastScorerOptions));

/* 1p. futureNewTour is forwarded to scorer options */
setGlobals({ tier: '', sub: '' });
profileShowCanonical('Test Show', testRows, { futureNewTour: true });
ok("futureNewTour forwarded to scorer options",
   lastScorerOptions !== null && lastScorerOptions.futureNewTour === true,
   "scorer options: " + JSON.stringify(lastScorerOptions));

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 2: Confidence label thresholds — sourced from signals.js         */
/*                                                                            */
/*  Reads the actual threshold values from signals.js so that any change to  */
/*  confidenceLabel() immediately causes the contract-consistency check to   */
/*  fail, surfacing the drift before it reaches a review.                    */
/* ══════════════════════════════════════════════════════════════════════════ */

section('2. Confidence thresholds — read from signals.js and verified against contract');

var signalsSrc   = src('src/js/core/signals.js');
var contractSrc  = src('docs/SCORING_CONTRACT.md');

/* Extract the confidenceLabel() function body first to avoid matching the
 * signal() function which also has a `return 'Moderate'` branch at >= 65. */
var confLabelStart = signalsSrc.indexOf('function confidenceLabel');
var confLabelEnd   = signalsSrc.indexOf('\n  function ', confLabelStart + 1);
if (confLabelEnd === -1) confLabelEnd = signalsSrc.indexOf('\n}', confLabelStart + 1);
var confLabelBody  = confLabelStart >= 0 ? signalsSrc.slice(confLabelStart, confLabelEnd) : '';

var highMatch = confLabelBody.match(/if\s*\(\s*score\s*>=\s*(\d+)\s*\)\s*return\s*'High'/);
var modMatch  = confLabelBody.match(/if\s*\(\s*score\s*>=\s*(\d+)\s*\)\s*return\s*'Moderate'/);

var implHigh = highMatch ? parseInt(highMatch[1], 10) : null;
var implMod  = modMatch  ? parseInt(modMatch[1],  10) : null;

ok("signals.js confidenceLabel High threshold is 75",
   implHigh === 75,
   "found: " + implHigh);

ok("signals.js confidenceLabel Moderate threshold is 45",
   implMod === 45,
   "found: " + implMod);

/* Verify the contract documents the same values the implementation uses      */
ok("contract documents High threshold matching signals.js (" + implHigh + ")",
   implHigh !== null && contractSrc.includes('| `High` | ≥ ' + implHigh),
   "looking for: '| `High` | ≥ " + implHigh + "' in contract");

ok("contract documents Moderate threshold matching signals.js (" + implMod + ")",
   implMod !== null && contractSrc.includes(implMod + '–'),
   "looking for: '" + implMod + "–' (range start) in contract");

ok("contract states no recency component for Confidence",
   /no recency component/i.test(contractSrc),
   "no-recency statement not found");

ok("contract documents all four Confidence scaled ranges",
   contractSrc.includes('0 → 40 records') &&
   contractSrc.includes('0 → 20 venues') &&
   contractSrc.includes('0 → 18 records') &&
   contractSrc.includes('0 → 30 weeks'),
   "one or more confidence scaled ranges not found");

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 3: Static source compliance (supplementary)                      */
/*                                                                            */
/*  These checks verify that callers supply the required cutoffs and that     */
/*  the contract document is internally consistent. They supplement the vm   */
/*  harness — they do not substitute for it.                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

section('3. Caller source compliance (supplementary — static checks)');

var programmingSrc = src('src/programming.html');
var execSrc        = src('src/exec_summary.html');
var commonSrc      = src('src/js/core/page-common.js');

ok("programming.html: dateTo = season.end wired for past seasons",
   programmingSrc.includes('dateTo:   isPast ? season.end : undefined'),
   "pattern not found");

ok("exec_summary.html: dateTo = season.end wired for past seasons",
   execSrc.includes('dateTo:   isPast ? season.end : undefined'),
   "pattern not found");

ok("programming.html: dateFrom absent from code (intentional — all prior history)",
   !programmingSrc.split('\n')
     .filter(function (l) { var t = l.trim(); return !t.startsWith('*') && !t.startsWith('//'); })
     .some(function (l) { return /dateFrom\s*:/.test(l); }),
   "unexpected dateFrom code assignment found");

ok("exec_summary.html: dateFrom absent from code",
   !execSrc.split('\n')
     .filter(function (l) { var t = l.trim(); return !t.startsWith('*') && !t.startsWith('//'); })
     .some(function (l) { return /dateFrom\s*:/.test(l); }),
   "unexpected dateFrom code assignment found");

ok("page-common.js: options.tier !== undefined guard in profileShowCanonical",
   commonSrc.includes("options.tier   !== undefined ? options.tier   : active.tier"),
   "tier override guard not found");

ok("page-common.js: options.sub !== undefined guard in profileShowCanonical",
   commonSrc.includes("options.sub    !== undefined ? options.sub    : active.sub"),
   "sub override guard not found");

ok("page-common.js: peer forced to '' in whitelist",
   commonSrc.includes("peer:   '',   // display filter"),
   "peer whitelist not found");

ok("page-common.js: equity forced to '' in whitelist",
   commonSrc.includes("equity: '',   // display filter"),
   "equity whitelist not found");

ok("page-common.js: engage forced to '' in whitelist",
   commonSrc.includes("engage: ''    // display filter"),
   "engage whitelist not found");

section('4. Contract document invariants (supplementary)');

ok("contract: three score types (Baseline / Context-filtered / Scenario)",
   contractSrc.includes('Baseline Planning Signal') &&
   contractSrc.includes('Context-filtered Planning Signal') &&
   contractSrc.includes('Scenario score'),
   "score-type taxonomy incomplete");

ok("contract: UI disclosure required for context-filtered score",
   contractSrc.includes('UI disclosure is required'),
   "disclosure requirement not found");

ok("contract: dateFrom intentional absence documented",
   /`dateFrom`.*intentionally absent/i.test(contractSrc),
   "dateFrom rationale not found");

ok("contract: decomp described as not pre-rounding",
   /not\*?\*? pre-rounding raw values/.test(contractSrc),
   "decomp description not found");

ok("contract: Category 4 says 'before aggregation' not 'post-calculation'",
   /Category 4[^#]*before aggregation/s.test(contractSrc) &&
   !/Category 4[^#]*post-calculation/s.test(contractSrc),
   "Category 4 wording not corrected");

ok("contract: few-peer wording uses 'One or more peer records'",
   contractSrc.includes('One or more peer records'),
   "few-peer wording not updated");

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SUMMARY                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

console.log('\n' + '═'.repeat(60));
console.log('Scoring contract validation complete');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('═'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
