(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  function fiscalYear(d) { return root.BTD.format && root.BTD.format.fiscalYear ? root.BTD.format.fiscalYear(d) : null; }
  /* Validate that a string is a well-formed ISO date (YYYY-MM-DD).
     Accepts only the 10-character form used by week_of throughout the dataset.
     Uses a round-trip check to reject impossible calendar dates such as
     2025-02-31 (JS Date normalizes those to a neighbouring month). */
  function isValidISODate(s) {
    if (typeof s !== 'string' || s.length !== 10) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var parts = s.split('-');
    var y = +parts[0], m = +parts[1], d = +parts[2];
    /* Basic range guard before constructing a Date object */
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(s + 'T12:00:00');
    if (Number.isNaN(dt.getTime())) return false;
    /* Round-trip: if JS normalised the date (e.g. Feb 31 → Mar 3), reject it */
    return dt.getFullYear() === y && (dt.getMonth() + 1) === m && dt.getDate() === d;
  }

  /* Fail-closed boundary handling for apply() options:
     When a caller supplies dateFrom or dateTo that is NOT a valid ISO date
     (malformed, impossible, or null), treat the boundary as absent.
     This prevents a bad option from silently suppressing the season filter
     while passing an effectively unbounded population through.
     The variable `hasDateRange` controls whether date-range mode is entered
     at all; if both boundaries fail validation, it is false and season
     filtering resumes normally. */

  function apply(rows, opts) {
    opts = opts || {};
    var peers = root.BTD.peers || {};

    /* Date-range mode — dateFrom or dateTo being present makes date range the
       active time selector. In this mode:
         1. opts.season is NOT applied (date range takes priority; they are
            mutually exclusive, not intersected).
         2. Any record without a valid ISO week_of is excluded.
       Without a date range, opts.season applies as before. */
    var hasDateRange = !!(opts.dateFrom || opts.dateTo);
    var dateFrom = hasDateRange && isValidISODate(opts.dateFrom) ? opts.dateFrom : null;
    var dateTo   = hasDateRange && isValidISODate(opts.dateTo)   ? opts.dateTo   : null;

    return (rows || []).filter(function (d) {
      if (opts.tier && d.tier !== opts.tier) return false;
      var sub = opts.sub;
      if ((sub === 'sub' || sub === '1' || sub === true) && !d.on_sub) return false;
      if ((sub === 'nonsub' || sub === '0' || sub === false) && d.on_sub) return false;
      if (opts.peer && peers.isPeerType && !peers.isPeerType(d, opts.peer)) return false;
      var eq = opts.equity;
      if ((eq === 'equity' || eq === 'no') && d.non_equity) return false;
      if ((eq === 'nonequity' || eq === 'yes') && !d.non_equity) return false;
      var engage = opts.engage;
      if ((engage === 'performed' || engage === 'no') && d.no_engagement) return false;
      if ((engage === 'no_performance' || engage === 'yes') && !d.no_engagement) return false;

      if (hasDateRange) {
        /* When a date range is active, week_of must be a valid ISO date.
           Records missing or malformed week_of are excluded entirely. */
        if (!isValidISODate(d.week_of)) return false;
        if (dateFrom && d.week_of < dateFrom) return false;
        if (dateTo   && d.week_of > dateTo)   return false;
      } else {
        /* Season filter — only applied when no date range is active. */
        if (opts.season && fiscalYear(d.week_of) !== opts.season) return false;
      }

      return true;
    });
  }
  function set(name, value) {
    root.BTD.state = root.BTD.state || { active: {} };
    root.BTD.state.active = root.BTD.state.active || {};
    root.BTD.state.active[name] = value || '';
    root.BTD.state.filtered = apply(root.BTD.state.all || [], root.BTD.state.active);
    return root.BTD.state.filtered;
  }
  function reset() {
    var active = root.BTD.state.active || {};
    ['tier','sub','peer','equity','engage'].forEach(function (k) { active[k] = ''; });
    root.BTD.state.filtered = apply(root.BTD.state.all || [], active);
    return root.BTD.state.filtered;
  }
  function getActiveCount() {
    var a = root.BTD.state && root.BTD.state.active || {};
    return ['season','tier','sub','peer','equity','engage'].filter(function (k) { return !!a[k]; }).length;
  }
  function describeActive() {
    var a = root.BTD.state && root.BTD.state.active || {};
    return ['season','tier','sub','peer','equity','engage'].filter(function (k) { return !!a[k]; }).map(function (k) { return k + ': ' + a[k]; }).join(', ');
  }
  root.BTD.filters = { apply: apply, set: set, reset: reset, getActiveCount: getActiveCount, describeActive: describeActive };
})(window);
