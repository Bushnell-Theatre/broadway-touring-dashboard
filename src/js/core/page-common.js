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
   * EVIDENCE CONTEXT — all options below are part of the evidence contract:
   *
   *   options.tier     — Broadway League market tier (Primary / Secondary).
   *                      When supplied, overrides the page-global ACTIVE_TIER.
   *                      Required for test harnesses and batch scoring where
   *                      page-global state is unavailable.
   *
   *   options.sub      — Subscription filter ('0', '1', or '').
   *                      When supplied, overrides the page-global ACTIVE_SUB.
   *
   *   options.dateFrom — ISO date string; exclude records before this date.
   *
   *   options.dateTo   — ISO date string; exclude records after this date.
   *                      For past seasons, callers MUST supply dateTo = season.end
   *                      to prevent post-season records from leaking into
   *                      historical scoring.
   *
   * DISPLAY FILTERS — explicitly excluded from the evidence boundary:
   *   peer   — display selector for tables/charts; signals.js evaluates all
   *             three cohort types (size, proximity, market) independently
   *   equity — display toggle; does not define what evidence to score
   *   engage — display toggle; does not define what evidence to score
   *
   * OPTIONS FORWARDED TO signals.js (not evidence filters):
   *   options.seasonId      — futureNewTour detection only (not record filtering)
   *   options.futureNewTour — when true, components are Exploratory, score is null
   *
   * Does not mutate shared filter state. options.tier / options.sub override
   * page globals; all other global filter state is ignored.
   *
   * ─────────────────────────────────────────────────────────────────────────── */
  function profileShowCanonical(show, allRows, options) {
    options = options || {};

    // Evidence filter set — explicit whitelist per SCORING_CONTRACT.md §"Filter taxonomy"
    // options.tier / options.sub take priority over page globals when supplied.
    var active = activeFilters();
    var filters = {
      tier:   options.tier   !== undefined ? options.tier   : active.tier,
      sub:    options.sub    !== undefined ? options.sub    : active.sub,
      peer:   '',   // display filter — excluded from evidence boundary
      equity: '',   // display filter — excluded from evidence boundary
      engage: ''    // display filter — excluded from evidence boundary
    };

    var rows = applyStandardFilters(allRows || matchRows(show), filters);

    // Date boundaries — required for historical season integrity.
    // dateFrom: lower bound (inclusive); dateTo: upper bound (inclusive).
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


  /* ── Date Range Validation Error Display ───────────────────────────────────
   *
   * Pages that include a #dateRangeError element (dashboard, programming,
   * exec_summary) get a visible inline error message when From > To.
   * ─────────────────────────────────────────────────────────────────────── */

  function dateRangeValidationError(msg) {
    /* Show or clear the inline validation message in #dateRangeError.
       Pass a non-empty string to show; pass '' or null to clear. */
    var el = root.document && root.document.getElementById('dateRangeError');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? '' : 'none';
  }

  function clearDateRangeError() {
    dateRangeValidationError('');
  }

  /* ── Date Range Toggle — shared across all three dashboard pages ──────────
   *
   * Dashboard uses a radio (Season / Date Range) that calls onDateModeChange().
   * Programming and Executive Summary use evidence pills (All available data /
   * Custom date range) that call onDisplayEvidencePillChange().
   *
   * Shared state:  window._DATE_RANGE = { start, end } | null
   * Shared inputs: id="fDateFrom", id="fDateTo", id="modeRange-panel"
   * Shared error:  id="dateRangeError"
   *
   * Apply button is the sole trigger for both contracts — no oninput.
   * ─────────────────────────────────────────────────────────────────────── */

  function onDateRangeChange(renderFn) {
    /* Triggered only by the Apply button — not on input events.
       Validation order:
         1. Compare raw ISO strings (YYYY-MM-DD sorts lexicographically) BEFORE
            snapping to Sunday. A same-week inversion would snap to the same
            boundary and pass a snapped comparison even though From > To.
         2. Only after raw validation passes do we snap to reporting-week
            boundaries and update _DATE_RANGE.
         3. On error: preserve the last valid _DATE_RANGE and the currently
            rendered result — do not clear state, do not re-render. Draft inputs
            remain in the fields for the user to correct. */
    var fromEl = root.document && root.document.getElementById('fDateFrom');
    var toEl   = root.document && root.document.getElementById('fDateTo');
    var from = fromEl ? fromEl.value : '';
    var to   = toEl   ? toEl.value   : '';

    if (from || to) {
      /* Step 1 — validate raw ISO ordering before snapping */
      if (from && to && from > to) {
        /* Invalid range — do NOT touch _DATE_RANGE. The previously rendered
           result (if any) stays current; the error is surfaced inline. */
        dateRangeValidationError('✕ “From” must be on or before “To”.');
        return;
      }
      /* Step 2 — snap to reporting-week boundaries, then activate range */
      var snappedFrom = snapToSunday(from || '2000-01-01', 'back');
      var snappedTo   = snapToSunday(to   || '2099-12-31', 'forward');
      clearDateRangeError();
      root._DATE_RANGE = { start: snappedFrom, end: snappedTo };
    } else {
      clearDateRangeError();
      root._DATE_RANGE = null;
    }
    if (typeof renderFn === 'function') renderFn();
  }

  /* ── Dashboard-only: radio-based Season ↔ Date Range toggle ─────────────
   *
   * Reads input[name="dateMode"] (values: "season" | "range") and shows the
   * corresponding panel. Only used by dashboard.html. Programming and
   * Executive Summary use onDisplayEvidencePillChange() instead.
   * ─────────────────────────────────────────────────────────────────────── */

  function onDateModeChange(renderFn) {
    var checked = root.document && root.document.querySelector('input[name="dateMode"]:checked');
    var mode = checked ? checked.value : 'season';
    var seasonPanel = root.document && root.document.getElementById('modeSeason-panel');
    var rangePanel  = root.document && root.document.getElementById('modeRange-panel');
    if (seasonPanel) seasonPanel.style.display = mode === 'season' ? '' : 'none';
    if (rangePanel)  rangePanel.style.display  = mode === 'range'  ? '' : 'none';
    if (mode === 'season') {
      // Switching back to Season — clear any active date range so season filter takes over
      root._DATE_RANGE = null;
      clearDateRangeError();
      var fromEl = root.document && root.document.getElementById('fDateFrom');
      var toEl   = root.document && root.document.getElementById('fDateTo');
      if (fromEl) fromEl.value = '';
      if (toEl)   toEl.value   = '';
      if (typeof renderFn === 'function') renderFn();
    }
    // Switching to Date Range — do nothing until user enters dates and hits Apply
  }

  function resetDateMode(renderFn) {
    /* Dashboard: reset the sidebar radio back to Season and clear any active
       date range. Call from dashboard.html's reset function. */
    root._DATE_RANGE = null;
    clearDateRangeError();
    var fromEl = root.document && root.document.getElementById('fDateFrom');
    var toEl   = root.document && root.document.getElementById('fDateTo');
    if (fromEl) fromEl.value = '';
    if (toEl)   toEl.value   = '';
    var seasonRadio = root.document && root.document.getElementById('modeSeason');
    if (seasonRadio) { seasonRadio.checked = true; onDateModeChange(null); }
    if (typeof renderFn === 'function') renderFn();
  }

  /* ── Programming / Executive Summary: evidence pill toggle ───────────────
   *
   * Two always-visible sidebar sections:
   *   "Show Slate"       — season pills; governs which planned shows appear
   *   "Display Evidence" — pills: "All available data" | "Custom date range"
   *
   * Switching to "Custom date range" shows the From/To/Apply inputs.
   * Switching back to "All available data" clears _DATE_RANGE and re-renders.
   * Apply is still the sole trigger for actually applying a date range.
   *
   * HTML structure required on these pages:
   *   id="deAll"         — "All available data" pill button
   *   id="deRange"       — "Custom date range" pill button
   *   id="modeRange-panel" — collapsible From/To/Apply container
   *   id="fDateFrom", id="fDateTo" — date inputs inside that container
   *   id="dateRangeError"          — validation message element
   * ─────────────────────────────────────────────────────────────────────── */

  function onDisplayEvidencePillChange(mode, renderFn) {
    /* mode: 'all' | 'range'
       'all'   → hide inputs, clear _DATE_RANGE, re-render
       'range' → show inputs; wait for Apply before re-rendering */
    var deAll   = root.document && root.document.getElementById('deAll');
    var deRange = root.document && root.document.getElementById('deRange');
    var panel   = root.document && root.document.getElementById('modeRange-panel');

    if (deAll)   deAll.classList.toggle('active', mode !== 'range');
    if (deRange) deRange.classList.toggle('active', mode === 'range');
    if (panel)   panel.style.display = mode === 'range' ? '' : 'none';

    if (mode !== 'range') {
      // Switching to "All available data" — clear range and re-render
      root._DATE_RANGE = null;
      clearDateRangeError();
      var fromEl = root.document && root.document.getElementById('fDateFrom');
      var toEl   = root.document && root.document.getElementById('fDateTo');
      if (fromEl) fromEl.value = '';
      if (toEl)   toEl.value   = '';
      if (typeof renderFn === 'function') renderFn();
    }
    // Switching to 'range' — show inputs but do nothing until Apply
  }

  function resetDisplayEvidence(renderFn) {
    /* Programming / Executive Summary: reset Display Evidence to
       "All available data" without triggering a separate re-render.
       Pass renderFn if you want a re-render after reset (usually omit
       and let the caller's full reset function trigger renderAll). */
    onDisplayEvidencePillChange('all', null);
    if (typeof renderFn === 'function') renderFn();
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
    dateRangeValidationError: dateRangeValidationError, clearDateRangeError: clearDateRangeError,
    onDateRangeChange: onDateRangeChange, onDateModeChange: onDateModeChange, resetDateMode: resetDateMode,
    onDisplayEvidencePillChange: onDisplayEvidencePillChange, resetDisplayEvidence: resetDisplayEvidence,
    seasonCalloutClass: seasonCalloutClass, seasonHeadline: seasonHeadline, seasonSummaryCopy: seasonSummaryCopy
  };
})(window);
