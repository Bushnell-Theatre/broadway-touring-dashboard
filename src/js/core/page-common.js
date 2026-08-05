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

  /* ── profileShowCanonical ────────────────────────────────────────────────────
   *
   * Sole entry point for the canonical Planning Signal score per SCORING_CONTRACT.md.
   *
   * EVIDENCE FILTERS — only these two define what records are analyzed:
   *   tier  — Broadway League market tier (Primary / Secondary)
   *   sub   — subscription vs non-subscription records
   *
   * The following are explicitly excluded from the scoring evidence boundary:
   *   peer   — display selector for tables/charts; signals.js evaluates all
   *             three cohort types (size, proximity, market) independently
   *   equity — display toggle; does not define what evidence to score
   *   engage — display toggle; does not define what evidence to score
   *
   * DATE BOUNDARIES — optional, for historical evaluation integrity:
   *   options.dateFrom — ISO date string; exclude records before this date
   *   options.dateTo   — ISO date string; exclude records on or after this date
   *
   * For past seasons, callers MUST supply dateTo = season.end to prevent
   * later-season records from leaking into historical scoring. Without dateTo,
   * a show that appeared in multiple seasons is scored using all available
   * records, including evidence that did not exist when the season ran.
   *
   * Clones activeFilters() before constructing the permitted set — does not
   * mutate shared filter state.
   *
   * Options forwarded to signals.js:
   *   seasonId      — used for futureNewTour detection only (not record filtering)
   *   futureNewTour — explicit override; when true, components are Exploratory
   *                   and score is null
   *
   * ─────────────────────────────────────────────────────────────────────────── */
  function profileShowCanonical(show, allRows, options) {
    options = options || {};

    // Build the permitted evidence filter set — whitelist only, no mutation of shared state
    var active = activeFilters();
    var filters = {
      tier:   active.tier,
      sub:    active.sub,
      peer:   '',   // display filter — excluded from evidence boundary
      equity: '',   // display filter — excluded from evidence boundary
      engage: ''    // display filter — excluded from evidence boundary
    };

    var rows = applyStandardFilters(allRows || matchRows(show), filters);

    // Apply date boundaries when provided — required for historical season integrity
    if (options.dateFrom) rows = rows.filter(function (r) { return r.week_of && r.week_of >= options.dateFrom; });
    if (options.dateTo)   rows = rows.filter(function (r) { return r.week_of && r.week_of <= options.dateTo; });

    return root.BTD.signals.profileShow(show, rows, {
      seasonId:      options.seasonId,
      futureNewTour: options.futureNewTour
    });
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

  // ── Season callout helpers (revenue-first, data-driven) ──────────────────────
  function seasonCalloutClass(avgGG) {
    if (avgGG == null) return '';
    return avgGG >= 80 ? 'good' : avgGG < 60 ? 'warn' : '';
  }
  function seasonHeadline(avgGG, avgGross, peer, profiles) {
    profiles = profiles || [];
    var fmt = root.fmt$ || function(v) { return v == null ? '—' : '$' + Math.round(v / 1000) + 'k'; };
    var pc = root.pct || function(v, d) { return v == null ? '—' : Math.round(v) + '%'; };
    var withData = profiles.filter(function(p) { return p.metrics && p.metrics.count > 0 && !p.isFutureNewTour; });
    if (!withData.length) {
      var newTours = profiles.filter(function(p) { return p.isFutureNewTour; }).length;
      return newTours > 0 ? newTours + ' new-tour title' + (newTours > 1 ? 's' : '') + ' on the slate — no feed history yet.' : 'Season slate loaded — awaiting tour data.';
    }
    var byGross = withData.slice().sort(function(a, b) { return (b.metrics.gross || 0) - (a.metrics.gross || 0); });
    var top = byGross[0];
    return top.show.title + ' leads at ' + fmt(top.metrics.gross) + ' avg gross · season at ' + pc(avgGG, 0) + ' GG% across ' + withData.length + ' matched show' + (withData.length > 1 ? 's' : '') + '.';
  }
  function seasonSummaryCopy(profiles, avgGG, avgGross, avgCap, peer) {
    profiles = profiles || [];
    var fmt = root.fmt$ || function(v) { return v == null ? '—' : '$' + Math.round(v).toLocaleString(); };
    var pc = root.pct || function(v, d) { return v == null ? '—' : Math.round(v) + '%'; };
    var withData = profiles.filter(function(p) { return p.metrics && p.metrics.count > 0 && !p.isFutureNewTour; });
    var newTours = profiles.filter(function(p) { return p.isFutureNewTour; }).length;
    var known = withData.length;
    var parts = [];
    // Fact 1: coverage
    parts.push(known + ' of ' + profiles.length + ' planned shows have matched tour records' + (newTours > 0 ? '; ' + newTours + ' are new-tour titles without feed history yet' : '') + '.');
    // Fact 2: revenue leaders (GG% >= 80)
    var strong = withData.filter(function(p) { return p.metrics.gg != null && p.metrics.gg >= 80; }).sort(function(a,b){ return (b.metrics.gross||0)-(a.metrics.gross||0); });
    if (strong.length) {
      parts.push(strong.map(function(p){ return p.show.title; }).join(', ') + (strong.length === 1 ? ' is' : ' are') + ' converting demand to revenue at or above expectations (' + pc(strong[0].metrics.gg, 0) + ' GG%' + (strong.length > 1 ? ' leading' : '') + ').');
    }
    // Fact 3: soft revenue signals (GG% < 60 with data)
    var soft = withData.filter(function(p) { return p.metrics.gg != null && p.metrics.gg < 60; }).sort(function(a,b){ return (a.metrics.gg||0)-(b.metrics.gg||0); });
    if (soft.length) {
      parts.push(soft.map(function(p){ return p.show.title; }).join(', ') + (soft.length === 1 ? ' shows' : ' show') + ' the softest revenue signal — review pricing and demand depth before committing.');
    }
    // Fact 4: capacity as context only
    if (avgCap != null || peer != null) {
      parts.push('Capacity context: ' + pc(avgCap, 0) + ' nationally · ' + pc(peer, 0) + ' across Bushnell-size peer venues.');
    }
    return parts.join(' ');
  }

  // ── Planning vs. Actual profiling helpers ────────────────────────────────────
  // These use raw BTD.state.all (no page-level UI filters) so the pre-season,
  // before-Bushnell, and after-Bushnell windows always reflect true national data.
  function isBushnellRow(r) { return /bushnell|mortensen/i.test(String(r.theatre || '')); }

  function profileAtDate(show, maxDate, opts) {
    var all = root.BTD.state && root.BTD.state.all || [];
    var rows = root.BTD.signals.rowsForShow(show, all).filter(function (r) { return r.week_of && r.week_of < maxDate; });
    var p = root.BTD.signals.profileShow(show, rows, Object.assign({ peerType: 'size' }, opts || {}));
    if (p) { p.show = (typeof show === 'object') ? show : p.show; return p; }
    var avgFn = function (arr) { return root.BTD.metrics && root.BTD.metrics.avg ? root.BTD.metrics.avg(arr) : null; };
    var caps = rows.filter(function (r) { return r.cap_paid != null; }).map(function (r) { return r.cap_paid; });
    var ggs = rows.filter(function (r) { return r.gg_pct_gp != null; }).map(function (r) { return r.gg_pct_gp; });
    return { show: (typeof show === 'object') ? show : { title: show, match: show }, rows: rows, metrics: { count: rows.length, cap: avgFn(caps), gg: avgFn(ggs), peerCap: null }, score: 0 };
  }

  function profileInRange(show, start, end, opts) {
    opts = opts || {};
    var all = root.BTD.state && root.BTD.state.all || [];
    var rows = root.BTD.signals.rowsForShow(show, all).filter(function (r) { return r.week_of && r.week_of >= start && r.week_of <= end; });
    if (opts.excludeBushnell) rows = rows.filter(function (r) { return !isBushnellRow(r); });
    var p = root.BTD.signals.profileShow(show, rows, Object.assign({ peerType: 'size' }, opts));
    if (p) { p.show = (typeof show === 'object') ? show : p.show; return p; }
    var avgFn = function (arr) { return root.BTD.metrics && root.BTD.metrics.avg ? root.BTD.metrics.avg(arr) : null; };
    var caps = rows.filter(function (r) { return r.cap_paid != null; }).map(function (r) { return r.cap_paid; });
    var ggs = rows.filter(function (r) { return r.gg_pct_gp != null; }).map(function (r) { return r.gg_pct_gp; });
    return { show: (typeof show === 'object') ? show : { title: show, match: show }, rows: rows, metrics: { count: rows.length, cap: avgFn(caps), gg: avgFn(ggs), peerCap: null }, score: 0 };
  }

  function bushnellRowsForSeason(show, season) {
    if (!season || !season.start || !season.end) return [];
    var all = root.BTD.state && root.BTD.state.all || [];
    var key = root.BTD.signals.normalizeName(show && (show.match || show.title) || show);
    return all.filter(function (r) {
      return isBushnellRow(r)
        && root.BTD.signals.normalizeName(r.show || '').indexOf(key) >= 0
        && r.week_of >= season.start && r.week_of <= season.end;
    });
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
    matchRows: matchRows, activeFilters: activeFilters, applyStandardFilters: applyStandardFilters, profileShow: profileShow, profileShowCanonical: profileShowCanonical,
    profileAtDate: profileAtDate, profileInRange: profileInRange, bushnellRowsForSeason: bushnellRowsForSeason,
    contextForWeek: contextForWeek, contextForDate: contextForDate, contextBadge: contextBadge, contextTooltip: contextTooltip, preShowWindow: preShowWindow,
    rankItems: rankItems, setFilterValue: setFilterValue, setFilterButton: setFilterButton, hydrateCoreState: hydrateCoreState,
    normalizeDashboardRows: normalizeDashboardRows, normalizeDashboardSeasons: normalizeDashboardSeasons,
    renderDashboardSeasonPills: renderDashboardSeasonPills, attachHelpTooltips: attachHelpTooltips,
    snapToSunday: snapToSunday, fiscalWeek: fiscalWeek,
    seasonCalloutClass: seasonCalloutClass, seasonHeadline: seasonHeadline, seasonSummaryCopy: seasonSummaryCopy
  };
})(window);
