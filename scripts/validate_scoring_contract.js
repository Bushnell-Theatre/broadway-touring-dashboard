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

/* ── Section 5 — Phase 2: inline planningSignals() eliminated ────────────── */

section('5. Phase 2: inline planningSignals() eliminated from both pages');

// programmingSrc and execSrc are already loaded in Section 3.

ok("programming.html: no inline function planningSignals declaration",
   !programmingSrc.includes('function planningSignals'),
   "found 'function planningSignals' in programming.html — inline definition must be deleted");

ok("exec_summary.html: no inline function planningSignals declaration",
   !execSrc.includes('function planningSignals'),
   "found 'function planningSignals' in exec_summary.html — inline definition must be deleted");

// Unqualified call: planningSignals( not preceded by BTD.page.
// The negative-lookahead pattern is: find planningSignals( where the preceding
// non-whitespace characters are NOT "BTD.page.". We strip BTD.page. calls first
// then check for any remaining bare calls.
function hasBareCall(htmlSrc) {
  var stripped = htmlSrc.replace(/BTD\.page\.planningSignals\s*\(/g, '__QUALIFIED__');
  return /\bplanningSignals\s*\(/.test(stripped);
}

ok("programming.html: no unqualified planningSignals( call sites",
   !hasBareCall(programmingSrc),
   "found unqualified planningSignals( in programming.html — must be BTD.page.planningSignals(");

ok("exec_summary.html: no unqualified planningSignals( call sites",
   !hasBareCall(execSrc),
   "found unqualified planningSignals( in exec_summary.html — must be BTD.page.planningSignals(");

// Inline demand scoring: the band-sum pattern used by the old Model 3
// (cap >= 85 ? 'Strong' combined with band-sum composite arithmetic).
// These patterns should only appear if someone reimplemented the old model.
function hasInlineDemandScoring(htmlSrc) {
  return /cap\s*>=\s*85\s*\?\s*['"]Strong['"]/.test(htmlSrc) &&
         /sigNums\s*=\s*\{/.test(htmlSrc);
}

ok("programming.html: no inline demand-band scoring (old Model 3)",
   !hasInlineDemandScoring(programmingSrc),
   "found old cap>=85 band-sum pattern in programming.html — inline scoring must be removed");

ok("exec_summary.html: no inline demand-band scoring (old Model 3)",
   !hasInlineDemandScoring(execSrc),
   "found old cap>=85 band-sum pattern in exec_summary.html — inline scoring must be removed");

// Planning Read must not be invented inline — only BTD.page.planningSignals()
// or BTD.signals.signalLabels() may produce it. Check for the old composite
// threshold strings ('Strong Candidate', 'Good Candidate') in contexts other
// than the contract document or signal-badge/display rendering.
// We check that the old composite-read assignment pattern is gone.
function hasInlinePlanningRead(htmlSrc) {
  // Old pattern: planningRead = composite >= 8 ? 'Strong Candidate' : ...
  return /planningRead\s*=\s*\n?\s*composite\s*>=/.test(htmlSrc);
}

ok("programming.html: no inline composite planningRead assignment",
   !hasInlinePlanningRead(programmingSrc),
   "found inline 'planningRead = composite >= ...' in programming.html");

ok("exec_summary.html: no inline composite planningRead assignment",
   !hasInlinePlanningRead(execSrc),
   "found inline 'planningRead = composite >= ...' in exec_summary.html");

// Stale user-facing methodology content checks.
// These target methodology/help copy that asserts behaviour the implementation
// no longer has. Each pattern is scoped to avoid rejecting innocuous editorial
// phrases (e.g. "needs review" as a verb phrase).

// Confidence recency: reject any <td>, <p>, or formula line that describes
// Confidence inputs and mentions "recency". We strip JS comments first.
function stripJsComments(s) {
  // Remove // line comments and /* block comments */ — avoids false positives
  // on developer notes like "Avoids expressing the score as a false percentile rank".
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

var progNoComments = stripJsComments(programmingSrc);
var execNoComments = stripJsComments(execSrc);

// Recency in Confidence descriptions — reject only when recency appears as a
// listed input (e.g. ", recency", "and recency", "recency, ", "recency and ").
// "No recency component" in corrected text must NOT trigger this check.
function confidenceClaimsRecency(src) {
  var noComments = stripJsComments(src);
  // Match "recency" as a list item — preceded or followed by ", " or "and ".
  // Does NOT match "No recency" or "no recency" (explicit correction text).
  // Matches: ", recency" | "recency," | "and recency" — all "recency as input" forms.
  // Does NOT match "No recency component" (no leading comma or "and").
  return /(?:,\s*recency\b|recency\s*,|\band\s+recency\b)/gi.test(noComments);
}

ok("programming.html: Confidence description does not claim recency as an input",
   !confidenceClaimsRecency(programmingSrc),
   "found 'Confidence ... recency' in user-facing content — Confidence has no recency input");

ok("exec_summary.html: Confidence description does not claim recency as an input",
   !confidenceClaimsRecency(execSrc),
   "found 'Confidence ... recency' in user-facing content — Confidence has no recency input");

// Peer Fit as percentile rank — reject HTML content asserting this.
// JS comment lines are stripped first; the phrase only appears in stale help copy.
function peerFitClaimsPercentile(src) {
  var noComments = stripJsComments(src);
  return /Peer\s+Fit[^<]{0,200}percentile/gi.test(noComments) ||
         /percentile\s+rank[^<]{0,100}peer\s+(pool|dataset)/gi.test(noComments);
}

ok("programming.html: Peer Fit description does not claim percentile rank",
   !peerFitClaimsPercentile(programmingSrc),
   "found Peer Fit percentile-rank claim in programming.html — Peer Fit uses capacity/GG/breadth");

ok("exec_summary.html: Peer Fit description does not claim percentile rank",
   !peerFitClaimsPercentile(execSrc),
   "found Peer Fit percentile-rank claim in exec_summary.html — Peer Fit uses capacity/GG/breadth");

// Old Model 3 Planning Read labels in user-facing content.
// "Good Candidate" only appears in old Model 3; not a canonical read.
// "Needs Review" as a canonical Planning Read — match the pattern
//   "Planning Read.*Needs Review" or in the old formula line.
// Editorial uses like "Needs Review: Show Title" are not Planning Read claims.
function hasOldPlanningReadLabel(src, label) {
  // Match the label inside a Planning Read formula or description context.
  // Formula pattern: "Planning Read = ... <label>" or "planningRead: '<label>'"
  var formulaPattern = new RegExp('Planning Read[^<]{0,200}' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return formulaPattern.test(src);
}

ok("programming.html: Planning Read list does not include 'Good Candidate' (old Model 3)",
   !hasOldPlanningReadLabel(programmingSrc, 'Good Candidate'),
   "found 'Planning Read ... Good Candidate' in programming.html — canonical reads do not include this label");

ok("exec_summary.html: Planning Read list does not include 'Good Candidate' (old Model 3)",
   !hasOldPlanningReadLabel(execSrc, 'Good Candidate'),
   "found 'Planning Read ... Good Candidate' in exec_summary.html — canonical reads do not include this label");

ok("programming.html: Planning Read list does not include 'Needs Review' as a canonical label",
   !hasOldPlanningReadLabel(programmingSrc, 'Needs Review'),
   "found 'Planning Read ... Needs Review' in programming.html — not a canonical Planning Read");

ok("exec_summary.html: Planning Read list does not include 'Needs Review' as a canonical label",
   !hasOldPlanningReadLabel(execSrc, 'Needs Review'),
   "found 'Planning Read ... Needs Review' in exec_summary.html — not a canonical Planning Read");

// Demand using total capacity or markets played as scored inputs.
// Match in content near "Demand Signal" descriptions.
function demandClaimsObsoleteInputs(src) {
  var noComments = stripJsComments(src);
  return /Demand[^<]{0,200}total capacity/gi.test(noComments) ||
         /Demand[^<]{0,200}markets played/gi.test(noComments);
}

ok("programming.html: Demand description does not claim total capacity or markets played as inputs",
   !demandClaimsObsoleteInputs(programmingSrc),
   "found obsolete Demand inputs (total capacity / markets played) in programming.html");

ok("exec_summary.html: Demand description does not claim total capacity or markets played as inputs",
   !demandClaimsObsoleteInputs(execSrc),
   "found obsolete Demand inputs (total capacity / markets played) in exec_summary.html");

// Fixed percentage weights — the old 40/25/25/10 model.
// Match content asserting the score uses fixed weights (e.g. "40%", "25%").
// Must avoid matching the SCORING_CONTRACT.md deprecation schedule.
function claimsFixedWeights(src) {
  var noComments = stripJsComments(src);
  // Look for fixed weight claims near scoring language.
  // "40%" or "SIGNAL_WEIGHTS" in HTML content (not in the contract doc).
  return /SIGNAL_WEIGHTS/g.test(noComments) ||
         /weighted.*40%|40%.*weighted/gi.test(noComments);
}

ok("programming.html: no fixed percentage weight claims (old 40/25/25/10 model)",
   !claimsFixedWeights(programmingSrc),
   "found fixed-weight claim in programming.html — the score uses equal-weight averaging, not SIGNAL_WEIGHTS");

ok("exec_summary.html: no fixed percentage weight claims (old 40/25/25/10 model)",
   !claimsFixedWeights(execSrc),
   "found fixed-weight claim in exec_summary.html — the score uses equal-weight averaging, not SIGNAL_WEIGHTS");

/* ── Section 6 — Phase 3: canonical signal card (no legacy markup) ───────── */

section('6. Phase 3: canonical signal card — legacy removed, contract fields used');

// Re-read sources fresh (they may have been updated this run).
var progSrc3 = src('src/programming.html');
var execSrc3 = src('src/exec_summary.html');

// 1. No p.signal reads — the legacy utils.js signal object is gone.
// Match "p.signal" when followed by a property access or assignment.
// Avoid matching "p.signals" (the canonical signals object).
function readsLegacySignal(s) {
  // "p.signal." or "p.signal =" or "p.signal)" — but NOT "p.signals."
  return /\bp\.signal(?!s)[\s.=)]/g.test(stripJsComments(s));
}
ok("programming.html: no reads from p.signal (legacy utils.js object)",
   !readsLegacySignal(progSrc3),
   "found p.signal access in programming.html — legacy signal object was removed");
ok("exec_summary.html: no reads from p.signal (legacy utils.js object)",
   !readsLegacySignal(execSrc3),
   "found p.signal access in exec_summary.html — legacy signal object was removed");

// 2. No scoreBand() calls — the old qualitative band function is gone.
ok("programming.html: scoreBand() function not declared",
   !stripJsComments(progSrc3).includes('function scoreBand'),
   "found function scoreBand in programming.html — must be removed");
ok("exec_summary.html: scoreBand() function not declared",
   !stripJsComments(execSrc3).includes('function scoreBand'),
   "found function scoreBand in exec_summary.html — must be removed");

ok("programming.html: scoreBand() not called",
   !stripJsComments(progSrc3).includes('scoreBand('),
   "found scoreBand( call in programming.html — legacy path must be removed");
ok("exec_summary.html: scoreBand() not called",
   !stripJsComments(execSrc3).includes('scoreBand('),
   "found scoreBand( call in exec_summary.html — legacy path must be removed");

// 3. No legacy National/Peer composite score IDs in markup.
// The old card had sigNatComposite, sigPeerComposite, sigPeerLabel (composite header).
ok("programming.html: no legacy sigNatComposite element",
   !progSrc3.includes('sigNatComposite'),
   "found sigNatComposite in programming.html — old National composite markup must be removed");
ok("exec_summary.html: no legacy sigNatComposite element",
   !execSrc3.includes('sigNatComposite'),
   "found sigNatComposite in exec_summary.html — old National composite markup must be removed");
ok("programming.html: no legacy sigPeerComposite element",
   !progSrc3.includes('sigPeerComposite'),
   "found sigPeerComposite in programming.html — old Peer composite markup must be removed");
ok("exec_summary.html: no legacy sigPeerComposite element",
   !execSrc3.includes('sigPeerComposite'),
   "found sigPeerComposite in exec_summary.html — old Peer composite markup must be removed");

// 4. Shared planning-signal adapter is used in renderSignalCard.
// Both pages must call BTD.page.planningSignals() inside the signal card renderer.
ok("programming.html: renderSignalCard uses BTD.page.planningSignals()",
   progSrc3.includes('BTD.page.planningSignals(p)'),
   "renderSignalCard in programming.html does not call BTD.page.planningSignals(p)");
ok("exec_summary.html: renderSignalCard uses BTD.page.planningSignals()",
   execSrc3.includes('BTD.page.planningSignals(p)'),
   "renderSignalCard in exec_summary.html does not call BTD.page.planningSignals(p)");

// 5. National reference strip with "not scored" disclosure is present.
ok("programming.html: national reference strip labeled 'not scored'",
   progSrc3.includes('National reference — not scored'),
   "programming.html missing 'National reference — not scored' label in signal card");
ok("exec_summary.html: national reference strip labeled 'not scored'",
   execSrc3.includes('National reference — not scored'),
   "exec_summary.html missing 'National reference — not scored' label in signal card");

// 6. Context-filter disclosure logic: checks ACTIVE_TIER and ACTIVE_SUB near sigContextBadge.
// Both variables must appear in the same renderSignalCard function as the badge element.
function hasContextDisclosure(s) {
  // Find renderSignalCard body (from "function renderSignalCard" to the closing brace).
  var start = s.indexOf('function renderSignalCard');
  if (start < 0) return false;
  var body = s.slice(start, start + 3000); // generous slice
  return body.includes('sigContextBadge') &&
         body.includes('ACTIVE_TIER') &&
         body.includes('ACTIVE_SUB');
}
ok("programming.html: context-filter disclosure checks ACTIVE_TIER and ACTIVE_SUB",
   hasContextDisclosure(progSrc3),
   "programming.html renderSignalCard missing context-filter disclosure (sigContextBadge + ACTIVE_TIER + ACTIVE_SUB)");
ok("exec_summary.html: context-filter disclosure checks ACTIVE_TIER and ACTIVE_SUB",
   hasContextDisclosure(execSrc3),
   "exec_summary.html renderSignalCard missing context-filter disclosure (sigContextBadge + ACTIVE_TIER + ACTIVE_SUB)");

// 7. Planning Read and Season Position are separate elements.
// Card must contain both sigPlanningRead and sigSeasonPos as distinct IDs.
ok("programming.html: Planning Read (sigPlanningRead) and Season Position (sigSeasonPos) are separate elements",
   progSrc3.includes('sigPlanningRead') && progSrc3.includes('sigSeasonPos'),
   "programming.html missing sigPlanningRead or sigSeasonPos element in signal card");
ok("exec_summary.html: Planning Read (sigPlanningRead) and Season Position (sigSeasonPos) are separate elements",
   execSrc3.includes('sigPlanningRead') && execSrc3.includes('sigSeasonPos'),
   "exec_summary.html missing sigPlanningRead or sigSeasonPos element in signal card");

// 8. Null score is not coerced to zero in renderSignalCard.
// The function must test "p.score != null" (or equivalent) before using the score.
// Reject patterns that would silently coerce null to 0: "p.score || 0" or "p.score ?? 0".
function nullScoreCoerced(s) {
  var start = s.indexOf('function renderSignalCard');
  if (start < 0) return false;
  var body = s.slice(start, start + 3000);
  return /p\.score\s*\|\|\s*0/.test(body) || /p\.score\s*\?\?\s*0/.test(body);
}
ok("programming.html: null score not coerced to zero in renderSignalCard",
   !nullScoreCoerced(progSrc3),
   "found 'p.score || 0' or 'p.score ?? 0' in renderSignalCard — null must show 'Exploratory', not zero");
ok("exec_summary.html: null score not coerced to zero in renderSignalCard",
   !nullScoreCoerced(execSrc3),
   "found 'p.score || 0' or 'p.score ?? 0' in renderSignalCard — null must show 'Exploratory', not zero");

// 9. renderSignalCard reads p.planning.read directly (no scoreBand fallback for display).
function planningReadReadDirectly(s) {
  var start = s.indexOf('function renderSignalCard');
  if (start < 0) return false;
  var body = s.slice(start, start + 3000);
  return body.includes('p.planning') && body.includes('sigPlanningRead');
}
ok("programming.html: renderSignalCard displays p.planning.read via sigPlanningRead",
   planningReadReadDirectly(progSrc3),
   "programming.html renderSignalCard does not read p.planning.read into sigPlanningRead");
ok("exec_summary.html: renderSignalCard displays p.planning.read via sigPlanningRead",
   planningReadReadDirectly(execSrc3),
   "exec_summary.html renderSignalCard does not read p.planning.read into sigPlanningRead");

// 10. sigFillPct is removed — bar widths must use canonical p.signals.*.value.
// The fixed label→percentage map was a Phase 3 bug; it must not appear anywhere.
function sigFillPctPresent(s) {
  return s.includes('function sigFillPct') || s.includes('sigFillPct(');
}
ok("programming.html: sigFillPct is absent (removed in Phase 3 corrections)",
   !sigFillPctPresent(progSrc3),
   "programming.html still contains sigFillPct — must be removed; use p.signals.*.value for bar widths");
ok("exec_summary.html: sigFillPct is absent (removed in Phase 3 corrections)",
   !sigFillPctPresent(execSrc3),
   "exec_summary.html still contains sigFillPct — must be removed; use p.signals.*.value for bar widths");

// 11. Canonical component values appear in renderSignalCard.
// Bar widths must come from p.signals.*.value (via rawSig.demand.value etc.).
function canonicalValuesUsed(s) {
  var start = s.indexOf('function renderSignalCard');
  if (start < 0) return false;
  var body = s.slice(start, start + 4000);
  return body.includes('rawSig.demand.value') &&
         body.includes('rawSig.revenue.value') &&
         body.includes('rawSig.peer.value') &&
         body.includes('rawSig.confidence.value');
}
ok("programming.html: renderSignalCard uses rawSig.*.value for component bar widths",
   canonicalValuesUsed(progSrc3),
   "programming.html renderSignalCard missing rawSig.demand/revenue/peer/confidence.value — must use canonical values, not fixed label map");
ok("exec_summary.html: renderSignalCard uses rawSig.*.value for component bar widths",
   canonicalValuesUsed(execSrc3),
   "exec_summary.html renderSignalCard missing rawSig.demand/revenue/peer/confidence.value — must use canonical values, not fixed label map");

// 12. Numeric component value is rendered via sig-comp-val span.
// The class must appear inside renderSignalCard (written by sigCompRender).
function sigCompValPresent(s) {
  var start = s.indexOf('function renderSignalCard');
  if (start < 0) return false;
  var body = s.slice(start, start + 4000);
  return body.includes('sig-comp-val');
}
ok("programming.html: sig-comp-val span rendered in renderSignalCard for numeric component values",
   sigCompValPresent(progSrc3),
   "programming.html renderSignalCard missing sig-comp-val span — numeric component value must be displayed alongside badge");
ok("exec_summary.html: sig-comp-val span rendered in renderSignalCard for numeric component values",
   sigCompValPresent(execSrc3),
   "exec_summary.html renderSignalCard missing sig-comp-val span — numeric component value must be displayed alongside badge");

// 13. Season Position is three-state (above / at / below), not binary.
// Must contain: p.score > SCORE_MED, p.score < SCORE_MED, and "At season median".
// Must NOT contain the old binary "p.score >= SCORE_MED" as the sole condition.
function seasonPosThreeState(s) {
  var start = s.indexOf('function renderSignalCard');
  if (start < 0) return false;
  var body = s.slice(start, start + 4000);
  return (
    body.includes('p.score > SCORE_MED') &&
    body.includes('p.score < SCORE_MED') &&
    body.includes('At season median')
  );
}
function seasonPosBinaryBug(s) {
  /* Flag the old two-state pattern: "p.score >= SCORE_MED" used as the
   * Season Position condition (not as the composite score color guard). */
  var start = s.indexOf('function renderSignalCard');
  if (start < 0) return false;
  var body = s.slice(start, start + 4000);
  /* The composite-score color guard also uses >= but on a different variable
   * (scoreEl.style.color). We scope to lines that set posEl (the season pos). */
  return /p\.score\s*>=\s*SCORE_MED/.test(body) &&
    !body.includes('p.score > SCORE_MED');
}
ok("programming.html: Season Position is three-state (above / at / below season median)",
   seasonPosThreeState(progSrc3),
   "programming.html renderSignalCard Season Position missing three-state logic — need p.score > SCORE_MED, p.score < SCORE_MED, and 'At season median'");
ok("exec_summary.html: Season Position is three-state (above / at / below season median)",
   seasonPosThreeState(execSrc3),
   "exec_summary.html renderSignalCard Season Position missing three-state logic — need p.score > SCORE_MED, p.score < SCORE_MED, and 'At season median'");
ok("programming.html: old binary Season Position bug (>= SCORE_MED) is absent",
   !seasonPosBinaryBug(progSrc3),
   "programming.html renderSignalCard still uses 'p.score >= SCORE_MED' for Season Position — equality must route to 'At season median' state");
ok("exec_summary.html: old binary Season Position bug (>= SCORE_MED) is absent",
   !seasonPosBinaryBug(execSrc3),
   "exec_summary.html renderSignalCard still uses 'p.score >= SCORE_MED' for Season Position — equality must route to 'At season median' state");

// 14. sig-comp-val is defined in styles.css.
const stylesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'styles.css'), 'utf8');
ok("styles.css: .sig-comp-val class is defined",
   stylesSrc.includes('.sig-comp-val'),
   "styles.css missing .sig-comp-val class definition — required for numeric component value display");

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 7 — Phase 4 removal guards (utils.js)                           */
/*                                                                            */
/*  These checks constitute the automated removal coverage that the          */
/*  SCORING_CONTRACT.md deprecation schedule originally required before      */
/*  deleting planningSignal() and SIGNAL_WEIGHTS. They fail immediately if   */
/*  either symbol — or any of the four private helpers that served the       */
/*  deprecated model — is reintroduced in utils.js or called from any page. */
/*                                                                            */
/*  Rationale for satisfying the former "Phase 5 contract tests pass" gate   */
/*  in Phase 4 is documented in SCORING_CONTRACT.md §"Removal gate           */
/*  reconciliation (Phase 4)".                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

section('7. Phase 4: utils.js Model 1 symbols permanently absent');

const utilsSrc      = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'utils.js'), 'utf8');
const utilsStripped = stripJsComments(utilsSrc);

// 1. SIGNAL_WEIGHTS must not be re-declared as a live variable in utils.js.
// Tombstone comment references to the name are allowed; live declarations are not.
ok("utils.js: SIGNAL_WEIGHTS not re-declared (Phase 4 guard)",
   !/\b(?:var|let|const)\s+SIGNAL_WEIGHTS\s*=/.test(utilsStripped),
   "utils.js re-declares SIGNAL_WEIGHTS — must remain removed (Model 1 weight constants)");

// 2. planningSignal() must not be re-declared as a function in utils.js.
ok("utils.js: planningSignal() not re-declared (Phase 4 guard)",
   !/\bfunction\s+planningSignal\b/.test(utilsStripped) &&
   !/\bplanningSignal\s*=\s*function\b/.test(utilsStripped),
   "utils.js re-declares planningSignal — must remain removed (Model 1 entry point)");

// 3. The private percentileRank() from Model 1 must not be re-declared in utils.js.
// BTD.metrics.percentileRank in metrics.js is a different implementation and is permitted.
ok("utils.js: function percentileRank() not re-declared (Phase 4 guard — private Model 1 helper)",
   !/\bfunction\s+percentileRank\b/.test(utilsStripped),
   "utils.js re-declares percentileRank — the private Model 1 helper must remain removed");

// 4. The recency-based confidenceScore() from Model 1 must not be re-declared.
// The local variable 'confidenceScore' in signals.js is a different thing and is permitted.
ok("utils.js: function confidenceScore() not re-declared (Phase 4 guard — recency-based Model 1 helper)",
   !/\bfunction\s+confidenceScore\b/.test(utilsStripped),
   "utils.js re-declares confidenceScore — the recency-based Model 1 helper must remain removed");

// 5. threeYearCutoff() must not be re-declared.
ok("utils.js: function threeYearCutoff() not re-declared (Phase 4 guard)",
   !/\bfunction\s+threeYearCutoff\b/.test(utilsStripped),
   "utils.js re-declares threeYearCutoff — the Model 1 helper must remain removed");

// 6. No page may call planningSignal() (no 's') — the Model 1 entry point.
// This is distinct from planningSignals() (with 's') which is the Model 3 inline.
// Section 3 covers planningSignals (Model 3); this guard covers planningSignal (Model 1).
function callsPlanningSignalModel1(src) {
  var stripped = stripJsComments(src);
  /* Match "planningSignal(" but not "planningSignals(" (the Model 3 function).
   * Negative character class: planningSignal followed by ( but not by s+( */
  return /\bplanningSignal\s*\(/.test(stripped.replace(/\bplanningSignals\s*\(/g, '__MODEL3__'));
}
ok("programming.html: planningSignal() (Model 1) not called (Phase 4 guard)",
   !callsPlanningSignalModel1(progSrc3),
   "programming.html calls planningSignal() — this is the removed Model 1 entry point in utils.js");
ok("exec_summary.html: planningSignal() (Model 1) not called (Phase 4 guard)",
   !callsPlanningSignalModel1(execSrc3),
   "exec_summary.html calls planningSignal() — this is the removed Model 1 entry point in utils.js");

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 8 — DEVELOPER.md return-shape invariants (Phase 5)               */
/*                                                                            */
/*  Each correction is guarded on BOTH sides:                                 */
/*   • signals.js — implementation still matches what the doc describes.      */
/*   • DEVELOPER.md — the document actually contains the correct text.        */
/*                                                                            */
/*  A one-sided check only catches implementation drift; it cannot catch      */
/*  the doc reverting to stale content independently.                         */
/* ══════════════════════════════════════════════════════════════════════════ */

section('8. DEVELOPER.md return-shape invariants (Phase 5)');

const developerSrc = src('docs/DEVELOPER.md');

/* ── 1. profileShow 3-param signature ──────────────────────────────────── */
// Implementation side: signals.js declares the function with 3 params.
ok("signals.js: profileShow declared with 3-param signature (show, records, options)",
   /function\s+profileShow\s*\(\s*show\s*,\s*records\s*,\s*options\s*\)/.test(signalsSrc),
   "signals.js profileShow signature has changed — DEVELOPER.md must be updated to match");

// Documentation side: DEVELOPER.md contains the correct 3-param call.
ok("DEVELOPER.md: documents profileShow with 3-param signature (show, records, options)",
   developerSrc.includes('BTD.signals.profileShow(show, records, options)'),
   "DEVELOPER.md reverted to old signature — must document BTD.signals.profileShow(show, records, options)");

// Documentation side: the obsolete 5-param signature is absent.
ok("DEVELOPER.md: obsolete 5-param signature (show, records, peers, context, config) is absent",
   !developerSrc.includes('profileShow(show, records, peers, context, config)'),
   "DEVELOPER.md contains the old 5-param profileShow signature — must be (show, records, options)");

/* ── 2. title as top-level field ───────────────────────────────────────── */
// Implementation side: signals.js return assigns title: titleOf(show).
ok("signals.js: profileShow return object has top-level `title:` field",
   /\btitle\s*:\s*titleOf\s*\(\s*show\s*\)/.test(signalsSrc),
   "signals.js profileShow return object lost top-level `title:` field — DEVELOPER.md must be updated");

// Documentation side: DEVELOPER.md documents title as top-level.
// The canonical marker is the comment '// normalized show title string (top-level)'.
ok("DEVELOPER.md: title documented as top-level field (not nested under show)",
   developerSrc.includes('normalized show title string (top-level)'),
   "DEVELOPER.md lost the top-level title annotation — must document title as a top-level field, not nested under show");

/* ── 3. decomp contains canonical rounded values, not raw pre-scale data ─ */
// Implementation side: signals.js decomp object includes the canonical: key.
ok("signals.js: decomp object includes `canonical:` marker (rounded component values, not raw)",
   /decomp\s*:\s*\{[^}]*\bcanonical\s*:/.test(signalsSrc),
   "signals.js decomp object lost `canonical:` marker — description in DEVELOPER.md must match implementation");

// Documentation side: 'raw pre-scale values' description is absent.
ok("DEVELOPER.md: decomp not described as 'raw pre-scale values'",
   !developerSrc.includes('raw pre-scale values'),
   "DEVELOPER.md reverted to describing decomp as 'raw pre-scale values' — must describe rounded canonical component values");

// Documentation side: decomp is described as rounded canonical values.
ok("DEVELOPER.md: decomp described as rounded canonical component values",
   developerSrc.includes('rounded demand component value'),
   "DEVELOPER.md lost the rounded-canonical-values description for decomp — must match implementation");

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 9 — CLAUDE.md current-versions table matches versions.json       */
/*                                                                            */
/*  versions.json is the single source of truth for page versions. CLAUDE.md */
/*  carries a "Current versions" table that must stay in sync. This section  */
/*  parses both files and checks that each page's version string appears in  */
/*  the CLAUDE.md table. A mismatch fails immediately so the next version    */
/*  bump can't silently leave the table stale.                               */
/* ══════════════════════════════════════════════════════════════════════════ */

section('9. CLAUDE.md current-versions table matches versions.json');

const versionsJson = JSON.parse(src('src/data/versions.json'));
const claudeSrc    = src('CLAUDE.md');

// The four pages tracked in versions.json; label is how they appear in CLAUDE.md.
const VERSION_PAGES = [
  { key: 'dashboard',    label: 'dashboard.html'    },
  { key: 'programming',  label: 'programming.html'  },
  { key: 'exec_summary', label: 'exec_summary.html' },
  { key: 'box_office',   label: 'box_office.html'   },
];

VERSION_PAGES.forEach(function (p) {
  var entry = versionsJson[p.key];
  if (!entry) {
    ok('CLAUDE.md versions table: ' + p.label + ' entry present in versions.json',
       false, 'versions.json is missing the ' + p.key + ' key');
    return;
  }
  var version = entry.version; // e.g. "v6.0"
  // Check that the CLAUDE.md table row for this page includes the version string.
  // The table row format is: | page.html | vX.Y | ... |
  var rowPattern = new RegExp('\\|\\s*' + p.label.replace('.', '\\.') + '\\s*\\|[^|]*' + version.replace('.', '\\.'));
  ok('CLAUDE.md versions table: ' + p.label + ' shows ' + version,
     rowPattern.test(claudeSrc),
     'CLAUDE.md current-versions table for ' + p.label + ' does not match versions.json (' + version + ')');
});

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 10 — Post-merge reconciliation invariants                        */
/*                                                                            */
/*  Guards for four items identified in the post-merge reconciliation:       */
/*   a) SCORING_CONTRACT.md documents three-state Season Position.           */
/*   b) SCORING_CONTRACT.md no longer calls disclosure a Phase 3 future task.*/
/*   c) SCORING_CONTRACT.md distinguishes null stored / Exploratory UI / dash.*/
/*   d) HTML pageVersion/pageDate fallbacks match versions.json.             */
/*   e) programming.html <title> contains no hardcoded version string.       */
/* ══════════════════════════════════════════════════════════════════════════ */

section('10. Post-merge reconciliation invariants');

// contractSrc already loaded at Section 2 (line 298).

// a-1. SCORING_CONTRACT.md documents all three Season Position states.
ok("SCORING_CONTRACT.md: Season Position documents 'Above season median' state",
   contractSrc.includes('Above season median'),
   "SCORING_CONTRACT.md missing 'Above season median' — Season Position must document three states");
ok("SCORING_CONTRACT.md: Season Position documents 'At season median' state",
   contractSrc.includes('At season median'),
   "SCORING_CONTRACT.md missing 'At season median' — Season Position must document three states");
ok("SCORING_CONTRACT.md: Season Position documents 'Below season median' state",
   contractSrc.includes('Below season median'),
   "SCORING_CONTRACT.md missing 'Below season median' — Season Position must document three states");
ok("SCORING_CONTRACT.md: Season Position documents null/hidden state",
   contractSrc.includes('null score has no season position') ||
   contractSrc.includes('hidden') && contractSrc.includes('null'),
   "SCORING_CONTRACT.md must document that null score hides the Season Position element");

// a-2. Old binary >= Season Position code is absent from SCORING_CONTRACT.md.
ok("SCORING_CONTRACT.md: old binary >= Season Position code is absent",
   !/p\.score\s*>=\s*SCORE_MED\s*\?/.test(contractSrc),
   "SCORING_CONTRACT.md still contains the old binary p.score >= SCORE_MED Season Position — must be three-state");

// b. 'Phase 3 UI task' stale language is absent from SCORING_CONTRACT.md.
ok("SCORING_CONTRACT.md: stale 'Phase 3 UI task' language is absent",
   !contractSrc.includes('Phase 3 UI task'),
   "SCORING_CONTRACT.md still calls disclosure a 'Phase 3 UI task' — Phase 3 is complete; update to past tense");

// c. SCORING_CONTRACT.md distinguishes null stored, Exploratory UI, and dash.
ok("SCORING_CONTRACT.md: null score Exploratory presentation documented",
   contractSrc.includes('Exploratory') && contractSrc.includes('sigCompositeScore'),
   "SCORING_CONTRACT.md must document that null score renders as 'Exploratory' in the signal card");
ok("SCORING_CONTRACT.md: null score em-dash formatter presentation documented",
   contractSrc.includes('—') && contractSrc.includes('fmt') || contractSrc.includes('pct()'),
   "SCORING_CONTRACT.md must document that numeric formatters render null metric values as em-dash");

// d. HTML pageVersion fallback text matches versions.json for scored pages.
// Extract the fallback text from id="pageVersion">...<
function extractFallback(htmlSrc, id) {
  var m = new RegExp('id="' + id + '">([^<]+)<').exec(htmlSrc);
  return m ? m[1].trim() : null;
}
var progFallbackVer  = extractFallback(progSrc3,  'pageVersion');
var execFallbackVer  = extractFallback(execSrc3,  'pageVersion');
var progFallbackDate = extractFallback(progSrc3,  'pageDate');
var execFallbackDate = extractFallback(execSrc3,  'pageDate');

ok("programming.html: pageVersion fallback matches versions.json",
   progFallbackVer === versionsJson.programming.version,
   "programming.html pageVersion fallback (" + progFallbackVer + ") does not match versions.json (" + versionsJson.programming.version + ")");
ok("exec_summary.html: pageVersion fallback matches versions.json",
   execFallbackVer === versionsJson.exec_summary.version,
   "exec_summary.html pageVersion fallback (" + execFallbackVer + ") does not match versions.json (" + versionsJson.exec_summary.version + ")");
ok("programming.html: pageDate fallback matches versions.json",
   progFallbackDate === versionsJson.programming.date,
   "programming.html pageDate fallback (" + progFallbackDate + ") does not match versions.json (" + versionsJson.programming.date + ")");
ok("exec_summary.html: pageDate fallback matches versions.json",
   execFallbackDate === versionsJson.exec_summary.date,
   "exec_summary.html pageDate fallback (" + execFallbackDate + ") does not match versions.json (" + versionsJson.exec_summary.date + ")");

// e. programming.html <title> must not contain a hardcoded version string (vX.Y).
ok("programming.html: <title> contains no hardcoded version string",
   !/<title>[^<]*v\d+\.\d+[^<]*<\/title>/.test(progSrc3),
   "programming.html <title> contains a hardcoded version string — version strings must come from versions.json, not the <title> tag");

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SECTION 11 — index.html version card invariants                          */
/*                                                                            */
/*  index.html cards must not carry hard-coded version/date strings.         */
/*  versions.json is the sole source of displayed versions; the loader       */
/*  replaces each ver-<key> span on load. Static fallback text must be       */
/*  neutral ("Loading…") so a fetch failure does not surface stale data.     */
/* ══════════════════════════════════════════════════════════════════════════ */

section('11. index.html version card invariants');

const indexSrc = src('src/index.html');

// Active ver-* elements that must exist in index.html and carry no hardcoded version.
// box_office is suspended (commented out) — excluded from active checks.
const ACTIVE_CARD_KEYS = ['dashboard', 'programming', 'exec_summary'];

ACTIVE_CARD_KEYS.forEach(function (key) {
  var id = 'ver-' + key;

  // 1. The ver-<key> span exists (and is not commented out).
  // Match the element outside an HTML comment block.
  var strippedComments = indexSrc.replace(/<!--[\s\S]*?-->/g, '');
  ok('index.html: id="ver-' + key + '" element present (not commented out)',
     strippedComments.includes('id="ver-' + key + '"'),
     'index.html is missing an active id="ver-' + key + '" span — required for versions.json loader');

  // 2. The ver-<key> span contains no hardcoded version string (vX.Y pattern).
  //    Extract the text between >…< for this element and check it is version-free.
  var spanPattern = new RegExp('id="ver-' + key + '"[^>]*>([^<]*)<');
  var spanMatch = spanPattern.exec(strippedComments);
  var fallbackText = spanMatch ? spanMatch[1].trim() : '';
  ok('index.html: ver-' + key + ' fallback contains no hardcoded version string',
     !/v\d+\.\d+/.test(fallbackText),
     'index.html ver-' + key + ' fallback contains hardcoded version "' + fallbackText + '" — use a neutral placeholder like "Loading…"');
});

// 3. The versions.json loader is present and iterates over the active card keys.
ok("index.html: versions.json loader fetches 'data/versions.json'",
   indexSrc.includes("fetch('data/versions.json')"),
   "index.html is missing the versions.json fetch — loader is required to populate ver-* spans");

ok("index.html: versions.json loader references 'programming' key",
   /ver-.*programming|programming.*ver-|'programming'/.test(indexSrc),
   "index.html versions.json loader does not reference the 'programming' card key");

ok("index.html: versions.json loader references 'exec_summary' key",
   /ver-.*exec_summary|exec_summary.*ver-|'exec_summary'/.test(indexSrc),
   "index.html versions.json loader does not reference the 'exec_summary' card key");

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SUMMARY                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

console.log('\n' + '═'.repeat(60));
console.log('Scoring contract validation complete');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('═'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
