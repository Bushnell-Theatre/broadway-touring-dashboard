#!/usr/bin/env node
'use strict';
/**
 * test_cycles.js
 *
 * Behavioural guard for src/js/core/cycles.js — the tour-cycle grouping that
 * the Tour History panel on programming.html and exec_summary.html is built
 * from. The module had no coverage, and two bugs lived in it.
 *
 * Fixtures are synthetic on purpose. data.json is rewritten every week by the
 * watcher, so a suite that asserts against live rows fails on a Monday for
 * reasons that have nothing to do with the code.
 *
 * Run with: node scripts/test_cycles.js   (or npm run test:cycles)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ── Load the browser IIFE into a stub global ────────────────────────────── */
function loadCycles() {
  const src = fs.readFileSync(path.join(ROOT, 'src/js/core/cycles.js'), 'utf8');
  const ctx = { window: { BTD: {} }, console };
  vm.runInNewContext(src, ctx);
  return ctx.window.BTD.cycles;
}

/* ── Assertions ──────────────────────────────────────────────────────────── */
let passed = 0;
let failed = 0;

function ok(label, cond, detail) {
  if (cond) {
    console.log('    ✅ ' + label);
    passed++;
  } else {
    console.log('    ❌ ' + label);
    if (detail !== undefined) console.log('        ' + detail);
    failed++;
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(label, a === e, 'expected ' + e + ', got ' + a);
}

function section(name) {
  console.log('\n  ' + name);
}

/* ── Fixture builder ─────────────────────────────────────────────────────── */
/** A run of weekly rows for one feed title, starting at `start`, `n` weeks. */
function run(show, start, n, cap, gross) {
  const rows = [];
  const d = new Date(start + 'T00:00:00Z');
  for (let i = 0; i < n; i++) {
    rows.push({
      show,
      week_of: d.toISOString().slice(0, 10),
      no_engagement: false,
      num_perf: 8,
      cap_paid: cap,
      gross_gross: gross,
    });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return rows;
}

const cycles = loadCycles();
const titles = (tc) => (tc ? tc.cycles.map((c) => c.title) : null);

/* ── 1. The rename bug ───────────────────────────────────────────────────── */
section('1. A feed rename does not split one company in two');
{
  cycles.setAliases({ 'SIX: The Musical': 'Six' });
  const rows = [
    ...run('Six (Boleyn)', '2022-10-09', 10, 80, 500000),
    ...run('SIX: The Musical (Boleyn)', '2022-12-18', 6, 74, 460000),
  ];
  const tc = cycles.cyclesFor('Six', rows);

  eq('the renamed company is ONE cycle, not two', tc.cycles.length, 1);
  eq('all weeks are carried into it', tc.cycles[0].weeks, 16);
  eq('it is displayed under the name the feed uses now', tc.cycles[0].title, 'SIX: The Musical (Boleyn)');
  eq('it spans the whole run', [tc.cycles[0].first, tc.cycles[0].last], ['2022-10-09', '2023-01-22']);
  ok(
    'no cycle-over-cycle delta, because there is nothing prior to compare to',
    tc.cycles[0].capDelta === null,
    'capDelta was ' + tc.cycles[0].capDelta,
  );
}

/* ── 2. Concurrent companies must stay apart ─────────────────────────────── */
section('2. Concurrent companies are still separate cycles');
{
  cycles.setAliases({ 'SIX: The Musical': 'Six' });
  const rows = [
    ...run('Six (Aragon)', '2022-10-09', 8, 70, 400000),
    ...run('Six (Boleyn)', '2022-10-09', 10, 80, 500000),
    ...run('SIX: The Musical (Boleyn)', '2022-12-18', 6, 74, 460000),
  ];
  const tc = cycles.cyclesFor('Six', rows);

  eq('Aragon and the renamed Boleyn are two cycles', tc.cycles.length, 2);
  eq('both companies are present', titles(tc).sort(), ['SIX: The Musical (Boleyn)', 'Six (Aragon)']);
  eq('Boleyn keeps all 16 of its weeks', tc.cycles.find((c) => /Boleyn/.test(c.title)).weeks, 16);
}

/* ── 3. The collapse this fix nearly introduced ──────────────────────────── */
section('3. Company markers survive normalization');
{
  cycles.setAliases({});
  const rows = [
    ...run('Hamilton (And Peggy)', '2019-07-21', 5, 85, 900000),
    ...run('Hamilton (Angelica)', '2019-07-21', 7, 88, 950000),
    ...run('Hamilton (Eliza)', '2019-07-21', 4, 82, 870000),
    ...run('Hamilton (Philip)', '2019-07-21', 6, 86, 910000),
  ];
  const tc = cycles.cyclesFor('Hamilton', rows);

  /* norm() deletes a parenthetical whole, so a key built from norm('(Angelica)')
   * is the empty string and all four companies merge into one. */
  eq('four simultaneous companies stay four cycles', tc.cycles.length, 4);
  ok('the family reads as concurrent', tc.concurrent === true, 'concurrent was ' + tc.concurrent);
  ok(
    'no delta is chained between companies running at once',
    tc.cycles.every((c) => c.capDelta === null),
    'deltas: ' + tc.cycles.map((c) => c.capDelta).join(', '),
  );
}

/* ── 4. Year and hyphenated run markers ──────────────────────────────────── */
section('4. Successive runs stay apart');
{
  cycles.setAliases({
    "Dr. Seuss' How the Grinch Stole Christmas 2024-Old Max": 'Dr. Seuss How the Grinch Stole Christmas',
    "Dr. Seuss' How the Grinch Stole Christmas 2024-Young Max": 'Dr. Seuss How the Grinch Stole Christmas',
  });
  const rows = [
    ...run('Dr. Seuss How the Grinch Stole Christmas 2019', '2019-11-24', 3, 70, 300000),
    ...run('Dr. Seuss How the Grinch Stole Christmas 2021', '2021-11-21', 3, 90, 380000),
    ...run("Dr. Seuss' How the Grinch Stole Christmas 2024-Old Max", '2024-11-10', 7, 78, 350000),
    ...run("Dr. Seuss' How the Grinch Stole Christmas 2024-Young Max", '2024-11-10', 5, 75, 340000),
  ];
  const tc = cycles.cyclesFor('Dr. Seuss How the Grinch Stole Christmas', rows);

  eq('year-marked and hyphen-marked runs are four cycles', tc.cycles.length, 4);
  ok(
    'the two 2024 companies are not merged',
    titles(tc).some((t) => /Old Max/.test(t)) && titles(tc).some((t) => /Young Max/.test(t)),
    titles(tc).join(' | '),
  );
  ok(
    'a whole-title alias does not collapse the family into one run',
    tc.cycles.length > 1,
    'alias folding swallowed the run markers',
  );
  eq('successive runs earn a delta', tc.cycles[1].capDelta, 20);
}

/* ── 5. Parenthetical plus trailing marker ───────────────────────────────── */
section('5. A run carrying both marker kinds');
{
  cycles.setAliases({});
  const rows = [
    ...run('The Lion King (Toronto) 2024', '2024-01-07', 4, 88, 800000),
    ...run('The Lion King (Toronto) 2026', '2026-01-04', 4, 84, 780000),
  ];
  const tc = cycles.cyclesFor('The Lion King', rows);
  eq('same company, different years, stays two cycles', tc.cycles.length, 2);
}

/* ── 6. Pre-Broadway tryouts ─────────────────────────────────────────────── */
section('6. A tryout is flagged and skipped when chaining deltas');
{
  cycles.setAliases({});
  const rows = [
    ...run('Some New Musical 2023', '2023-02-07', 4, 80, 500000),
    ...run('Some New Musical Pre', '2024-02-06', 3, 50, 200000),
    ...run('Some New Musical 2025', '2025-02-04', 4, 78, 490000),
  ];
  const tc = cycles.cyclesFor('Some New Musical', rows);

  const pre = tc.cycles.find((c) => c.isPre);
  ok('the tryout is marked isPre', !!pre, titles(tc).join(' | '));
  const last = tc.cycles[tc.cycles.length - 1];
  eq('the tour after it is compared to the previous TOUR', last.comparedTo, 'Some New Musical 2023');
  eq('not to the tryout', last.capDelta, -2);
}

/* ── 7. Overall totals ───────────────────────────────────────────────────── */
section('7. Family totals cover every cycle');
{
  cycles.setAliases({ 'SIX: The Musical': 'Six' });
  const rows = [
    ...run('Six (Aragon)', '2022-10-09', 8, 70, 400000),
    ...run('Six (Boleyn)', '2022-10-09', 10, 80, 500000),
    ...run('SIX: The Musical (Boleyn)', '2022-12-18', 6, 74, 460000),
  ];
  const tc = cycles.cyclesFor('Six', rows);
  eq('overall weeks is every active row in the family', tc.overall.weeks, 24);
  eq('family key is the aliased stem', tc.family, 'six');
}

/* ── 8. Degenerate input ─────────────────────────────────────────────────── */
section('8. Nothing to group');
{
  cycles.setAliases({});
  ok('an unknown title returns null', cycles.cyclesFor('Not A Show', []) === null);
  ok('an empty title returns null', cycles.cyclesFor('', [{ show: 'x', week_of: '2024-01-01' }]) === null);
  const dark = [{ show: 'Dark Only', week_of: '2024-01-01', no_engagement: true }];
  ok('a family with no active weeks returns null', cycles.cyclesFor('Dark Only', dark) === null);
}

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log('\n' + '─'.repeat(60));
console.log(`  test_cycles.js   ${passed} / ${passed + failed} passed`);
if (failed) {
  console.log(`  ${failed} FAILED`);
  process.exit(1);
}
console.log('  All assertions passed.');
