(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  function esc(v) { return root.BTD.format && root.BTD.format.escapeHtml ? root.BTD.format.escapeHtml(v) : String(v == null ? '' : v); }
  function fmtPct(v, d) { return root.BTD.format && root.BTD.format.percent ? root.BTD.format.percent(v, d) : (v == null ? '—' : Number(v).toFixed(d != null ? d : 1) + '%'); }
  function fmt$(v) { return root.BTD.format && root.BTD.format.currency ? root.BTD.format.currency(v) : (v == null ? '—' : '$' + Math.round(v).toLocaleString()); }

  function kpiCard(label, value, note) {
    return '<div class="kpi-cell"><div class="kpi-label">' + esc(label) + '</div><div class="kpi-value">' + esc(value) + '</div><div class="kpi-sub">' + esc(note || '') + '</div></div>';
  }
  function signalBadge(label, value, status) {
    return '<span class="status ' + esc(status || 'neutral') + '">' + esc(label) + ': ' + esc(value == null ? '—' : value) + '</span>';
  }
  function confidenceBadge(confidence) { return signalBadge('Confidence', confidence || '—', confidence === 'High' ? 'good' : confidence === 'Low' || confidence === 'Exploratory' ? 'warn' : 'neutral'); }
  function caveatBlock(type) {
    var text = type === 'revenue'
      ? 'Revenue Signal describes revenue quality, not net profit. Deal terms, local costs, presenter share, and ancillary revenue are not included yet.'
      : 'Use these signals to guide discussion, not to approve or reject a title by themselves.';
    return '<div class="explainer"><p><strong>Decision-support note:</strong> ' + esc(text) + '</p></div>';
  }
  function whyRead(profile) {
    var exp = profile && profile.explanation || { positive: [], caution: [] };
    function list(items) { return (items || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') || '<li>No specific drivers available.</li>'; }
    return '<details class="note"><summary><strong>Why this read?</strong></summary><div class="grid grid-2" style="margin-top:8px"><div><div class="note-hd">Positive signals</div><ul>' + list(exp.positive) + '</ul></div><div><div class="note-hd">Caution signals</div><ul>' + list(exp.caution) + '</ul></div></div></details>';
  }
  function decisionCard(profile, options) {
    options = options || {};
    if (!profile) return '';
    var s = profile.signals || {};
    var m = profile.metrics || {};
    return '<div class="card">'
      + '<div class="card-hd">' + esc(profile.title) + '</div>'
      + '<div class="card-sub">' + esc(profile.planning && profile.planning.note || '') + '</div>'
      + '<div class="pill-row" style="margin-top:8px">'
      + signalBadge('Planning', profile.planning && profile.planning.read, 'neutral')
      + signalBadge('Demand', s.demand && s.demand.label, s.demand && s.demand.value >= 75 ? 'good' : 'neutral')
      + signalBadge('Revenue', s.revenue && s.revenue.label, s.revenue && s.revenue.value < 55 ? 'warn' : 'neutral')
      + signalBadge('Peer', s.peer && s.peer.label, 'neutral')
      + confidenceBadge(s.confidence && s.confidence.label)
      + '</div>'
      + '<table class="mini-table" style="margin-top:8px"><tbody>'
      + '<tr><td>Paid Capacity</td><td class="num">' + fmtPct(m.paidCapacity) + '</td></tr>'
      + '<tr><td>Gross % Potential</td><td class="num">' + fmtPct(m.ggPctGp) + '</td></tr>'
      + '<tr><td>Average Admission</td><td class="num">' + fmt$(m.avgAdmission) + '</td></tr>'
      + '<tr><td>Peer Capacity</td><td class="num">' + fmtPct(m.peerPaidCapacity) + '</td></tr>'
      + '</tbody></table>'
      + (options.includeWhy === false ? '' : whyRead(profile))
      + '</div>';
  }
  function dataQualitySummary(report) {
    report = report || (root.BTD.state && root.BTD.state.validation) || {};
    var summary = report.summary || {};
    var exc = report.exceptions || {};
    var status = root.BTD.validation && root.BTD.validation.status ? root.BTD.validation.status(report) : { label: 'Checked', className: 'good' };
    return '<div class="card"><div class="card-hd">Data Quality <span class="status ' + esc(status.className) + '">' + esc(status.label) + '</span></div>'
      + '<div class="card-sub">Validation report generated ' + esc(report.generated_at || 'in browser') + '</div>'
      + '<table class="mini-table"><tbody>'
      + '<tr><td>Records loaded</td><td class="num">' + esc(summary.record_count || 0) + '</td></tr>'
      + '<tr><td>Duplicate canonical keys</td><td class="num">' + esc(summary.duplicate_canonical_key_count || 0) + '</td></tr>'
      + '<tr><td>Paid capacity over 100%</td><td class="num">' + esc(exc.cap_paid_over_100_count || 0) + '</td></tr>'
      + '<tr><td>Gross % potential over 100%</td><td class="num">' + esc(exc.gg_pct_gp_over_100_count || 0) + '</td></tr>'
      + '<tr><td>Gross over potential</td><td class="num">' + esc(exc.gross_over_potential_count || 0) + '</td></tr>'
      + '</tbody></table><p style="font-size:.68rem;color:var(--ink2);margin-top:8px">Above-100 values are retained and surfaced because they may be valid Broadway League reporting conditions.</p></div>';
  }

  function signalStatus(label) {
    var map = { Strong: 'good', Moderate: 'neutral', Medium: 'neutral', Soft: 'warn', Weak: 'warn', Insufficient: 'neutral', Exploratory: 'neutral', High: 'good', Low: 'warn' };
    return map[label] || 'neutral';
  }
  function signalRow(signals) {
    signals = signals || {};
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'
      + '<span style="font-size:.52rem;color:var(--ink3);align-self:center">Demand</span>' + signalBadge(signals.demand, '', signalStatus(signals.demand)).replace(': ', '')
      + '<span style="font-size:.52rem;color:var(--ink3);align-self:center">Revenue</span>' + signalBadge(signals.revenue, '', signalStatus(signals.revenue)).replace(': ', '')
      + '<span style="font-size:.52rem;color:var(--ink3);align-self:center">Peer</span>' + signalBadge(signals.peer, '', signalStatus(signals.peer)).replace(': ', '')
      + '<span style="font-size:.52rem;color:var(--ink3);align-self:center">Confidence</span>' + signalBadge(signals.confidence, '', signalStatus(signals.confidence)).replace(': ', '')
      + '</div>';
  }
  function rankItems(items, nameFn, detailFn, valFn) {
    var rows = (items || []).map(function (p, i) {
      var value = Number(valFn(p)) || 0;
      return '<div class="rank-item"><div class="rank-n ' + (i < 3 ? 'top' : '') + '">' + (i + 1) + '</div><div class="rank-body"><div class="rank-name">' + esc(nameFn(p)) + '</div><div class="rank-detail">' + esc(detailFn(p)) + '</div><div class="bar-track"><div class="bar-fill" style="width:' + Math.max(4, Math.min(100, value)) + '%"></div></div></div><div class="rank-val">' + esc(valFn(p)) + '</div></div>';
    }).join('');
    return rows || '<div class="empty">No matching records.</div>';
  }
  function programmingShowCard(profile, active, idx, median, opts) {
    if (!profile) return '';
    var p = profile;
    var o = opts || {};
    var sig = root.BTD.signals && root.BTD.signals.signalLabels ? root.BTD.signals.signalLabels(p) : {};
    var scoreCls = p.isFutureNewTour ? 'neutral' : (p.score >= median ? 'good' : 'warn');
    var scoreText = p.isFutureNewTour ? 'NEW' : (p.score == null ? '—' : String(p.score));
    var cap = p.metrics && (p.metrics.cap != null ? p.metrics.cap : p.metrics.paidCapacity);
    var gg = p.metrics && (p.metrics.gg != null ? p.metrics.gg : p.metrics.ggPctGp);
    var dateHtml = o.dateStr ? '<div class="card-sub" style="margin:4px 0 8px">' + o.dateStr + '</div>' : '';
    var footerHtml = o.footerStr ? '<div class="card-sub" style="margin-top:6px;margin-bottom:0;border-top:1px solid var(--rule2);padding-top:6px">' + o.footerStr + '</div>' : '';
    var onclickAttr = o.onclick ? ' onclick="' + o.onclick + '"' : '';
    return '<div class="show-card ' + (active ? 'active' : '') + '" data-idx="' + esc(idx) + '"' + onclickAttr + '>'
      + '<div class="show-name">' + esc(p.show && p.show.title || p.title) + '</div>'
      + dateHtml
      + '<div class="metric-row" style="margin-top:8px">'
      + '<div class="metric"><div class="val ' + scoreCls + '">' + scoreText + '</div><div class="lbl">Fit Score</div></div>'
      + '<div class="metric"><div class="val">' + fmtPct(gg, 0) + '</div><div class="lbl">Revenue GG%</div></div>'
      + '<div class="metric"><div class="val">' + fmtPct(cap, 0) + '</div><div class="lbl">Demand Cap</div></div>'
      + '</div>'
      + '<div style="font-size:.52rem;color:var(--ink3);margin-top:6px">Planning Read: <strong>' + esc(sig.planningRead || 'Exploratory') + '</strong></div>'
      + signalRow(sig)
      + footerHtml
      + '</div>';
  }
  function metricTile(label, value, note, statusClass) {
    return '<div class="note"><div class="note-hd">' + esc(label) + '</div><div class="val ' + esc(statusClass || '') + '" style="font-family:var(--serif,Georgia);font-size:1.2rem;font-weight:700">' + esc(value) + '</div><div class="note-body">' + esc(note || '') + '</div></div>';
  }
  function externalConditionsCard(weatherWeeks, fallingWeeks) {
    if (!weatherWeeks && !fallingWeeks) return '';
    return '<div class="card"><div class="card-hd">External Conditions This Season</div><div style="display:flex;gap:16px;margin-top:6px">'
      + (weatherWeeks > 0 ? '<div><div class="score ' + (weatherWeeks >= 3 ? 'warn' : 'neutral') + '" style="font-size:1.2rem">' + esc(weatherWeeks) + '</div><div class="mini-label">Weather Events</div></div>' : '')
      + (fallingWeeks > 0 ? '<div><div class="score warn" style="font-size:1.2rem">' + esc(fallingWeeks) + '</div><div class="mini-label">Falling Confidence Wks</div></div>' : '')
      + '</div><div class="card-sub" style="margin-top:10px">Hartford County weather events and falling consumer confidence weeks this season. See History tab for show-level context.</div></div>';
  }


  function dashboardRankList(options) {
    options = options || {};
    var id = options.id || '';
    var items = options.items || [];
    var valFn = options.valFn || function (d) { return d && d._val; };
    var labelFn = options.labelFn || function () { return ''; };
    var fmtFn = options.fmtFn || function (v) { return v; };
    var maxVal = options.maxVal;
    var breakdownFn = options.breakdownFn;
    if (!items.length) return '<div class="no-data">No data available</div>';
    return items.map(function (d, i) {
      var v = valFn(d);
      var pct = maxVal ? Math.min((v / maxVal) * 100, 100) : 100;
      var rowId = id + '-bd-' + i;
      var hasBreakdown = !!breakdownFn;
      var breakdown = hasBreakdown ? (breakdownFn(d) || []) : [];
      var bdRows = breakdown.map(function (b) {
        var capColor = b.cap >= 90 ? 'var(--teal)' : b.cap >= 60 ? 'var(--amber)' : 'var(--rose)';
        return '<div style="display:flex;align-items:center;gap:8px;padding:4px 12px 4px 32px;font-size:0.62rem;border-top:1px solid var(--rule2);">'
          + '<div style="flex:1;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc((b.theatre || '') + ', ' + (b.city || '')) + '">' + esc(b.theatre || '') + '<span style="color:var(--ink3);margin-left:6px;">' + esc(b.city || '') + '</span></div>'
          + '<div style="font-family:var(--mono);color:var(--ink);min-width:80px;text-align:right;">' + (b.gross ? fmt$(b.gross) : '—') + '</div>'
          + '<div style="font-family:var(--mono);min-width:50px;text-align:right;color:' + capColor + ';">' + (b.cap ? Number(b.cap).toFixed(1) + '%' : '—') + '</div>'
          + '<div style="color:var(--ink3);min-width:36px;text-align:right;">' + esc(b.wks || 0) + ' wk' + (b.wks !== 1 ? 's' : '') + '</div>'
          + '</div>';
      }).join('');
      var bdHdr = breakdown.length
        ? '<div style="display:flex;gap:8px;padding:4px 12px 4px 32px;font-size:0.55rem;color:var(--ink3);text-transform:uppercase;letter-spacing:0.08em;border-top:2px solid var(--rule);background:var(--bg2);"><div style="flex:1;">Venue</div><div style="min-width:80px;text-align:right;">Gross</div><div style="min-width:50px;text-align:right;">% Cap</div><div style="min-width:36px;text-align:right;">Wks</div></div>'
        : '<div style="padding:8px 12px 8px 32px;font-size:0.62rem;color:var(--ink3);font-style:italic;border-top:1px solid var(--rule2);">No venue detail available</div>';
      var click = hasBreakdown ? ' onclick="toggleRankBreakdown(\'' + esc(rowId) + '\')"' : '';
      return '<div class="rank-item" style="' + (hasBreakdown ? 'cursor:pointer;' : '') + '"' + click + ' title="' + (hasBreakdown ? 'Click to see venue breakdown' : '') + '">'
        + '<div class="rank-n ' + (i < 3 ? 'top' : '') + '">' + (i + 1) + '</div>'
        + '<div class="rank-body"><div class="rank-name">' + esc(d._label || d.show || '') + (hasBreakdown ? ' <span style="font-size:0.6rem;color:var(--ink3);">▶</span>' : '') + '</div>'
        + '<div class="rank-detail">' + esc(labelFn(d)) + '</div><div class="rank-bar-track"><div class="rank-bar-fill" style="width:' + pct + '%"></div></div></div>'
        + '<div class="rank-val">' + esc(fmtFn(v)) + '</div></div>'
        + '<div id="' + esc(rowId) + '" style="display:none;background:var(--bg2);margin-bottom:2px;">' + bdHdr + bdRows + '</div>';
    }).join('');
  }


  function dashboardWowTable(data, options) {
    data = data || {};
    options = options || {};
    var fmtWeekFn = options.fmtWeek || function (v) { return v || '—'; };
    var fmtCurrencyFn = options.fmtCurrency || fmt$;
    var fmtNumberFn = options.fmtN || function (v) { return Number(v || 0).toFixed(1); };
    var rows = data.rows || [];
    if (!rows.length) return '<div class="no-data">No shows appear in both ' + esc(fmtWeekFn(data.previous)) + ' and ' + esc(fmtWeekFn(data.current)) + ' — try a wider date range</div>';
    function venueRow(r, dim) {
      var pc = r.cap_paid;
      var pcCol = pc >= 90 ? 'var(--teal)' : pc >= 60 ? 'var(--amber)' : 'var(--rose)';
      var dimStyle = dim ? 'color:var(--ink3);' : 'color:var(--ink2);';
      return '<tr style="background:var(--bg2);border-top:1px solid var(--rule2);"><td style="padding:4px 10px 4px 26px;font-size:0.62rem;' + dimStyle + '">' + esc(r.theatre || '') + '<span style="color:var(--ink3);margin-left:6px;">' + esc(r.city || '') + '</span></td><td style="padding:4px 10px;text-align:right;font-family:var(--mono);font-size:0.62rem;' + dimStyle + '">' + esc(fmtCurrencyFn(r.gross_gross)) + '</td><td style="padding:4px 10px;text-align:right;font-family:var(--mono);font-size:0.62rem;color:' + (pc ? pcCol : 'var(--ink3)') + ';">' + (pc ? esc(fmtNumberFn(pc)) + '%' : '—') + '</td></tr>';
    }
    function section(label, rowHtml, fallback) {
      return '<tr style="background:var(--bg2);"><td colspan="3" style="padding:3px 10px 3px 26px;font-size:0.52rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink3);border-top:1px solid var(--rule);">' + esc(label) + '</td></tr>' + (rowHtml || '<tr style="background:var(--bg2);"><td colspan="3" style="padding:3px 10px 3px 26px;font-size:0.62rem;color:var(--ink3);font-style:italic;">' + esc(fallback) + '</td></tr>');
    }
    return '<table style="width:100%;border-collapse:collapse;font-size:0.68rem;table-layout:fixed;"><colgroup><col style="width:40%"><col style="width:15%"><col style="width:12%"><col style="width:12%"><col style="width:10%"></colgroup><thead><tr style="background:var(--bg2);border-bottom:2px solid var(--rule);"><th style="text-align:left;padding:8px 10px;font-size:0.55rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink3);">Show</th><th style="text-align:right;padding:8px 10px;font-size:0.55rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink3);">Gross ' + esc(fmtWeekFn(data.current)) + '</th><th style="text-align:right;padding:8px 10px;font-size:0.55rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink3);">% Cap</th><th style="text-align:right;padding:8px 10px;font-size:0.55rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink3);">WoW Δ</th><th style="text-align:right;padding:8px 10px;font-size:0.55rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink3);">Venues</th></tr></thead><tbody>'
      + rows.map(function (d, i) {
        var rowId = 'wow-bd-' + i;
        var isPos = d._val >= 0;
        var col = isPos ? 'var(--teal)' : 'var(--rose)';
        var w2Rows = (d.currentRows || []).map(function (r) { return venueRow(r, false); }).join('');
        var w1Rows = (d.priorRows || []).map(function (r) { return venueRow(r, true); }).join('');
        return '<tr style="border-bottom:1px solid var(--rule2);cursor:pointer;" onclick="toggleWowDetail(\'' + esc(rowId) + '\')"><td style="padding:8px 10px;color:var(--ink);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span id="' + esc(rowId) + '-arr" style="font-size:0.6rem;color:var(--ink3);margin-right:4px;">&#9654;</span>' + esc(d._label) + '</td><td style="padding:8px 10px;text-align:right;font-family:var(--mono);">' + esc(fmtCurrencyFn(d._g2)) + '</td><td style="padding:8px 10px;text-align:right;font-family:var(--mono);">' + (d._cap != null ? esc(fmtNumberFn(d._cap)) + '%' : '—') + '</td><td style="padding:8px 10px;text-align:right;font-family:var(--mono);font-weight:700;color:' + col + ';">' + (isPos ? '+' : '') + esc(fmtNumberFn(d._val)) + '%</td><td style="padding:8px 10px;text-align:right;font-family:var(--mono);color:var(--ink3);">' + esc((d.currentRows || []).length) + '</td></tr><tr id="' + esc(rowId) + '" style="display:none;"><td colspan="5" style="padding:0;border-bottom:2px solid var(--rule);"><table style="width:100%;border-collapse:collapse;table-layout:fixed;"><colgroup><col style="width:55%"><col style="width:20%"><col style="width:15%"></colgroup><thead><tr style="background:var(--bg2);"><th style="padding:4px 10px 4px 26px;font-size:0.52rem;color:var(--ink3);text-align:left;">Venue &middot; City</th><th style="padding:4px 10px;font-size:0.52rem;color:var(--ink3);text-align:right;">Gross</th><th style="padding:4px 10px;font-size:0.52rem;color:var(--ink3);text-align:right;">% Cap</th></tr></thead><tbody>' + section(fmtWeekFn(data.current), w2Rows, 'No venue detail') + section(fmtWeekFn(data.previous) + ' (prior)', w1Rows, 'No prior-week data') + '</tbody></table></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function dashboardSizeGrid(rows, options) {
    rows = rows || [];
    options = options || {};
    var fmtCurrencyFn = options.fmtCurrency || fmt$;
    var fmtNumberFn = options.fmtN || function (v) { return Number(v || 0).toFixed(1); };
    return rows.map(function (b) { return '<div class="size-cell"><div class="size-lbl">' + esc(b.label) + '</div><div class="size-val">' + (b.avgCap ? esc(fmtNumberFn(b.avgCap)) + '%' : '—') + '</div><div class="size-sub">' + esc(b.count) + ' shows · ' + esc(fmtCurrencyFn(b.avgGross)) + '</div></div>'; }).join('');
  }

  function dashboardTableRows(records, options) {
    options = options || {};
    records = records || [];
    var fmtWeekFn = options.fmtWeek || function (v) { return v || '—'; };
    var fmtNFn = options.fmtN || function (v, d) { return v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d == null ? 1 : d }); };
    var fmtCurrencyFn = options.fmtCurrency || fmt$;
    if (!records.length) return '<tr><td colspan="14" class="no-data">No data matches current filters</td></tr>';
    return records.map(function (d) {
      var pct = d.cap_paid;
      var fc = pct > 95 ? 'fill-hi' : pct < 50 ? 'fill-lo' : 'fill-mid';
      var bw = pct ? Math.min(pct, 120) : 0;
      var tier = String(d.tier || '');
      return '<tr>'
        + '<td style="font-family:var(--mono);font-size:0.65rem;color:var(--ink3)">' + esc(fmtWeekFn(d.week_of)) + '</td>'
        + '<td><span class="badge badge-' + esc(tier.toLowerCase()) + '">' + esc(tier || '—') + '</span></td>'
        + '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;font-weight:500;color:var(--ink)">' + esc(d.show || '') + '</td>'
        + '<td>' + esc(d.city || '') + '</td>'
        + '<td style="font-family:var(--mono);text-align:right">' + esc(d.num_perf == null ? '—' : d.num_perf) + '</td>'
        + '<td style="font-family:var(--mono);font-weight:600;color:var(--ink)">' + esc(fmtCurrencyFn(d.gross_gross)) + '</td>'
        + '<td style="font-family:var(--mono);color:var(--ink3)">' + esc(fmtCurrencyFn(d.gross_potential)) + '</td>'
        + '<td style="font-family:var(--mono)">' + esc(d.gg_pct_gp != null ? fmtNFn(d.gg_pct_gp) + '%' : '—') + '</td>'
        + '<td><div class="cap-cell"><div class="cap-bar"><div class="cap-fill ' + esc(fc) + '" style="width:' + esc(bw) + '%"></div></div><span style="font-family:var(--mono)">' + esc(pct != null ? fmtNFn(pct) + '%' : '—') + '</span></div></td>'
        + '<td style="font-family:var(--mono);color:var(--ink3)">' + esc(d.capacity != null ? Number(d.capacity).toLocaleString() : '—') + '</td>'
        + '<td style="font-family:var(--mono);color:var(--ink3)">' + esc(d.paid_tix != null ? Number(d.paid_tix).toLocaleString() : '—') + '</td>'
        + '<td style="font-family:var(--mono)">' + esc(d.avg_adm != null ? '$' + fmtNFn(d.avg_adm, 2) : '—') + '</td>'
        + '<td style="font-family:var(--mono)">' + esc(d.top_price ? '$' + d.top_price : '—') + '</td>'
        + '<td style="text-align:center">' + (d.on_sub ? '<span class="sub-y">✓</span>' : '<span class="sub-n">—</span>') + '</td>'
        + '</tr>';
    }).join('');
  }

  function dashboardTableCount(count) {
    return (Number(count) || 0).toLocaleString() + ' engagements';
  }


  function methodologySummary() {
    return '<div class="method-card"><h3>Planning Signal</h3><p>The Planning Signal is built from separate Demand, Revenue, Peer, and Confidence signals. Demand measures audience pull. Revenue measures revenue quality. Peer measures relevance to Bushnell-like venues. Confidence measures evidence depth.</p></div>';
  }

  root.BTD.components = { kpiCard: kpiCard, signalBadge: signalBadge, confidenceBadge: confidenceBadge, caveatBlock: caveatBlock, decisionCard: decisionCard, whyRead: whyRead, methodologySummary: methodologySummary, dataQualitySummary: dataQualitySummary, signalStatus: signalStatus, signalRow: signalRow, rankItems: rankItems, programmingShowCard: programmingShowCard, metricTile: metricTile, externalConditionsCard: externalConditionsCard, dashboardRankList: dashboardRankList, dashboardWowTable: dashboardWowTable, dashboardSizeGrid: dashboardSizeGrid, dashboardTableRows: dashboardTableRows, dashboardTableCount: dashboardTableCount };
})(window);
