(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  function keyFromDate(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
  }
  function forWeek(week) { return (root.BTD.state.context || {})[keyFromDate(week)] || null; }
  function forDate(date) { return forWeek(date); }
  function summaryForRows(rows) {
    var weeks = {};
    (rows || []).forEach(function (r) { weeks[r.week_of] = forWeek(r.week_of); });
    var values = Object.values(weeks).filter(Boolean);
    return {
      contextWeeks: values.length,
      weatherWeeks: values.filter(function (c) { return c.weather && c.weather.significant; }).length,
      fallingSentimentWeeks: values.filter(function (c) { return c.economic && c.economic.confidence_trend === 'falling'; }).length
    };
  }
  function badge(weekOrDate) {
    var c = forWeek(weekOrDate);
    if (!c) return '';
    var out = [];
    if (c.weather && c.weather.significant) out.push('Weather');
    if (c.economic && c.economic.confidence_trend === 'falling') out.push('Sentiment');
    return out.join(' · ');
  }
  function preShowWindow() { return null; }
  function tooltip(weekOrDate) { return badge(weekOrDate); }
  root.BTD.context = { forWeek: forWeek, forDate: forDate, badge: badge, summaryForRows: summaryForRows, preShowWindow: preShowWindow, tooltip: tooltip };
})(window);
