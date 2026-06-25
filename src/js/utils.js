/**
 * utils.js — compatibility bridge for shared Broadway Touring Dashboard helpers.
 *
 * New shared logic lives under window.BTD.* in src/js/core/*.js.
 * This file preserves the legacy global helper names used by the existing pages
 * so the refactor can be staged without breaking inline page scripts.
 */
(function (root) {
  'use strict';
  root.BTD = root.BTD || {};

  // Minimal fallback definitions when this file is loaded without core/*.js.
  root.BTD.config = root.BTD.config || {
    defaultSeason: '2025-2026',
    dataUrls: ['data/data.json', 'https://white-pebble-01710020f.7.azurestaticapps.net/data/data.json'],
    peersUrl: 'data/peers.json',
    seasonsUrl: 'data/seasons.json',
    contextUrls: ['data/context.json', 'https://white-pebble-01710020f.7.azurestaticapps.net/data/context.json']
  };
  root.BTD.state = root.BTD.state || { all: [], filtered: [], peerMeta: {}, context: {}, seasons: [], charts: {}, active: { season: root.BTD.config.defaultSeason } };

  function fallbackCurrency(v) {
    if (v == null || Number.isNaN(Number(v))) return '—';
    v = Number(v);
    return Math.abs(v) >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B'
      : Math.abs(v) >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M'
      : Math.abs(v) >= 1e3 ? '$' + (v / 1e3).toFixed(0) + 'K'
      : '$' + Math.round(v).toLocaleString();
  }
  function fallbackPercent(v, d) { d = d == null ? 1 : d; return v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d) + '%'; }
  function fallbackNumber(v, d) { d = d == null ? 1 : d; return v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d); }
  function fallbackAvg(arr) { arr = (arr || []).map(Number).filter(function (v) { return !Number.isNaN(v); }); return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; }
  function fallbackFiscalYear(dateStr) { if (!dateStr) return null; var y = +String(dateStr).slice(0, 4), mo = +String(dateStr).slice(5, 7); return mo >= 7 ? y + '-' + (y + 1) : (y - 1) + '-' + y; }
  function fallbackWeek(s) { if (!s) return ''; var p = String(s).split('-'); var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return m[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0]; }
  function fallbackDate(s) { if (!s) return '—'; var p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

  var fmt = root.BTD.format || {};
  var metrics = root.BTD.metrics || {};

  root.fmt$ = root.fmt$ || fmt.currency || fallbackCurrency;
  root.pct = root.pct || fmt.percent || fallbackPercent;
  root.fmtN = root.fmtN || fmt.number || fallbackNumber;
  root.avg = root.avg || metrics.avg || fallbackAvg;
  root.fmtDate = root.fmtDate || fmt.date || fallbackDate;
  root.fmtWeek = root.fmtWeek || fmt.week || fallbackWeek;
  root.fiscalYear = root.fiscalYear || fmt.fiscalYear || fallbackFiscalYear;
  root.getFiscalYear = root.getFiscalYear || root.fiscalYear;

  root.ALL = root.ALL || root.BTD.state.all;
  root.FILTERED = root.FILTERED || root.BTD.state.filtered;
  root.PEER_META = root.PEER_META || root.BTD.state.peerMeta;

  root.isPeerType = root.isPeerType || function isPeerType(d, type) {
    if (root.BTD.peers && root.BTD.peers.isPeerType) return root.BTD.peers.isPeerType(d, type);
    if (!type) return true;
    var meta = (root.PEER_META || {})[(d.theatre || '') + '|' + (d.city || '')];
    if (!meta || !meta.peer_types) return false;
    if (type === 'any') return meta.peer_types.length > 0;
    return meta.peer_types.indexOf(type) >= 0;
  };

  root.applyStandardFilters = function applyStandardFilters(rows, opts) {
    if (root.BTD.filters && root.BTD.filters.apply) return root.BTD.filters.apply(rows, opts);
    opts = opts || {};
    return (rows || []).filter(function (d) {
      if (opts.tier && d.tier !== opts.tier) return false;
      if (opts.sub === 'sub' && !d.on_sub) return false;
      if (opts.sub === 'nonsub' && d.on_sub) return false;
      if (opts.peer && !root.isPeerType(d, opts.peer)) return false;
      if (opts.equity === 'equity' && d.non_equity) return false;
      if (opts.equity === 'nonequity' && !d.non_equity) return false;
      if (opts.engage === 'performed' && d.no_engagement) return false;
      if (opts.engage === 'no' && !d.no_engagement) return false;
      if (opts.season && root.fiscalYear(d.week_of) !== opts.season) return false;
      return true;
    });
  };

  // Do not overwrite page-specific applyFilters() implementations. Existing
  // pages use applyFilters() as a UI render trigger, not only as a pure filter.
  if (!root.applyFilters) root.applyFilters = root.applyStandardFilters;

  root.initSharedData = async function initSharedData(onReady, onError, options) {
    try {
      if (root.BTD.data && root.BTD.data.loadCore) await root.BTD.data.loadCore(options || {});
      else throw new Error('BTD.data.loadCore is unavailable.');
      root.ALL = root.BTD.state.all;
      root.FILTERED = root.BTD.state.filtered;
      root.PEER_META = root.BTD.state.peerMeta;
      if (typeof onReady === 'function') onReady();
    } catch (e) {
      if (typeof onError === 'function') onError(e.message || String(e));
      else console.error(e);
    }
  };

  // Legacy name retained for pages that explicitly opt in later.
  root.initDataShared = root.initSharedData;
})(window);
