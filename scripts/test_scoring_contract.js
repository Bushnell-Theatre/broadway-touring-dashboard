#!/usr/bin/env node
/* ── test_scoring_contract.js ────────────────────────────────────────────────
 *
 * Master test runner for the Planning Signal scoring contract.
 * Executes both validators as child processes, forwards their output,
 * and exits 1 if either subprocess fails.
 *
 * Usage:
 *   node scripts/test_scoring_contract.js
 *   npm test
 *
 * Suites:
 *   validate_scoring_contract.js  — static source checks
 *   verify_render_harness.js      — DOM-stub behavioral checks
 *
 * ─────────────────────────────────────────────────────────────────────────── */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = __dirname;

/* ── Suite definitions ─────────────────────────────────────────────────────── */
const SUITES = [
  {
    label: 'validate_scoring_contract.js',
    script: path.join(SCRIPTS_DIR, 'validate_scoring_contract.js'),
  },
  {
    label: 'verify_render_harness.js',
    script: path.join(SCRIPTS_DIR, 'verify_render_harness.js'),
  },
  {
    label: 'test-filters.js',
    script: path.join(SCRIPTS_DIR, 'test-filters.js'),
  },
];

/* ── Runner ─────────────────────────────────────────────────────────────────── */

console.log('');
console.log('══════════════════════════════════════════════════════════════════');
console.log('  BTD Scoring Contract — Test Suite');
console.log('══════════════════════════════════════════════════════════════════');
console.log('');

let anyFailed = false;

for (const suite of SUITES) {
  console.log('──────────────────────────────────────────────────────────────────');
  console.log('  Suite: ' + suite.label);
  console.log('──────────────────────────────────────────────────────────────────');

  const result = spawnSync(process.execPath, [suite.script], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  /* Forward stdout/stderr from the subprocess */
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    console.error('  ✗ Failed to launch: ' + result.error.message);
    anyFailed = true;
  } else if (result.status !== 0) {
    console.error('  ✗ Suite exited with status ' + result.status);
    anyFailed = true;
  } else {
    console.log('  ✓ Suite passed');
  }

  console.log('');
}

/* ── Summary ─────────────────────────────────────────────────────────────────── */

console.log('══════════════════════════════════════════════════════════════════');
if (anyFailed) {
  console.error('  RESULT: FAIL — one or more suites did not pass.');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('');
  process.exit(1);
} else {
  console.log('  RESULT: PASS — all suites passed.');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('');
  process.exit(0);
}
