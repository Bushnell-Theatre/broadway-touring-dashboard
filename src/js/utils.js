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
// Pages declare their own DATA_URLS / DATA_JSON_URL before this file runs.
// initData() reads window.DATA_URLS if set; falls back to local data.json.
// Do NOT declare DATA_URLS here — it would collide with page-level const declarations.

const PEERS_URL = './peers.json';

// ── GLOBAL STATE ──────────────────────────────────────────────────────────────
// Pages read/write these after initData() resolves.

window.ALL = []; // raw records from data.json
window.FILTERED = []; // post-filter slice
window.PEER_META = {}; // keyed by "theatre|city"

// ── FORMATTERS ────────────────────────────────────────────────────────────────
// Canonical source: programming.html (most complete)

/** Currency: $1.23B / $456.78M / $789K / $123 */
window.fmt$ = (v) =>
  v == null
    ? '—'
    : v >= 1e9
      ? '$' + (v / 1e9).toFixed(2) + 'B'
      : v >= 1e6
        ? '$' + (v / 1e6).toFixed(2) + 'M'
        : v >= 1e3
          ? '$' + (v / 1e3).toFixed(0) + 'K'
          : '$' + Math.round(v).toLocaleString();

/** Percentage with NaN guard */
window.pct = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d) + '%');

/** General number with decimal places */
window.fmtN = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));

/** Average of an array */
window.avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

/** "Jun 8, 2025" from "2025-06-08"; returns "—" for null/empty */
window.fmtDate = (s) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/** "YYYY-MM-DD" → "YYYY-YYYY" fiscal year label (July start) */
window.fiscalYear = (dateStr) => {
  if (!dateStr) return null;
  const y = +dateStr.slice(0, 4),
    mo = +dateStr.slice(5, 7);
  return mo >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
};

/** Alias used by dashboard.html */
window.getFiscalYear = window.fiscalYear;

