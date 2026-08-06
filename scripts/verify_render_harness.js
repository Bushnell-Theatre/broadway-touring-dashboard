'use strict';
/**
 * verify_render_harness.js
 *
 * DOM-stub harness for renderSignalCard(). Exercises the six rendered states
 * required by the Phase 3 final review on both programming.html and
 * exec_summary.html:
 *
 *   1. Two same-label components with different values → different bars + numerics
 *   2. Null component value → Exploratory badge, 0% bar, no numeric zero
 *   3. Peer Fit value = 0 → label badge, 0% bar, no numeric zero
 *   4. score > / === / < SCORE_MED → three Season Position states
 *   5. Null composite → "Exploratory" score, hidden Season Position, empty note
 *   6. Baseline / tier / sub / non-sub / combined → correct disclosure badge
 *
 * Run with: node scripts/verify_render_harness.js
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');

/* ── Assertion counters ──────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;

function ok(label, cond, detail) {
  if (cond) {
    console.log('    ✅ ' + label);
    passed++;
  } else {
    console.log('    ❌ ' + label);
    if (detail) console.log('       → ' + detail);
    failed++;
  }
}

/* ── Brace-balanced function extractor ──────────────────────────────────── */
/* Handles nested functions (sigCompRender lives inside renderSignalCard).
 * Skips braces inside single-quoted, double-quoted, and template strings. */

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('function ' + name + ' not found in source');

  let depth = 0;
  let inStr  = false;
  let strChar = '';

  for (let i = start; i < src.length; i++) {
    const c = src[i];

    if (inStr) {
      /* End of string — but not if escaped */
      if (c === strChar && src[i - 1] !== '\\') inStr = false;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr   = true;
      strChar = c;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }

  throw new Error('unclosed braces in function ' + name);
}

/* ── Minimal DOM element stub ────────────────────────────────────────────── */

function makeDom() {
  const ids = [
    'signalCard',
    'sigCompositeScore', 'sigPlanningRead', 'sigInterpretation',
    'sigSeasonPos',      'sigContextBadge',
    'sigDemandBar',      'sigDemandLabel',
    'sigRevenueBar',     'sigRevenueLabel',
    'sigPeerFitBar',     'sigPeerFitLabel',
    'sigConfBar',        'sigConfLabel',
    'sigNatCap',         'sigNatGg', 'sigNatDepth'
  ];
  const dom = {};
  ids.forEach(id => {
    dom[id] = {
      id,
      textContent : '',
      innerHTML   : '',
      style       : { width: '', color: '', display: '' }
    };
  });
  return dom;
}

/* ── Runner builder ──────────────────────────────────────────────────────── */
/* Extracts renderSignalCard once, then returns a callable that:
 *   (a) creates fresh DOM stubs
 *   (b) builds a vm context with all globals the function needs
 *   (c) runs renderSignalCard(profile) inside that context
 *   (d) returns the populated DOM stubs for assertion */

function buildRunner(htmlSrc) {
  const funcText = extractFunction(htmlSrc, 'renderSignalCard');

  return function run(profile, scoreMed, activeTier, activeSub) {
    const dom = makeDom();

    /* signalBadge stub: use a distinctive wrapper so assertions can detect
     * the label text unambiguously. */
    const signalBadgeStub = function(label) {
      return '<sb>' + label + '</sb>';
    };

    /* pct stub: matches the real pct() signature used in the national strip. */
    const pctStub = function(v) {
      return v != null ? (v * 100).toFixed(1) + '%' : '—';
    };

    /* BTD.page.planningSignals stub: returns labels directly from the profile's
     * signals.*.label fields, same as the real adapter. */
    const planningSignalsStub = function(p) {
      var sig = (p && p.signals) || {};
      function lbl(k) { return (sig[k] && sig[k].label) || 'Exploratory'; }
      return {
        demand       : lbl('demand'),
        revenue      : lbl('revenue'),
        peer         : lbl('peer'),
        confidence   : lbl('confidence'),
        planningRead : (p && p.planning && p.planning.read)  || 'Exploratory',
        interpretation: (p && p.planning && p.planning.note) || ''
      };
    };

    const script = [
      /* Bind all globals the function references */
      'var $ = function(id) { return __dom[id]; };',
      'var BTD          = __BTD;',
      'var signalBadge  = __signalBadge;',
      'var pct          = __pct;',
      'var SCORE_MED    = __SCORE_MED;',
      'var ACTIVE_TIER  = __ACTIVE_TIER;',
      'var ACTIVE_SUB   = __ACTIVE_SUB;',
      /* The extracted function definition */
      funcText,
      /* Call it with the test profile */
      'renderSignalCard(__profile);'
    ].join('\n');

    vm.runInNewContext(script, {
      __dom          : dom,
      __BTD          : { page: { planningSignals: planningSignalsStub } },
      __signalBadge  : signalBadgeStub,
      __pct          : pctStub,
      __SCORE_MED    : scoreMed,
      __ACTIVE_TIER  : activeTier,
      __ACTIVE_SUB   : activeSub,
      __profile      : profile
    });

    return dom;
  };
}

