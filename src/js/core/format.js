(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  function isMissing(value) { return value == null || Number.isNaN(Number(value)); }
  function currency(value) {
    if (isMissing(value)) return '—';
    var v = Number(value);
    if (Math.abs(v) >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (Math.abs(v) >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(v).toLocaleString();
  }
  function percent(value, decimals) {
    if (decimals == null) decimals = 1;
    return isMissing(value) ? '—' : Number(value).toFixed(decimals) + '%';
  }
  function number(value, decimals) {
    if (decimals == null) decimals = 1;
    return isMissing(value) ? '—' : Number(value).toFixed(decimals);
  }
  function date(value) {
    if (!value) return '—';
    var parts = String(value).split('-').map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return String(value);
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function week(value) {
    if (!value) return '';
    var parts = String(value).split('-');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch];
    });
  }
  function fiscalYear(dateStr) {
    if (!dateStr) return null;
    var y = +String(dateStr).slice(0, 4);
    var mo = +String(dateStr).slice(5, 7);
    if (!y || !mo) return null;
    return mo >= 7 ? y + '-' + (y + 1) : (y - 1) + '-' + y;
  }
  function statusClass(value, thresholds) {
    thresholds = thresholds || { good: 75, warn: 50 };
    if (value == null || Number.isNaN(Number(value))) return 'neutral';
    if (Number(value) >= thresholds.good) return 'good';
    if (Number(value) < thresholds.warn) return 'warn';
    return 'neutral';
  }
  root.BTD.format = { currency: currency, percent: percent, number: number, date: date, week: week, shortCurrency: currency, escapeHtml: escapeHtml, fiscalYear: fiscalYear, statusClass: statusClass };
})(window);
