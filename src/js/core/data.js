(function (root) {
  'use strict';
  root.BTD = root.BTD || {};

  async function tryFetch(urls, fallback) {
    if (!Array.isArray(urls)) urls = [urls];
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

  function normalizeName(value) {
    var text = String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/\([^)]*\)/g, ' ');
    text = text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.indexOf('the ') === 0) text = text.slice(4);
    return text;
  }

  function canonicalName(value, aliases) {
    var key = normalizeName(value);
    aliases = aliases || {};
    return aliases[key] || key;
  }

  function normalizeAliases(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (k) { out[normalizeName(k)] = normalizeName(raw[k]); });
    return out;
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

  function indexShows(shows, aliases) {
    var map = {};
    (Array.isArray(shows) ? shows : []).forEach(function (s) {
      var names = [s.name, s.show, s.title, s.league_name].filter(Boolean);
      names.forEach(function (n) {
        var key = canonicalName(n, aliases);
        if (key) map[key] = s;
      });
    });
    return map;
  }

  function enrichShowsFromAwards(shows, awards, media, aliases) {
    var awardSummary = awards && awards.summary_by_show || {};
    var mediaSummary = media && media.summary_by_show || {};
    return (Array.isArray(shows) ? shows : []).map(function (s) {
      var key = canonicalName(s.name || s.show || s.title || s.league_name, aliases);
      var out = Object.assign({}, s);
      if (awardSummary[key]) {
        out.awards = Object.assign({}, out.awards || {}, awardSummary[key]);
        out.signals = Object.assign({}, out.signals || {});
        if (!out.signals.recognition) out.signals.recognition = recognitionFromAwards(out.awards);
      }
      if (mediaSummary[key]) {
        out.signals = Object.assign({}, out.signals || {}, { media: mediaSummary[key] });
      }
      return out;
    });
  }

  function recognitionFromAwards(awards) {
    var weights = { tony: [12, 3, 45], olivier: [8, 2, 25], drama_desk: [6, 2, 20], grammy: [6, 2, 15] };
    var score = 0;
    var drivers = [];
    Object.keys(awards || {}).forEach(function (body) {
      var vals = awards[body] || {};
      var w = weights[body] || [4, 1, 10];
      var wins = +vals.wins || 0;
      var noms = +vals.nominations || 0;
      score += Math.min(w[2], wins * w[0] + Math.max(0, noms - wins) * w[1]);
      if (wins || noms) drivers.push(body.replace(/_/g, ' ') + ': ' + wins + ' wins / ' + noms + ' nominations');
    });
    score = Math.min(100, Math.round(score));
    return { value: score, label: score >= 60 ? 'High' : score >= 25 ? 'Moderate' : score > 0 ? 'Limited' : 'Unknown', drivers: drivers };
  }

  async function loadCore(options) {
    options = options || {};
    var cfg = root.BTD.config || {};
    var data = await tryFetch(options.dataUrls || cfg.dataUrls || ['data/data.json']);
    var peers = await tryFetch(options.peersUrl || cfg.peersUrl || 'data/peers.json', { venues: [] });
    var seasons = await tryFetch(options.seasonsUrl || cfg.seasonsUrl || 'data/seasons.json', []);
    var context = options.includeContext === false ? {} : await tryFetch(options.contextUrls || cfg.contextUrls || ['data/context.json'], {});
    var aliases = normalizeAliases(await tryFetch(options.titleAliasesUrl || cfg.titleAliasesUrl || 'data/title_aliases.json', {}));
    var awards = await tryFetch(options.awardsUrl || cfg.awardsUrl || 'data/awards.json', { records: [], summary_by_show: {} });
    var media = await tryFetch(options.mediaSignalsUrl || cfg.mediaSignalsUrl || 'data/media_signals.json', { records: [], summary_by_show: {} });
    var shows = options.includeShows === false ? [] : await tryFetch(options.showsUrl || cfg.showsUrl || 'data/shows.json', []);
    shows = enrichShowsFromAwards(shows, awards, media, aliases);
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
    root.BTD.state.titleAliases = aliases;
    root.BTD.state.awards = awards || {};
    root.BTD.state.mediaSignals = media || {};
    root.BTD.state.shows = shows || [];
    root.BTD.state.showIndex = indexShows(shows, aliases);
    root.ALL = root.BTD.state.all;
    root.FILTERED = root.BTD.state.filtered;
    root.PEER_META = root.BTD.state.peerMeta;
    return root.BTD.state;
  }

  async function loadShows() {
    var cfg = root.BTD.config || {};
    var aliases = root.BTD.state && root.BTD.state.titleAliases || normalizeAliases(await tryFetch(cfg.titleAliasesUrl || 'data/title_aliases.json', {}));
    var awards = root.BTD.state && root.BTD.state.awards || await tryFetch(cfg.awardsUrl || 'data/awards.json', { records: [], summary_by_show: {} });
    var media = root.BTD.state && root.BTD.state.mediaSignals || await tryFetch(cfg.mediaSignalsUrl || 'data/media_signals.json', { records: [], summary_by_show: {} });
    var shows = await tryFetch(cfg.showsUrl || 'data/shows.json', []);
    shows = enrichShowsFromAwards(shows, awards, media, aliases);
    root.BTD.state.shows = shows;
    root.BTD.state.showIndex = indexShows(shows, aliases);
    return shows;
  }

  root.BTD.data = {
    tryFetch: tryFetch, isoDate: isoDate, normalizeName: normalizeName, canonicalName: canonicalName,
    normalizeRecords: normalizeRecords, normalizeSeasons: normalizeSeasons, indexPeers: indexPeers,
    indexShows: indexShows, loadCore: loadCore, loadShows: loadShows
  };
})(window);
