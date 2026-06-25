(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  var config = root.BTD.config || {};
  root.BTD.state = Object.assign({
    all: [],
    filtered: [],
    seasons: [],
    peerMeta: {},
    context: {},
    shows: {},
    validation: {},
    charts: {},
    active: {
      season: config.defaultSeason || '2025-2026',
      tier: '',
      sub: '',
      peer: '',
      equity: '',
      engage: '',
      tab: ''
    }
  }, root.BTD.state || {});
})(window);
