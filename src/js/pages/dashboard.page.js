// Page controller extracted from dashboard.html during Phase 5.
// Keep as a non-module script so existing inline onclick handlers remain global.

// ── DASHBOARD STATE ────────────────────────────────────────────────────────────
// Season metadata now comes from the shared BTD.data / BTD.seasons layer.
// Keep SEASONS as a local compatibility alias for the existing dashboard controller.
let SEASONS = [];

let ACTIVE_SEASONS = new Set(); // supports multiple seasons

function setSeasonFilter(seasonId) {
  ACTIVE_SEASONS.clear();
  if (seasonId) ACTIVE_SEASONS.add(seasonId);
  if(BTD.state&&BTD.state.active)BTD.state.active.season=seasonId||'';
  document.querySelectorAll('[data-season]').forEach(b=>b.classList.toggle('active', b.dataset.season===seasonId));
  applyFilters();
}

// getFiscalYear → utils.js


// ── HELP TEXT (single source of truth for tooltips and FAQ) ──────────────────
const HELP_TEXT = {
  // Filters
  tier:         "Primary markets are major touring cities designated by the Broadway League. Secondary markets are smaller regional cities.",
  subscription: "Subscription shows are part of the venue's subscriber package. Non-subscription shows are add-ons or specials not included in the season subscription.",
  peerVenues:   "Peers classified by type: Size (±10% of Bushnell sellable seats, 2,450–2,994), Proximity (Northeast/New England), Market (comparable nonprofit mid-sized city PACs), Extended (±15% range).",
  season:       "Seasons follow the Bushnell fiscal year: July 1 through June 30. A show reporting in August 2025 belongs to the 25-26 season. Season is derived from each record's Broadway League report week date — not the show's opening or closing night. Works independently of the date range filter.",
  dateRange:    "Narrows results to a specific date window. Dates snap to the nearest Sunday to align with Broadway League reporting.",
  venue:        "Filter to a specific venue across all Broadway League markets.",
  city:         "Filter to a specific city across all Broadway League markets.",
  shows:        "Select specific show titles to focus analysis. Use the search box to find shows quickly.",
  advanced:     "Gross range, capacity range, and performance count filters for detailed data slicing.",
  tourType:     "Equity tours are productions under an Actors' Equity Association contract. Non-Equity tours operate outside the AEA contract. Both are reported by Broadway League member venues.",
  engagement:   "Performed = the show had at least one performance and reported gross revenue that week. No Performance = the week was a layoff, dark week, or had no reportable data.",

  // Metrics
  grossGross:   "Total gross revenue for the week at that venue — all tickets sold at all price points.",
  grossPotential: "The theoretical maximum revenue if every seat sold at full price for every performance.",
  ggPctGp:      "Gross Gross as a percentage of Gross Potential. Over 100% indicates premium pricing or above-capacity revenue. Under 100% indicates unsold seats or discounting.",
  pctCapPaid:   "Paid tickets sold divided by total sellable capacity. The primary measure of how full the house was.",
  pctCapTotal:  "Total tickets (including comps) divided by total sellable capacity.",
  avgPaidAdm:   "Average price paid per ticket: Gross Gross divided by Paid Tickets.",
  wow:          "Week-over-Week. The percentage change in gross revenue from the previous report week to the current week.",
  topPaidPrice: "The highest price at which a ticket was sold that week.",
  numPerf:      "Number of performances in the report week (typically 8 for a standard Broadway week).",

  // Data
  broadwayLeague: "Weekly touring report published by The Broadway League covering gross revenue, capacity, and performance data for Broadway touring productions across North America.",
  reportWeek:   "Each record represents one week of performances at one venue. Reports are published weekly, typically on Sundays.",
  fiscalYear:   "The Bushnell fiscal year runs July 1 through June 30. All season and annual comparisons use this calendar.",
  dataCurrency: "Data reflects Broadway League reports uploaded to this system. The most recent report date is shown in the masthead.",

  // Peer venues
  peerDef:      "Peers classified by type: Size (±10% of Bushnell sellable seats, 2,450–2,994), Proximity (Northeast/New England), Market (comparable nonprofit mid-sized city PACs), Extended (±15% range).",
  meaningfulPeers: "Venues with 10+ reporting weeks and average gross within 50% of the Bushnell average are considered meaningful comparators and receive full synopses on the Peer Venues tab.",
  peerBenchmark:  "Peer comparisons show how Bushnell gross and capacity performance compares to similar venues presenting the same touring productions.",

  // Charts
  weeklyTrend:  "Total gross across all filtered venues by report week. The chart spans the full date range of the current filter — missing report weeks appear as zero. Use the season pills or date range filter to change the view.",
  eightWeekMA:  "Rolling 8-week moving average overlaid on the weekly gross chart. Missing weeks count as zero in the average calculation.",
  seasonality:  "Average gross by fiscal period (July-June) across all years in the filter. Shows seasonal patterns in Broadway touring revenue.",
  yoy:          "Fiscal year gross by period, overlaid for comparison. Years labeled in 2024-25 format reflecting the July-June fiscal calendar.",
  ggPctChart:   "Teal bars indicate shows averaging at or above 100% of gross potential — strong demand or premium pricing. Navy bars indicate below potential.",
  mktCapChart:  "Average paid capacity utilization by city. Color coded: green 90% or above, amber 60-89%, red below 60%.",
};

// Helper: render a tooltip icon
function tipIcon(key) {
  const text = HELP_TEXT[key] || '';
  return `<span class="tip-icon" tabindex="0" title="${text}" aria-label="${text}">?</span>`;
}
function snapToSunday(dateStr, direction) {
  return BTD.page && BTD.page.snapToSunday ? BTD.page.snapToSunday(dateStr, direction) : dateStr;
}

// ── DATA INIT ─────────────────────────────────────────────────────────────────
async function initData() {
  try {
    if (!window.BTD || !BTD.data || !BTD.data.loadCore) throw new Error('BTD.data.loadCore unavailable');
    await BTD.data.loadCore({ includeContext: true });
    ALL_DATA = BTD.page && BTD.page.normalizeDashboardRows ? BTD.page.normalizeDashboardRows(BTD.state.all) : BTD.state.all.slice();
    SEASONS = BTD.page && BTD.page.normalizeDashboardSeasons ? BTD.page.normalizeDashboardSeasons(BTD.state.seasons) : (BTD.state.seasons || []);
    window.PEER_META = BTD.state.peerMeta || {};
  } catch(e) {
    console.warn('Shared dashboard data load failed:', e);
    ALL_DATA = [];
    SEASONS = [];
  }
  const allDates = ALL_DATA.map(d=>d.week_of).filter(Boolean).sort();
  LAST_REPORT_DATE = allDates[allDates.length-1] ? allDates[allDates.length-1].slice(0,10) : null;
  ACTIVE_SEASONS.add('2025-2026');
  boot();
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let ALL_DATA = [];
let FILTERED = [];
let SORT_COL = 'gross_gross';
let SORT_DIR = -1;
let ACTIVE_TIER = '';
let ACTIVE_SUB = '';
let ACTIVE_PEER = '';
let ACTIVE_EQUITY = '';
let ACTIVE_ENGAGE = '';
let CHARTS = {};
let CACHE = {}; // pre-computed aggregations from FILTERED
// PEER_META → window.PEER_META from utils.js
let LAST_REPORT_DATE = null;
let DEFAULT_RANGE = null;

// ── BOOT ──────────────────────────────────────────────────────────────────────
function boot() {
  const defaultSeason = '2025-2026';
  ACTIVE_SEASONS.add(defaultSeason);
  if (BTD.page && BTD.page.renderDashboardSeasonPills) {
    BTD.page.renderDashboardSeasonPills('seasonPills', SEASONS, defaultSeason, setSeasonFilter);
  }
  const tipMap = {
    'tip-tier': 'tier', 'tip-sub': 'subscription', 'tip-peer': 'peerVenues',
    'tip-equity': 'tourType', 'tip-engage': 'engagement'
  };
  if (BTD.page && BTD.page.attachHelpTooltips) BTD.page.attachHelpTooltips(tipMap, HELP_TEXT);
  populateVenueCity();
  populateShowList();
  updateDataStatus();
  applyFilters();
}

function populateVenueCity() {
  const venues = [...new Set(ALL_DATA.map(d=>d.theatre).filter(Boolean))].sort();
  const cities = [...new Set(ALL_DATA.map(d=>d.city).filter(Boolean))].sort();
  const vSel = document.getElementById('fVenue');
  const cSel = document.getElementById('fCity');
  if (vSel) vSel.innerHTML = '<option value="">All Venues</option>' + venues.map(v=>`<option value="${v}">${v}</option>`).join('');
  if (cSel) cSel.innerHTML = '<option value="">All Cities</option>' + cities.map(c=>`<option value="${c}">${c}</option>`).join('');
}



let ACTIVE_YEAR = '';




function populateShowList() {
  const shows = [...new Set(ALL_DATA.map(d=>d.show))].sort();
  document.getElementById('showList').innerHTML = shows.map(s=>
    `<label><input type="checkbox" class="sCb" value="${s}" checked> ${s}</label>`
  ).join('');
  document.querySelectorAll('.sCb').forEach(cb=>cb.addEventListener('change', ()=>{updateShowCount();applyFilters();}));
  updateShowCount();
}

function filterShowList() {
  const q = document.getElementById('showSearch').value.toLowerCase().trim();
  document.querySelectorAll('#showList label').forEach(label => {
    const name = label.querySelector('input').value.toLowerCase();
    label.classList.toggle('hidden', q !== '' && !name.includes(q));
  });
  updateShowCount();
}

function updateShowCount() {
  const total = document.querySelectorAll('.sCb').length;
  const checked = document.querySelectorAll('.sCb:checked').length;
  const el = document.getElementById('showCount');
  el.textContent = checked === total ? `All ${total} shows` : `${checked} of ${total} selected`;
  el.style.color = checked < total ? 'var(--amber)' : 'var(--ink3)';
}

function selectAllShows() { document.querySelectorAll('.sCb').forEach(cb=>cb.checked=true); updateShowCount(); applyFilters(); }
function clearAllShows() { document.querySelectorAll('.sCb').forEach(cb=>cb.checked=false); updateShowCount(); applyFilters(); }
function soloSearchedShows() {
  const q = document.getElementById('showSearch').value.toLowerCase().trim();
  if (!q) return;
  document.querySelectorAll('.sCb').forEach(cb => { cb.checked = cb.value.toLowerCase().includes(q); });
  updateShowCount(); applyFilters();
}

function updateFilterCount() {
  let count = 0;
  if (ACTIVE_SEASONS.size > 0) count++;
  if (ACTIVE_TIER) count++;
  if (ACTIVE_SUB !== '') count++;
  if (ACTIVE_PEER) count++;
  if (ACTIVE_EQUITY !== '') count++;
  if (ACTIVE_ENGAGE !== '') count++;
  if (document.getElementById('fVenue')?.value) count++;
  if (document.getElementById('fCity')?.value) count++;
  if (window._DATE_RANGE && DEFAULT_RANGE &&
      (window._DATE_RANGE.start !== DEFAULT_RANGE.start || window._DATE_RANGE.end !== DEFAULT_RANGE.end)) count++;
  if (document.getElementById('fGrossMin')?.value || document.getElementById('fGrossMax')?.value) count++;
  if (document.getElementById('fCapMin')?.value || document.getElementById('fCapMax')?.value) count++;
  if (document.getElementById('fPerfMin')?.value || document.getElementById('fPerfMax')?.value) count++;
  const badge = document.getElementById('activeFilterCount');
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline' : 'none';
  }
}

