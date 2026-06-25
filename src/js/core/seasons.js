(function (root) {
  'use strict';
  root.BTD = root.BTD || {};

  function all() { return root.BTD.state && root.BTD.state.seasons || []; }
  function getById(id) { return all().find(function (s) { return s.id === id; }) || null; }
  function getActive() { return getById(root.BTD.state && root.BTD.state.active && root.BTD.state.active.season) || all()[0] || null; }
  function getShows(id) { var s = id ? getById(id) : getActive(); return s && s.shows || []; }
  function getMode(id) {
    var s = id ? getById(id) : getActive();
    if (!s) return 'unknown';
    var today = new Date();
    var start = new Date(s.start + 'T00:00:00');
    var end = new Date(s.end + 'T23:59:59');
    if (today < start) return 'future';
    if (today > end) return 'past';
    return 'current';
  }
  function buildFallback() { return []; }
  function dateLine(show) {
    if (!show) return '';
    var f = root.BTD.format && root.BTD.format.date || function (x) { return x || ''; };
    if (show.open && show.close) return f(show.open) + ' - ' + f(show.close);
    if (show.open) return 'Opens ' + f(show.open);
    if (show.close) return 'Closes ' + f(show.close);
    return show.sub ? 'Subscription' : 'Special / add-on';
  }
  function renderPills(containerId, onSelect) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var active = root.BTD.state.active.season;
    el.innerHTML = all().map(function (s) { return '<button class="pill ' + (s.id === active ? 'active' : '') + '" data-season="' + s.id + '">' + s.id + '</button>'; }).join('');
    el.querySelectorAll('[data-season]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        root.BTD.state.active.season = btn.dataset.season;
        if (typeof onSelect === 'function') onSelect(btn.dataset.season);
      });
    });
  }

  root.BTD.seasons = { all: all, getActive: getActive, getById: getById, getShows: getShows, getMode: getMode, buildFallback: buildFallback, dateLine: dateLine, renderPills: renderPills };
})(window);
