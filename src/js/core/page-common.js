(function (root) {
  'use strict';
  root.BTD = root.BTD || {};

  function esc(v) { return root.BTD.format && root.BTD.format.escapeHtml ? root.BTD.format.escapeHtml(v) : String(v == null ? '' : v); }
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  function norm(s) { return root.BTD.signals && root.BTD.signals.normalizeName ? root.BTD.signals.normalizeName(s) : String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function fmtDate(value) { return root.BTD.format && root.BTD.format.date ? root.BTD.format.date(value) : String(value || ''); }

  function bySeasonDate(a, b) {
    var as = a && (a.show || a) || {};
    var bs = b && (b.show || b) || {};
    return String(as.open || '9999-99-99').localeCompare(String(bs.open || '9999-99-99')) || String(as.title || '').localeCompare(String(bs.title || ''));
  }
  function dateLine(show) {
    if (!show || !show.open) return '';
    var a = fmtDate(show.open);
    var b = show.close ? fmtDate(show.close) : '';
    return b && b !== a ? a + ' — ' + b : a;
  }
  function seasonStartYear(id) { return id ? parseInt(String(id).slice(0, 4), 10) : null; }
  function seasonMode(id) {
    var y = seasonStartYear(id);
    if (y == null) return 'current';
    if (y >= 2026) return 'future';
    if (y <= 2024) return 'past';
    return 'current';
  }
  function scoreLabelForMode(mode) { return mode === 'past' ? 'Result Index' : mode === 'future' ? 'Planning Signal' : 'Planning / Performance'; }
  function readLabelForMode(mode) { return mode === 'past' ? 'Performance Read' : mode === 'future' ? 'Planning Read' : 'Read'; }
  function scoreCellText(profile) { return profile && profile.isFutureNewTour ? 'NEW' : profile && profile.score; }
  function scoreBadge(profile, median) {
    if (!profile) return '<span class="status neutral">—</span>';
    var cls = profile.isFutureNewTour ? 'neutral' : profile.score >= median ? 'good' : 'warn';
    var lbl = scoreCellText(profile);
    var delta = (!profile.isFutureNewTour && median != null) ? (profile.score - Math.round(median) >= 0 ? '+' : '') + (profile.score - Math.round(median)) + ' vs median' : '';
    return '<span class="status ' + esc(cls) + '">' + esc(lbl) + '</span>' + (delta ? '<div style="font-size:.52rem;color:var(--ink3);margin-top:2px">' + esc(delta) + '</div>' : '');
  }

  function planningSignals(profile) {
    return root.BTD.signals && root.BTD.signals.signalLabels ? root.BTD.signals.signalLabels(profile) : {
      demand: 'Exploratory', revenue: 'Exploratory', peer: 'Exploratory', confidence: 'Exploratory', planningRead: 'Exploratory', interpretation: 'No profile available.'
    };
  }
  function signalBadge(label) {
    var map = { Strong: 'good', Moderate: 'neutral', Soft: 'warn', Weak: 'warn', Insufficient: 'neutral', Exploratory: 'neutral' };
    return '<span class="status ' + esc(map[label] || 'neutral') + '">' + esc(label || '—') + '</span>';
  }
  function signalRow(signals) {
    return root.BTD.components && root.BTD.components.signalRow ? root.BTD.components.signalRow(signals) : '';
  }
  function whyThisRead(profile) {
    return root.BTD.components && root.BTD.components.whyRead ? root.BTD.components.whyRead(profile) : '<div class="card-sub">No explanation available.</div>';
  }
  function confidenceLabel(profile) { return profile && profile.signals && profile.signals.confidence && profile.signals.confidence.label || 'Exploratory'; }
  function confidenceText(profile) {
    var c = confidenceLabel(profile);
    if (c === 'High') return 'Broad tour evidence across multiple venues.';
    if (c === 'Moderate') return 'Usable evidence, but not enough to stand alone.';
    if (c === 'Low') return 'Limited evidence; use local judgment.';
    return 'Little or no touring evidence in this dataset.';
  }

  function matchRows(show, rows) {
    rows = rows || root.BTD.state && root.BTD.state.all || root.ALL || [];
    if (root.BTD.signals && root.BTD.signals.rowsForShow) return root.BTD.signals.rowsForShow(show, rows);
    var n = norm(show && (show.match || show.title) || show);
    return rows.filter(function (d) { return d.show && norm(d.show).indexOf(n) >= 0 && d.gross_gross != null; });
  }
  function activeFilters() {
    return {
      tier: root.ACTIVE_TIER || root.BTD.state && root.BTD.state.active && root.BTD.state.active.tier || '',
      sub: root.ACTIVE_SUB || root.BTD.state && root.BTD.state.active && root.BTD.state.active.sub || '',
      peer: root.ACTIVE_PEER || root.BTD.state && root.BTD.state.active && root.BTD.state.active.peer || '',
      equity: root.ACTIVE_EQUITY || root.BTD.state && root.BTD.state.active && root.BTD.state.active.equity || '',
      engage: root.ACTIVE_ENGAGE || root.BTD.state && root.BTD.state.active && root.BTD.state.active.engage || ''
    };
  }
  function applyStandardFilters(rows, filters) {
    filters = filters || activeFilters();
    return root.BTD.filters && root.BTD.filters.apply ? root.BTD.filters.apply(rows || [], filters) : (rows || []);
  }
  function profileShow(show, rows, options) {
    options = options || {};
    var filteredRows = applyStandardFilters(rows || matchRows(show), options.filters || activeFilters());
    return root.BTD.signals.profileShow(show, filteredRows, Object.assign({ peerType: activeFilters().peer || 'size' }, options));
  }

  function contextForWeek(weekOf) { return root.BTD.context && root.BTD.context.forWeek ? root.BTD.context.forWeek(weekOf) : (root.CONTEXT && root.CONTEXT[weekOf]) || null; }
  function contextForDate(isoDate) { return root.BTD.context && root.BTD.context.forDate ? root.BTD.context.forDate(isoDate) : null; }
  function contextBadge(value) { return root.BTD.context && root.BTD.context.badge ? root.BTD.context.badge(value) : ''; }
  function contextTooltip(value) { return root.BTD.context && root.BTD.context.tooltip ? root.BTD.context.tooltip(value) : ''; }
  function preShowWindow(openDate, weeks) { return root.BTD.context && root.BTD.context.preShowWindow ? root.BTD.context.preShowWindow(openDate, weeks) : null; }

  function rankItems(items, nameFn, detailFn, valFn) {
    return root.BTD.components && root.BTD.components.rankItems ? root.BTD.components.rankItems(items, nameFn, detailFn, valFn) : '';
  }

  function setFilterValue(globalName, value) {
    root[globalName] = value || '';
    var key = globalName.replace(/^ACTIVE_/, '').toLowerCase();
    if (key === 'sub') key = 'sub';
    root.BTD.state = root.BTD.state || {};
    root.BTD.state.active = root.BTD.state.active || {};
    root.BTD.state.active[key] = value || '';
    return value || '';
  }
  function setFilterButton(globalName, selector, value, renderFn) {
    setFilterValue(globalName, value);
    if (root.document) {
      root.document.querySelectorAll(selector).forEach(function (b) {
        var attr = selector.replace(/^\[data-/, '').replace(/\]$/, '');
        b.classList.toggle('active', String(b.dataset[attr] || '') === String(value || ''));
      });
    }
    if (typeof renderFn === 'function') renderFn();
  }
  function hydrateCoreState(target) {
    target = target || {};
    var st = root.BTD.state || {};
    target.all = (st.all || []).map(function (d) { return Object.assign({}, d, { on_sub: d.on_sub ? 1 : 0 }); });
    target.context = st.context || {};
    target.seasons = st.seasons || [];
    root.PEER_META = st.peerMeta || {};
    return target;
  }


  function normalizeDashboardRows(rows) {
    return (rows || []).map(function (d) {
      return Object.assign({}, d, {
        on_sub: d.on_sub ? 1 : 0,
        capacity: d.capacity != null ? Math.round(Number(d.capacity)) : null,
        paid_tix: d.paid_tix != null ? Math.round(Number(d.paid_tix)) : null,
        total_tix: d.total_tix != null ? Math.round(Number(d.total_tix)) : null,
        num_perf: d.num_perf != null ? Math.round(Number(d.num_perf)) : null
      });
    });
  }

  function normalizeDashboardSeasons(seasons) {
    return (seasons || []).map(function (s) {
      return Object.assign({}, s, {
        shows: (s.shows || []).map(function (show) {
          return Object.assign({}, show, {
            title: show.title || show.name || show.league_name || '',
            matchStr: show.matchStr || show.match || show.league_name || show.name || show.title || '',
            open: show.open || null,
            close: show.close || null,
            sub: !!show.sub
          });
        })
      });
    });
  }

  function renderDashboardSeasonPills(containerId, seasons, activeSeason, onSelect) {
    var el = root.document && root.document.getElementById(containerId);
    if (!el) return;
    seasons = seasons || [];
    el.innerHTML = '<button class="pill" data-season="" aria-label="All seasons">All</button>' + seasons.map(function (s) {
      var label = String(s.id || '').slice(2, 4) + '-' + String(s.id || '').slice(7, 9);
      return '<button class="pill' + (s.id === activeSeason ? ' active' : '') + '" data-season="' + esc(s.id) + '" aria-label="' + esc(s.name || s.id) + '">' + esc(label) + '</button>';
    }).join('');
    el.querySelectorAll('[data-season]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof onSelect === 'function') onSelect(btn.dataset.season || '');
      });
    });
  }

  // ── Season callout helpers (revenue-first) ───────────────────────────────────
  function seasonCalloutClass(avgGG) {
    if (avgGG == null) return '';
    return avgGG >= 80 ? 'good' : avgGG < 60 ? 'warn' : '';
  }
  function seasonHeadline(avgGG, avgGross, peer, profiles) {
    profiles = profiles || [];
    var newTours = profiles.filter(function(p) { return p.isFutureNewTour; }).length;
    if (newTours > 0) return 'New-tour season: limited data, but real upside potential.';
    if (avgGG == null) return 'Season slate is loaded — match data pending.';
    if (avgGG >= 85) return 'Strong revenue season: demand is converting well.';
    if (avgGG >= 75) return 'Revenue tracking solidly — demand and yield are aligned.';
    if (avgGG >= 60) return 'Revenue in range — monitor yield and pricing signals.';
    if (avgGG >= 45) return 'Revenue below expectations — review pricing and demand signals.';
    return 'Revenue needs attention — results warrant leadership review.';
  }
  function seasonSummaryCopy(profiles, avgGG, avgGross, avgCap, peer) {
    profiles = profiles || [];
    var fmt = root.fmt$ || function(v) { return v == null ? '—' : '$' + Math.round(v).toLocaleString(); };
    var pc = root.pct || function(v, d) { return v == null ? '—' : (d === 0 ? Math.round(v) : (v || 0).toFixed(1)) + '%'; };
    var known = profiles.filter(function(p) { return p.metrics && p.metrics.count > 0; }).length;
    var newTours = profiles.filter(function(p) { return p.isFutureNewTour; }).length;
    if (newTours > 0) {
      return known + ' of ' + profiles.length + ' planned shows have matching historical tour records. ' + newTours + ' appear to be new-tour opportunities in this feed — treat as uncertainty plus upside, not a negative signal. Revenue averaging ' + pc(avgGG, 0) + ' GG% of gross potential across matched records.';
    }
    return known + ' of ' + profiles.length + ' planned shows have matching tour records. Season averaging ' + fmt(avgGross) + ' avg gross and ' + pc(avgGG, 0) + ' GG% of gross potential. Capacity context: ' + pc(avgCap, 0) + ' nationally · ' + pc(peer, 0) + ' across Bushnell-size peer venues. Use the show-level signals below as directional planning inputs, not guarantees.';
  }

  function attachHelpTooltips(tipMap, helpText) {
    if (!root.document) return;
    Object.keys(tipMap || {}).forEach(function (id) {
      var key = tipMap[id];
      var text = helpText && helpText[key];
      var el = root.document.getElementById(id);
      if (!el || !text) return;
      el.setAttribute('title', text);
      el.setAttribute('aria-label', text);
      if (!el.querySelector('.tip-text')) {
        var span = root.document.createElement('span');
        span.className = 'tip-text';
        span.textContent = text;
        el.appendChild(span);
      }
    });
  }

  function snapToSunday(dateStr, direction) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return dateStr;
    var day = d.getDay();
    if (day !== 0) d.setDate(d.getDate() + (direction === 'back' ? -day : 7 - day));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fiscalWeek(dateStr) {
    if (!dateStr) return null;
    var y = parseInt(String(dateStr).slice(0, 4), 10);
    var mo = parseInt(String(dateStr).slice(5, 7), 10);
    var fy = mo >= 7 ? y : y - 1;
    var julFirst = new Date(fy, 6, 1);
    var julSun = new Date(julFirst);
    julSun.setDate(julFirst.getDate() - julFirst.getDay());
    var dt = new Date(dateStr + 'T12:00:00');
    if (Number.isNaN(dt.getTime())) return null;
    var diff = Math.round((dt - julSun) / (7 * 86400000));
    return Math.max(1, diff + 1);
  }


  root.BTD.page = {
    esc: esc, short: short, norm: norm, bySeasonDate: bySeasonDate, dateLine: dateLine,
    seasonStartYear: seasonStartYear, seasonMode: seasonMode, scoreLabelForMode: scoreLabelForMode, readLabelForMode: readLabelForMode,
    scoreCellText: scoreCellText, scoreBadge: scoreBadge,
    planningSignals: planningSignals, signalBadge: signalBadge, signalRow: signalRow, whyThisRead: whyThisRead,
    confidenceLabel: confidenceLabel, confidenceText: confidenceText,
    matchRows: matchRows, activeFilters: activeFilters, applyStandardFilters: applyStandardFilters, profileShow: profileShow,
    contextForWeek: contextForWeek, contextForDate: contextForDate, contextBadge: contextBadge, contextTooltip: contextTooltip, preShowWindow: preShowWindow,
    rankItems: rankItems, setFilterValue: setFilterValue, setFilterButton: setFilterButton, hydrateCoreState: hydrateCoreState,
    normalizeDashboardRows: normalizeDashboardRows, normalizeDashboardSeasons: normalizeDashboardSeasons,
    renderDashboardSeasonPills: renderDashboardSeasonPills, attachHelpTooltips: attachHelpTooltips,
    snapToSunday: snapToSunday, fiscalWeek: fiscalWeek,
    seasonCalloutClass: seasonCalloutClass, seasonHeadline: seasonHeadline, seasonSummaryCopy: seasonSummaryCopy
  };
})(window);
