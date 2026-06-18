/**
 * utils.js — shared utilities for Broadway Touring Dashboard
 *
 * Canonical versions of all functions duplicated across
 * dashboard.html, exec_summary.html, and programming.html.
 *
 * Pages should include this file BEFORE their own <script> block
 * and remove the local copies of anything defined here.
 *
 * STATUS: DRAFT — under consolidation, not yet wired to any page
 */

// ── DATA URLs ─────────────────────────────────────────────────────────────────

const DATA_URLS = [
  './data.json',
  'https://broadway-touring-dashboard.azurestaticapps.net/data.json'
];

const PEERS_URL = './peers.json';

// ── GLOBAL STATE ──────────────────────────────────────────────────────────────
// Pages read/write these after initData() resolves.

window.ALL        = [];   // raw records from data.json
window.FILTERED   = [];   // post-filter slice
window.PEER_META  = {};   // keyed by "theatre|city"

// ── FORMATTERS ────────────────────────────────────────────────────────────────
// Canonical source: programming.html (most complete)

/** Currency: $1.23B / $456.78M / $789K / $123 */
window.fmt$ = v =>
  v == null ? '—'
  : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B'
  : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M'
  : v >= 1e3 ? '$' + (v / 1e3).toFixed(0) + 'K'
  : '$' + Math.round(v).toLocaleString();

/** Percentage with NaN guard */
window.pct = (v, d = 1) =>
  v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d) + '%';

/** General number with decimal places */
window.fmtN = (v, d = 1) =>
  v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d);

/** Average of an array */
window.avg = arr =>
  arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

/** "Jun 8, 2025" from "2025-06-08"; returns "—" for null/empty */
window.fmtDate = s => {
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/** "YYYY-MM-DD" → "YYYY-YYYY" fiscal year label (July start) */
window.fiscalYear = dateStr => {
  if (!dateStr) return null;
  const y = +dateStr.slice(0, 4), mo = +dateStr.slice(5, 7);
  return mo >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
};

/** Alias used by dashboard.html */
window.getFiscalYear = window.fiscalYear;

/** "2025-06-08" → "Jun 8, 2025" week label */
window.fmtWeek = s => {
  if (!s) return '';
  const parts = s.split('-');
  const y = parts[0], m = parseInt(parts[1]), d = parseInt(parts[2]);
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} ${d}, ${y}`;
};

// ── PEER HELPERS ──────────────────────────────────────────────────────────────

/**
 * Returns true if record d belongs to peer group `type`.
 * type: 'size' | 'size_extended' | 'proximity' | 'market' | 'any' | null/''
 */
window.isPeerType = function isPeerType(d, type) {
  if (!type) return true;
  const meta = window.PEER_META[d.theatre + '|' + d.city];
  if (!meta || !meta.peer_types) return false;
  if (type === 'any') return meta.peer_types.length > 0;
  return meta.peer_types.includes(type);
};

// ── FILTER LOGIC ──────────────────────────────────────────────────────────────

/**
 * Filter ALL records by the standard set of sidebar controls.
 * Pass an options object matching whichever filters the page uses.
 *
 * @param {object} opts
 * @param {string}  opts.tier       — 'Primary' | 'Secondary' | '' (all)
 * @param {string}  opts.sub        — 'sub' | 'nonsub' | '' (all)
 * @param {string}  opts.peer       — 'size' | 'size_extended' | 'proximity' | 'market' | 'any' | '' (all)
 * @param {string}  opts.equity     — 'equity' | 'nonequity' | '' (all)
 * @param {string}  opts.engage     — 'performed' | 'no' | '' (all)
 * @param {string}  opts.season     — fiscal year string e.g. '2024-2025' | '' (all)
 * @returns {Array} filtered records
 */
window.applyFilters = function applyFilters(rows, opts = {}) {
  const { tier = '', sub = '', peer = '', equity = '', engage = '', season = '' } = opts;
  return rows.filter(d => {
    if (tier   && d.tier !== tier)                                    return false;
    if (sub === 'sub'    && !d.on_sub)                                return false;
    if (sub === 'nonsub' && d.on_sub)                                 return false;
    if (peer   && !window.isPeerType(d, peer))                        return false;
    if (equity === 'equity'    && d.non_equity)                       return false;
    if (equity === 'nonequity' && !d.non_equity)                      return false;
    if (engage === 'performed' && d.no_engagement)                    return false;
    if (engage === 'no'        && !d.no_engagement)                   return false;
    if (season && window.fiscalYear(d.week_of) !== season)            return false;
    return true;
  });
};

// ── DATA LOADING ──────────────────────────────────────────────────────────────
// Sequential fallback strategy from programming.html (most resilient).

/**
 * Load data.json and peers.json, populate ALL and PEER_META.
 * Calls onReady() when complete.
 *
 * @param {Function} onReady — called with no args when data is loaded
 * @param {Function} [onError] — called with error message on failure
 */
window.initData = async function initData(onReady, onError) {
  // Try each data URL in order until one succeeds
  let rawData = null;
  for (const url of DATA_URLS) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) { rawData = await r.json(); break; }
    } catch (e) { /* try next */ }
  }

  if (!rawData) {
    const msg = 'Could not load data.json from any source.';
    if (onError) onError(msg);
    else console.error(msg);
    return;
  }

  window.ALL = rawData.records || rawData;

  // Load peers (optional — pages degrade gracefully without it)
  try {
    const r = await fetch(PEERS_URL);
    if (r.ok) {
      const peersData = await r.json();
      const venues = peersData.venues || peersData;
      window.PEER_META = {};
      venues.forEach(v => {
        window.PEER_META[v.theatre + '|' + v.city] = v;
      });
    }
  } catch (e) {
    console.warn('peers.json not loaded:', e.message);
  }

  if (onReady) onReady();
};