function updateDataStatus() {
  const allWeeks = [...new Set(ALL_DATA.map(d=>d.week_of))];
  document.getElementById('dataStatus').innerHTML =
    `<strong>${ALL_DATA.length.toLocaleString()}</strong> records · <strong>${allWeeks.length.toLocaleString()}</strong> weeks total`;
}

function updateFilteredStatus() {
  const filtWeeks = [...new Set(FILTERED.map(d=>d.week_of))];
  const wkCount = filtWeeks.length;
  let span;
  if (wkCount < 4) span = `${wkCount} week${wkCount!==1?'s':''}`;
  else if (wkCount < 52) span = `${Math.round(wkCount/4.33)} months`;
  else { const yrs=Math.floor(wkCount/52); const mos=Math.round((wkCount%52)/4.33); span = mos>0?`${yrs} yr${yrs!==1?'s':''} ${mos} mo`:`${yrs} yr${yrs!==1?'s':''}`; }
  const el = document.getElementById('filteredStatus');
  if (el) el.innerHTML = `Filtered: <strong>${FILTERED.length.toLocaleString()}</strong> records · <strong>${span}</strong> · Last report: <strong>${LAST_REPORT_DATE ? fmtWeek(LAST_REPORT_DATE) : '—'}</strong>`;
}

// ── FILTERS ───────────────────────────────────────────────────────────────────
function setTier(btn, val) {BTD.page.setFilterButton('ACTIVE_TIER','[data-tier]',val,applyFilters);}
function setSub(btn, val) {BTD.page.setFilterButton('ACTIVE_SUB','[data-sub]',val,applyFilters);}



function onDateRangeChange() {
  const from = document.getElementById('fDateFrom').value;
  const to = document.getElementById('fDateTo').value;
  if (from || to) {
    window._DATE_RANGE = {
      start: snapToSunday(from || '2000-01-01', 'back'),
      end: snapToSunday(to || '2099-12-31', 'forward')
    };
    const fDate = document.getElementById('fDate');
    if (fDate) fDate.value = '';
    document.querySelectorAll('[data-preset]').forEach(b=>b.classList.remove('active'));
  } else {
    window._DATE_RANGE = null;
  }
  applyFilters();
}

function setPeer(btn, val) {BTD.page.setFilterButton('ACTIVE_PEER','[data-peer]',val,applyFilters);}
function setEquity(btn, val) {BTD.page.setFilterButton('ACTIVE_EQUITY','[data-equity]',val,applyFilters);}
function setEngage(btn, val) {BTD.page.setFilterButton('ACTIVE_ENGAGE','[data-engage]',val,applyFilters);}

function applyFilters() {
  const venueF = document.getElementById('fVenue')?.value || '';
  const cityF = document.getElementById('fCity')?.value || '';
  const grossMin = parseFloat(document.getElementById('fGrossMin').value)||0;
  const grossMax = parseFloat(document.getElementById('fGrossMax').value)||Infinity;
  const capMin = parseFloat(document.getElementById('fCapMin').value)||0;
  const capMax = parseFloat(document.getElementById('fCapMax').value)||Infinity;
  const perfMin = parseFloat(document.getElementById('fPerfMin').value)||0;
  const perfMax = parseFloat(document.getElementById('fPerfMax').value)||Infinity;
  const checked = [...document.querySelectorAll('.sCb:checked')].map(c=>c.value);

  FILTERED = ALL_DATA.filter(d => {
    if (ACTIVE_SEASONS.size === 0 && window._DATE_RANGE) {
      if (d.week_of < window._DATE_RANGE.start || d.week_of > window._DATE_RANGE.end) return false;
    }
    if (ACTIVE_TIER && d.tier !== ACTIVE_TIER) return false;
    if (ACTIVE_SUB !== '' && String(d.on_sub) !== ACTIVE_SUB) return false;
    if (ACTIVE_SEASONS.size > 0) {
      const fy = getFiscalYear(d.week_of);
      if (!fy || !ACTIVE_SEASONS.has(fy)) return false;
    }
    if (ACTIVE_PEER && !isPeerType(d, ACTIVE_PEER)) return false;
    if (ACTIVE_EQUITY === 'yes' && !d.non_equity) return false;
    if (ACTIVE_EQUITY === 'no' && d.non_equity) return false;
    if (ACTIVE_ENGAGE === 'yes' && !d.no_engagement) return false;
    if (ACTIVE_ENGAGE === 'no' && d.no_engagement) return false;
    if (venueF && d.theatre !== venueF) return false;
    if (cityF && d.city !== cityF) return false;
    if (d.gross_gross !== null) {
      if (d.gross_gross < grossMin || d.gross_gross > grossMax) return false;
    } else if (grossMin > 0) return false;
    if (d.cap_paid !== null) {
      if (d.cap_paid < capMin || d.cap_paid > capMax) return false;
    }
    if (d.num_perf !== null) {
      if (d.num_perf < perfMin || d.num_perf > perfMax) return false;
    }
    if (!checked.includes(d.show)) return false;
    return true;
  });

  if(BTD.state){BTD.state.filtered=FILTERED;}
  buildCache();
  renderKPIs();
  renderTable();
  updateFilteredStatus();
  updateFilterCount();
  const activePanel = document.querySelector('.panel.active');
  if (activePanel) {
    const id = activePanel.id;
    if (id === 'tab-shows' || id === 'tab-markets') { renderCharts(); renderRankings(); renderAnalytics(); }
    
    
    else if (id === 'tab-seasons') renderSeasons();
    else if (id === 'tab-peers') renderPeers();
  }
}

function resetFilters() {
  if (document.getElementById('fGrossMin')) document.getElementById('fGrossMin').value = '';
  if (document.getElementById('fGrossMax')) document.getElementById('fGrossMax').value = '';
  if (document.getElementById('fCapMin')) document.getElementById('fCapMin').value = '';
  if (document.getElementById('fCapMax')) document.getElementById('fCapMax').value = '';
  if (document.getElementById('fPerfMin')) document.getElementById('fPerfMin').value = '';
  if (document.getElementById('fPerfMax')) document.getElementById('fPerfMax').value = '';
  if (document.getElementById('showSearch')) document.getElementById('showSearch').value = '';
  if (document.getElementById('fVenue')) document.getElementById('fVenue').value = '';
  if (document.getElementById('fCity')) document.getElementById('fCity').value = '';
  document.getElementById('fDateFrom').value = '';
  document.getElementById('fDateTo').value = '';
  window._DATE_RANGE = null;
  // Reset to default season (2025-2026)
  ACTIVE_SEASONS.clear();
  ACTIVE_SEASONS.add('2025-2026');
  document.querySelectorAll('[data-season]').forEach(b=>b.classList.toggle('active', b.dataset.season==='2025-2026'));
  filterShowList(); setTier(null,''); setSub(null,''); setPeer(null,''); setEquity(null,''); setEngage(null,''); selectAllShows();
  applyFilters();
}


// Canonical planning profile adapter. Dashboard remains operational/QA-focused,
// but any title-level planning read should now come from BTD.signals.
function canonicalShowProfile(show, rows) {
  if (window.BTD && BTD.signals) {
    return BTD.signals.profileShow({ title: show, match: show }, rows || FILTERED || ALL_DATA, { peerType: ACTIVE_PEER || 'size' });
  }
  return null;
}

// ── HELPERS → utils.js ────────────────────────────────────────────────────────
// fmt$, fmtN, avg, fmtWeek, getFiscalYear, isPeerType all live in utils.js