/* ── Test profiles ───────────────────────────────────────────────────────── */

const SCORE_MED = 60;

/* Two components share the "Moderate" label but have values 48 and 74. */
const profileSameLabelDiffValue = {
  score: 65,
  planning: { read: 'Discuss', note: 'Solid evidence base with mixed signals.' },
  signals: {
    demand     : { value: 48, label: 'Moderate' },
    revenue    : { value: 74, label: 'Moderate' },
    peer       : { value: 55, label: 'Moderate' },
    confidence : { value: 80, label: 'High'     }
  },
  metrics: { paidCapacity: 0.72, ggPctGp: 0.85, count: 30, venueCount: 12 }
};

/* Demand component has a null value (no data for cohort). */
const profileNullComponent = {
  score: 50,
  planning: { read: 'Watch', note: 'Limited peer data.' },
  signals: {
    demand     : { value: null, label: 'Exploratory' },
    revenue    : { value: 55,   label: 'Moderate'    },
    peer       : { value: 30,   label: 'Soft'        },
    confidence : { value: 20,   label: 'Low'         }
  },
  metrics: { paidCapacity: 0.65, ggPctGp: 0.70, count: 5, venueCount: 2 }
};

/* Peer Fit value is exactly 0 (zero peer records — measured, not null). */
const profilePeerZero = {
  score: 38,
  planning: { read: 'Exploratory', note: '' },
  signals: {
    demand     : { value: 55, label: 'Moderate' },
    revenue    : { value: 60, label: 'Moderate' },
    peer       : { value: 0,  label: 'Weak'     },   /* exactly 0 */
    confidence : { value: 30, label: 'Low'      }
  },
  metrics: { paidCapacity: 0.70, ggPctGp: 0.80, count: 8, venueCount: 3 }
};

/* Null composite: future new tour with no evidence. */
const profileNullScore = {
  score           : null,
  isFutureNewTour : true,
  planning        : { read: 'Exploratory', note: '' },
  signals: {
    demand     : { value: null, label: 'Exploratory' },
    revenue    : { value: null, label: 'Exploratory' },
    peer       : { value: 0,   label: 'Exploratory'  },
    confidence : { value: 0,   label: 'Exploratory'  }
  },
  metrics: null
};

/* Helper: generic scored profile for Season Position and context tests. */
function scoreProfile(score) {
  return {
    score,
    planning: { read: 'Discuss', note: 'Adequate evidence.' },
    signals: {
      demand     : { value: 60, label: 'Moderate' },
      revenue    : { value: 60, label: 'Moderate' },
      peer       : { value: 60, label: 'Moderate' },
      confidence : { value: 60, label: 'Moderate' }
    },
    metrics: { paidCapacity: 0.70, ggPctGp: 0.80, count: 20, venueCount: 8 }
  };
}

/* ── State runner ────────────────────────────────────────────────────────── */

