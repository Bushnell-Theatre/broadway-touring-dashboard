(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  function clean(values) { return (values || []).map(Number).filter(function (v) { return !Number.isNaN(v); }); }
  function sum(values) { return clean(values).reduce(function (a, b) { return a + b; }, 0); }
  function avg(values) { var a = clean(values); return a.length ? sum(a) / a.length : null; }
  function median(values) {
    var a = clean(values).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }
  function groupBy(records, keyFn) {
    return (records || []).reduce(function (acc, row) {
      var key = typeof keyFn === 'function' ? keyFn(row) : row[keyFn];
      (acc[key] = acc[key] || []).push(row);
      return acc;
    }, {});
  }
  function uniqueCount(records, keyFn) { return Object.keys(groupBy(records, keyFn)).length; }
  function safeDivide(n, d) { n = Number(n); d = Number(d); return d && !Number.isNaN(n) && !Number.isNaN(d) ? n / d : null; }
  function percentileRank(value, population) {
    var a = clean(population);
    if (!a.length || value == null || Number.isNaN(Number(value))) return null;
    var below = a.filter(function (v) { return v < Number(value); }).length;
    return below / a.length * 100;
  }
  root.BTD.metrics = { sum: sum, avg: avg, median: median, groupBy: groupBy, uniqueCount: uniqueCount, safeDivide: safeDivide, percentileRank: percentileRank };
})(window);
