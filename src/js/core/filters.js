(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  function fiscalYear(d) { return root.BTD.format && root.BTD.format.fiscalYear ? root.BTD.format.fiscalYear(d) : null; }
  function apply(rows, opts) {
    opts = opts || {};
    var peers = root.BTD.peers || {};
    return (rows || []).filter(function (d) {
      if (opts.tier && d.tier !== opts.tier) return false;
      var sub = opts.sub;
      if ((sub === 'sub' || sub === '1' || sub === true) && !d.on_sub) return false;
      if ((sub === 'nonsub' || sub === '0' || sub === false) && d.on_sub) return false;
      if (opts.peer && peers.isPeerType && !peers.isPeerType(d, opts.peer)) return false;
      var eq = opts.equity;
      if ((eq === 'equity' || eq === 'no') && d.non_equity) return false;
      if ((eq === 'nonequity' || eq === 'yes') && !d.non_equity) return false;
      var engage = opts.engage;
      if ((engage === 'performed' || engage === 'no') && d.no_engagement) return false;
      if ((engage === 'no_performance' || engage === 'yes') && !d.no_engagement) return false;
      if (opts.season && fiscalYear(d.week_of) !== opts.season) return false;
      return true;
    });
  }
  function set(name, value) {
    root.BTD.state = root.BTD.state || { active: {} };
    root.BTD.state.active = root.BTD.state.active || {};
    root.BTD.state.active[name] = value || '';
    root.BTD.state.filtered = apply(root.BTD.state.all || [], root.BTD.state.active);
    return root.BTD.state.filtered;
  }
  function reset() {
    var active = root.BTD.state.active || {};
    ['tier','sub','peer','equity','engage'].forEach(function (k) { active[k] = ''; });
    root.BTD.state.filtered = apply(root.BTD.state.all || [], active);
    return root.BTD.state.filtered;
  }
  function getActiveCount() {
    var a = root.BTD.state && root.BTD.state.active || {};
    return ['season','tier','sub','peer','equity','engage'].filter(function (k) { return !!a[k]; }).length;
  }
  function describeActive() {
    var a = root.BTD.state && root.BTD.state.active || {};
    return ['season','tier','sub','peer','equity','engage'].filter(function (k) { return !!a[k]; }).map(function (k) { return k + ': ' + a[k]; }).join(', ');
  }
  root.BTD.filters = { apply: apply, set: set, reset: reset, getActiveCount: getActiveCount, describeActive: describeActive };
})(window);
