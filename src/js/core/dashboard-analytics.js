(function (root) {
  root.BTD = root.BTD || {};
  var BTD = root.BTD;
  var metrics = BTD.metrics || {};
  var avg = metrics.avg || root.avg || function (arr) {
    arr = (arr || []).filter(function (v) { return v != null && !isNaN(Number(v)); }).map(Number);
    return arr.length ? arr.reduce(function (a,b) { return a + b; }, 0) / arr.length : null;
  };

  function fiscalWeek(dateStr) {
    return BTD.page && BTD.page.fiscalWeek ? BTD.page.fiscalWeek(dateStr) : null;
  }

  function getFiscalYearSafe(dateStr) {
    if (typeof root.getFiscalYear === 'function') return root.getFiscalYear(dateStr);
    if (!dateStr) return null;
    var y = parseInt(String(dateStr).slice(0,4), 10);
    var m = parseInt(String(dateStr).slice(5,7), 10);
    if (!y || !m) return null;
    return m >= 7 ? y : y - 1;
  }

  function isPeer(record, type) {
    return BTD.peers && BTD.peers.isPeerType ? BTD.peers.isPeerType(record, type || 'size') : !!(record && record.similar_bushnell);
  }

  function buildCache(records, options) {
    records = records || [];
    options = options || {};
    var byShow = {};
    var byCity = {};
    var byWeek = {};
    var byWeekShow = {};
    var byShowVenue = {};
    var bySub = {
      sub: { gross:0, grossCnt:0, capSum:0, capCnt:0 },
      nonsub: { gross:0, grossCnt:0, capSum:0, capCnt:0 }
    };
    var byFY = {};
    var byVenue = {};

    records.forEach(function (d) {
      var show = d.show;
      var city = d.city;
      var date = d.week_of;
      var fy = getFiscalYearSafe(date);
      var fw = date ? fiscalWeek(date) : null;
      var fm = date ? ((parseInt(String(date).slice(5,7), 10) - 7 + 12) % 12) + 1 : null;
      var isSub = d.on_sub === 1 || d.on_sub === true;
      var peer = isPeer(d, options.peerType || 'size');
      var g = d.gross_gross;
      var cp = d.cap_paid;
      var gg = d.gg_pct_gp;
      var hasGross = g != null;
      var hasCap = cp != null;
      var hasGg = gg != null;

      if (show) {
        if (!byShow[show]) byShow[show] = { gross:0, grossCnt:0, ggSum:0, ggCnt:0, capSum:0, capCnt:0, weeks:new Set(), grossValues:[], active:0, dark:0 };
        if (hasGross) { byShow[show].gross += g; byShow[show].grossCnt++; byShow[show].grossValues.push(g); }
        if (hasGg) { byShow[show].ggSum += gg; byShow[show].ggCnt++; }
        if (hasCap) { byShow[show].capSum += cp; byShow[show].capCnt++; }
        if (date) byShow[show].weeks.add(date);
        var hasPerformanceData = hasGross || d.paid_tix != null || d.capacity != null || d.num_perf != null || d.avg_adm != null;
        if (d.no_engagement && !hasPerformanceData) byShow[show].dark++;
        else byShow[show].active++;
      }

      if (city) {
        if (!byCity[city]) byCity[city] = { gross:0, grossCnt:0, capSum:0, capCnt:0 };
        if (hasGross) { byCity[city].gross += g; byCity[city].grossCnt++; }
        if (hasCap) { byCity[city].capSum += cp; byCity[city].capCnt++; }
      }

      if (date) {
        if (!byWeek[date]) byWeek[date] = { gross:0, grossCnt:0, peerCapSum:0, peerCapCnt:0, otherCapSum:0, otherCapCnt:0, allCapSum:0, allCapCnt:0 };
        if (hasGross) { byWeek[date].gross += g; byWeek[date].grossCnt++; }
        if (hasCap) {
          byWeek[date].allCapSum += cp; byWeek[date].allCapCnt++;
          if (peer) { byWeek[date].peerCapSum += cp; byWeek[date].peerCapCnt++; }
          else { byWeek[date].otherCapSum += cp; byWeek[date].otherCapCnt++; }
        }
      }

      if (date && show) {
        var wk = date + '|' + show;
        if (!byWeekShow[wk]) byWeekShow[wk] = { gross:0, grossCnt:0, capSum:0, capCnt:0, venues:[] };
        if (hasGross) { byWeekShow[wk].gross += g; byWeekShow[wk].grossCnt++; }
        if (hasCap) { byWeekShow[wk].capSum += cp; byWeekShow[wk].capCnt++; }
        byWeekShow[wk].venues.push({ theatre:d.theatre, city:city, gross:g, cap:cp, peer:peer });
      }

      if (show && d.theatre) {
        var svk = show + '|' + d.theatre + '|' + city;
        if (!byShowVenue[svk]) byShowVenue[svk] = { show:show, theatre:d.theatre, city:city, gross:0, grossCnt:0, capSum:0, capCnt:0, weeks:0 };
        if (hasGross) { byShowVenue[svk].gross += g; byShowVenue[svk].grossCnt++; }
        if (hasCap) { byShowVenue[svk].capSum += cp; byShowVenue[svk].capCnt++; }
        if (hasGross) byShowVenue[svk].weeks++;
      }

      var subBucket = isSub ? bySub.sub : bySub.nonsub;
      if (hasGross) { subBucket.gross += g; subBucket.grossCnt++; }
      if (hasCap) { subBucket.capSum += cp; subBucket.capCnt++; }

      if (fy && hasGross) {
        if (!byFY[fy]) byFY[fy] = { byFW:{}, byFM:{} };
        if (fw) byFY[fy].byFW[fw] = (byFY[fy].byFW[fw] || 0) + g;
        if (fm) byFY[fy].byFM[fm] = (byFY[fy].byFM[fm] || 0) + g;
      }

      if (d.theatre) {
        var vk = d.theatre + '|' + city;
        if (!byVenue[vk]) byVenue[vk] = { theatre:d.theatre, city:city, gross:0, grossCnt:0, capSum:0, capCnt:0, weeks:0 };
        if (hasGross) { byVenue[vk].gross += g; byVenue[vk].grossCnt++; }
        if (hasCap) { byVenue[vk].capSum += cp; byVenue[vk].capCnt++; }
        byVenue[vk].weeks++;
      }
    });

    return { byShow:byShow, byCity:byCity, byWeek:byWeek, byWeekShow:byWeekShow, byShowVenue:byShowVenue, bySub:bySub, byFY:byFY, byVenue:byVenue };
  }

  function topShowGross(cache, limit, desc) {
    var arr = Object.entries(cache.byShow || {}).filter(function (x) { return x[1].grossCnt > 0; }).map(function (x) { return { _label:x[0], _val:x[1].gross }; }).sort(function (a,b) { return desc === false ? a._val - b._val : b._val - a._val; });
    return arr.slice(0, limit || 10);
  }
  function showVenueBreakdown(cache, show) {
    return Object.values(cache.byShowVenue || {}).filter(function (v) { return v.show === show && v.grossCnt > 0; }).map(function (v) { return { theatre:v.theatre, city:v.city, gross:v.gross, cap:v.capCnt ? v.capSum / v.capCnt : null, wks:v.weeks }; }).sort(function (a,b) { return b.gross - a.gross; });
  }
  function topMarketGross(cache, limit) {
    return Object.entries(cache.byCity || {}).map(function (x) { return { _label:x[0], _val:x[1].gross || 0 }; }).filter(function (d) { return d._val > 0; }).sort(function (a,b) { return b._val - a._val; }).slice(0, limit || 10);
  }
  function topMarketCap(cache, limit) {
    return Object.entries(cache.byCity || {}).filter(function (x) { return x[1].capCnt > 0; }).map(function (x) { return { _label:x[0], _val:x[1].capSum / x[1].capCnt, engagements:x[1].capCnt }; }).sort(function (a,b) { return b._val - a._val; }).slice(0, limit || 10);
  }
  function weekOverWeek(records) {
    records = records || [];
    var weeks = Array.from(new Set(records.map(function (d) { return d.week_of; }).filter(Boolean))).sort();
    if (weeks.length < 2) return { weeks:weeks, rows:[] };
    var w1 = weeks[weeks.length - 2], w2 = weeks[weeks.length - 1];
    var showsW2 = Array.from(new Set(records.filter(function (d) { return d.week_of === w2 && d.gross_gross; }).map(function (d) { return d.show; })));
    var rows = [];
    showsW2.forEach(function (s) {
      var w1rows = records.filter(function (d) { return d.week_of === w1 && d.show === s && d.gross_gross; });
      var w2rows = records.filter(function (d) { return d.week_of === w2 && d.show === s && d.gross_gross; });
      if (!w1rows.length || !w2rows.length) return;
      var g1 = w1rows.reduce(function (a,d) { return a + d.gross_gross; }, 0);
      var g2 = w2rows.reduce(function (a,d) { return a + d.gross_gross; }, 0);
      var caps = w2rows.filter(function (d) { return d.cap_paid; }).map(function (d) { return d.cap_paid; });
      rows.push({ _label:s, _val:((g2 - g1) / g1) * 100, _g2:g2, _cap:avg(caps), _venues:w2rows.length, currentRows:w2rows.slice().sort(function (a,b) { return b.gross_gross - a.gross_gross; }), priorRows:w1rows.slice().sort(function (a,b) { return b.gross_gross - a.gross_gross; }) });
    });
    rows.sort(function (a,b) { return b._val - a._val; });
    return { weeks:weeks, previous:w1, current:w2, rows:rows };
  }
  function theatreSizeBuckets(records) {
    var buckets = [{label:'< 5K',min:0,max:5000},{label:'5–10K',min:5000,max:10000},{label:'10–15K',min:10000,max:15000},{label:'15–20K',min:15000,max:20000},{label:'20K+',min:20000,max:Infinity}];
    return buckets.map(function (b) {
      var items = (records || []).filter(function (d) { return d.capacity && d.cap_paid && d.capacity >= b.min && d.capacity < b.max; });
      return { label:b.label, avgCap:avg(items.map(function (d) { return d.cap_paid; })), avgGross:avg(items.map(function (d) { return d.gross_gross; })), count:items.length };
    });
  }

  function analyticsSeries(cache, options) {
    cache = cache || {};
    options = options || {};
    var FM_LABELS = ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];
    var fiscalYears = Object.keys(cache.byFY || {}).sort();
    var byFY = cache.byFY || {};
    function seasonalityWeek() {
      var byFW = {};
      Object.values(byFY).forEach(function (fy) { Object.entries(fy.byFW || {}).forEach(function (x) { byFW[x[0]] = byFW[x[0]] || []; byFW[x[0]].push(x[1]); }); });
      var keys = Object.keys(byFW).map(Number).sort(function (a,b) { return a - b; });
      return { keys:keys, labels:keys.map(function (w) { return 'Wk ' + w; }), values:keys.map(function (fw) { return avg(byFW[fw]); }) };
    }
    function seasonalityMonth() {
      var byFM = {};
      Object.values(byFY).forEach(function (fy) { Object.entries(fy.byFM || {}).forEach(function (x) { byFM[x[0]] = byFM[x[0]] || []; byFM[x[0]].push(x[1]); }); });
      var keys = Array.from({length:12}, function (_,i) { return i + 1; }).filter(function (fm) { return byFM[fm]; });
      return { keys:keys, labels:keys.map(function (fm) { return FM_LABELS[fm - 1]; }), values:keys.map(function (fm) { return avg(byFM[fm]); }) };
    }
    function yoyWeek() {
      var fwNums = Array.from({length:53}, function (_,i) { return i + 1; });
      return { labels:fwNums.map(function (w) { return 'Wk ' + w; }), fiscalYears:fiscalYears, datasets:fiscalYears.map(function (fy) { var byFW = byFY[fy] && byFY[fy].byFW || {}; return { fiscalYear:fy, data:fwNums.map(function (fw) { return byFW[fw] || null; }) }; }) };
    }
    function yoyMonth() {
      return { labels:FM_LABELS.slice(), fiscalYears:fiscalYears, datasets:fiscalYears.map(function (fy) { var byFM = byFY[fy] && byFY[fy].byFM || {}; return { fiscalYear:fy, data:Array.from({length:12}, function (_,i) { return byFM[i + 1] || null; }) }; }) };
    }
    var longevity = Object.entries(cache.byShow || {}).map(function (x) { return { s:x[0], n:x[1].weeks ? x[1].weeks.size : 0 }; }).filter(function (d) { return d.n > 0; }).sort(function (a,b) { return b.n - a.n; }).slice(0,20);
    var capRank = Object.entries(cache.byShow || {}).filter(function (x) { return x[1].capCnt >= 3; }).map(function (x) { return { s:x[0], avg:x[1].capSum / x[1].capCnt }; }).sort(function (a,b) { return b.avg - a.avg; }).slice(0,15);
    var consistency = Object.entries(cache.byShow || {}).map(function (x) { return [x[0], x[1].grossValues || []]; }).filter(function (x) { return x[1].length >= 5; }).map(function (x) { var mean = avg(x[1]); var sd = Math.sqrt(x[1].map(function (v) { return Math.pow(v - mean, 2); }).reduce(function (a,b) { return a + b; }, 0) / x[1].length); return { s:x[0], cv:(sd / mean) * 100, mean:mean, n:x[1].length }; }).sort(function (a,b) { return a.cv - b.cv; }).slice(0,15);
    var darkWeeks = Object.entries(cache.byShow || {}).filter(function (x) { return x[1].active >= 3 && x[1].dark > 0; }).map(function (x) { var v = x[1]; return { s:x[0], pct:(v.dark / (v.active + v.dark)) * 100, dark:v.dark, active:v.active, total:v.active + v.dark }; }).sort(function (a,b) { return b.pct - a.pct; }).slice(0,15);
    var peerGapWeeks = Object.keys(cache.byWeek || {}).sort();
    return { FM_LABELS:FM_LABELS, fiscalYears:fiscalYears, seasonalityWeek:seasonalityWeek(), seasonalityMonth:seasonalityMonth(), yoyWeek:yoyWeek(), yoyMonth:yoyMonth(), longevity:longevity, capRank:capRank, consistency:consistency, darkWeeks:darkWeeks, peerGap:{ weeks:peerGapWeeks, peer:peerGapWeeks.map(function (w) { var row = cache.byWeek[w]; return row.peerCapCnt ? row.peerCapSum / row.peerCapCnt : null; }), others:peerGapWeeks.map(function (w) { var row = cache.byWeek[w]; return row.otherCapCnt ? row.otherCapSum / row.otherCapCnt : null; }) } };
  }

  function peerSummary(records, peerType, peerMeta, synopses) {
    records = records || [];
    peerType = peerType || 'size';
    peerMeta = peerMeta || {};
    synopses = synopses || {};
    var bushnellData = records.filter(function (d) { return String(d.city || '').toLowerCase() === 'hartford'; });
    var bushnellAvgGross = avg(bushnellData.filter(function (d) { return d.gross_gross; }).map(function (d) { return d.gross_gross; }));
    var bushnellAvgCap = avg(bushnellData.map(function (d) { return d.cap_paid; }));
    var peerStats = {};
    records.filter(function (d) { return isPeer(d, peerType) && String(d.city || '').toLowerCase() !== 'hartford'; }).forEach(function (d) {
      var key = d.theatre;
      if (!key) return;
      if (!peerStats[key]) peerStats[key] = { city:d.city, gross:[], cap:[], shows:new Set() };
      if (d.gross_gross) peerStats[key].gross.push(d.gross_gross);
      if (d.cap_paid) peerStats[key].cap.push(d.cap_paid);
      if (d.show) peerStats[key].shows.add(d.show);
    });
    var rows = Object.entries(peerStats).map(function (x) { var name = x[0], s = x[1], ag = avg(s.gross), ac = avg(s.cap); return { name:name, city:s.city, weeks:s.gross.length + s.cap.length > 0 ? Math.max(s.gross.length, s.cap.length) : 0, avg_gross:ag, avg_cap:ac, shows:s.shows.size, meaningful:s.gross.length >= 10 && ag && bushnellAvgGross && ag / bushnellAvgGross >= 0.5 && ag / bushnellAvgGross <= 2.0 }; }).sort(function (a,b) { return b.weeks - a.weeks; });
    return { bushnell:{ rows:bushnellData, avgGross:bushnellAvgGross, avgCap:bushnellAvgCap }, rows:rows, synopsisVenues:rows.filter(function (v) { return v.meaningful && (synopses[v.name] || (peerMeta[v.name + '|' + v.city] && peerMeta[v.name + '|' + v.city].synopsis)); }), listedVenues:rows.filter(function (v) { return !v.meaningful || !synopses[v.name]; }) };
  }

  BTD.dashboardAnalytics = { buildCache:buildCache, topShowGross:topShowGross, showVenueBreakdown:showVenueBreakdown, topMarketGross:topMarketGross, topMarketCap:topMarketCap, weekOverWeek:weekOverWeek, theatreSizeBuckets:theatreSizeBuckets, analyticsSeries:analyticsSeries, peerSummary:peerSummary };
})(window);