function runTests(pageName, htmlSrc) {
  console.log('\n' + '═'.repeat(62));
  console.log('  ' + pageName);
  console.log('═'.repeat(62));

  const run = buildRunner(htmlSrc);

  /* ─── State 1: Same label, different values ─── */
  console.log('\n  State 1 — same label, different canonical values');
  {
    const dom = run(profileSameLabelDiffValue, SCORE_MED, '', '');

    ok('Demand bar = 48%',
       dom.sigDemandBar.style.width === '48%',
       'got "' + dom.sigDemandBar.style.width + '"');

    ok('Revenue bar = 74%',
       dom.sigRevenueBar.style.width === '74%',
       'got "' + dom.sigRevenueBar.style.width + '"');

    ok('Bars differ (48 ≠ 74)',
       dom.sigDemandBar.style.width !== dom.sigRevenueBar.style.width);

    ok('Demand badge contains numeric 48',
       dom.sigDemandLabel.innerHTML.includes('>48<'),
       'got: ' + dom.sigDemandLabel.innerHTML);

    ok('Revenue badge contains numeric 74',
       dom.sigRevenueLabel.innerHTML.includes('>74<'),
       'got: ' + dom.sigRevenueLabel.innerHTML);
  }

  /* ─── State 2: Null component value ─── */
  console.log('\n  State 2 — null component value');
  {
    const dom = run(profileNullComponent, SCORE_MED, '', '');

    ok('Demand bar = 0% (value is null)',
       dom.sigDemandBar.style.width === '0%',
       'got "' + dom.sigDemandBar.style.width + '"');

    ok('Demand badge shows Exploratory',
       dom.sigDemandLabel.innerHTML.includes('Exploratory'),
       'got: ' + dom.sigDemandLabel.innerHTML);

    ok('Demand badge does NOT contain numeric zero',
       !dom.sigDemandLabel.innerHTML.includes('>0<'),
       'got: ' + dom.sigDemandLabel.innerHTML);

    ok('Adjacent Revenue bar = 55% (unaffected by null demand)',
       dom.sigRevenueBar.style.width === '55%',
       'got "' + dom.sigRevenueBar.style.width + '"');
  }

  /* ─── State 3: Peer Fit value = 0 ─── */
  console.log('\n  State 3 — Peer Fit value = 0 (zero peer records)');
  {
    const dom = run(profilePeerZero, SCORE_MED, '', '');

    ok('Peer Fit bar = 0% (value is 0)',
       dom.sigPeerFitBar.style.width === '0%',
       'got "' + dom.sigPeerFitBar.style.width + '"');

    ok('Peer Fit badge shows canonical label (Weak)',
       dom.sigPeerFitLabel.innerHTML.includes('Weak'),
       'got: ' + dom.sigPeerFitLabel.innerHTML);

    ok('Peer Fit badge does NOT contain numeric zero',
       !dom.sigPeerFitLabel.innerHTML.includes('>0<'),
       'got: ' + dom.sigPeerFitLabel.innerHTML);
  }

  /* ─── State 4: Three Season Position states ─── */
  console.log('\n  State 4 — Season Position three states (SCORE_MED = ' + SCORE_MED + ')');
  {
    /* above: score 75 > 60 */
    const domAbove = run(scoreProfile(75), SCORE_MED, '', '');
    ok('score 75 > median 60 → "▲ Above season median"',
       domAbove.sigSeasonPos.textContent === '▲ Above season median',
       'got "' + domAbove.sigSeasonPos.textContent + '"');
    ok('Above → teal',
       domAbove.sigSeasonPos.style.color === 'var(--teal)',
       'got "' + domAbove.sigSeasonPos.style.color + '"');
    ok('Above → visible (not display:none)',
       domAbove.sigSeasonPos.style.display !== 'none');

    /* equal: score 60 === 60 */
    const domAt = run(scoreProfile(60), SCORE_MED, '', '');
    ok('score 60 === median 60 → "◆ At season median"',
       domAt.sigSeasonPos.textContent === '◆ At season median',
       'got "' + domAt.sigSeasonPos.textContent + '"');
    ok('At → ink3 (neutral)',
       domAt.sigSeasonPos.style.color === 'var(--ink3)',
       'got "' + domAt.sigSeasonPos.style.color + '"');

    /* below: score 45 < 60 */
    const domBelow = run(scoreProfile(45), SCORE_MED, '', '');
    ok('score 45 < median 60 → "▼ Below season median"',
       domBelow.sigSeasonPos.textContent === '▼ Below season median',
       'got "' + domBelow.sigSeasonPos.textContent + '"');
    ok('Below → rose',
       domBelow.sigSeasonPos.style.color === 'var(--rose)',
       'got "' + domBelow.sigSeasonPos.style.color + '"');
  }

  /* ─── State 5: Null composite score ─── */
  console.log('\n  State 5 — null composite score');
  {
    const dom = run(profileNullScore, SCORE_MED, '', '');

    ok('Null score → sigCompositeScore shows "Exploratory"',
       dom.sigCompositeScore.textContent === 'Exploratory',
       'got "' + dom.sigCompositeScore.textContent + '"');

    ok('Null score → sigCompositeScore color = var(--ink3)',
       dom.sigCompositeScore.style.color === 'var(--ink3)',
       'got "' + dom.sigCompositeScore.style.color + '"');

    ok('Null score → sigSeasonPos display = none',
       dom.sigSeasonPos.style.display === 'none',
       'got "' + dom.sigSeasonPos.style.display + '"');

    ok('Null score → sigSeasonPos textContent is empty',
       dom.sigSeasonPos.textContent === '',
       'got "' + dom.sigSeasonPos.textContent + '"');

    ok('Null score → interpretation empty',
       dom.sigInterpretation.textContent === '',
       'got "' + dom.sigInterpretation.textContent + '"');
  }

  /* ─── State 6: Context-filter disclosure ─── */
  console.log('\n  State 6 — context-filter disclosure');
  const p = scoreProfile(65);
  {
    const dom = run(p, SCORE_MED, '', '');
    ok('Baseline (tier="", sub="") → badge hidden',
       dom.sigContextBadge.style.display === 'none',
       'got display="' + dom.sigContextBadge.style.display + '" text="' + dom.sigContextBadge.textContent + '"');
  }
  {
    const dom = run(p, SCORE_MED, 'Primary', '');
    ok('Tier=Primary → badge visible with "Primary tier only"',
       dom.sigContextBadge.style.display === 'inline-block' &&
       dom.sigContextBadge.textContent.includes('Primary tier only'),
       'display="' + dom.sigContextBadge.style.display + '" text="' + dom.sigContextBadge.textContent + '"');
  }
  {
    const dom = run(p, SCORE_MED, '', '1');
    ok('Sub=1 → badge shows "Subscribers only"',
       dom.sigContextBadge.textContent.includes('Subscribers only'),
       'got "' + dom.sigContextBadge.textContent + '"');
  }
  {
    const dom = run(p, SCORE_MED, '', '0');
    ok('Sub=0 → badge shows "Non-subscribers only"',
       dom.sigContextBadge.textContent.includes('Non-subscribers only'),
       'got "' + dom.sigContextBadge.textContent + '"');
  }
  {
    const dom = run(p, SCORE_MED, 'Primary', '1');
    ok('Tier=Primary + Sub=1 → combined disclosure',
       dom.sigContextBadge.textContent.includes('Primary tier only') &&
       dom.sigContextBadge.textContent.includes('Subscribers only'),
       'got "' + dom.sigContextBadge.textContent + '"');
  }
}

/* ── Main ────────────────────────────────────────────────────────────────── */

const progSrc = fs.readFileSync(
  path.join(ROOT, 'src', 'programming.html'), 'utf8'
);
const execSrc = fs.readFileSync(
  path.join(ROOT, 'src', 'exec_summary.html'), 'utf8'
);

runTests('programming.html', progSrc);
runTests('exec_summary.html', execSrc);

console.log('\n' + '═'.repeat(62));
console.log('Render harness complete');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('═'.repeat(62));

process.exit(failed > 0 ? 1 : 0);