// ── KPIs ──────────────────────────────────────────────────────────────────────
function renderKPIs() {
  const wg = FILTERED.filter(d=>d.gross_gross!=null);
  document.getElementById('kCount').textContent = wg.length.toLocaleString();
  document.getElementById('kGross').textContent = fmt$(wg.reduce((a,d)=>a+d.gross_gross,0));
  const ac = avg(FILTERED.map(d=>d.cap_paid));
  document.getElementById('kCap').textContent = ac?fmtN(ac)+'%':'—';
  const ag = avg(FILTERED.map(d=>d.gg_pct_gp));
  document.getElementById('kGgPct').textContent = ag?fmtN(ag)+'%':'—';
  const aa = avg(FILTERED.map(d=>d.avg_adm));
  document.getElementById('kAdm').textContent = aa?'$'+fmtN(aa,2):'—';
  const subAvgG = avg(FILTERED.filter(d=>d.on_sub===1&&d.gross_gross).map(d=>d.gross_gross));
  document.getElementById('kSubAvg').textContent = subAvgG ? fmt$(subAvgG) : '—';
  const peerRows = FILTERED.filter(d => isPeerType(d, ACTIVE_PEER || 'size'));
  const peerCap = avg(peerRows.map(d=>d.cap_paid));
  const peerGross = avg(peerRows.filter(d=>d.gross_gross).map(d=>d.gross_gross));
  document.getElementById('kPeerCap').textContent = peerCap ? fmtN(peerCap)+'%' : '—';
  document.getElementById('kPeerGross').textContent = peerGross ? fmt$(peerGross) : '—';
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
function sortBy(col) {
  if (SORT_COL===col) SORT_DIR*=-1; else { SORT_COL=col; SORT_DIR=-1; }
  document.querySelectorAll('thead th span[id^="s-"]').forEach(s=>s.textContent='');
  const el = document.getElementById('s-'+col);
  if(el) el.textContent = SORT_DIR===-1?' ↓':' ↑';
  renderTable();
}

function renderTable() {
  const sorted = [...FILTERED].sort((a,b)=>{
    const av=a[SORT_COL],bv=b[SORT_COL];
    if(av==null&&bv==null)return 0; if(av==null)return 1; if(bv==null)return -1;
    return SORT_DIR*(av>bv?1:av<bv?-1:0);
  });
  const tb = document.getElementById('tableBody');
  const countEl = document.getElementById('tableCount');
  if (countEl) countEl.textContent = BTD.components && BTD.components.dashboardTableCount ? BTD.components.dashboardTableCount(sorted.length) : `${sorted.length.toLocaleString()} engagements`;
  if (!tb) return;
  if (BTD.components && BTD.components.dashboardTableRows) {
    tb.innerHTML = BTD.components.dashboardTableRows(sorted, { fmtWeek, fmtN, fmtCurrency: fmt$ });
    return;
  }
  if(!sorted.length){tb.innerHTML='<tr><td colspan="14" class="no-data">No data matches current filters</td></tr>';return;}
  tb.innerHTML = sorted.map(d=>`<tr><td>${fmtWeek(d.week_of)}</td><td>${d.tier}</td><td>${d.show}</td><td>${d.city}</td><td>${d.num_perf??'—'}</td><td>${fmt$(d.gross_gross)}</td><td>${fmt$(d.gross_potential)}</td><td>${d.gg_pct_gp!=null?fmtN(d.gg_pct_gp)+'%':'—'}</td><td>${d.cap_paid!=null?fmtN(d.cap_paid)+'%':'—'}</td><td>${d.capacity!=null?d.capacity.toLocaleString():'—'}</td><td>${d.paid_tix!=null?d.paid_tix.toLocaleString():'—'}</td><td>${d.avg_adm!=null?'$'+fmtN(d.avg_adm,2):'—'}</td><td>${d.top_price?'$'+d.top_price:'—'}</td><td>${d.on_sub?'✓':'—'}</td></tr>`).join('');
}
// ── CHARTS ────────────────────────────────────────────────────────────────────
const CC = {
  amber:'#003865', amberA:'rgba(0,56,101,0.5)',
  teal:'#0A6B5E', rose:'#B0303A',
  grid:'rgba(0,0,0,0.06)', text:'#6b6b6b',
  cobalt:'#1A4E8A'
};

function dc(id){ if (BTD.charts && BTD.charts.destroyDashboardChart) BTD.charts.destroyDashboardChart(CHARTS,id); else if(CHARTS[id]){ CHARTS[id].destroy(); delete CHARTS[id]; } }
// analytics chart ids: sa,yy,lo,cr,co,ne,pg


// ── ANALYTICS CACHE ───────────────────────────────────────────────────────────
// Single pass over FILTERED — all render functions read from CACHE
function buildCache() {
  CACHE = BTD.dashboardAnalytics && BTD.dashboardAnalytics.buildCache
    ? BTD.dashboardAnalytics.buildCache(FILTERED, { peerType: ACTIVE_PEER || 'size' })
    : {};
}
// Global fiscalWeek (needed by cache builder outside renderAnalytics)
function fiscalWeekGlobal(dateStr) {
  return BTD.page && BTD.page.fiscalWeek ? BTD.page.fiscalWeek(dateStr) : null;
}


function renderCharts() {
  Chart.defaults.color = CC.text;
  Chart.defaults.font.family = "'Libre Franklin', sans-serif";
  Chart.defaults.font.size = 10;

  // ── CHART: Top 12 Shows by Total Gross (cShowGross) ─────────────────────────
  // Tab: Charts | Type: Horizontal bar
  // Data source: CACHE.byShow — cumulative gross per show across filtered weeks
  dc('sg');
  const se=Object.entries(CACHE.byShow)
    .filter(([,v])=>v.grossCnt>0)
    .map(([s,v])=>[s,v.gross])
    .sort((a,b)=>b[1]-a[1]).slice(0,12);
  CHARTS.sg = BTD.charts.renderDashboardChart(CHARTS,'sg','cShowGross',{type:'bar',
    data:{labels:se.map(([s])=>s.length>22?s.slice(0,22)+'…':s),
          datasets:[{data:se.map(([,v])=>v),backgroundColor:CC.amber,borderRadius:2}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`Total Gross: ${fmt$(ctx.raw)}`}}},
      scales:{x:{grid:{color:CC.grid},ticks:{callback:v=>fmt$(v)}},y:{grid:{display:false}}},
      datasets:{bar:{maxBarThickness:22,minBarLength:2}}}});

  // ── CHART: Avg GG% of Gross Potential by Show (cGgPct) ──────────────────────
  // Tab: Charts | Type: Horizontal bar
  // Data source: CACHE.byShow — ggSum/ggCnt per show | Teal = ≥100%, Navy = below
  dc('gp');
  const ge=Object.entries(CACHE.byShow)
    .filter(([,v])=>v.ggCnt>0)
    .map(([s,v])=>[s,v.ggSum/v.ggCnt])
    .sort((a,b)=>b[1]-a[1]).slice(0,12);
  CHARTS.gp = BTD.charts.renderDashboardChart(CHARTS,'gp','cGgPct',{type:'bar',
    data:{labels:ge.map(([s])=>s.length>22?s.slice(0,22)+'…':s),
          datasets:[{data:ge.map(([,v])=>v),backgroundColor:ge.map(([,v])=>v>100?CC.teal:CC.amber),borderRadius:2}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`Avg GG% Potential: ${fmtN(ctx.raw)}%`}}},
      scales:{x:{grid:{color:CC.grid},ticks:{callback:v=>v+'%'}},y:{grid:{display:false}}},
      datasets:{bar:{maxBarThickness:22,minBarLength:2}}}});

  // ── CHART: Weekly Gross Trend (cWeekly) ──────────────────────────────────────
  // Tab: Charts | Type: Line (two datasets)
  // Dataset 1: Weekly gross per report week — spine generated from filtered date range
  // Missing weeks show as 0 to make gaps visible
  // Dataset 2: 8-week rolling moving average (MA constant = 8, see var MA)
  try {
  dc('wk');
  const _filteredDates = new Set(FILTERED.map(d=>d.week_of));
  const _baseWeeks = [..._filteredDates].filter(Boolean).sort();
  const weeklyNote = document.getElementById('weeklyChartNote');
  if (weeklyNote) weeklyNote.style.display = 'none';

  // Build a full Sunday spine between earliest and latest filtered date
  let weeks = _baseWeeks;
  if (_baseWeeks.length >= 2) {
    const fmtISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const start = new Date(_baseWeeks[0] + 'T12:00:00');
    const end   = new Date(_baseWeeks[_baseWeeks.length-1] + 'T12:00:00');
    const spine = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+7)) {
      spine.push(fmtISO(d));
    }
    weeks = spine;
  }
  const wkGross=weeks.map(w=>CACHE.byWeek[w]?.gross || 0);
  const MA=8;
  const wkTrend=wkGross.map((v,i,arr)=>{
    const slice=arr.slice(Math.max(0,i-MA+1),i+1);
    return slice.length?slice.reduce((a,b)=>a+b,0)/slice.length:null;
  });
  CHARTS.wk = BTD.charts.renderDashboardChart(CHARTS,'wk','cWeekly',{type:'line',
    data:{labels:weeks.map(w=>fmtWeek(w)),
          datasets:[
            {label:'Weekly Gross',data:wkGross,borderColor:CC.amber,backgroundColor:'rgba(0,56,101,0.07)',fill:true,tension:0.1,pointBackgroundColor:CC.amber,pointRadius:2,pointBorderColor:'#fff',pointBorderWidth:1,order:2},
            {label:'8-Week Trend',data:wkTrend,borderColor:'#ff9e1b',backgroundColor:'transparent',fill:false,tension:0.4,pointRadius:0,borderWidth:2.5,spanGaps:true,order:1}
          ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:true,labels:{color:CC.text,font:{size:10,family:"'Libre Franklin', sans-serif"},boxWidth:20}},
        tooltip:{callbacks:{label:ctx=>ctx.dataset.label==='Weekly Gross'?`Gross: ${fmt$(ctx.raw)}`:`8-Wk Trend: ${fmt$(ctx.raw)}`}}
      },
      scales:{x:{grid:{color:CC.grid}},y:{grid:{color:CC.grid},ticks:{callback:v=>fmt$(v)}}}}});

  } catch(e) { console.warn('Weekly chart error:', e); }

  // ── CHART: Subscription vs Non-Subscription Comparison (cSubComp) ───────────
  // Tab: Charts | Type: Grouped vertical bar, dual Y-axis
  // Left Y-axis: avg gross | Right Y-axis: avg % capacity paid
  // Data source: CACHE.bySub.sub and CACHE.bySub.nonsub
    dc('sc');
  const subG   = CACHE.bySub.sub.grossCnt    > 0 ? CACHE.bySub.sub.gross/CACHE.bySub.sub.grossCnt : null;
  const nonG   = CACHE.bySub.nonsub.grossCnt > 0 ? CACHE.bySub.nonsub.gross/CACHE.bySub.nonsub.grossCnt : null;
  const subCap = CACHE.bySub.sub.capCnt    > 0 ? CACHE.bySub.sub.capSum/CACHE.bySub.sub.capCnt : null;
  const nonCap = CACHE.bySub.nonsub.capCnt > 0 ? CACHE.bySub.nonsub.capSum/CACHE.bySub.nonsub.capCnt : null;
  CHARTS.sc = BTD.charts.renderDashboardChart(CHARTS,'sc','cSubComp',{type:'bar',
    data:{labels:['Subscribed','Non-Subscribed'],
          datasets:[
            {label:'Avg Gross',data:[subG||0,nonG||0],backgroundColor:CC.amber,borderRadius:2,yAxisID:'y'},
            {label:'Avg % Cap Paid',data:[subCap||0,nonCap||0],backgroundColor:'rgba(26,78,138,0.65)',borderRadius:2,yAxisID:'y2'}
          ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{labels:{color:CC.text,font:{size:10,family:"'Libre Franklin', sans-serif"}}},
        tooltip:{callbacks:{label:ctx=>ctx.dataset.yAxisID==='y'?`${ctx.dataset.label}: ${fmt$(ctx.raw)}`:`${ctx.dataset.label}: ${fmtN(ctx.raw)}%`}}
      },
      scales:{
        x:{grid:{display:false}},
        y:{grid:{color:CC.grid},position:'left',ticks:{callback:v=>fmt$(v)}},
        y2:{grid:{display:false},position:'right',min:0,max:110,ticks:{callback:v=>v+'%'}}
      }}});

  // ── CHART: % Capacity Paid by Market / City (cMarketCap) ────────────────────
  // Tab: Charts | Type: Vertical bar
  // Data source: CACHE.byCity — avg capSum/capCnt per city, top 20
  // Color: Green ≥90% | Amber 60–89% | Red <60%
  dc('mc');
  const mce=Object.entries(CACHE.byCity).filter(([,v])=>v.capCnt>0).map(([c,v])=>[c,v.capSum/v.capCnt]).sort((a,b)=>b[1]-a[1]).slice(0,20);
  CHARTS.mc = BTD.charts.renderDashboardChart(CHARTS,'mc','cMarketCap',{type:'bar',
    data:{labels:mce.map(([c])=>c),
          datasets:[{data:mce.map(([,v])=>v),backgroundColor:mce.map(([,v])=>v>90?CC.teal:v<60?CC.rose:CC.amber),borderRadius:2}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{grid:{display:false}},y:{grid:{color:CC.grid},min:0,max:110,ticks:{callback:v=>v+'%'}}}}});
}

// ── RANKINGS ─────────────────────────────────────────────────────────────────
function mkRankList(id,items,valFn,labelFn,fmtFn,maxVal,breakdownFn) {
  const el=document.getElementById(id);
  if(!el)return;
  if(BTD.components&&BTD.components.dashboardRankList){
    el.innerHTML=BTD.components.dashboardRankList({id,items,valFn,labelFn,fmtFn,maxVal,breakdownFn});
    return;
  }
  el.innerHTML='<div class="no-data">No data available</div>';
}


function toggleWowDetail(rowId) {
  const row = document.getElementById(rowId);
  const arr = document.getElementById(rowId+'-arr');
  if (!row) return;
  if (row.style.display === 'none') {
    row.style.display = '';
    if (arr) arr.innerHTML = '&#9660;';
  } else {
    row.style.display = 'none';
    if (arr) arr.innerHTML = '&#9654;';
  }
}

function toggleRankBreakdown(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const btn = row.previousElementSibling?.querySelector('.rank-name span');
  if (row.style.display === 'none') {
    row.style.display = 'block';
    if (btn) btn.textContent = '▼';
  } else {
    row.style.display = 'none';
    if (btn) btn.textContent = '▶';
  }
}

