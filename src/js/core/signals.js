(function (root) {
  'use strict';
  root.BTD = root.BTD || {};

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function val(v) { return Number.isFinite(+v) ? +v : null; }
  function normBool(v) { return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'; }
  function normalizeName(s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function titleOf(show) { return typeof show === 'string' ? show : (show && (show.title || show.show || show.name || show.match || show.league_name)) || 'Unknown Title'; }
  function matchOf(show) { return typeof show === 'string' ? show : (show && (show.match || show.league_name || show.title || show.name || show.show)) || titleOf(show); }
  function canonicalName(value) {
    var key = normalizeName(value);
    var aliases = root.BTD.state && root.BTD.state.titleAliases || {};
    return aliases[key] || key;
  }
  function showMetaFor(show) {
    var state = root.BTD.state || {};
    var idx = state.showIndex || {};
    var keys = [titleOf(show), matchOf(show), show && show.name, show && show.league_name].filter(Boolean).map(canonicalName);
    for (var i = 0; i < keys.length; i++) { if (idx[keys[i]]) return idx[keys[i]]; }
    return {};
  }
  function avg(rows, field) { return root.BTD.metrics.avg((rows || []).map(function (r) { return val(r[field]); })); }
  function sum(rows, field) { return root.BTD.metrics.sum((rows || []).map(function (r) { return val(r[field]); })); }
  function uniq(rows, fn) { return root.BTD.metrics.uniqueCount(rows || [], fn); }
  function activeRows(rows) { return (rows || []).filter(function (r) { return !r.no_engagement || hasPerformanceData(r); }); }
  function hasPerformanceData(r) { return !!r && ['num_perf','gross_gross','gross_potential','gg_pct_gp','paid_tix','total_tix','capacity','cap_paid','cap_total','avg_adm'].some(function (k) { var v = r[k]; return v != null && v !== '' && Number.isFinite(+v); }); }
  function rowsForShow(show, records) {
    var needle = normalizeName(matchOf(show));
    if (!needle) return [];
    return (records || root.BTD.state.all || []).filter(function (r) {
      var hay = normalizeName(r.show);
      return hay === needle || hay.indexOf(needle) >= 0 || needle.indexOf(hay) >= 0;
    });
  }
  function label(score) {
    if (score == null || !Number.isFinite(+score)) return 'Insufficient';
    if (score >= 80) return 'Strong';
    if (score >= 65) return 'Moderate';
    if (score >= 45) return 'Soft';
    return 'Weak';
  }
  function confidenceLabel(score, rowCount) {
    if (!rowCount && (!score || score <= 0)) return 'Exploratory';
    if (score >= 75) return 'High';
    if (score >= 45) return 'Moderate';
    if (score > 0) return 'Low';
    return 'Exploratory';
  }
  function scaled(value, low, high) {
    if (value == null || !Number.isFinite(+value)) return null;
    return clamp(((value - low) / (high - low)) * 100, 0, 100);
  }
  function avgNonNull(values) {
    var nums = (values || []).filter(function (x) { return x != null && Number.isFinite(+x); }).map(Number);
    return nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : null;
  }
  function percentile(value, rows, field) {
    if (value == null) return null;
    var pop = (rows || []).map(function (r) { return val(r[field]); }).filter(function (v) { return v != null; }).sort(function (a,b){ return a-b; });
    if (!pop.length) return null;
    var below = pop.filter(function (v) { return v <= value; }).length;
    return 100 * below / pop.length;
  }
  function signal(value, drivers) { return { value: value == null ? null : Math.round(value), label: label(value), drivers: drivers || [] }; }
  function normalizeSignal(raw, fallbackLabel) {
    raw = raw || {};
    var value = raw.value == null ? null : Math.round(+raw.value);
    return { value: value, label: raw.label || fallbackLabel || label(value), drivers: raw.drivers || [] };
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
  function mediaSignal(media, key, fallback) {
    media = media || {};
    var raw = media[key] || {};
    if (key === 'tour_viability') return { value: raw.label === 'Confirmed' ? 85 : null, label: raw.label || fallback || 'Unknown', drivers: raw.drivers || [] };
    if (key === 'audience_fit' || key === 'local_market' || key === 'critical_reception') return { value: raw.value == null ? null : +raw.value, label: raw.label || fallback || 'Unknown', drivers: raw.drivers || raw.tags || [] };
    return normalizeSignal(raw, fallback || 'Unknown');
  }

  function profileShow(show, records, options) {
    options = options || {};
    var all = records || root.BTD.state.all || [];
    var matched = rowsForShow(show, all);
    var rows = activeRows(matched);
    // peerType retained for backward compat (used by legacy callers); scoring always uses all three types
    var peerType = options.peerType || 'size';

    /* ── PEER POOLS ────────────────────────────────────────────────────────────
     *
     * All three peer cohort types are evaluated independently and then combined.
     * A venue tagged in multiple types (e.g., Buell Theatre = size + market)
     * contributes to each pool it belongs to; the deduplicated union is allPeers.
     *
     * Scoring weights (each type contributes equally when data exists):
     *   size      — venues within ±10% of Bushnell sellable seats (2,450–2,994)
     *   proximity — Northeast/New England markets (routing and audience overlap)
     *   market    — nonprofit mid-sized PACs with subscription programming
     *
     * National data (paidCapacity, ggPctGp, etc.) is retained in the metrics
     * object for reference but is NOT used in the composite score.
     * ─────────────────────────────────────────────────────────────────────── */
    function isPeer(r, type) { return !!(root.BTD.peers && root.BTD.peers.isPeerType(r, type)); }
    var sizePeers      = rows.filter(function (r) { return isPeer(r, 'size'); });
    var proximityPeers = rows.filter(function (r) { return isPeer(r, 'proximity'); });
    var marketPeers    = rows.filter(function (r) { return isPeer(r, 'market'); });

    // Deduplicated union — venues tagged in multiple types appear once
    var peerKeys = {};
    var allPeers = [];
    [sizePeers, proximityPeers, marketPeers].forEach(function (pool) {
      pool.forEach(function (r) {
        var k = (r.week_of || '') + '|' + (r.theatre || '') + '|' + (r.city || '');
        if (!peerKeys[k]) { peerKeys[k] = true; allPeers.push(r); }
      });
    });

    // Legacy single-type peer array — backward compat only, not used in scoring
    var peers = rows.filter(function (r) { return isPeer(r, peerType); });

    var bushnell = rows.filter(function (r) { return /bushnell|mortensen/i.test(String(r.theatre || '')) || /hartford/i.test(String(r.city || '')); });
    var sub    = rows.filter(function (r) { return normBool(r.on_sub); });
    var nonsub = rows.filter(function (r) { return !normBool(r.on_sub); });

    /* ── NATIONAL METRICS — reference only, not used in scoring ── */
    var paidCapacity        = avg(rows, 'cap_paid');
    var totalCapacity       = avg(rows, 'cap_total');
    var grossGross          = avg(rows, 'gross_gross');
    var totalGross          = sum(rows, 'gross_gross');
    var grossPotential      = avg(rows, 'gross_potential');
    var ggPctGp             = avg(rows, 'gg_pct_gp');
    var avgAdmission        = avg(rows, 'avg_adm');
    var paidTix             = sum(rows, 'paid_tix');
    var totalTix            = sum(rows, 'total_tix');
    var venueSellable       = avg(rows, 'venue_sellable');
    var grossPerSellableSeat = grossGross != null && venueSellable ? grossGross / venueSellable : null;

    /* ── PER-TYPE PEER METRICS ── */
    var sizePeerCap       = avg(sizePeers,      'cap_paid');
    var sizePeerGg        = avg(sizePeers,      'gg_pct_gp');
    var sizePeerAdm       = avg(sizePeers,      'avg_adm');
    var sizePeerGross     = avg(sizePeers,      'gross_gross');
    var proximityPeerCap  = avg(proximityPeers, 'cap_paid');
    var proximityPeerGg   = avg(proximityPeers, 'gg_pct_gp');
    var proximityPeerAdm  = avg(proximityPeers, 'avg_adm');
    var proximityPeerGross = avg(proximityPeers, 'gross_gross');
    var marketPeerCap     = avg(marketPeers,    'cap_paid');
    var marketPeerGg      = avg(marketPeers,    'gg_pct_gp');
    var marketPeerAdm     = avg(marketPeers,    'avg_adm');
    var marketPeerGross   = avg(marketPeers,    'gross_gross');

    /* ── COMBINED PEER METRICS (across deduplicated allPeers) ── */
    var peerPaidCapacity  = avg(allPeers, 'cap_paid');
    var peerGgPctGp       = avg(allPeers, 'gg_pct_gp');
    var peerAvgAdmission  = avg(allPeers, 'avg_adm');
    var peerGross         = avg(allPeers, 'gross_gross');

    var bushnellCap       = avg(bushnell, 'cap_paid');
    var subAvgAdmission   = avg(sub,      'avg_adm');
    var nonsubAvgAdmission = avg(nonsub,  'avg_adm');
    var subGgPctGp        = avg(sub,      'gg_pct_gp');
    var nonsubGgPctGp     = avg(nonsub,   'gg_pct_gp');
    var subCap            = avg(sub,      'cap_paid');
    var nonsubCap         = avg(nonsub,   'cap_paid');
    var venueCount        = uniq(rows, function (r) { return (r.theatre || '') + '|' + (r.city || ''); });
    var weekCount         = uniq(rows, function (r) { return r.week_of; });

    /* ── COHORT-ANCHORED SCORING ───────────────────────────────────────────────
     *
     * All three peer types (size, proximity, market) contribute equally to each
     * signal when data exists for that type. Types with no records are excluded
     * rather than penalized. This ensures a show is judged against venues the
     * Bushnell actually competes with — not diluted by large-hall or primary-
     * market tour stops.
     *
     * demandScore  — avg paid capacity % at each active peer type, plus sub lift.
     *                Weights: size 1, proximity 1, market 1, sub lift 1 (equal,
     *                null-aware average).
     *
     * revenueScore — GG%GP and avg admission at each active peer type, averaged
     *                within type first, then across types.
     *                Weights: size 1, proximity 1, market 1 (equal, null-aware).
     *
     * peerScore    — cross-type consistency and evidence breadth. High score means
     *                strong performance AND data from multiple peer cohorts.
     *
     * confidenceScore — evidence depth: record count, venue diversity, peer
     *                   coverage (combined), and unique weeks.
     * ─────────────────────────────────────────────────────────────────────── */

    // Build driver strings that document exactly which peer types contributed
    var typesSeen = [];
    if (sizePeers.length)      typesSeen.push('size (' + sizePeers.length + ' records)');
    if (proximityPeers.length) typesSeen.push('proximity (' + proximityPeers.length + ' records)');
    if (marketPeers.length)    typesSeen.push('market (' + marketPeers.length + ' records)');
    var typesStr = typesSeen.length ? typesSeen.join(', ') : 'no peer records found';

    var demandDrivers     = [];
    var revenueDrivers    = [];
    var peerDrivers       = [];
    var confidenceDrivers = [];

    /* demandScore: paid capacity at each peer type, plus subscription lift */
    var demandScore = avgNonNull([
      sizePeerCap      != null ? scaled(sizePeerCap,      50, 100) : null,
      proximityPeerCap != null ? scaled(proximityPeerCap, 50, 100) : null,
      marketPeerCap    != null ? scaled(marketPeerCap,    50, 100) : null,
      subCap != null && nonsubCap != null ? scaled(subCap - nonsubCap, -10, 15) : null
    ]);

    /* revenueScore: GG%GP and admission, averaged per type, then across types */
    var sizePeerRevScore      = avgNonNull([
      sizePeerGg  != null ? scaled(sizePeerGg,  55, 105) : null,
      sizePeerAdm != null ? scaled(sizePeerAdm, 45, 140) : null
    ]);
    var proximityPeerRevScore = avgNonNull([
      proximityPeerGg  != null ? scaled(proximityPeerGg,  55, 105) : null,
      proximityPeerAdm != null ? scaled(proximityPeerAdm, 45, 140) : null
    ]);
    var marketPeerRevScore    = avgNonNull([
      marketPeerGg  != null ? scaled(marketPeerGg,  55, 105) : null,
      marketPeerAdm != null ? scaled(marketPeerAdm, 45, 140) : null
    ]);
    var revenueScore = avgNonNull([sizePeerRevScore, proximityPeerRevScore, marketPeerRevScore]);

    /* peerScore: cross-type consistency and sample breadth */
    var peerScore = avgNonNull([
      peerPaidCapacity != null ? scaled(peerPaidCapacity, 50, 100) : null,
      peerGgPctGp      != null ? scaled(peerGgPctGp,      55, 105) : null,
      scaled(allPeers.length, 0, 24)
    ]);

    /* confidenceScore: evidence depth */
    var confidenceScore = avgNonNull([
      scaled(rows.length,     0, 40),
      scaled(venueCount,      0, 20),
      scaled(allPeers.length, 0, 18),
      scaled(weekCount,       0, 30)
    ]) || 0;

    demandDrivers.push('Paid capacity at comparable venues — ' + typesStr + '. Each peer type contributes equally when data exists. Subscription vs. non-subscription capacity differential applied where available.');
    revenueDrivers.push('GG% of gross potential and average admission at comparable venues — ' + typesStr + '. Averaged within each peer type, then across types equally.');
    peerDrivers.push('Cross-type consistency: paid capacity and revenue efficiency across ' + allPeers.length + ' combined cohort records (' + typesStr + ').');
    confidenceDrivers.push(rows.length + ' active records, ' + venueCount + ' venues, ' + weekCount + ' weeks, ' + allPeers.length + ' combined peer records (' + typesStr + ').');

    var showMeta = showMetaFor(show);
    var awards = showMeta.awards || {};
    var metaSignals = showMeta.signals || {};
    var media = metaSignals.media || {};
    var recognitionSignal = normalizeSignal(metaSignals.recognition || recognitionFromAwards(awards), 'Unknown');
    var pressSignal   = mediaSignal(media, 'press_awareness', 'Unknown');
    var tourSignal    = mediaSignal(media, 'tour_viability',  'Unknown');
    var riskSignal    = mediaSignal(media, 'reputation_risk', 'Unknown');
    var audienceSignal = mediaSignal(media, 'audience_fit',   'Unknown');
    var localSignal   = mediaSignal(media, 'local_market',    'Unknown');

    var isFutureNewTour = !!options.futureNewTour || (String(options.seasonId || '').indexOf('2026') === 0 && rows.length === 0);
    var planningRead = 'Exploratory';
    if (rows.length) {
      if ((demandScore || 0) >= 75 && (revenueScore || 0) >= 70 && confidenceScore >= 45) planningRead = 'Strong Candidate';
      else if ((demandScore || 0) >= 75 && (revenueScore || 0) < 60) planningRead = 'Mixed: Demand Ahead of Revenue';
      else if ((revenueScore || 0) >= 75 && (demandScore || 0) < 60) planningRead = 'Upside: Revenue Ahead of Demand';
      else if ((demandScore || 0) >= 60 || (revenueScore || 0) >= 60) planningRead = 'Discuss';
      else planningRead = 'Watch';
    }

    var positive = [];
    var caution  = [];
    // Explanations reference peer metrics, not national averages
    if (peerPaidCapacity >= 85) positive.push('Paid capacity is strong across comparable peer venues (' + typesStr + ').');
    else if (peerPaidCapacity != null && peerPaidCapacity < 65) caution.push('Paid capacity at comparable venues is a soft signal; review local factors.');
    if (peerGgPctGp >= 85) positive.push('Revenue efficiency is strong across comparable peer venues.');
    else if (peerGgPctGp != null && peerGgPctGp < 70) caution.push('Revenue efficiency trails peer venue benchmarks; review pricing and deal terms.');
    if (sizePeerCap != null && sizePeerCap >= 80) positive.push('Similarly-sized halls show strong attendance for this show.');
    if (proximityPeerCap != null && proximityPeerCap >= 80) positive.push('Northeast/New England regional markets show strong attendance for this show.');
    if (marketPeerCap != null && marketPeerCap >= 80) positive.push('Comparable nonprofit PAC markets show strong attendance for this show.');
    if (peerPaidCapacity >= 85 && peerGgPctGp != null && peerGgPctGp < 70) caution.push('Attendance at peer venues is strong but revenue yield is softer; review pricing power and discounting.');
    if (allPeers.length < 4) caution.push('Combined peer sample is limited (' + allPeers.length + ' records); apply local judgment.');
    if (confidenceScore < 45) caution.push('Evidence depth is thin; treat the read as preliminary.');
    if (recognitionSignal.label === 'High') positive.push('Recognition signal is high based on award history.');
    else if (recognitionSignal.label === 'Moderate' || recognitionSignal.label === 'Limited') positive.push('Award recognition provides some additional context.');
    if (pressSignal.label === 'High') positive.push('Public-media awareness appears high based on curated sources.');
    if (tourSignal.label === 'Confirmed') positive.push('Tour viability is confirmed by curated public sources.');
    if (riskSignal.label === 'High' || riskSignal.label === 'Moderate') caution.push('Public-source reputation risk should be reviewed.');
    if (audienceSignal.label && audienceSignal.label !== 'Unknown') positive.push('Audience-fit context: ' + audienceSignal.label + '.');
    if (localSignal.label === 'Relevant') positive.push('Local-market relevance appears in curated public sources.');
    caution.push('Revenue Signal is revenue quality, not net profit; deal terms and local costs are not included.');

    var demandSignal     = signal(demandScore,     demandDrivers);
    var revenueSignal    = signal(revenueScore,    revenueDrivers);
    var peerSignal       = signal(peerScore,       peerDrivers);
    var confidenceSignal = { value: Math.round(confidenceScore), label: confidenceLabel(confidenceScore, rows.length), drivers: confidenceDrivers };
    if (isFutureNewTour) {
      demandSignal     = { value: null, label: 'Exploratory', drivers: demandDrivers };
      revenueSignal    = { value: null, label: 'Exploratory', drivers: revenueDrivers };
      peerSignal       = { value: null, label: 'Exploratory', drivers: peerDrivers };
      confidenceSignal = { value: 0,    label: 'Exploratory', drivers: confidenceDrivers };
    }
    /* Future new tours have no scored components — composite is null, not a fabricated number.
     * The UI displays '—' for null scores. Shows with zero records but no new-tour flag get 0. */
    var composite = isFutureNewTour ? null : Math.round(avgNonNull([demandScore, revenueScore, peerScore, confidenceScore]) || 0);
    var note = planningRead.indexOf('Demand Ahead') >= 0 ? 'Audience demand at comparable venues appears stronger than revenue quality; review pricing, discounting, and deal terms.' :
      planningRead.indexOf('Revenue Ahead') >= 0 ? 'Revenue quality at comparable venues is promising but demand evidence is softer; review audience reach and marketing risk.' :
      planningRead === 'Strong Candidate' ? 'Demand, revenue, peer cohort, and confidence signals support leadership discussion.' :
      rows.length ? 'Signals are mixed or limited; use this as a discussion prompt.' : 'Little or no touring evidence found in this dataset.';

    return {
      title: titleOf(show),
      show: typeof show === 'object' ? show : { title: titleOf(show), match: matchOf(show) },
      records: { national: rows, peers: allPeers, bushnell: bushnell, subscription: sub, nonSubscription: nonsub },
      rows: rows,
      metrics: {
        // National metrics — reference only, not used in composite score
        paidCapacity: paidCapacity, totalCapacity: totalCapacity, cap: paidCapacity,
        grossGross: grossGross, gross: grossGross, totalGross: totalGross,
        grossPotential: grossPotential, ggPctGp: ggPctGp, gg: ggPctGp,
        avgAdmission: avgAdmission, avgAdm: avgAdmission, adm: avgAdmission,
        grossPerSellableSeat: grossPerSellableSeat,
        paidTix: paidTix, totalTix: totalTix, venueSellable: venueSellable,
        // Combined peer metrics (across all three types, deduplicated)
        peerPaidCapacity: peerPaidCapacity, peerCap: peerPaidCapacity,
        peerGgPctGp: peerGgPctGp, peerAvgAdmission: peerAvgAdmission, peerGross: peerGross,
        // Bushnell and subscription metrics
        bushnellCap: bushnellCap, index: (bushnellCap != null && paidCapacity) ? (bushnellCap / paidCapacity) * 100 : null,
        subAvgAdmission: subAvgAdmission, nonsubAvgAdmission: nonsubAvgAdmission,
        subGgPctGp: subGgPctGp, nonsubGgPctGp: nonsubGgPctGp,
        subCap: subCap, nonsubCap: nonsubCap, nonSubCap: nonsubCap,
        // Record counts
        recordCount: rows.length, count: rows.length, activeCount: rows.length,
        venueCount: venueCount, venues: venueCount, weekCount: weekCount, weeks: weekCount,
        peerRecordCount: allPeers.length, peerCount: allPeers.length
      },
      // Per-type breakdown — documents exactly which cohorts contributed and how
      peerBreakdown: {
        size:      { count: sizePeers.length,      cap: sizePeerCap,      gg: sizePeerGg,      adm: sizePeerAdm,      gross: sizePeerGross },
        proximity: { count: proximityPeers.length, cap: proximityPeerCap, gg: proximityPeerGg, adm: proximityPeerAdm, gross: proximityPeerGross },
        market:    { count: marketPeers.length,    cap: marketPeerCap,    gg: marketPeerGg,    adm: marketPeerAdm,    gross: marketPeerGross },
        combined:  { count: allPeers.length,       cap: peerPaidCapacity, gg: peerGgPctGp,    adm: peerAvgAdmission, gross: peerGross }
      },
      signals: { demand: demandSignal, revenue: revenueSignal, peer: peerSignal, recognition: recognitionSignal, press: pressSignal, tour: tourSignal, risk: riskSignal, audience: audienceSignal, local: localSignal, confidence: confidenceSignal },
      awards: awards,
      showMeta: showMeta,
      planning: { read: isFutureNewTour ? 'Exploratory' : planningRead, note: note },
      explanation: { positive: positive, caution: caution },
      score: composite,
      decomp: { canonical: true, demand: demandSignal.value, revenue: revenueSignal.value, peer: peerSignal.value, confidence: confidenceSignal.value, peerTypes: typesStr },
      isFutureNewTour: isFutureNewTour
    };
  }

  function profileSeason(seasonId, records, options) {
    options = options || {};
    options.seasonId = seasonId;
    return (root.BTD.seasons.getShows(seasonId) || []).map(function (s) { return profileShow(s, records, options); });
  }
  function passthrough(kind) { return function (profile) { return profile && profile.signals && profile.signals[kind]; }; }
  function planningRead(profile) { return profile && profile.planning; }
  function whyRead(profile) { return profile && profile.explanation || { positive: [], caution: [] }; }
  function signalLabels(profile) {
    if (!profile || !profile.signals) return { demand: 'Exploratory', revenue: 'Exploratory', peer: 'Exploratory', recognition: 'Unknown', press: 'Unknown', tour: 'Unknown', risk: 'Unknown', audience: 'Unknown', local: 'Unknown', confidence: 'Exploratory', planningRead: 'Exploratory', interpretation: 'No profile available.' };
    return {
      demand: profile.signals.demand.label,
      revenue: profile.signals.revenue.label,
      peer: profile.signals.peer.label,
      recognition: profile.signals.recognition && profile.signals.recognition.label,
      press: profile.signals.press && profile.signals.press.label,
      tour: profile.signals.tour && profile.signals.tour.label,
      risk: profile.signals.risk && profile.signals.risk.label,
      audience: profile.signals.audience && profile.signals.audience.label,
      local: profile.signals.local && profile.signals.local.label,
      confidence: profile.signals.confidence.label,
      planningRead: profile.planning && profile.planning.read,
      interpretation: profile.planning && profile.planning.note
    };
  }

  root.BTD.signals = {
    normalizeName: normalizeName, rowsForShow: rowsForShow, profileShow: profileShow, profileSeason: profileSeason,
    demand: passthrough('demand'), revenue: passthrough('revenue'), peer: passthrough('peer'), recognition: passthrough('recognition'), press: passthrough('press'), tour: passthrough('tour'), risk: passthrough('risk'), audience: passthrough('audience'), local: passthrough('local'), confidence: passthrough('confidence'),
    planningRead: planningRead, whyRead: whyRead, signalLabels: signalLabels
  };
})(window);
