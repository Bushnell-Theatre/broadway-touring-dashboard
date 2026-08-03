(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  function key(record) { return String(record && record.theatre || '').trim() + '|' + String(record && record.city || '').trim(); }
  function getMeta(record) {
    var k = key(record);
    var fromState = root.BTD.state && root.BTD.state.peerMeta && root.BTD.state.peerMeta[k];
    return fromState || (root.PEER_META && root.PEER_META[k]) || null;
  }
  function isPeerType(record, type) {
    if (!type) return true;
    if (type === 'size' && record && record.similar_bushnell) return true;
    var meta = getMeta(record);
    var types = meta && (meta.peer_types || meta.types || []);
    if (!Array.isArray(types)) types = String(types || '').split(/[;,\s]+/).filter(Boolean);
    if (type === 'any') return types.length > 0 || !!(record && record.similar_bushnell);
    return types.indexOf(type) >= 0;
  }
  function summarize(records, options) {
    options = options || {};
    var rows = (records || []).filter(function (r) { return isPeerType(r, options.type || options.peerType || 'size'); });
    var metrics = root.BTD.metrics;
    return {
      rows: rows,
      count: rows.length,
      venues: metrics.uniqueCount(rows, function (r) { return key(r); }),
      capPaid: metrics.avg(rows.map(function (r) { return +r.cap_paid; })),
      ggPctGp: metrics.avg(rows.map(function (r) { return +r.gg_pct_gp; })),
      avgAdmission: metrics.avg(rows.map(function (r) { return +r.avg_adm; }))
    };
  }
  function isBushnell(record) { return !!record && (/bushnell|mortensen/i.test(String(record.theatre || '')) || /hartford/i.test(String(record.city || ''))); }
  function compareToBushnell(records) {
    var rows = records || [];
    var bushnell = rows.filter(isBushnell);
    var peers = summarize(rows, { type: 'size' });
    var metrics = root.BTD.metrics;
    var bushCap = metrics.avg(bushnell.map(function (r) { return +r.cap_paid; }));
    return { bushnellRows: bushnell, peerRows: peers.rows, bushnellCap: bushCap, peerCap: peers.capPaid, capDelta: bushCap == null || peers.capPaid == null ? null : bushCap - peers.capPaid };
  }
  function badges(record) { var meta = getMeta(record); return meta && meta.peer_types ? meta.peer_types : []; }
  root.BTD.peers = { key: key, getMeta: getMeta, isBushnell: isBushnell, isPeerType: isPeerType, summarize: summarize, compareToBushnell: compareToBushnell, badges: badges };
})(window);
