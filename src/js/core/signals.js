(function (root) {
  'use strict';
  root.BTD = root.BTD || {};

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function val(v) { return Number.isFinite(+v) ? +v : null; }
  function normBool(v) { return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'; }
  function normalizeName(s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function titleOf(show) { return typeof show === 'string' ? show : (show && (show.title || show.show || show.name || show.match || show.league_name)) || 'Unknown Title'; }
  function matchOf(show) { return typeof show === 'string' ? show : (show && (show.match || show.league_name || show.title || show.name || show.show)) || titleOf(show); }
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

  function profileShow(show, records, options) {
    options = options || {};
    var all = records || root.BTD.state.all || [];
    var matched = rowsForShow(show, all);
    var rows = activeRows(matched);
    var peerType = options.peerType || 'size';
    var peers = rows.filter(function (r) { return root.BTD.peers && root.BTD.peers.isPeerType(r, peerType); });
    var bushnell = rows.filter(function (r) { return /bushnell|mortensen/i.test(String(r.theatre || '')) || /hartford/i.test(String(r.city || '')); });
    var sub = rows.filter(function (r) { return normBool(r.on_sub); });
    var nonsub = rows.filter(function (r) { return !normBool(r.on_sub); });

    var paidCapacity = avg(rows, 'cap_paid');
    var totalCapacity = avg(rows, 'cap_total');
    var grossGross = avg(rows, 'gross_gross');
    var totalGross = sum(rows, 'gross_gross');
    var grossPotential = avg(rows, 'gross_potential');
    var ggPctGp = avg(rows, 'gg_pct_gp');
    var avgAdmission = avg(rows, 'avg_adm');
    var paidTix = sum(rows, 'paid_tix');
    var totalTix = sum(rows, 'total_tix');
    var venueSellable = avg(rows, 'venue_sellable');
    var grossPerSellableSeat = grossGross != null && venueSellable ? grossGross / venueSellable : null;
    var peerPaidCapacity = avg(peers, 'cap_paid');
    var peerGgPctGp = avg(peers, 'gg_pct_gp');
    var peerAvgAdmission = avg(peers, 'avg_adm');
    var peerGross = avg(peers, 'gross_gross');
    var bushnellCap = avg(bushnell, 'cap_paid');
    var subAvgAdmission = avg(sub, 'avg_adm');
    var nonsubAvgAdmission = avg(nonsub, 'avg_adm');
    var subGgPctGp = avg(sub, 'gg_pct_gp');
    var nonsubGgPctGp = avg(nonsub, 'gg_pct_gp');
    var subCap = avg(sub, 'cap_paid');
    var nonsubCap = avg(nonsub, 'cap_paid');
    var venueCount = uniq(rows, function (r) { return (r.theatre || '') + '|' + (r.city || ''); });
    var weekCount = uniq(rows, function (r) { return r.week_of; });

    var demandDrivers = [];
    var revenueDrivers = [];
    var peerDrivers = [];
    var confidenceDrivers = [];
    var demandScore = avgNonNull([
      scaled(paidCapacity, 50, 100),
      scaled(totalCapacity, 55, 102),
      peerPaidCapacity == null ? null : scaled(peerPaidCapacity, 50, 100),
      scaled(Math.log10(Math.max(1, paidTix || 0)), 3, 5.2),
      subCap != null && nonsubCap != null ? scaled(subCap - nonsubCap, -10, 15) : null
    ]);
    var revenueScore = avgNonNull([
      scaled(ggPctGp, 55, 105),
      scaled(avgAdmission, 45, 140),
      scaled(grossPerSellableSeat, 20, 700),
      peerGgPctGp == null ? null : scaled(peerGgPctGp, 55, 105),
      percentile(avgAdmission, root.BTD.state.all || all, 'avg_adm')
    ]);
    var peerScore = avgNonNull([
      peerPaidCapacity == null ? null : scaled(peerPaidCapacity, 50, 100),
      peerGgPctGp == null ? null : scaled(peerGgPctGp, 55, 105),
      peerAvgAdmission == null ? null : scaled(peerAvgAdmission, 45, 140),
      scaled(peers.length, 0, 24)
    ]);
    var confidenceScore = avgNonNull([
      scaled(rows.length, 0, 40),
      scaled(venueCount, 0, 20),
      scaled(peers.length, 0, 18),
      scaled(weekCount, 0, 30)
    ]) || 0;

    demandDrivers.push('Paid capacity, total capacity, ticket volume, peer attendance, and subscription lift.');
    revenueDrivers.push('GG% of gross potential, average admission, gross per sellable seat, peer revenue, and revenue rank.');
    peerDrivers.push('Bushnell-size or selected peer group capacity, revenue behavior, admission, and sample size.');
    confidenceDrivers.push(rows.length + ' active records, ' + venueCount + ' venues, ' + weekCount + ' weeks, ' + peers.length + ' peer records.');

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
    var caution = [];
    if (paidCapacity >= 85) positive.push('Paid capacity is a strong demand signal.');
    else if (paidCapacity != null && paidCapacity < 65) caution.push('Paid capacity is a soft demand signal.');
    if (ggPctGp >= 85) positive.push('Gross potential performance indicates healthy revenue quality.');
    else if (ggPctGp != null && ggPctGp < 70) caution.push('Revenue efficiency trails stronger planning candidates.');
    if (peerPaidCapacity >= 80) positive.push('Comparable peer venues show strong attendance behavior.');
    if (peerGgPctGp >= 80) positive.push('Comparable peer venues show useful revenue performance.');
    if (paidCapacity >= 85 && ggPctGp != null && ggPctGp < 70) caution.push('Attendance is stronger than revenue yield; review pricing power and discounting.');
    if (avgAdmission != null && percentile(avgAdmission, root.BTD.state.all || all, 'avg_adm') < 40) caution.push('Average admission trails much of the touring dataset.');
    if (peers.length < 4) caution.push('Peer sample is limited; apply local judgment.');
    if (confidenceScore < 45) caution.push('Evidence depth is thin; treat the read as preliminary.');
    caution.push('Revenue Signal is revenue quality, not net profit; deal terms and local costs are not included.');

    var demandSignal = signal(demandScore, demandDrivers);
    var revenueSignal = signal(revenueScore, revenueDrivers);
    var peerSignal = signal(peerScore, peerDrivers);
    var confidenceSignal = { value: Math.round(confidenceScore), label: confidenceLabel(confidenceScore, rows.length), drivers: confidenceDrivers };
    if (isFutureNewTour) {
      demandSignal = { value: null, label: 'Exploratory', drivers: demandDrivers };
      revenueSignal = { value: null, label: 'Exploratory', drivers: revenueDrivers };
      peerSignal = { value: null, label: 'Exploratory', drivers: peerDrivers };
      confidenceSignal = { value: 0, label: 'Exploratory', drivers: confidenceDrivers };
    }
    var composite = Math.round(avgNonNull([demandScore, revenueScore, peerScore, confidenceScore]) || (isFutureNewTour ? 65 : 0));
    var note = planningRead.indexOf('Demand Ahead') >= 0 ? 'Audience demand appears stronger than revenue quality; review pricing, discounting, and deal terms.' :
      planningRead.indexOf('Revenue Ahead') >= 0 ? 'Revenue quality is promising but demand evidence is softer; review audience reach and marketing risk.' :
      planningRead === 'Strong Candidate' ? 'Demand, revenue, peer, and confidence signals support leadership discussion.' :
      rows.length ? 'Signals are mixed or limited; use this as a discussion prompt.' : 'Little or no touring evidence found in this dataset.';

    return {
      title: titleOf(show),
      show: typeof show === 'object' ? show : { title: titleOf(show), match: matchOf(show) },
      records: { national: rows, peers: peers, bushnell: bushnell, subscription: sub, nonSubscription: nonsub },
      rows: rows,
      metrics: {
        paidCapacity: paidCapacity, totalCapacity: totalCapacity, cap: paidCapacity,
        grossGross: grossGross, gross: grossGross, totalGross: totalGross,
        grossPotential: grossPotential, ggPctGp: ggPctGp, gg: ggPctGp,
        avgAdmission: avgAdmission, avgAdm: avgAdmission, adm: avgAdmission,
        grossPerSellableSeat: grossPerSellableSeat,
        paidTix: paidTix, totalTix: totalTix, venueSellable: venueSellable,
        peerPaidCapacity: peerPaidCapacity, peerCap: peerPaidCapacity,
        peerGgPctGp: peerGgPctGp, peerAvgAdmission: peerAvgAdmission, peerGross: peerGross,
        bushnellCap: bushnellCap, index: (bushnellCap != null && paidCapacity) ? (bushnellCap / paidCapacity) * 100 : null,
        subAvgAdmission: subAvgAdmission, nonsubAvgAdmission: nonsubAvgAdmission,
        subGgPctGp: subGgPctGp, nonsubGgPctGp: nonsubGgPctGp,
        subCap: subCap, nonsubCap: nonsubCap, nonSubCap: nonsubCap,
        recordCount: rows.length, count: rows.length, activeCount: rows.length,
        venueCount: venueCount, venues: venueCount, weekCount: weekCount, weeks: weekCount,
        peerRecordCount: peers.length, peerCount: peers.length
      },
      signals: { demand: demandSignal, revenue: revenueSignal, peer: peerSignal, confidence: confidenceSignal },
      planning: { read: isFutureNewTour ? 'Exploratory' : planningRead, note: note },
      explanation: { positive: positive, caution: caution },
      score: composite,
      decomp: { canonical: true, demand: demandSignal.value, revenue: revenueSignal.value, peer: peerSignal.value, confidence: confidenceSignal.value },
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
    if (!profile || !profile.signals) return { demand: 'Exploratory', revenue: 'Exploratory', peer: 'Exploratory', confidence: 'Exploratory', planningRead: 'Exploratory', interpretation: 'No profile available.' };
    return {
      demand: profile.signals.demand.label,
      revenue: profile.signals.revenue.label,
      peer: profile.signals.peer.label,
      confidence: profile.signals.confidence.label,
      planningRead: profile.planning && profile.planning.read,
      interpretation: profile.planning && profile.planning.note
    };
  }

  root.BTD.signals = {
    normalizeName: normalizeName, rowsForShow: rowsForShow, profileShow: profileShow, profileSeason: profileSeason,
    demand: passthrough('demand'), revenue: passthrough('revenue'), peer: passthrough('peer'), confidence: passthrough('confidence'),
    planningRead: planningRead, whyRead: whyRead, signalLabels: signalLabels
  };
})(window);