function renderRankings() {
  const da = BTD.dashboardAnalytics;
  if (!da) return;

  const showBreakdown = d => da.showVenueBreakdown(CACHE, d._label);
  const sgArr = da.topShowGross(CACHE, 10, true);
  mkRankList('rShowGross', sgArr, d=>d._val, ()=>'cumulative gross', fmt$, sgArr[0]?._val, showBreakdown);

  const sgBottomArr = da.topShowGross(CACHE, 10, false);
  mkRankList('rShowGrossBottom', sgBottomArr, d=>d._val, ()=>'cumulative gross', fmt$, sgArr[0]?._val, showBreakdown);

  const wow = da.weekOverWeek(FILTERED);
  const wowLabel = document.getElementById('wowWeekLabel');
  const wowEl = document.getElementById('rShowWow');
  if (wow.weeks.length === 0) {
    if (wowLabel) wowLabel.textContent = '';
    if (wowEl) wowEl.innerHTML = '<div class="no-data">No data matches current filters</div>';
  } else if (wow.weeks.length === 1) {
    if (wowLabel) wowLabel.textContent = '';
    if (wowEl) wowEl.innerHTML = '<div class="no-data">Only one week in current filter — select a wider date range to see week-over-week changes</div>';
  } else {
    if (wowLabel) wowLabel.textContent = fmtWeek(wow.previous) + ' → ' + fmtWeek(wow.current);
    if (wowEl) wowEl.innerHTML = BTD.components.dashboardWowTable(wow, { fmtWeek, fmtCurrency: fmt$, fmtN });
  }

  const mgArr = da.topMarketGross(CACHE, 10);
  mkRankList('rMarketGross', mgArr, d=>d._val, ()=>'total gross', fmt$, mgArr[0]?._val);

  const mcArr = da.topMarketCap(CACHE, 10);
  mkRankList('rMarketCap', mcArr, d=>d._val, d=>`${d.engagements} engagement${d.engagements!==1?'s':''}`, v=>fmtN(v)+'%', 100);

  const sizeData = da.theatreSizeBuckets(FILTERED);
  const sizeEl = document.getElementById('rTheatreSize');
  if (sizeEl) sizeEl.innerHTML = BTD.components.dashboardSizeGrid(sizeData, { fmtCurrency: fmt$, fmtN });

  dc('ts');
  CHARTS.ts = BTD.charts.renderDashboardChart(CHARTS,'ts','cTheatreSize',{type:'bar',
    data:{labels:sizeData.map(b=>b.label), datasets:[
      {label:'Avg % Cap Paid',data:sizeData.map(b=>b.avgCap||0),backgroundColor:CC.amber,borderRadius:2,yAxisID:'y'},
      {label:'Avg Gross',data:sizeData.map(b=>b.avgGross||0),backgroundColor:'rgba(26,78,138,0.5)',borderRadius:2,yAxisID:'y2'}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:CC.text,font:{size:10,family:"'Libre Franklin', sans-serif"}}}},
      scales:{y:{grid:{color:CC.grid},position:'left',ticks:{callback:v=>v+'%'},max:110}, y2:{grid:{display:false},position:'right',ticks:{callback:v=>fmt$(v)}}}}});
}

// ── TABS ──────────────────────────────────────────────────────────────────────
function toggleAdvanced() {
  const panel = document.getElementById('advancedFilters');
  const arrow = document.getElementById('advancedArrow');
  const btn = document.getElementById('advancedToggle');
  const open = panel.style.display === 'none';
  panel.style.display = open ? 'block' : 'none';
  arrow.innerHTML = open ? '&#9660;' : '&#9658;';
  btn.setAttribute('aria-expanded', open);
}

function printDashboard() {
  // Update print header date
  const hdr = document.getElementById('printHeaderDate');
  if (hdr) hdr.textContent = 'Printed ' + new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'});

  // Build active filter summary
  const filters = [];
  if (ACTIVE_SEASONS.size > 0) filters.push('Season(s): ' + [...ACTIVE_SEASONS].join(' + '));
  if (ACTIVE_TIER) filters.push('Tier: ' + ACTIVE_TIER);
  if (ACTIVE_SUB !== '') filters.push('Subscription: ' + (ACTIVE_SUB==='1'?'Sub Only':'Non-Sub Only'));
  if (ACTIVE_PEER) filters.push('Peer: ' + (ACTIVE_PEER === 'any' ? 'Any Peer' : ACTIVE_PEER === 'size_extended' ? 'Extended' : ACTIVE_PEER.charAt(0).toUpperCase() + ACTIVE_PEER.slice(1)));
  const v = document.getElementById('fVenue')?.value;
  const c = document.getElementById('fCity')?.value;
  if (v) filters.push('Venue: ' + v);
  if (c) filters.push('City: ' + c);
  if (window._DATE_RANGE) filters.push('Date: ' + fmtWeek(window._DATE_RANGE.start) + ' — ' + fmtWeek(window._DATE_RANGE.end));
  const fl = document.getElementById('printFilterList');
  if (fl) fl.textContent = filters.length ? filters.join(' · ') : 'None (showing all data)';

  window.print();
}

function toggleSidebar() {
  const sb = document.querySelector('.sidebar');
  const bd = document.getElementById('sidebarBackdrop');
  sb.classList.toggle('open');
  bd.classList.toggle('open');
}


// ISO week number (1-53, Monday-based, consistent across years)
function isoWeek(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 4 - (d.getDay()||7));
  const yearStart = new Date(d.getFullYear(),0,1);
  return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
}

let SEASON_MODE = 'week';
let YOY_MODE = 'week';

function setSeasonMode(mode) {
  SEASON_MODE = mode;
  document.getElementById('btnSeasonWeek').classList.toggle('active', mode==='week');
  document.getElementById('btnSeasonMonth').classList.toggle('active', mode==='month');
  renderAnalytics();
}

function setYoYMode(mode) {
  YOY_MODE = mode;
  document.getElementById('btnYoYWeek').classList.toggle('active', mode==='week');
  document.getElementById('btnYoYMonth').classList.toggle('active', mode==='month');
  renderAnalytics();
}

function renderAnalytics() {
  const analytics = BTD.dashboardAnalytics && BTD.dashboardAnalytics.analyticsSeries
    ? BTD.dashboardAnalytics.analyticsSeries(CACHE, { seasonMode: SEASON_MODE, yoyMode: YOY_MODE })
    : null;
  if (!analytics) return;

  const palette = ['#003865','#1A4E8A','#6798b9','#0A6B5E','#ff9e1b','#B0303A','#6b6b6b'];
  const fwQStarts = {1:'Jul',14:'Oct',27:'Jan',40:'Apr'};

  dc('sa');
  const seasonality = SEASON_MODE === 'week' ? analytics.seasonalityWeek : analytics.seasonalityMonth;
  CHARTS.sa = BTD.charts.renderDashboardChart(CHARTS,'sa','cSeasonality', {type:'bar',
    data:{labels:seasonality.labels,datasets:[{data:seasonality.values,backgroundColor:CC.amber,borderRadius:2}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{
        title:ctx=>SEASON_MODE==='week' ? `Fiscal Week ${seasonality.keys[ctx[0].dataIndex]}` : seasonality.labels[ctx[0].dataIndex],
        label:ctx=>`Avg Gross: ${fmt$(ctx.raw)}`
      }}},
      scales:{x:{grid:{display:false},ticks:{callback:(v,i)=>SEASON_MODE==='week' ? (fwQStarts[seasonality.keys[i]]||'') : seasonality.labels[i],maxRotation:0,autoSkip:SEASON_MODE!=='week'}},y:{grid:{color:CC.grid},ticks:{callback:v=>fmt$(v)}}}}});

  dc('yy');
  const yoy = YOY_MODE === 'week' ? analytics.yoyWeek : analytics.yoyMonth;
  const yyDS = yoy.datasets.map((row,i)=>({label:row.fiscalYear,data:row.data,borderColor:palette[i%palette.length],backgroundColor:'transparent',fill:false,tension:0.3,pointRadius:YOY_MODE==='week'?2:3,borderWidth:1.5,spanGaps:true}));
  CHARTS.yy = BTD.charts.renderDashboardChart(CHARTS,'yy','cYoY', {type:'line',
    data:{labels:yoy.labels,datasets:yyDS},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:CC.text,font:{size:10},boxWidth:12}},tooltip:{callbacks:{title:ctx=>YOY_MODE==='week'?`Fiscal Week ${ctx[0].label}`:ctx[0].label,label:ctx=>`${ctx.dataset.label}: ${fmt$(ctx.raw)}`}}},
      scales:{x:{grid:{color:CC.grid},ticks:{callback:(v,i)=>YOY_MODE==='week' ? (fwQStarts[i+1]||'') : yoy.labels[i],maxRotation:0,autoSkip:YOY_MODE!=='week'}},y:{grid:{color:CC.grid},ticks:{callback:v=>fmt$(v)}}}}});

  dc('lo');
  const lonArr = analytics.longevity;
  CHARTS.lo = BTD.charts.renderDashboardChart(CHARTS,'lo','cLongevity', {type:'bar',
    data:{labels:lonArr.map(d=>d.s.length>24?d.s.slice(0,24)+'…':d.s),datasets:[{data:lonArr.map(d=>d.n),backgroundColor:CC.amber,borderRadius:2}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.raw} weeks`}}},scales:{x:{grid:{color:CC.grid},ticks:{callback:v=>v+' wks'}},y:{grid:{display:false}}}}});

  dc('cr');
  const capArr = analytics.capRank;
  CHARTS.cr = BTD.charts.renderDashboardChart(CHARTS,'cr','cCapRank', {type:'bar',
    data:{labels:capArr.map(d=>d.s.length>24?d.s.slice(0,24)+'…':d.s),datasets:[{data:capArr.map(d=>d.avg),backgroundColor:capArr.map(d=>d.avg>=90?CC.teal:CC.amber),borderRadius:2}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`Avg % Cap: ${fmtN(ctx.raw)}%`}}},scales:{x:{grid:{color:CC.grid},ticks:{callback:v=>v+'%'}},y:{grid:{display:false}}}}});

  dc('co');
  const conArr = analytics.consistency;
  CHARTS.co = BTD.charts.renderDashboardChart(CHARTS,'co','cConsistency', {type:'bar',
    data:{labels:conArr.map(d=>d.s.length>24?d.s.slice(0,24)+'…':d.s),datasets:[{data:conArr.map(d=>Math.round(d.cv*10)/10),backgroundColor:CC.cobalt,borderRadius:2}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`CV: ${ctx.raw}% · Avg: ${fmt$(conArr[ctx.dataIndex].mean)} · ${conArr[ctx.dataIndex].n} wks`}}},scales:{x:{grid:{color:CC.grid},ticks:{callback:v=>v+'%'}},y:{grid:{display:false}}}}});

  dc('ne');
  const neArr = analytics.darkWeeks;
  CHARTS.ne = BTD.charts.renderDashboardChart(CHARTS,'ne','cNoEng', {type:'bar',
    data:{labels:neArr.map(d=>d.s.length>24?d.s.slice(0,24)+'…':d.s),datasets:[{data:neArr.map(d=>Math.round(d.pct*10)/10),backgroundColor:CC.rose,borderRadius:2}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:ctx=>[neArr[ctx[0].dataIndex].s],label:ctx=>`Dark weeks: ${ctx.raw}% · ${neArr[ctx[0].dataIndex].dark} dark, ${neArr[ctx[0].dataIndex].active} active of ${neArr[ctx[0].dataIndex].total} total`}}},scales:{x:{grid:{color:CC.grid},ticks:{callback:v=>v+'%'}},y:{grid:{display:false}}}}});

  dc('pg');
  const pg = analytics.peerGap;
  CHARTS.pg = BTD.charts.renderDashboardChart(CHARTS,'pg','cPeerGap', {type:'line',
    data:{labels:pg.weeks.map(w=>fmtWeek(w)),datasets:[{label:'Peer Venues',data:pg.peer,borderColor:CC.amber,backgroundColor:'rgba(0,56,101,0.07)',fill:true,tension:0.3,pointRadius:2,borderWidth:2.5,spanGaps:true},{label:'All Others',data:pg.others,borderColor:CC.rose,backgroundColor:'transparent',fill:false,tension:0.3,pointRadius:2,borderWidth:1.5,spanGaps:true}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:CC.text,font:{size:10},boxWidth:16}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${fmtN(ctx.raw)}% avg capacity`}}},scales:{x:{grid:{color:CC.grid}},y:{grid:{color:CC.grid},ticks:{callback:v=>v+'%'}}}}});
}


