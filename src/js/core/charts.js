(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  function registry() { root.BTD.state.charts = root.BTD.state.charts || {}; return root.BTD.state.charts; }
  function destroy(id) { var c = registry()[id]; if (c && typeof c.destroy === 'function') c.destroy(); delete registry()[id]; }
  function destroyAll() { Object.keys(registry()).forEach(destroy); }
  function getCanvas(canvasId) { return typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId; }
  function baseOptions(extra) {
    return Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }, extra || {});
  }
  function renderBar(canvasId, labels, data, options) {
    if (!root.Chart) return null;
    var el = getCanvas(canvasId);
    if (!el) return null;
    var id = el.id || canvasId;
    destroy(id);
    registry()[id] = new Chart(el, {
      type: 'bar',
      data: { labels: labels || [], datasets: [{ data: data || [], backgroundColor: '#003865', borderRadius: 2 }] },
      options: baseOptions(options)
    });
    return registry()[id];
  }
  function renderMultiBar(canvasId, labels, datasets, options) {
    if (!root.Chart) return null;
    var el = getCanvas(canvasId);
    if (!el) return null;
    var id = el.id || canvasId;
    destroy(id);
    registry()[id] = new Chart(el, { type: 'bar', data: { labels: labels || [], datasets: datasets || [] }, options: baseOptions(Object.assign({ plugins: { legend: { display: true } } }, options || {})) });
    return registry()[id];
  }
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

  /* ── CATEGORY LABEL WRAPPING ───────────────────────────────────────────────
     Chart.js renders an array-valued tick label as one line per array element.
     wrapLabel() turns a long show name into those lines, breaking at word
     boundaries, so the COMPLETE name stays readable. Nothing is truncated and
     no ellipsis is substituted for meaningful text — a name that does not fit
     on one line becomes two or three lines instead of losing its tail.

     Returns a plain string when the name already fits, an array of lines when
     it does not; Chart.js accepts either. */
  function wrapLabel(text, maxChars) {
    var s = String(text == null ? '' : text).trim();
    var limit = Math.max(4, maxChars || 30);
    if (s.length <= limit) return s;

    var lines = [];
    var line = '';
    s.split(/\s+/).forEach(function (word) {
      /* A single word longer than the line budget cannot be wrapped at a word
         boundary, so it is hard-broken rather than allowed to overrun the axis
         and collide with the plot area. */
      while (word.length > limit) {
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, limit));
        word = word.slice(limit);
      }
      if (!word) return;
      if (!line) line = word;
      else if (line.length + 1 + word.length <= limit) line += ' ' + word;
      else { lines.push(line); line = word; }
    });
    if (line) lines.push(line);
    return lines;
  }

  /* How many lines a (possibly wrapped) label occupies. */
  function labelLineCount(label) { return Array.isArray(label) ? label.length : 1; }

  /* The tallest label in a set, in lines. */
  function maxLabelLines(labels) {
    return (labels || []).reduce(function (m, l) { return Math.max(m, labelLineCount(l)); }, 1);
  }

  /* ── CATEGORY AXIS SIZING ──────────────────────────────────────────────────
     Give a category-axis canvas enough height that every wrapped label has room
     for all of its lines. Without this, wrapped labels on a fixed-height canvas
     would run into their neighbours.

     The stylesheet height acts as a floor — this only ever grows a chart.

     The height has to be published as a STYLESHEET rule, not an inline style:
     Chart.js writes `canvas.style.height` itself on every resize, which would
     wipe out an inline declaration (importance and all). A rule in a stylesheet
     appended to <head> sits after the page's own `#cLongevity { height: … }`
     rules, so it wins on cascade order, and Chart.js's non-important inline
     style cannot override it.

     Call it BEFORE constructing the chart so the first layout already uses the
     final height. */
  var fittedHeights = {};

  function heightStyleSheet() {
    var el = document.getElementById('btd-chart-heights');
    if (!el) {
      el = document.createElement('style');
      el.id = 'btd-chart-heights';
      document.head.appendChild(el);
    }
    return el;
  }

  function fitCategoryHeight(canvasId, labels, opts) {
    var el = getCanvas(canvasId);
    if (!el) return null;
    var id = typeof canvasId === 'string' ? canvasId : el.id;
    if (!id) return null;

    opts = opts || {};
    var linePx = opts.linePx || 12;      /* one line of tick text, incl. leading */
    var gapPx = opts.gapPx || 8;         /* clear space between adjacent labels  */
    var axisPx = opts.axisPx || 56;      /* value axis, ticks and chart padding  */
    var minPx = opts.minPx || 0;         /* the stylesheet height                */
    var count = (labels || []).length;
    var needed = count * (maxLabelLines(labels) * linePx + gapPx) + axisPx;
    var h = Math.max(minPx, Math.round(needed));

    fittedHeights[id] = h;
    heightStyleSheet().textContent = Object.keys(fittedHeights)
      .map(function (k) { return '#' + k + ' { height: ' + fittedHeights[k] + 'px !important; }'; })
      .join('\n');
    return h;
  }
  function renderSignalChart(canvasId, profiles, signalName) {
    signalName = signalName || 'demand';
    profiles = profiles || [];
    return renderBar(canvasId, profiles.map(function (p) { return short(p.title || (p.show && p.show.title), 18); }), profiles.map(function (p) { return p.signals && p.signals[signalName] ? p.signals[signalName].value || 0 : 0; }), { indexAxis: 'y', scales: { x: { min: 0, max: 100 }, y: { grid: { display: false } } } });
  }
  function renderCapacityChart(canvasId, profiles) {
    profiles = profiles || [];
    return renderMultiBar(canvasId, profiles.map(function (p) { return short(p.title || (p.show && p.show.title), 16); }), [
      { label: 'Tour', data: profiles.map(function (p) { return p.metrics && p.metrics.paidCapacity || 0; }), borderRadius: 2 },
      { label: 'Peer', data: profiles.map(function (p) { return p.metrics && p.metrics.peerPaidCapacity || 0; }), borderRadius: 2 }
    ], { scales: { y: { min: 0, max: 110, ticks: { callback: function (v) { return v + '%'; } } }, x: { grid: { display: false } } } });
  }
  function renderPeerChart(canvasId, rows) {
    rows = (rows || []).slice(0, 14);
    return renderBar(canvasId, rows.map(function (r) { return short(r.city || r.theatre, 14); }), rows.map(function (r) { return r.cap || r.capPaid || 0; }), { scales: { y: { min: 0, max: 110, ticks: { callback: function (v) { return v + '%'; } } }, x: { grid: { display: false } } } });
  }

  function renderFitChart(canvasId, profiles) {
    profiles = profiles || [];
    return renderSignalChart(canvasId, profiles.map(function (p) {
      return Object.assign({}, p, { signals: Object.assign({}, p.signals || {}, { fit: { value: p.score || 0 } }) });
    }), 'fit');
  }
  function renderCapacityComparisonChart(canvasId, profiles) {
    return renderCapacityChart(canvasId, profiles || []);
  }
  function renderTonyRecognitionChart(canvasId, rows) {
    rows = (rows || []).filter(function (r) { return r.rec && Number(r.rec.tony_nominations || 0) > 0; });
    if (!rows.length) {
      destroy(typeof canvasId === 'string' ? canvasId : canvasId && canvasId.id);
      return null;
    }
    return renderMultiBar(canvasId, rows.map(function (r) { return short(r.title, 16); }), [
      { label: 'Wins', data: rows.map(function (r) { return Number(r.rec.tony_wins || 0); }), backgroundColor: '#003865', borderRadius: 2 },
      { label: 'Nominations', data: rows.map(function (r) { return Number(r.rec.tony_nominations || 0); }), backgroundColor: 'rgba(0,56,101,.3)', borderRadius: 2 }
    ], { plugins: { legend: { labels: { color: '#6b6b6b', font: { size: 10 } } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.06)' } } } });
  }
  function renderDashboardChart(store, key, canvasId, config) {
    if (!root.Chart) return null;
    store = store || registry();
    var el = getCanvas(canvasId);
    if (!el) return null;
    if (store[key] && typeof store[key].destroy === 'function') store[key].destroy();
    store[key] = new Chart(el, config || {});
    registry()[key] = store[key];
    return store[key];
  }
  function destroyDashboardChart(store, key) {
    store = store || registry();
    var c = store[key] || registry()[key];
    if (c && typeof c.destroy === 'function') c.destroy();
    delete store[key];
    delete registry()[key];
  }
  function renderDashboardChartRegistry(defs, store) {
    defs = defs || [];
    store = store || registry();
    return defs.map(function (def) {
      if (!def) return null;
      if (def.skip) { destroyDashboardChart(store, def.key); return null; }
      return renderDashboardChart(store, def.key, def.canvasId, def.config);
    });
  }


  root.BTD.charts = { wrapLabel: wrapLabel, labelLineCount: labelLineCount, maxLabelLines: maxLabelLines, fitCategoryHeight: fitCategoryHeight, destroy: destroy, destroyAll: destroyAll, renderBar: renderBar, renderMultiBar: renderMultiBar, renderSignalChart: renderSignalChart, renderCapacityChart: renderCapacityChart, renderPeerChart: renderPeerChart, renderFitChart: renderFitChart, renderCapacityComparisonChart: renderCapacityComparisonChart, renderTonyRecognitionChart: renderTonyRecognitionChart, renderDashboardChart: renderDashboardChart, destroyDashboardChart: destroyDashboardChart, renderDashboardChartRegistry: renderDashboardChartRegistry };
})(window);
