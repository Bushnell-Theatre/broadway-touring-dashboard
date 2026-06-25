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


  root.BTD.charts = { destroy: destroy, destroyAll: destroyAll, renderBar: renderBar, renderMultiBar: renderMultiBar, renderSignalChart: renderSignalChart, renderCapacityChart: renderCapacityChart, renderPeerChart: renderPeerChart, renderFitChart: renderFitChart, renderCapacityComparisonChart: renderCapacityComparisonChart, renderTonyRecognitionChart: renderTonyRecognitionChart, renderDashboardChart: renderDashboardChart, destroyDashboardChart: destroyDashboardChart, renderDashboardChartRegistry: renderDashboardChartRegistry };
})(window);