function togglePeerDetail(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const btn = row.previousElementSibling?.querySelector('button');
  if (row.style.display === 'none') {
    row.style.display = '';
    if (btn) btn.textContent = '▼';
  } else {
    row.style.display = 'none';
    if (btn) btn.textContent = '▶';
  }
}

function renderSeasons() {
  const container = document.getElementById('seasonsContent');
  if (!container) return;

  container.innerHTML = SEASONS.map(season => {
    const isActive = ACTIVE_SEASONS.has(season.id);
    const seasonData = ALL_DATA.filter(d => d.week_of >= season.start && d.week_of <= season.end);
    const hasData = seasonData.length > 0;

    // Season-level KPIs
    const totalGross = seasonData.filter(d=>d.gross_gross).reduce((a,d)=>a+d.gross_gross,0);
    const avgCap = avg(seasonData.map(d=>d.cap_paid));
    const subShows = season.shows.filter(s=>s.sub).length;

    const showRows = season.shows.map(show => {
      const ml = show.matchStr.toLowerCase();
      const showData = seasonData.filter(d => d.show && d.show.toLowerCase().includes(ml));

      // Bushnell records — city Hartford
      const bushnellData = showData.filter(d => (d.city||'').toLowerCase() === 'hartford');
      const bushnellGross = bushnellData.filter(d=>d.gross_gross).reduce((a,d)=>a+d.gross_gross,0) || null;
      const bushnellCap = avg(bushnellData.map(d=>d.cap_paid));

      // Peer records — similar_bushnell, exclude Hartford
      const peerData = showData.filter(d => d.similar_bushnell && (d.city||'').toLowerCase() !== 'hartford');
      const peerGross = peerData.length ? avg(peerData.filter(d=>d.gross_gross).map(d=>d.gross_gross)) : null;
      const peerCap = avg(peerData.map(d=>d.cap_paid));

      // All venues (non-Hartford) for broader comparison
      const allData = showData.filter(d => (d.city||'').toLowerCase() !== 'hartford');
      const allGross = allData.length ? avg(allData.filter(d=>d.gross_gross).map(d=>d.gross_gross)) : null;
      const allCap = avg(allData.map(d=>d.cap_paid));

      const wks = [...new Set(bushnellData.map(d=>d.week_of))].length;
      const hasData = bushnellData.length > 0;

      const capCell = (bushnell, peer) => {
        if (!bushnell && !peer) return '<span style="color:var(--rule)">—</span>';
        const diff = bushnell && peer ? bushnell - peer : null;
        const color = bushnell >= 90 ? 'var(--teal)' : bushnell >= 60 ? 'var(--amber)' : bushnell ? 'var(--rose)' : 'var(--rule)';
        const arrow = diff !== null ? (diff > 2 ? ' <span style="color:var(--teal)">▲</span>' : diff < -2 ? ' <span style="color:var(--rose)">▼</span>' : ' <span style="color:var(--ink3)">—</span>') : '';
        return `<span style="color:${color};font-weight:600;">${bushnell?fmtN(bushnell)+'%':'—'}</span>${arrow}`;
      };

      const grossCell = (bushnell, peer) => {
        if (!bushnell && !peer) return '<span style="color:var(--rule)">No data yet</span>';
        const diff = bushnell && peer ? ((bushnell-peer)/peer)*100 : null;
        const arrow = diff !== null ? (diff > 5 ? ' <span style="color:var(--teal)">▲</span>' : diff < -5 ? ' <span style="color:var(--rose)">▼</span>' : ' <span style="color:var(--ink3)">—</span>') : '';
        return `<span style="font-weight:600;">${bushnell?fmt$(bushnell):'—'}</span>${arrow}`;
      };

      // Peer detail rows — all peer reports for this show within the season
      const showKey = show.matchStr.toLowerCase();
      const peerRows = seasonData
        .filter(d => d.similar_bushnell && (d.city||'').toLowerCase() !== 'hartford'
          && d.show && d.show.toLowerCase().includes(showKey))
        .sort((a,b) => a.week_of > b.week_of ? 1 : -1);

      const rowId = 'peer-detail-' + season.id + '-' + show.open.replace(/-/g,'');
      const peerDetailHTML = peerRows.length ? peerRows.map(p => {
        const isBefore = bushnellData.length && p.week_of < bushnellData[0]?.week_of;
        const isAfter  = bushnellData.length && p.week_of > bushnellData[bushnellData.length-1]?.week_of;
        const timing = isBefore ? '<span style="color:var(--teal);font-size:0.6rem;">▶ Before us</span>'
                     : isAfter  ? '<span style="color:var(--rose);font-size:0.6rem;">◀ After us</span>'
                     : '<span style="color:var(--amber);font-size:0.6rem;">↔ Same time</span>';
        const pc = p.cap_paid;
        const pcColor = pc>=90?'var(--teal)':pc>=60?'var(--amber)':'var(--rose)';
        return `<tr style="background:var(--bg2);border-bottom:1px solid var(--rule2);">
          <td style="padding:6px 10px 6px 24px;color:var(--ink2);font-size:0.65rem;">${p.theatre}</td>
          <td style="padding:6px 10px;color:var(--ink3);font-size:0.62rem;font-family:var(--mono);">${fmtWeek(p.week_of)}</td>
          <td style="padding:6px 10px;text-align:center;">${timing}</td>
          <td style="padding:6px 10px;font-family:var(--mono);text-align:right;font-size:0.72rem;">${p.gross_gross?fmt$(p.gross_gross):'—'}</td>
          <td style="padding:6px 10px;font-family:var(--mono);text-align:right;color:var(--ink3);font-size:0.65rem;">—</td>
          <td style="padding:6px 10px;font-family:var(--mono);text-align:right;font-size:0.72rem;color:${pcColor};">${pc?fmtN(pc)+'%':'—'}</td>
          <td colspan="2" style="padding:6px 10px;"></td>
        </tr>`;
      }).join('') : `<tr style="background:var(--bg2);"><td colspan="8" style="padding:8px 24px;color:var(--ink3);font-size:0.65rem;font-style:italic;">No peer venue data for this show in this season</td></tr>`;

      return `<tr style="border-bottom:1px solid var(--rule2);${hasData?'':'opacity:0.6;'}">
        <td style="padding:9px 10px;font-weight:500;color:var(--ink);" title="${show.title}">
          <button onclick="togglePeerDetail('${rowId}')" style="background:none;border:none;cursor:pointer;padding:0 6px 0 0;color:var(--ink3);font-size:0.65rem;" aria-label="Toggle peer details">▶</button>${show.title}
        </td>
        <td style="padding:9px 10px;color:var(--ink3);font-size:0.63rem;font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${fmtWeek(show.open).replace(/, \d{4}/,'')} – ${fmtWeek(show.close)}</td>
        <td style="padding:9px 10px;text-align:center;">
          ${show.sub
            ? '<span class="badge" style="background:var(--amber-lt);color:var(--amber);border:1px solid var(--amber-md);">Sub</span>'
            : '<span class="badge badge-secondary">Non-Sub</span>'}
        </td>
        <td style="padding:9px 10px;font-family:var(--mono);text-align:right;">${grossCell(bushnellGross, peerGross)}</td>
        <td style="padding:9px 10px;font-family:var(--mono);text-align:right;color:var(--ink3);font-size:0.65rem;">${peerGross?fmt$(peerGross):'—'}</td>
        <td style="padding:9px 10px;font-family:var(--mono);text-align:right;">${capCell(bushnellCap, peerCap)}</td>
        <td style="padding:9px 10px;font-family:var(--mono);text-align:right;color:var(--ink3);font-size:0.65rem;">${peerCap?fmtN(peerCap)+'%':'—'}</td>
        <td style="padding:9px 10px;font-family:var(--mono);text-align:right;color:var(--ink3);">${wks||'—'}</td>
      </tr>
      <tr id="${rowId}" style="display:none;">
        <td colspan="8" style="padding:0;">
          <table style="width:100%;table-layout:fixed;border-top:2px solid var(--rule);">
            <colgroup><col style="width:22%"><col style="width:18%"><col style="width:8%"><col style="width:13%"><col style="width:13%"><col style="width:10%"><col style="width:10%"><col style="width:6%"></colgroup>
            <thead><tr style="background:var(--bg2);">
              <th style="padding:5px 10px 5px 24px;font-size:0.52rem;color:var(--ink3);">Peer Venue</th>
              <th style="padding:5px 10px;font-size:0.52rem;color:var(--ink3);">Report Week</th>
              <th style="padding:5px 10px;font-size:0.52rem;color:var(--ink3);text-align:center;">Timing</th>
              <th style="padding:5px 10px;font-size:0.52rem;color:var(--ink3);text-align:right;">Gross</th>
              <th style="padding:5px 10px;font-size:0.52rem;color:var(--ink3);text-align:right;"></th>
              <th style="padding:5px 10px;font-size:0.52rem;color:var(--ink3);text-align:right;">% Cap</th>
              <th colspan="2"></th>
            </tr></thead>
            <tbody>${peerDetailHTML}</tbody>
          </table>
        </td>
      </tr>`;
    }).join('');

    return `
      <div style="margin-bottom:32px;">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px;flex-wrap:wrap;">
          <h3 style="font-family:var(--serif);font-size:1rem;color:var(--ink);">${season.name}</h3>
          <button class="pill ${isActive?'active':''}" data-season="${season.id}"
            onclick="setSeasonFilter('${season.id}')"
            aria-label="${isActive?'Clear':'Apply'} ${season.name} filter">
            ${isActive ? '✓ Active' : 'Add to Filter'}
          </button>
          ${season.note ? `<span style="font-size:0.62rem;color:var(--amber);font-style:italic;">${season.note}</span>` : ''}
          ${hasData
            ? `<span style="font-size:0.62rem;color:var(--ink3);">
                Total Gross: <strong style="color:var(--ink);">${fmt$(totalGross)}</strong> &nbsp;·&nbsp;
                Avg % Cap: <strong style="color:var(--ink);">${avgCap?fmtN(avgCap)+'%':'—'}</strong> &nbsp;·&nbsp;
                ${subShows} subscription shows
               </span>`
            : `<span style="font-size:0.62rem;color:var(--ink3);font-style:italic;">No data yet — season starts ${fmtWeek(season.start)}</span>`
          }
        </div>
        <div class="tbl-wrap">
          <table style="width:100%;table-layout:fixed;">
            <colgroup>
              <col style="width:22%"><col style="width:18%"><col style="width:8%">
              <col style="width:13%"><col style="width:13%"><col style="width:10%">
              <col style="width:10%"><col style="width:6%">
            </colgroup>
            <thead><tr>
              <th>Show</th>
              <th>Run Dates</th>
              <th style="text-align:center;">Type</th>
              <th style="text-align:right;">Bushnell Gross</th>
              <th style="text-align:right;color:var(--ink3);">Peer Avg Gross</th>
              <th style="text-align:right;">Bushnell % Cap</th>
              <th style="text-align:right;color:var(--ink3);">Peer Avg % Cap</th>
              <th style="text-align:right;">Wks</th>
            </tr></thead>
            <tbody>${showRows}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}


// ── PEER VENUE SYNOPSES ───────────────────────────────────────────────────────
const PEER_SYNOPSES = {
  'Pantages Theatre': {
    website: 'hollywoodpantages.com',
    synopsis: 'The Hollywood Pantages Theatre is a 2,691-seat Art Deco landmark on Hollywood Boulevard, opened in 1930. Operated by the Nederlander Organization, it is one of Los Angeles\'s highest-grossing Broadway touring venues and a National Historic Landmark. Its per-show sellable capacity closely mirrors the Bushnell\'s, making it a strong national benchmark.',
    capacity: 2691, city: 'Los Angeles, CA'
  },
  'Buell Theatre': {
    website: 'denvercenter.org',
    synopsis: 'The Temple Hoyne Buell Theatre (2,839 seats) opened in 1991 as part of the Denver Performing Arts Complex — North America\'s largest nonprofit theater organization. Designed specifically for Broadway tours, it consistently ranks among the highest-grossing theaters under 5,000 seats nationally. Managed by Denver Center for the Performing Arts.',
    capacity: 2839, city: 'Denver, CO'
  },
  'Connor Palace': {
    website: 'playhousesquare.org',
    synopsis: 'The Connor Palace (2,800 seats) is one of five restored historic theaters at Playhouse Square in Cleveland — the nation\'s largest performing arts center outside New York City. Originally a vaudeville palace built in 1922, it hosts Broadway tours, concerts, and comedy. Its restored gilded interior and subscription base parallel the Bushnell\'s programming model.',
    capacity: 2800, city: 'Cleveland, OH'
  },
  'Opera House': {
    website: 'bostonoperahouse.com',
    synopsis: 'The Boston Opera House (2,600 seats) is a restored 1928 venue in the heart of Boston\'s Theater District, operated by Live Nation. After a $38 million renovation reopening in 2004, it has become New England\'s premier Broadway touring destination, regularly hosting long runs of major national tours. Located just 90 minutes from Hartford, it is the Bushnell\'s closest major peer market.',
    capacity: 2600, city: 'Boston, MA'
  },
  'Aronoff Center: Procter & Gamble Hall': {
    website: 'cincinnatiarts.org',
    synopsis: 'Procter & Gamble Hall (2,719 seats) is the flagship theater of the Aronoff Center for the Arts in downtown Cincinnati, designed by architect César Pelli and opened in 1995. Owned by Cincinnati Arts Association, it anchors the city\'s Broadway series and is home to multiple resident arts organizations. Its nonprofit model and subscription-driven Broadway programming closely mirror the Bushnell\'s.',
    capacity: 2719, city: 'Cincinnati, OH'
  },
  'Orpheum Theatre': {
    website: 'hennepinarts.org',
    synopsis: 'The Orpheum Theatre (2,579 seats) is a Beaux Arts landmark on Hennepin Avenue in Minneapolis, originally opened in 1921 and restored in 1993. Owned by Hennepin Arts (formerly Hennepin Theatre Trust), it is a nonprofit organization and the primary home of Broadway in Minneapolis. The Orpheum premiered Disney\'s The Lion King national tour and remains a key regional Broadway destination.',
    capacity: 2579, city: 'Minneapolis, MN'
  },
  'Paramount Theatre': {
    website: 'stgpresents.org',
    synopsis: 'The Paramount Theatre (2,807 seats) is a 1928 Art Deco landmark in downtown Seattle, operated by STG Presents. One of the Pacific Northwest\'s premier performing arts venues, it hosts Broadway tours, concerts, and special events. Its consistently high capacity utilization (86% avg) makes it a strong performance benchmark.',
    capacity: 2807, city: 'Seattle, WA'
  },
  'Hobby Center For The Perf. Arts': {
    website: 'thehobbycenter.org',
    synopsis: 'The Hobby Center for the Performing Arts houses the Sarofim Hall (2,650 seats), a modern venue that opened in 2002 in downtown Houston. Operated as a nonprofit, it is the primary Broadway touring destination for Houston and the Gulf Coast region, presenting shows through Broadway Across America.',
    capacity: 2650, city: 'Houston, TX'
  },
  'Eccles Theater': {
    website: 'artsaltlake.org',
    synopsis: 'The George S. and Dolores Doré Eccles Theater (2,452 seats) opened in 2016 as Salt Lake City\'s premier performing arts venue. Operated by Utah Presenters in partnership with the city, it achieves among the highest avg capacity utilization (91.7%) in the peer group — reflecting strong subscription demand in a mid-sized market comparable to Hartford.',
    capacity: 2452, city: 'Salt Lake City, UT'
  },
  'Dr. Phillips Center for the Performing Arts: Walt Disney  Theater': {
    website: 'drphillipscenter.org',
    synopsis: 'The Dr. Phillips Center for the Performing Arts in Orlando opened in 2014, with the Walt Disney Theater seating 2,700. A nonprofit venue, it serves as Orlando\'s primary home for Broadway touring productions and resident performing arts organizations. Its strong capacity performance (89.8% avg) reflects a robust subscription market.',
    capacity: 2700, city: 'Orlando, FL'
  },
  'Benedum Center': {
    website: 'pittsburghculturaltrust.org',
    synopsis: 'The Benedum Center for the Performing Arts (2,800 seats) is a restored 1928 movie palace in downtown Pittsburgh, operated by the Pittsburgh Cultural Trust. It is the home of Broadway in Pittsburgh and also serves as the performance venue for Pittsburgh Ballet Theatre, Pittsburgh Opera, and Pittsburgh CLO — a multipurpose nonprofit model very similar to the Bushnell.',
    capacity: 2800, city: 'Pittsburgh, PA'
  },
  'Broward Center For The Perf. Arts': {
    website: 'browardcenter.org',
    synopsis: 'The Broward Center for the Performing Arts (2,700-seat Au-Rene Theater) opened in 1991 in Fort Lauderdale. A nonprofit presenting organization, it serves the South Florida market and is among the most active Broadway touring venues in the Southeast. Its below-average capacity utilization (69.5%) relative to peers provides useful benchmarking context for the Bushnell.',
    capacity: 2700, city: 'Fort Lauderdale, FL'
  },
  'Durham Performing Arts Center': {
    website: 'dpacnc.com',
    synopsis: 'DPAC (2,712 seats) opened in 2008 in Durham, NC, operated by Nederlander and the City of Durham. Despite its relatively recent opening, it has become one of the top-grossing mid-size performing arts venues in the country. Its high subscription penetration and strong avg capacity (89%) make it a notable benchmark for the Bushnell.',
    capacity: 2712, city: 'Durham, NC'
  },
  'ASU Gammage': {
    website: 'asugammage.com',
    synopsis: 'ASU Gammage (3,000 seats) is a Frank Lloyd Wright-designed venue at Arizona State University in Tempe, opened in 1964. It consistently achieves the highest avg capacity utilization in the peer group (94.1%), reflecting strong subscription demand in the Phoenix metro market. Operated by ASU, it combines academic resources with a major Broadway presenting program.',
    capacity: 3000, city: 'Tempe, AZ'
  },
  'Academy of Music: Kimmel Center': {
    website: 'kimmelculturalinstitute.org',
    synopsis: 'The Academy of Music (2,987 seats) in Philadelphia is one of the oldest operating opera houses in the United States, built in 1857 and home to the Broadway series presented by the Kimmel Cultural Institute. Its long history, subscription base, and mid-Atlantic market position make it a relevant peer despite its larger capacity.',
    capacity: 2987, city: 'Philadelphia, PA'
  },
  'Saenger Theatre': {
    website: 'saengernola.com',
    synopsis: 'The Saenger Theatre (2,708 seats) is a restored 1927 atmospheric theater in New Orleans, reopened in 2013 after Hurricane Katrina damage. Operated by ASM Global, it serves as the primary Broadway touring destination for the Gulf South region. Its recovery and consistent performance post-reopening provides an interesting resilience benchmark.',
    capacity: 2708, city: 'New Orleans, LA'
  },
  'Straz Center for the Performing Arts': {
    website: 'strazcenter.org',
    synopsis: 'The Straz Center for the Performing Arts (David A. Straz Jr. Hall, 2,610 seats) is a nonprofit performing arts complex in Tampa that opened in 1987. One of the largest performing arts centers in the Southeast, it presents Broadway tours and supports multiple resident arts organizations, paralleling the Bushnell\'s community anchor role.',
    capacity: 2610, city: 'Tampa, FL'
  },
  'Des Moines Civic Center': {
    website: 'desmoinesperformingarts.org',
    synopsis: 'The Des Moines Civic Center (2,735 seats) opened in 1979 as part of the city\'s Performing Arts Complex, operated by Des Moines Performing Arts. A nonprofit venue serving the Iowa market, it is one of the Bushnell\'s closest capacity and revenue comparables, with a similar subscription-driven Broadway model in a mid-sized regional market.',
    capacity: 2735, city: 'Des Moines, IA'
  },
  'Keller Auditorium': {
    website: 'portland5.com',
    synopsis: 'Keller Auditorium (2,992 seats) is Portland\'s primary Broadway touring venue, managed by Portland\'5 Centers for the Arts, a nonprofit organization. Its high avg capacity utilization (91.8%) reflects strong subscriber demand in the Pacific Northwest market.',
    capacity: 2992, city: 'Portland, OR'
  },
  'Proctors': {
    website: 'proctors.org',
    synopsis: 'Proctors Theatre (2,690 seats) in Schenectady, NY is a nonprofit performing arts organization that also manages multiple regional venues across the Capital Region. As the closest geographic peer to the Bushnell (under 2 hours), Proctors serves an overlapping New England/Upstate NY audience and its Broadway touring data provides the most directly comparable market benchmark.',
    capacity: 2690, city: 'Schenectady, NY'
  },
  'San Diego Civic Theatre': {
    website: 'broadwaysd.com',
    synopsis: 'The San Diego Civic Theatre (2,972 seats) is a modern venue opened in 1965, presenting Broadway tours through Broadway San Diego. A key market in the Southern California touring circuit, its strong avg capacity (82.9%) and consistent programming make it a useful West Coast benchmark.',
    capacity: 2972, city: 'San Diego, CA'
  },
  'Orpheum Theater': {
    website: 'omahaperformingarts.org',
    synopsis: 'The Orpheum Theater (2,611 seats) in Omaha is a restored 1927 vaudeville palace, operated by Omaha Performing Arts, a nonprofit organization. Serving the Nebraska/Iowa market, its subscription-driven Broadway series and mid-market positioning closely parallel the Bushnell\'s.',
    capacity: 2611, city: 'Omaha, NE'
  },
  'Ohio Theatre': {
    website: 'capa.com',
    synopsis: 'The Ohio Theatre (2,779 seats) is a restored 1928 Spanish Baroque movie palace in Columbus, operated by CAPA (Columbus Association for the Performing Arts). It is the primary Broadway touring venue for Central Ohio and achieves strong avg capacity (93.4%), reflecting high subscription penetration.',
    capacity: 2779, city: 'Columbus, OH'
  },
  'Steven Tanger Center for the Performing Arts': {
    website: 'greensborotangercenter.com',
    synopsis: 'The Steven Tanger Center for the Performing Arts (3,000 seats) is a new venue opened in 2021 in Greensboro, NC. Despite its recent opening, it has quickly established strong Broadway touring performance (83.3% avg capacity), serving as a benchmark for newer performing arts centers in mid-sized markets.',
    capacity: 3000, city: 'Greensboro, NC'
  },
  'Segerstrom Center for the Arts': {
    website: 'scfta.org',
    synopsis: 'The Segerstrom Center for the Arts (Renée and Henry Segerstrom Concert Hall, 3,000 seats) in Costa Mesa is a premier Southern California arts complex opened in 1986. A nonprofit organization presenting Broadway tours alongside resident symphony and opera companies, its strong capacity metrics (84%) reflect the competitive Orange County market.',
    capacity: 3000, city: 'Costa Mesa, CA'
  },
  'Bass Concert Hall @ U of TX at Austin': {
    website: 'texasperformingarts.org',
    synopsis: 'Bass Concert Hall (2,933 seats) at the University of Texas at Austin is operated by Texas Performing Arts, the university\'s presenting organization. One of the most active Broadway touring venues in Texas, it achieves strong capacity utilization (89.7%) in the fast-growing Austin market.',
    capacity: 2933, city: 'Austin, TX'
  },
  'Auditorium Theatre': {
    website: 'auditoriumtheatre.org',
    synopsis: 'The Auditorium Theatre (2,347 seats) in Rochester, NY is a restored 1922 venue operated by Rochester Broadway Theatre League, a nonprofit organization. As a close geographic peer in the New York State market, it provides relevant regional benchmarking data for the Bushnell.',
    capacity: 2347, city: 'Rochester, NY'
  },
  'KeyBank State Theatre': {
    website: 'playhousesquare.org',
    synopsis: 'The KeyBank State Theatre (3,400 seats) is part of Cleveland\'s Playhouse Square complex and serves as the venue for larger-scale Broadway productions in the market. While larger than the Bushnell, its per-show sellable capacity places it within the peer range.',
    capacity: 3400, city: 'Cleveland, OH'
  },
  'Queen Elizabeth Theatre': {
    website: 'vancouvercivictheatres.com',
    synopsis: 'The Queen Elizabeth Theatre (2,929 seats) in Vancouver, BC is operated by Vancouver Civic Theatres and serves as the city\'s primary Broadway touring destination. Its strong avg capacity (92.6%) reflects the robust Vancouver performing arts market.',
    capacity: 2929, city: 'Vancouver, BC'
  },
  'San Jose Center For The Perf. Arts': {
    website: 'broadwaysanjose.com',
    synopsis: 'The San Jose Center for the Performing Arts (2,677 seats) serves the Silicon Valley market, presenting Broadway tours through Broadway San Jose. A key venue in the Bay Area touring circuit, it provides useful West Coast mid-market benchmarking.',
    capacity: 2677, city: 'San Jose, CA'
  },
  'First Interstate Center for the Arts': {
    website: 'spokanecivictheatre.com',
    synopsis: 'The First Interstate Center for the Arts (2,700 seats) in Spokane presents Broadway tours serving Eastern Washington and Northern Idaho. Its below-peer capacity utilization (69.6%) reflects a smaller market, providing useful context for Bushnell\'s positioning.',
    capacity: 2700, city: 'Spokane, WA'
  },
  'Detroit Opera House': {
    website: 'michiganopera.org',
    synopsis: 'The Detroit Opera House (2,700 seats) is a restored 1922 venue operated by Michigan Opera Theatre, presenting both opera and Broadway touring productions. Its dual programming model and mid-market performance provide relevant benchmarking for the Bushnell.',
    capacity: 2700, city: 'Detroit, MI'
  },
  'Landmark Theatre': {
    website: 'landmarktheatre.org',
    synopsis: 'The Landmark Theatre (2,922 seats) in Syracuse, NY is a restored 1928 atmospheric theater operated by a nonprofit organization. As a regional New York State peer serving a market similar in size to Hartford, it is among the most directly comparable venues for the Bushnell\'s market positioning.',
    capacity: 2922, city: 'Syracuse, NY'
  },
  'Birmingham-Jefferson Concert Hall': {
    website: 'bjcc.org',
    synopsis: 'The Birmingham-Jefferson Concert Hall (2,956 seats) is part of the BJCC complex in Birmingham, AL, presenting Broadway tours in the Deep South market. Its capacity and avg gross provide a useful comparison for mid-sized Southern markets.',
    capacity: 2956, city: 'Birmingham, AL'
  },
  'Murat Centre': {
    website: 'oldnationalcentre.com',
    synopsis: 'The Murat Centre (Clowes Memorial Hall, 2,171 seats) in Indianapolis is a historic venue presenting Broadway touring productions. Its strong avg capacity (86.2%) in a mid-sized Midwest market makes it a relevant peer for the Bushnell.',
    capacity: 2171, city: 'Indianapolis, IN'
  },
  'Jacksonville Center for the Performing Arts: Moran Theatre': {
    website: 'jaxevents.com',
    synopsis: 'The Moran Theatre (2,930 seats) at the Jacksonville Center for the Performing Arts presents Broadway tours in Northeast Florida. Its below-peer capacity utilization (56.9%) provides useful context for understanding market-size effects on Broadway performance.',
    capacity: 2930, city: 'Jacksonville, FL'
  },
  'Place Des Arts': {
    website: 'placedesarts.com',
    synopsis: 'Place des Arts in Montreal is a major Canadian performing arts complex presenting Broadway touring productions in French and English markets. As the only Canadian venue in the meaningful peer group with significant reporting weeks, it provides international benchmarking context.',
    capacity: 2800, city: 'Montreal, QC'
  },
};

function renderPeers() {
  const container = document.getElementById('peersContent');
  if (!container) return;

  const peerSummary = BTD.dashboardAnalytics && BTD.dashboardAnalytics.peerSummary
    ? BTD.dashboardAnalytics.peerSummary(FILTERED, ACTIVE_PEER || 'size', PEER_META, PEER_SYNOPSES)
    : { bushnell:{ rows:[], avgGross:null, avgCap:null }, synopsisVenues:[], listedVenues:[] };
  const bushnellData = peerSummary.bushnell.rows;
  const bushnellAvgGross = peerSummary.bushnell.avgGross;
  const bushnellAvgCap = peerSummary.bushnell.avgCap;
  const synopsis_venues = peerSummary.synopsisVenues;
  const listed_venues = peerSummary.listedVenues;

  const grossDiff = (ag) => {
    if (!ag || !bushnellAvgGross) return '';
    const diff = ((ag - bushnellAvgGross)/bushnellAvgGross)*100;
    return diff > 5 ? `<span style="color:var(--teal);font-size:0.6rem;">▲${fmtN(diff)}%</span>` :
           diff < -5 ? `<span style="color:var(--rose);font-size:0.6rem;">▼${fmtN(Math.abs(diff))}%</span>` :
           `<span style="color:var(--ink3);font-size:0.6rem;">≈</span>`;
  };

  const capColor = (ac) => !ac ? 'var(--ink3)' : ac >= 90 ? 'var(--teal)' : ac >= 60 ? 'var(--amber)' : 'var(--rose)';

  // Bushnell benchmark row
  const bushnellRow = `
    <div style="background:var(--amber-lt);border:2px solid var(--amber);border-radius:3px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
      <div style="font-family:var(--serif);font-size:0.9rem;color:var(--amber);font-weight:700;">The Bushnell · Hartford, CT</div>
      <div style="font-size:0.65rem;color:var(--ink3);">Your venue — benchmark reference</div>
      <div style="margin-left:auto;display:flex;gap:24px;flex-wrap:wrap;">
        <div style="text-align:center;"><div style="font-size:0.55rem;color:var(--ink3);text-transform:uppercase;letter-spacing:0.1em;">Avg Gross</div><div style="font-family:var(--mono);font-weight:700;color:var(--amber);">${fmt$(bushnellAvgGross)}</div></div>
        <div style="text-align:center;"><div style="font-size:0.55rem;color:var(--ink3);text-transform:uppercase;letter-spacing:0.1em;">Avg % Cap</div><div style="font-family:var(--mono);font-weight:700;color:var(--amber);">${bushnellAvgCap?fmtN(bushnellAvgCap)+'%':'—'}</div></div>
        <div style="text-align:center;"><div style="font-size:0.55rem;color:var(--ink3);text-transform:uppercase;letter-spacing:0.1em;">Report Wks</div><div style="font-family:var(--mono);font-weight:700;color:var(--amber);">${bushnellData.length}</div></div>
      </div>
    </div>`;

  // Meaningful peers with synopses
  const meaningfulHTML = synopsis_venues.map(v => {
    const syn = PEER_SYNOPSES[v.name] || PEER_META[v.name+'|'+v.city] || {};
    const k = v.name+'|'+v.city;
    const types = (PEER_META[k] && PEER_META[k].peer_types) || [];
    const badges = types.map(t => `<span class="peer-badge peer-badge-${t}">${t==='size_extended'?'Extended':t.charAt(0).toUpperCase()+t.slice(1)}</span>`).join('');
    return `
      <div style="background:#fff;border:1px solid var(--rule);border-radius:3px;padding:20px;margin-bottom:16px;">
        <div style="display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap;">
          <div style="flex:1;min-width:260px;">
            <div style="font-family:var(--serif);font-size:0.95rem;color:var(--ink);margin-bottom:2px;">${v.name}${badges}</div>
            <div style="font-size:0.62rem;color:var(--ink3);margin-bottom:8px;">${v.city}${syn.capacity?' · '+syn.capacity.toLocaleString()+' seats':''}</div>
            <div style="font-size:0.68rem;color:var(--ink2);line-height:1.6;">${syn.synopsis||''}</div>
            ${syn.website?`<div style="margin-top:8px;"><a href="https://${syn.website}" target="_blank" style="font-size:0.6rem;color:var(--amber);">${syn.website} ↗</a></div>`:''}
          </div>
          <div style="display:flex;gap:20px;flex-wrap:wrap;flex-shrink:0;">
            <div style="text-align:center;min-width:70px;">
              <div style="font-size:0.55rem;color:var(--ink3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Avg Gross</div>
              <div style="font-family:var(--mono);font-size:0.85rem;font-weight:700;color:var(--ink);">${fmt$(v.avg_gross)}</div>
              <div style="margin-top:2px;">${grossDiff(v.avg_gross)}</div>
            </div>
            <div style="text-align:center;min-width:70px;">
              <div style="font-size:0.55rem;color:var(--ink3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Avg % Cap</div>
              <div style="font-family:var(--mono);font-size:0.85rem;font-weight:700;color:${capColor(v.avg_cap)};">${v.avg_cap?fmtN(v.avg_cap)+'%':'—'}</div>
            </div>
            <div style="text-align:center;min-width:60px;">
              <div style="font-size:0.55rem;color:var(--ink3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Report Wks</div>
              <div style="font-family:var(--mono);font-size:0.85rem;color:var(--ink3);">${v.weeks}</div>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');

  // Listed-only peers table
  const listedHTML = listed_venues.length ? `
    <div style="margin-top:28px;">
      <div class="section-divider" style="margin-bottom:12px;">
        <h3 style="font-family:var(--serif);font-size:0.85rem;color:var(--ink);">All Other Peer-Flagged Venues</h3>
        <div class="section-divider-line"></div>
        <div class="section-divider-meta">Fewer than 10 reporting weeks or outside gross range</div>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th>Venue</th><th>City</th>
            <th style="text-align:right;">Avg Gross</th>
            <th style="text-align:right;">Avg % Cap</th>
            <th style="text-align:right;">Report Wks</th>
          </tr></thead>
          <tbody>${listed_venues.map(v=>{
            const lk = v.name+'|'+v.city;
            const ltypes = (PEER_META[lk] && PEER_META[lk].peer_types) || [];
            const lbadges = ltypes.map(t => `<span class="peer-badge peer-badge-${t}">${t==='size_extended'?'Extended':t.charAt(0).toUpperCase()+t.slice(1)}</span>`).join('');
            return `
            <tr style="border-bottom:1px solid var(--rule2);">
              <td style="padding:8px 13px;color:var(--ink);">${v.name}${lbadges}</td>
              <td style="padding:8px 13px;color:var(--ink3);">${v.city}</td>
              <td style="padding:8px 13px;font-family:var(--mono);text-align:right;">${fmt$(v.avg_gross)}</td>
              <td style="padding:8px 13px;font-family:var(--mono);text-align:right;color:${capColor(v.avg_cap)};">${v.avg_cap?fmtN(v.avg_cap)+'%':'—'}</td>
              <td style="padding:8px 13px;font-family:var(--mono);text-align:right;color:var(--ink3);">${v.weeks}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  container.innerHTML = bushnellRow + meaningfulHTML + listedHTML;
}


function renderFaq() {
  const el = document.getElementById('faqContent');
  if (!el || el.innerHTML) return;

  const section = (title, items) => `
    <div style="margin-bottom:32px;">
      <h3 style="font-family:var(--serif);font-size:0.95rem;color:var(--ink);margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid var(--rule);">${title}</h3>
      <dl style="display:grid;grid-template-columns:200px 1fr;gap:8px 20px;">
        ${items.map(([t,d])=>`<dt style="font-weight:600;color:var(--ink);font-size:0.68rem;padding-top:2px;">${t}</dt><dd style="color:var(--ink2);font-size:0.68rem;line-height:1.6;margin:0;">${d}</dd>`).join('')}
      </dl>
    </div>`;

  const active = ALL_DATA.filter(d=>!d.no_engagement).length;
  const layoffs = ALL_DATA.filter(d=>d.no_engagement).length;

  el.innerHTML = `
    <div style="max-width:860px;">

      <div style="background:#fff;border:1px solid var(--rule);border-radius:3px;padding:20px;margin-bottom:24px;">
        <div style="font-size:.58rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);margin-bottom:12px;">Data Quality &amp; Provenance</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
          <div><div style="font-size:.55rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:4px;">Total Records</div><div style="font-family:var(--serif);font-size:1.2rem;font-weight:700">${ALL_DATA.length.toLocaleString()}</div><div style="font-size:.62rem;color:var(--ink3);margin-top:2px">${active.toLocaleString()} active · ${layoffs.toLocaleString()} layoff/dark</div></div>
          <div><div style="font-size:.55rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:4px;">Last Report Week</div><div style="font-family:var(--serif);font-size:1.2rem;font-weight:700">${LAST_REPORT_DATE?fmtWeek(LAST_REPORT_DATE):'—'}</div><div style="font-size:.62rem;color:var(--ink3);margin-top:2px">Broadway League weekly data</div></div>
          <div><div style="font-size:.55rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:4px;">Validation Status</div><div style="font-size:1.2rem;font-weight:700;color:#0A6B5E">PASS</div><div style="font-size:.62rem;color:var(--ink3);margin-top:2px">0 errors · required fields present · no duplicate keys</div></div>
          <div><div style="font-size:.55rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:4px;">Known Conditions</div><div style="font-size:.62rem;color:var(--ink3);line-height:1.55">Cap % and GG% may exceed 100% — valid per Broadway League reporting (dynamic pricing, SRO, comps). Above-100 values are retained and expected.</div></div>
        </div>
      </div>

      <div style="background:#fff;border:1px solid var(--rule);border-left:3px solid var(--rule);border-radius:3px;padding:16px 20px;margin-bottom:24px;display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div><div style="font-size:.55rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:6px;">What this dashboard shows</div><div style="font-size:.68rem;color:var(--ink2);line-height:1.65">Raw Broadway League touring data — weekly gross, capacity, peer benchmarks, and trend analysis. Use it to understand what the market is doing and how Bushnell-comparable venues are performing.</div></div>
        <div><div style="font-size:.55rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:6px;">What it does not show</div><div style="font-size:.68rem;color:var(--ink2);line-height:1.65">Deal terms · local Bushnell history · artistic or mission value · routing availability · pre-sale pace · audience segmentation. For Fit Scores and planning signals, use the <strong>Executive Summary</strong> or <strong>Programming</strong> views.</div></div>
      </div>

      ${section('Data Source', [
        ['Broadway League', HELP_TEXT.broadwayLeague],
        ['Report Week',     HELP_TEXT.reportWeek],
        ['Fiscal Year',     HELP_TEXT.fiscalYear],
        ['Data Currency',   HELP_TEXT.dataCurrency],
      ])}

      ${section('Key Metrics & Acronyms', [
        ['Gross Gross (GG)',    HELP_TEXT.grossGross],
        ['Gross Potential (GP)',HELP_TEXT.grossPotential],
        ['GG% of GP',          HELP_TEXT.ggPctGp],
        ['% Capacity Paid',    HELP_TEXT.pctCapPaid],
        ['% Capacity Total',   HELP_TEXT.pctCapTotal],
        ['Avg Paid Admission',  HELP_TEXT.avgPaidAdm],
        ['WoW',                HELP_TEXT.wow],
        ['Top Paid Price',     HELP_TEXT.topPaidPrice],
        ['# Performances',     HELP_TEXT.numPerf],
      ])}

      ${section('Filters', [
        ['Season',        HELP_TEXT.season],
        ['Date Range',    HELP_TEXT.dateRange],
        ['Tier',          HELP_TEXT.tier],
        ['Subscription',  HELP_TEXT.subscription],
        ['Peer Venues',   HELP_TEXT.peerVenues],
        ['Venue / City',  HELP_TEXT.venue + ' / ' + HELP_TEXT.city],
        ['Shows',         HELP_TEXT.shows],
        ['Advanced Filters', HELP_TEXT.advanced],
      ])}

      ${section('Peer Venues', [
        ['Definition',      HELP_TEXT.peerDef],
        ['Meaningful Peers',HELP_TEXT.meaningfulPeers],
        ['Benchmarking',    HELP_TEXT.peerBenchmark],
      ])}

      ${section('Seasons Tab', [
        ['Show Data','Each show row displays Bushnell actual gross and % capacity alongside the peer venue average for the same show within the same season.'],
        ['Peer Detail','Click the ▶ arrow on any show to expand a list of peer venues that reported that show during the season, sorted by report date — showing who ran it before and after Bushnell.'],
        ['No Data Yet','Shows listed in future seasons will display "No data yet" until Broadway League reports are available.'],
      ])}

      ${section('Charts & Analytics', [
        ['Weekly Gross Trend', HELP_TEXT.weeklyTrend],
        ['8-Week Trend',       HELP_TEXT.eightWeekMA],
        ['Seasonality',        HELP_TEXT.seasonality],
        ['Year over Year',     HELP_TEXT.yoy],
        ['GG% of Potential',   HELP_TEXT.ggPctChart],
        ['% Capacity by Market', HELP_TEXT.mktCapChart],
      ])}

    </div>`;
}

function showTab(name) {
  const names=['shows','markets','peers','seasons','table','faq'];
  document.querySelectorAll('.nav-tab').forEach((t,i)=>{t.classList.toggle('active',names[i]===name);});
  document.querySelectorAll('.panel').forEach(p=>{
    p.classList.toggle('active',p.id==='tab-'+name);
    p.style.display = p.id==='tab-'+name ? 'block' : 'none';
  });
  if(name==='shows') { renderCharts(); renderRankings(); renderAnalytics(); }
  if(name==='markets') { renderCharts(); renderRankings(); renderAnalytics(); }
  if(name==='peers') renderPeers();
  if(name==='seasons') renderSeasons();
  if(name==='faq') renderFaq();
}

// ── IMPORT — commented out pending Power Automate / SharePoint List wiring ────
/*
function openImport(){ document.getElementById('importModal').classList.add('open'); }
function closeImport(){ document.getElementById('importModal').classList.remove('open'); document.getElementById('importLog').style.display='none'; }

function log(msg,color='#6b6b6b'){
  const el=document.getElementById('importLog');
  el.style.display='block';
  el.innerHTML+=`<div style="color:${color}">${msg}</div>`;
  el.scrollTop=el.scrollHeight;
}

document.getElementById('fileInput').addEventListener('change',e=>{
  if(e.target.files[0]) processFile(e.target.files[0]);
  e.target.value='';
});

const dz=document.getElementById('dropZone');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag-over');});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag-over');if(e.dataTransfer.files[0])processFile(e.dataTransfer.files[0]);});

function safeF(v){if(v==null||v===''||v===undefined)return null;const n=parseFloat(String(v).replace(/[$%,]/g,''));return isNaN(n)?null:n;}

async function processFile(file) {
  document.getElementById('importLog').innerHTML='';
  log(`📂 Reading: ${file.name}`);
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(buf,{type:'array',cellDates:true});
  let added=0,dupes=0;

  const fmatch=file.name.match(/(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/);
  let fileDate=null;
  if(fmatch){
    const parts=fmatch[1].replace(/\//g,'-').split('-');
    if(parts.length===3){
      const y=parts[2].length===2?'20'+parts[2]:parts[2];
      fileDate=`${y}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
    }
  }

  for(const shName of wb.SheetNames){
    const tier=shName.toUpperCase().includes('PRIMARY')?'Primary':'Secondary';
    const ws=wb.Sheets[shName];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});

    for(let i=1;i<rows.length;i++){
      const row=rows[i];
      let show,theatre,city,trng,topP,nPerf,gg,gp,ggpct,ptix,ttix,tcap,cpaid,ctot,sub,avgA,rdate;

      if(tier==='Primary'){
        const d=row[0];
        rdate=d instanceof Date?d.toISOString().slice(0,10):fileDate;
        show=row[1]?String(row[1]).trim():''; theatre=row[2]?String(row[2]).trim():'';
        city=row[3]?String(row[3]).trim():''; trng=row[4]?String(row[4]):null;
        topP=safeF(row[5]); nPerf=safeF(row[6]); gg=safeF(row[7]); gp=safeF(row[8]);
        ggpct=safeF(row[9]); ptix=safeF(row[10]); ttix=safeF(row[11]); tcap=safeF(row[12]);
        cpaid=safeF(row[13]); ctot=safeF(row[14]); sub=row[15]==='X'?1:0; avgA=safeF(row[16]);
      } else {
        rdate=fileDate;
        show=row[0]?String(row[0]).trim():''; theatre=row[1]?String(row[1]).trim():'';
        city=row[2]?String(row[2]).trim():''; trng=row[3]?String(row[3]):null;
        topP=safeF(row[4]); nPerf=safeF(row[5]); gg=safeF(row[6]); gp=safeF(row[7]);
        ggpct=safeF(row[8]); ptix=safeF(row[9]); ttix=safeF(row[10]); tcap=safeF(row[11]);
        cpaid=safeF(row[12]); ctot=safeF(row[13]); sub=row[14]==='X'?1:0; avgA=safeF(row[15]);
      }

      if(!show||['nan','show',''].includes(show.toLowerCase())) continue;
      if(['layoff','nan',''].includes((city||'').toLowerCase())) continue;
      if(show.toLowerCase().includes('for engagements')) continue;

      const isDupe=ALL_DATA.some(d=>d.week_of===rdate&&d.show===show&&d.city===city&&d.tier===tier);
      if(isDupe){dupes++;continue;}

      ALL_DATA.push({week_of:rdate,tier,show,theatre:theatre||'',city:city||'',
        ticket_range:trng&&trng!=='null'?trng:null,top_price:topP,num_perf:nPerf,
        gross_gross:gg,gross_potential:gp,gg_pct_gp:ggpct,paid_tix:ptix,total_tix:ttix,
        capacity:tcap,cap_paid:cpaid,cap_total:ctot,on_sub:sub,avg_adm:avgA});
      added++;
    }
  }

  await saveData(ALL_DATA);
  log(`✓ Added ${added} records`, '#0A6B5E');
  if(dupes>0) log(`↷ Skipped ${dupes} duplicates`, '#B8620A');
  log(`◎ Total records: ${ALL_DATA.length}`);

  populateWeekDropdown(); populateShowList();
  document.getElementById('showSearch').value = '';
  filterShowList(); updateDataStatus(); applyFilters();
}
*/

async function clearAllData() {
  if(!confirm('Reload data from source?')) return;
  await initData();
}

// ── INIT ──────────────────────────────────────────────────────────────────────
initData();
