import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';

/*
 * ESLint — static correctness guardrail for the Broadway Touring Dashboard.
 *
 * Two things about this project shape every choice below:
 *
 * 1. Most live page JS is still INLINE in the HTML <script> blocks, not in
 *    src/js/. eslint-plugin-html extracts those blocks so they get linted too.
 *    Without it ESLint covers less than half the JavaScript that actually ships.
 *
 * 2. Cross-file sharing happens through `window.X = ...` assignments and the
 *    `BTD.*` namespace, not through imports. ESLint cannot follow either, so
 *    the shared globals are declared by hand in PROJECT_GLOBALS. When you add a
 *    new `window.something = ...` in utils.js or a core module, add it here too
 *    or every call site will report a false no-undef.
 *
 * Run with: npm run lint
 */

/** Globals assigned via `window.X = ...` and shared across files. */
const PROJECT_GLOBALS = {
  BTD: 'writable',
  PEER_META: 'writable',
  pct: 'readonly',
  avg: 'readonly',
  fmt$: 'readonly',
  fmtN: 'readonly',
  fmtWeek: 'readonly',
  fmtDate: 'readonly',
  isPeerType: 'readonly',
  fiscalYear: 'readonly',
  getFiscalYear: 'readonly',
};

/** Third-party libraries loaded from CDN <script> tags. */
const VENDOR_GLOBALS = {
  Chart: 'readonly',
  XLSX: 'readonly',
  JSZip: 'readonly',
  jspdf: 'readonly',
  html2canvas: 'readonly',
};

/*
 * no-unused-vars is scoped to `vars: 'local'` on purpose.
 *
 * Top-level functions in these files are globals called from inline HTML
 * attributes (onclick="resetFilters()"), which ESLint cannot see. Checking the
 * global scope produced ~96 warnings, essentially all false, which is the fast
 * road to a lint run nobody reads. Local scope still catches the real thing:
 * an unused variable inside a function.
 */
const SHARED_RULES = {
  'no-unused-vars': ['warn', { vars: 'local', args: 'none' }],

  /*
   * skipTemplates because the narrow no-break spaces (U+202F) around em dashes
   * in the exec summary's display strings are deliberate typography, not stray
   * whitespace. The rule still fires on irregular whitespace in actual code.
   */
  'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],
};

export default [
  {
    ignores: ['node_modules/**', 'archive/**', 'src/data/**', 'data/**', 'docs/**', 'scripts/cache/**'],
  },

  js.configs.recommended,

  // Browser JS — src/js/**
  {
    files: ['src/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: { ...globals.browser, ...PROJECT_GLOBALS, ...VENDOR_GLOBALS },
    },
    rules: SHARED_RULES,
  },

  // Inline <script> blocks inside the HTML pages — where most live code still is.
  {
    files: ['src/**/*.html'],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: { ...globals.browser, ...PROJECT_GLOBALS, ...VENDOR_GLOBALS },
    },
    rules: {
      ...SHARED_RULES,
      /*
       * no-undef is off for the HTML pages, and only for them. It cannot be
       * made accurate against this page architecture, in two separate ways:
       *
       *   - `window.loadData = function () {...}` followed by a bare
       *     `loadData()` call. ESLint does not connect the two, so every such
       *     call reports undefined. box_office.html alone has ten.
       *   - A function declared in one <script> block and called from another.
       *     The plugin is documented to share scope across blocks for
       *     non-module scripts, but it is not resolving them here.
       *
       * Both are artifacts of page JS living inline and talking through the
       * window object. Extracting these blocks into real modules is what makes
       * no-undef meaningful on this code; until then it is 13 false positives
       * and nothing else. It stays ON for src/js/**.
       */
      'no-undef': 'off',
    },
  },

  // Node test harnesses and pipeline helpers — scripts/**
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: SHARED_RULES,
  },
];
