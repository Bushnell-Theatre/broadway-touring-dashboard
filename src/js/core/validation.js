(function (root) {
  'use strict';
  root.BTD = root.BTD || {};

  function emptyReport() {
    return {
      generated_at: null,
      summary: { record_count: 0, duplicate_canonical_key_count: 0 },
      exceptions: {},
      missing_by_field: {},
      notes: []
    };
  }

  function summarize(records) {
    var rows = records || [];
    var keyCounts = {};
    var missing = {};
    var required = ['week_of','tier','show','theatre','city','gross_gross','gross_potential','gg_pct_gp','paid_tix','total_tix','capacity','cap_paid','cap_total','on_sub','avg_adm','venue_sellable','similar_bushnell','non_equity','no_engagement','canonical_key'];
    required.forEach(function (f) { missing[f] = 0; });
    rows.forEach(function (r) {
      if (r.canonical_key) keyCounts[r.canonical_key] = (keyCounts[r.canonical_key] || 0) + 1;
      required.forEach(function (f) { if (!(f in r) || r[f] == null || r[f] === '') missing[f]++; });
    });
    var duplicateCount = Object.keys(keyCounts).filter(function (k) { return keyCounts[k] > 1; }).length;
    function over(field) { return rows.filter(function (r) { return Number.isFinite(+r[field]) && +r[field] > 100; }).length; }
    return {
      generated_at: new Date().toISOString(),
      summary: {
        record_count: rows.length,
        unique_canonical_keys: Object.keys(keyCounts).length,
        duplicate_canonical_key_count: duplicateCount,
        unique_shows: new Set(rows.map(function (r) { return r.show; }).filter(Boolean)).size,
        unique_theatre_city_pairs: new Set(rows.map(function (r) { return (r.theatre || '') + '|' + (r.city || ''); }).filter(function (s) { return s !== '|'; })).size
      },
      missing_by_field: missing,
      exceptions: {
        cap_paid_over_100_count: over('cap_paid'),
        cap_total_over_100_count: over('cap_total'),
        gg_pct_gp_over_100_count: over('gg_pct_gp'),
        gross_over_potential_count: rows.filter(function (r) { return Number.isFinite(+r.gross_gross) && Number.isFinite(+r.gross_potential) && +r.gross_potential > 0 && +r.gross_gross > +r.gross_potential; }).length,
        no_engagement_count: rows.filter(function (r) { return !!r.no_engagement; }).length
      },
      notes: ['Generated in-browser from loaded records because validation_report.json was unavailable.']
    };
  }

  function status(report) {
    report = report || emptyReport();
    var exceptions = report.exceptions || {};
    var duplicateCount = report.summary && report.summary.duplicate_canonical_key_count || 0;
    if (duplicateCount > 0) return { label: 'Review', className: 'warn' };
    if ((exceptions.invalid_date_count || 0) > 0) return { label: 'Review', className: 'warn' };
    return { label: 'Checked', className: 'good' };
  }

  root.BTD.validation = { emptyReport: emptyReport, summarize: summarize, status: status };
})(window);