/** "2025-06-08" → "Jun 8, 2025" week label */
window.fmtWeek = (s) => {
  if (!s) return '';
  const parts = s.split('-');
  const y = parts[0],
    m = parseInt(parts[1]),
    d = parseInt(parts[2]);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}, ${y}`;
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
  return rows.filter((d) => {
    if (tier && d.tier !== tier) return false;
    if (sub === 'sub' && !d.on_sub) return false;
    if (sub === 'nonsub' && d.on_sub) return false;
    if (peer && !window.isPeerType(d, peer)) return false;
    if (equity === 'equity' && d.non_equity) return false;
    if (equity === 'nonequity' && !d.non_equity) return false;
    if (engage === 'performed' && d.no_engagement) return false;
    if (engage === 'no' && !d.no_engagement) return false;
    if (season && window.fiscalYear(d.week_of) !== season) return false;
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
  // Use page-declared DATA_URLS if available, otherwise fall back to local
  const urls = window.DATA_URLS || ['./data.json'];
  // Try each data URL in order until one succeeds
  let rawData = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) {
        rawData = await r.json();
        break;
      }
    } catch (e) {
      /* try next */
    }
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
      venues.forEach((v) => {
        window.PEER_META[v.theatre + '|' + v.city] = v;
      });
    }
  } catch (e) {
    console.warn('peers.json not loaded:', e.message);
  }

  if (onReady) onReady();
};

/* ── PLANNING SIGNAL MODEL ──────────────────────────────────────────────────
 *
 * Shared percentile-based Planning Signal functions used by
 * programming.html and exec_summary.html.
 *
 * The Planning Signal replaces the previous fitScore() formula which used
 * an arbitrary baseline (50/65) with dampened multipliers that disconnected
 * the displayed component metrics from the composite score.
 *
 * New model: each component is a percentile rank within a comparison pool.
 * A Planning Signal of 79 means this show outperforms 79% of the pool.
 * Explainable in one sentence to any stakeholder.
 *
 * Two comparison pools are always calculated side by side:
 *   - National (3-year rolling): all BTD records from last 3 seasons
 *   - Peer group: records from the active peer type only
 *
 * Weights are defined here as named constants. Adjust SIGNAL_WEIGHTS to
 * recalibrate the model without touching either dashboard file.
 * Weights will be reviewed once 2026-27 season data matures.
 *
 * ────────────────────────────────────────────────────────────────────────── */

/*
 * SIGNAL_WEIGHTS — contribution of each component to the composite score.
 * Must sum to 1.0.
 */
var SIGNAL_WEIGHTS = {
  demand:     0.40,   // avg paid capacity % — do audiences attend?
  revenue:    0.25,   // avg GG% of gross potential — does attendance convert to dollars?
  peerFit:    0.25,   // avg paid capacity % at peer venues — does it work at Bushnell-sized halls?
  confidence: 0.10    // evidence depth — how much data exists to support the signal?
};

/*
 * percentileRank — returns the percentage of values in the pool
 * that are strictly less than the target value (0–100 integer).
 *
 * A result of 79 means the target outperforms 79% of the pool.
 * Returns null if the pool is empty or the value is null/undefined.
 */
function percentileRank(pool, value) {
  if (!pool || pool.length === 0 || value == null) return null;
  var below = pool.filter(function (v) { return v < value; }).length;
  return Math.round((below / pool.length) * 100);
}

/*
 * confidenceScore — returns a 0–100 confidence score based on
 * the depth and recency of available show records.
 *
 * Scoring:
 *   Record count   0–60 points (5 pts per record, capped at 60)
 *   Recency        0–25 points (3 pts per recent record, capped at 25)
 *   Completeness   0–15 points (% of records with both gross and cap data)
 *
 * A show with 12 complete recent records scores roughly 60–70.
 * A show with 3 old incomplete records scores roughly 15–25.
 */
function confidenceScore(rows) {
  if (!rows || rows.length === 0) return 0;

  // Record count score (0–60 points)
  var countScore = Math.min(60, rows.length * 5);

  // Recency score (0–25 points): records from last 3 seasons
  var cutoff = threeYearCutoff();
  var recentRows = rows.filter(function (d) { return d.week_of >= cutoff; });
  var recencyScore = Math.min(25, recentRows.length * 3);

  // Completeness score (0–15 points): % records with both gross and cap data
  var complete = rows.filter(function (d) {
    return d.gross_gross != null && d.cap_paid != null;
  }).length;
  var completenessScore = Math.round((complete / rows.length) * 15);

  return Math.min(100, countScore + recencyScore + completenessScore);
}

/*
 * threeYearCutoff — returns an ISO date string for 3 years ago from today.
 * Used to define the rolling 3-season national comparison pool.
 */
function threeYearCutoff() {
  var d = new Date();
  d.setFullYear(d.getFullYear() - 3);
  return d.toISOString().slice(0, 10);
}

/*
 * planningSignal — computes the full Planning Signal for a show
 * against two comparison pools: national (3-year rolling) and peer group.
 *
 * Parameters:
 *   showRows   — filtered records for the selected show (post applyFilters)
 *   allRows    — all BTD records (the full dataset)
 *   peerType   — peer group type string (e.g. 'size', 'proximity', 'market')
 *                defaults to 'size' if not provided
 *
 * Returns an object with:
 *   national        — { demand, revenue, peerFit, confidence, composite }
 *   peer            — { demand, revenue, peerFit, confidence, composite }
 *   rawMetrics      — { cap, gg, peerCap, count, recentCount }
 *   activePeerType  — the peer type string used
 *   poolSizes       — { national, peer } record counts
 *
 * Returns null if showRows has no valid records.
 */
function planningSignal(showRows, allRows, peerType) {

  // --- Build comparison pools ---

  var cutoff = threeYearCutoff();

  // National pool: all records from last 3 seasons, excluding no_engagement
  var nationalPool = (allRows || []).filter(function (d) {
    return !d.no_engagement && d.gross_gross != null && d.week_of >= cutoff;
  });

  // Peer pool: national pool filtered to active peer group
  var pType = peerType || 'size';
  var peerPool = nationalPool.filter(function (d) {
    return typeof isPeerType === 'function' ? isPeerType(d, pType) : false;
  });

  // Show records: this show's rows only, excluding no_engagement
  var showActive = (showRows || []).filter(function (d) {
    return !d.no_engagement && d.gross_gross != null;
  });

  if (showActive.length === 0) return null;

  // --- Show metrics ---
  var capVals  = showActive.map(function (d) { return d.cap_paid; }).filter(function (v) { return v != null; });
  var ggVals   = showActive.map(function (d) { return d.gg_pct_gp; }).filter(function (v) { return v != null; });
  var peerRows = showActive.filter(function (d) {
    return typeof isPeerType === 'function' ? isPeerType(d, pType) : false;
  });
  var peerCapVals = peerRows.map(function (d) { return d.cap_paid; }).filter(function (v) { return v != null; });

  var showCap     = capVals.length     > 0 ? capVals.reduce(function (a, b) { return a + b; }, 0)     / capVals.length     : null;
  var showGg      = ggVals.length      > 0 ? ggVals.reduce(function (a, b) { return a + b; }, 0)      / ggVals.length      : null;
  var showPeerCap = peerCapVals.length > 0 ? peerCapVals.reduce(function (a, b) { return a + b; }, 0) / peerCapVals.length : null;

  // --- Percentile calculations ---

  // National pool percentiles
  var natDemand  = percentileRank(nationalPool.map(function (d) { return d.cap_paid;  }), showCap);
  var natRevenue = percentileRank(nationalPool.map(function (d) { return d.gg_pct_gp; }), showGg);
  var natPeerFit = percentileRank(peerPool.map(function (d) { return d.cap_paid; }), showPeerCap);
  var natConf    = confidenceScore(showActive);

  // Peer pool percentiles (show metrics ranked within peer pool only)
  var peerDemand  = percentileRank(peerPool.map(function (d) { return d.cap_paid;  }), showCap);
  var peerRevenue = percentileRank(peerPool.map(function (d) { return d.gg_pct_gp; }), showGg);
  var peerFitPct  = natPeerFit;  // peer fit is always vs peer pool regardless of comparison context
  var peerConf    = natConf;     // confidence doesn't change by pool

  // --- Composite score helper ---
  // Redistributes weights proportionally when components are null
  function composite(demand, revenue, peerFit, confidence) {
    var components = [
      { val: demand,     weight: SIGNAL_WEIGHTS.demand },
      { val: revenue,    weight: SIGNAL_WEIGHTS.revenue },
      { val: peerFit,    weight: SIGNAL_WEIGHTS.peerFit },
      { val: confidence, weight: SIGNAL_WEIGHTS.confidence }
    ];
    var validTotal = 0;
    var weightedSum = 0;
    components.forEach(function (c) {
      if (c.val != null) {
        validTotal  += c.weight;
        weightedSum += c.val * c.weight;
      }
    });
    if (validTotal === 0) return null;
    return Math.round(weightedSum / validTotal);
  }

  return {
    national: {
      demand:     natDemand,
      revenue:    natRevenue,
      peerFit:    natPeerFit,
      confidence: natConf,
      composite:  composite(natDemand, natRevenue, natPeerFit, natConf)
    },
    peer: {
      demand:     peerDemand,
      revenue:    peerRevenue,
      peerFit:    peerFitPct,
      confidence: peerConf,
      composite:  composite(peerDemand, peerRevenue, peerFitPct, peerConf)
    },
    rawMetrics: {
      cap:         showCap,
      gg:          showGg,
      peerCap:     showPeerCap,
      count:       showActive.length,
      recentCount: showActive.filter(function (d) { return d.week_of >= cutoff; }).length
    },
    activePeerType: pType,
    poolSizes: {
      national: nationalPool.length,
      peer:     peerPool.length
    }
  };
}

/* ── END PLANNING SIGNAL MODEL ──────────────────────────────────────────── */
