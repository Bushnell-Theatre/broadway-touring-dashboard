(function (root) {
  'use strict';
  root.BTD = root.BTD || {};

  async function tryFetch(urls, fallback) {
    urls = Array.isArray(urls) ? urls : [urls];
    var errors = [];
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await fetch(urls[i], { cache: 'no-store' });
        if (r.ok) return await r.json();
        errors.push(urls[i] + ' -> HTTP ' + r.status);
      } catch (e) {
        errors.push(urls[i] + ' -> ' + (e && e.message ? e.message : String(e)));
      }
    }
    if (fallback !== undefined) return fallback;
    throw new Error('Could not load: ' + errors.join('; '));
  }

  function isoDate(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
    var dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }

  function normalizeRecords(raw) {
    return (Array.isArray(raw) ? raw : (raw && raw.records) || []).map(function (d) {
      var theatre = String(d.theatre || '').replace(/\s+/g, ' ').trim();
      if (theatre === 'Academy Of Music: Kimmel Center') theatre = 'Academy of Music: Kimmel Center';
      return Object.assign({}, d, {
        theatre: theatre,
        city: String(d.city || '').replace(/\s+/g, ' ').trim(),
        show: String(d.show || '').replace(/\s+/g, ' ').trim(),
        week_of: isoDate(d.week_of),
        similar_bushnell: !!d.similar_bushnell,
        no_engagement: !!d.no_engagement,
        non_equity: !!d.non_equity,
        on_sub: !!d.on_sub
      });
    });
  }

  function indexPeers(raw) {
    var map = {};
    var venues = (raw && raw.venues) || (Array.isArray(raw) ? raw : []);
    venues.forEach(function (v) {
      if (!v) return;
      var key = String(v.theatre || '').trim() + '|' + String(v.city || '').trim();
      map[key] = v;
    });
    return map;
  }

  function normalizeSeasons(raw) {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'object') return [];
    return Object.keys(raw).map(function (id) {
      var entry = raw[id] || {};
      var yr = parseInt(String(id).slice(0, 4), 10);
      var shows = Array.isArray(entry) ? entry : (entry.shows || []);
      return {
        id: id,
        name: entry.name || (id + ' Season'),
        start: entry.start || (yr + '-07-01'),
        end: entry.end || ((yr + 1) + '-06-30'),
        note: entry.note || null,
        shows: shows.map(function (s) {
          if (typeof s === 'string') return { title: s, match: s, sub: false };
          return {
            title: s.title || s.name || s.league_name || '',
            match: s.match || s.league_name || s.name || s.title || '',
            open: s.open || null,
            close: s.close || null,
            sub: !!s.sub
          };
        })
      };
    }).sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); });
  }

  async function loadCore(options) {
    options = options || {};
    var cfg = root.BTD.config || {};
    var data = await tryFetch(options.dataUrls || cfg.dataUrls || ['data/data.json']);
    var peers = await tryFetch(options.peersUrl || cfg.peersUrl || 'data/peers.json', { venues: [] });
    var seasons = await tryFetch(options.seasonsUrl || cfg.seasonsUrl || 'data/seasons.json', []);
    var context = options.includeContext === false ? {} : await tryFetch(options.contextUrls || cfg.contextUrls || ['data/context.json'], {});
    var rows = normalizeRecords(data);
    var validation = await tryFetch(options.validationUrl || cfg.validationUrl || 'data/validation_report.json', null);
    if (!validation && root.BTD.validation && root.BTD.validation.summarize) validation = root.BTD.validation.summarize(rows);

    root.BTD.state = root.BTD.state || {};
    root.BTD.state.all = rows;
    root.BTD.state.filtered = rows.slice();
    root.BTD.state.peerMeta = indexPeers(peers);
    root.BTD.state.seasons = normalizeSeasons(seasons);
    root.BTD.state.context = context || {};
    root.BTD.state.validation = validation || {};
    root.ALL = root.BTD.state.all;
    root.FILTERED = root.BTD.state.filtered;
    root.PEER_META = root.BTD.state.peerMeta;
    return root.BTD.state;
  }

  async function loadShows() {
    var cfg = root.BTD.config || {};
    var shows = await tryFetch(cfg.showsUrl || 'data/shows.json', []);
    root.BTD.state.shows = shows;
    return shows;
  }

  root.BTD.data = { tryFetch: tryFetch, isoDate: isoDate, normalizeRecords: normalizeRecords, normalizeSeasons: normalizeSeasons, indexPeers: indexPeers, loadCore: loadCore, loadShows: loadShows };
})(window);
