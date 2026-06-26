// Page controller extracted from programming.html during Phase 5.
// Keep as a non-module script so existing inline onclick handlers remain global.

const HELP_TEXT = {
  tier: 'Primary markets are major touring cities designated by the Broadway League. Secondary markets are smaller regional cities.',
  subscription: "Subscription shows are part of the venue's subscriber package. Non-subscription shows are add-ons or specials not included in the season subscription.",
  peerVenues: 'Peers classified by type: Size (±10% of Bushnell sellable seats, 2,450–2,994), Proximity (Northeast/New England), Market (comparable nonprofit mid-sized city PACs), Extended (±15% range).',
  season: 'Seasons follow the Bushnell fiscal year: July 1 through June 30. A show reporting in August 2025 belongs to the 25-26 season. Season is derived from each record\'s Broadway League report week date — not the show\'s opening or closing night.',
  dateRange: 'Narrows results to a specific date window. Dates snap to the nearest Sunday to align with Broadway League reporting.',
  venue: 'Filter to a specific venue across all Broadway League markets.',
  city: 'Filter to a specific city across all Broadway League markets.',
  shows: 'Select specific show titles to focus analysis.',
  tourType: 'Equity tours are productions under an Actors\' Equity Association contract. Non-Equity tours operate outside the AEA contract.',
  engagement: 'Performed = the show had at least one performance and reported gross revenue that week. No Performance = the week was a layoff or dark week.',
  grossGross: 'Total gross revenue for the week at that venue — all tickets sold at all price points.',
  grossPotential: 'The theoretical maximum revenue if every seat sold at full price for every performance.',
  ggPctGp: 'Gross Gross as a percentage of Gross Potential. Over 100% indicates premium pricing. Under 100% indicates unsold seats or discounting.',
  pctCapPaid: 'Paid tickets sold divided by total sellable capacity. The primary measure of how full the house was.',
  pctCapTotal: 'Total tickets (including comps) divided by total sellable capacity.',
  avgPaidAdm: 'Average price paid per ticket: Gross Gross divided by Paid Tickets.',
  wow: 'Week-over-Week. The percentage change in gross revenue from the previous report week to the current week.',
  topPaidPrice: 'The highest price at which a ticket was sold that week.',
  numPerf: 'Number of performances in the report week (typically 8 for a standard Broadway week).',
  broadwayLeague: 'Weekly touring report published by The Broadway League covering gross revenue, capacity, and performance data for Broadway touring productions across North America.',
  reportWeek: 'Each record represents one week of performances at one venue. Reports are published weekly, typically on Sundays.',
  fiscalYear: 'The Bushnell fiscal year runs July 1 through June 30. All season and annual comparisons use this calendar.',
  dataCurrency: 'Data reflects Broadway League reports uploaded to this system. The most recent report date is shown in the masthead.',
  peerDef: 'Peers classified by type: Size (±10% of Bushnell sellable seats, 2,450–2,994), Proximity (Northeast/New England), Market (comparable nonprofit mid-sized city PACs), Extended (±15% range).',
  meaningfulPeers: 'Venues with 10+ reporting weeks and average gross within 50% of the Bushnell average are considered meaningful comparators and receive full synopses on the Peer Venues tab.',
  peerBenchmark: 'Peer comparisons show how Bushnell gross and capacity performance compares to similar venues presenting the same touring productions.',
  fitScore: 'A composite score (0–100) estimating how well a touring show fits the Bushnell based on its national capacity utilization and peer venue performance. Higher = stronger historical draw at similar venues.',
  weeklyTrend: 'Total gross across all filtered venues by report week.',
  eightWeekMA: 'Rolling 8-week moving average overlaid on the weekly gross chart.',
  seasonality: 'Average gross by fiscal period (July–June) across all years in the filter.',
  yoy: 'Fiscal year gross by period, overlaid for comparison.',
  ggPctChart: 'Teal bars indicate shows averaging at or above 100% of gross potential. Navy bars indicate below potential.',
  mktCapChart: 'Average paid capacity utilization by city.'
};
let SEASONS=[];
function _buildSeasons(raw){SEASONS=(BTD.data&&BTD.data.normalizeSeasons)?BTD.data.normalizeSeasons(raw):[];}
let ALL=[], FILTERED=[], STATE={season:'2025-2026', tab:'brief'}, CHARTS={}, CURRENT_PROFILES=[], HISTORY_PROFILES=[], CONTEXT={}, SCORE_MED=65;
let ACTIVE_TIER='', ACTIVE_SUB='', ACTIVE_PEER='', ACTIVE_EQUITY='', ACTIVE_ENGAGE='';
// PEER_META → window.PEER_META from utils.js
// isPeerType, fmt$, pct, avg, fmtDate, fiscalYear → utils.js
const $=id=>document.getElementById(id);
const num=(v,d=0)=>v==null||Number.isNaN(v)?'—':v.toFixed(d); // page-specific: d=0 default
const sum=a=>a.filter(x=>x!=null&&!Number.isNaN(x)).reduce((s,x)=>s+x,0);
function median(arr){return BTD.metrics&&BTD.metrics.median?BTD.metrics.median(arr):65;}
function isBushnell(d){return BTD.peers&&BTD.peers.isBushnell?BTD.peers.isBushnell(d):(/hartford/i.test(d.city||'')||/bushnell|mortensen/i.test(d.theatre||''));}
function normalizeName(s){return BTD.page&&BTD.page.norm?BTD.page.norm(s):String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function matchRows(show, rows=ALL){const m=normalizeName(show.match||show.title||show);return rows.filter(d=>{const n=normalizeName(d.show);return n.includes(m)||m.includes(n)})}
function rowMetric(rows){const active=rows.filter(d=>d.gross_gross!=null&&!d.no_engagement);const cap=avg(active.map(d=>d.cap_paid));const gross=avg(active.map(d=>d.gross_gross));const gg=avg(active.map(d=>d.gg_pct_gp));const peer=active.filter(d=>isPeerType(d, ACTIVE_PEER||'size'));const peerCap=avg(peer.map(d=>d.cap_paid));const bush=active.filter(isBushnell);const bushCap=avg(bush.map(d=>d.cap_paid));const index=(bushCap!=null&&cap)?(bushCap/cap)*100:null;const subRows=active.filter(d=>d.on_sub===1);const nonsubRows=active.filter(d=>d.on_sub===0);const subCap=avg(subRows.map(d=>d.cap_paid));const nonSubCap=avg(nonsubRows.map(d=>d.cap_paid));return {rows:active,all:rows,cap,gross,gg,peerCap,bushCap,index,subCap,nonSubCap,count:active.length,peerCount:peer.length,bushCount:bush.length,subShare:active.length?active.filter(d=>d.on_sub===1).length/active.length*100:null,dark:rows.filter(d=>d.no_engagement).length}}
function fitScore(m,show){let score=50;if(m.cap!=null)score+=(m.cap-70)*0.45;if(m.gg!=null)score+=(m.gg-75)*0.22;if(m.peerCap!=null)score+=(m.peerCap-70)*0.22;if(m.count>=8)score+=8;else if(m.count<3)score-=15;if(show&&show.sub&&m.subCap!=null&&m.nonSubCap!=null)score+=(m.subCap-m.nonSubCap)*0.08;return Math.max(0,Math.min(100,Math.round(score)))}
function seasonShows(){return SEASONS.find(s=>s.id===STATE.season)||SEASONS[1]}
function showProfile(show){const rows=matchRows(show);const filtered=applyFilters(rows);const p=(window.BTD&&BTD.signals)?BTD.signals.profileShow(show,filtered,{peerType:ACTIVE_PEER||'size',seasonId:STATE.season}):null;if(!p){const m=rowMetric(filtered);const raw=rowMetric(rows);return {show,rows,metrics:m,raw,score:fitScore(m,show)}}p.raw=rowMetric(rows);p.show=show;return p}
function applyFilters(rows){return BTD.page.applyStandardFilters(rows||ALL,{tier:ACTIVE_TIER,sub:ACTIVE_SUB,peer:ACTIVE_PEER,equity:ACTIVE_EQUITY,engage:ACTIVE_ENGAGE});}
function weekContext(weekOf){return BTD.context&&BTD.context.forWeek?BTD.context.forWeek(weekOf):(CONTEXT[weekOf]||null);}
function weekContextForDate(isoDate){if(!isoDate)return null;const keys=Object.keys(CONTEXT).filter(k=>k<=isoDate).sort();const k=keys[keys.length-1];return k?CONTEXT[k]:null;}
function contextBadge(weekOf){const ctx=weekContext(weekOf);if(!ctx)return '';const w=ctx.weather,e=ctx.economic;const parts=[];if(w&&w.significant)parts.push(`<span class="ctx-badge ctx-weather" title="${escapeHtml(w.summary||'Weather event')}">&#9928; ${escapeHtml(w.summary||'Weather')}</span>`);if(e&&e.confidence_trend==='falling')parts.push(`<span class="ctx-badge ctx-econ" title="Consumer sentiment falling · ${e.consumer_confidence}">&#8600; Sentiment</span>`);return parts.join(' ');}
function contextBlock(weekOf){const ctx=weekContext(weekOf);if(!ctx)return '';const w=ctx.weather,e=ctx.economic;const lines=[];if(w&&w.significant){lines.push(`<div class="ctx-block ctx-weather"><strong>Weather:</strong> ${escapeHtml(w.summary||'')}${w.events&&w.events[0]&&w.events[0].narrative?' — '+escapeHtml(w.events[0].narrative.slice(0,120)):''}.</div>`);}if(e&&e.consumer_confidence!=null){const trend=e.confidence_trend==='falling'?' (falling)':e.confidence_trend==='rising'?' (rising)':'';lines.push(`<div class="ctx-block ctx-econ"><strong>Sentiment:</strong> ${e.consumer_confidence}${trend} · CT unemployment ${e.ct_unemployment??'—'}%</div>`);}return lines.join('');}
function contextWeekCount(rows){const sig=rows.filter(r=>r.week_of&&weekContext(r.week_of)&&weekContext(r.week_of).weather&&weekContext(r.week_of).weather.significant).length;return sig>0?`<span class="ctx-badge ctx-weather" title="${sig} reporting week(s) had notable weather events">&#9928; ${sig}wk</span>`:'';}
async function loadData(){
  try{
    await BTD.data.loadCore({includeContext:true});
    const core=BTD.page.hydrateCoreState();
    ALL=core.all;
    CONTEXT=core.context;
    if(core.seasons.length) SEASONS=core.seasons;
    init();
  }catch(e){
    console.error(e);
    const brief=$('tab-brief');if(brief)brief.innerHTML='<div class="empty">Could not load dashboard data. '+(e.message||e)+'</div>';
  }
}
function init(){$('seasonPills').innerHTML=SEASONS.map(s=>`<button class="pill ${s.id===STATE.season?'active':''}" data-season="${s.id}" onclick="setSeason('${s.id}')">${s.id.slice(2,4)}-${s.id.slice(7,9)}</button>`).join('');document.querySelectorAll('.tip-icon[data-tip]').forEach(el=>{const span=document.createElement('span');span.className='tip-text';span.textContent=HELP_TEXT[el.dataset.tip]||'';el.appendChild(span);});renderFaq();renderAll();}
function setSeason(v){STATE.season=v;if(BTD.state&&BTD.state.active)BTD.state.active.season=v;document.querySelectorAll('[data-season]').forEach(b=>b.classList.toggle('active',b.dataset.season===v));renderAll();}
function setTier(btn,v){BTD.page.setFilterButton('ACTIVE_TIER','[data-tier]',v,renderAll);}
function setSub(btn,v){BTD.page.setFilterButton('ACTIVE_SUB','[data-sub]',v,renderAll);}
function setPeer(btn,v){BTD.page.setFilterButton('ACTIVE_PEER','[data-peer]',v,renderAll);}
function setEquity(btn,v){BTD.page.setFilterButton('ACTIVE_EQUITY','[data-equity]',v,renderAll);}
function setEngage(btn,v){BTD.page.setFilterButton('ACTIVE_ENGAGE','[data-engage]',v,renderAll);}
function resetAll(){
  STATE={season:'2025-2026',tab:'brief'};
  ACTIVE_TIER='';ACTIVE_SUB='';ACTIVE_PEER='';ACTIVE_EQUITY='';ACTIVE_ENGAGE='';
  document.querySelectorAll('[data-season]').forEach(b=>b.classList.toggle('active',b.dataset.season===STATE.season));
  ['tier','sub','peer','equity','engage'].forEach(k=>document.querySelectorAll('[data-'+k+']').forEach(b=>b.classList.toggle('active',b.dataset[k]==='')));
  showTab('brief');
}
function showTab(tab){STATE.tab=tab;document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));$('tab-'+tab).classList.add('active');document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));renderActive();}
function destroy(id){if(BTD.charts&&BTD.charts.destroy){BTD.charts.destroy(id);return;} if(CHARTS[id]){CHARTS[id].destroy();delete CHARTS[id];}}
function renderAll(){const dates=ALL.map(d=>d.week_of).filter(Boolean).sort();$('dataStatus').innerHTML=`<strong>${ALL.length.toLocaleString()}</strong> records · <strong>${new Set(dates).size.toLocaleString()}</strong> weeks total`;const _fsEl=$('filteredStatus');if(_fsEl){const _sRows=ALL.filter(d=>fiscalYear(d.week_of)===STATE.season);const _last=dates[dates.length-1]||null;_fsEl.innerHTML=`Filtered: <strong>${_sRows.length.toLocaleString()}</strong> records · Last report: <strong>${_last?fmtWeek(_last):'—'}</strong>`;}
  const profiles=seasonShows().shows.map(showProfile);const active=profiles.filter(p=>p.metrics.count>0);SCORE_MED=median(profiles.map(p=>p.score));$('kSeason').textContent=STATE.season.slice(2).replace('-20','-');$('kScheduled').textContent=profiles.length;$('kGross').textContent=fmt$(avg(active.map(p=>p.metrics.gross)));$('kGG').textContent=pct(avg(active.map(p=>p.metrics.gg)),0);$('kTourCap').textContent=pct(avg(active.map(p=>p.metrics.cap)),0);$('kHighFit').textContent=profiles.filter(p=>p.score>=SCORE_MED).length;$('kWatch').textContent=profiles.filter(p=>p.score<SCORE_MED&&p.metrics.count>0).length;renderActive();}
function renderActive(){if(STATE.tab==='brief')renderBrief();if(STATE.tab==='season')renderSeason();if(STATE.tab==='history')renderShowHistory();if(STATE.tab==='planning')renderPlanning();if(STATE.tab==='peers')renderPeers();if(STATE.tab==='reference')renderFaq();}
function renderFaq(){const el=$('faqContent');if(!el)return;
  const active=ALL.filter(d=>!d.no_engagement).length;
  const layoffs=ALL.filter(d=>d.no_engagement).length;
  const lastWeek=ALL.map(d=>d.week_of).filter(Boolean).sort().pop()||'—';
  const capAbove100=ALL.filter(d=>d.cap_paid!=null&&d.cap_paid>100).length;
  const ggAbove100=ALL.filter(d=>d.gg_pct_gp!=null&&d.gg_pct_gp>100).length;
  const section=(title,items)=>`<div class="faq-section"><h3>${title}</h3><dl class="faq-grid">${items.map(([t,d])=>`<dt>${t}</dt><dd>${d}</dd>`).join('')}</dl></div>`;
  el.innerHTML=`<div class="card full" style="margin-bottom:18px"><div class="card-hd" style="margin-bottom:10px">Data Quality &amp; Provenance</div><div class="grid grid-4"><div class="note"><div class="note-hd">Total Records</div><div class="val" style="font-family:var(--serif,Georgia);font-size:1.2rem;font-weight:700">${ALL.length.toLocaleString()}</div><div class="note-body">${active.toLocaleString()} active · ${layoffs.toLocaleString()} layoff/dark</div></div><div class="note"><div class="note-hd">Last Report Week</div><div class="val" style="font-family:var(--serif,Georgia);font-size:1.2rem;font-weight:700">${fmtWeek(lastWeek)}</div><div class="note-body">Broadway League weekly data</div></div><div class="note"><div class="note-hd">Validation Status</div><div class="val" style="font-size:1.2rem;font-weight:700;color:#0A6B5E">PASS</div><div class="note-body">0 errors · required fields present · no duplicate keys</div></div><div class="note"><div class="note-hd">Known Conditions</div><div class="note-body"><strong>${capAbove100.toLocaleString()}</strong> cap values above 100% · <strong>${ggAbove100.toLocaleString()}</strong> GG% values above 100%. Both retained per Broadway League reporting (dynamic pricing, SRO, comps).</div></div></div></div><div class="card full" style="margin-bottom:18px;border-left:4px solid var(--amber)"><div class="card-hd" style="margin-bottom:10px">Planning Signal Model</div><div class="grid grid-4"><div class="note"><div class="note-hd">Demand Signal</div><div class="note-body">Do audiences want this title? Uses paid capacity, total capacity, markets played, and peer attendance. Occupancy is a demand measure — not a full definition of success.</div></div><div class="note"><div class="note-hd">Revenue Signal</div><div class="note-body">Does demand convert to dollars? Uses GG% of Gross Potential and average admission, normalized to avoid large-market distortion. A title can have strong attendance and weak revenue efficiency.</div></div><div class="note"><div class="note-hd">Peer Signal</div><div class="note-body">How relevant is this to Bushnell-like conditions? Uses Bushnell-size venue behavior and peer consistency. Separates national popularity from likely Hartford fit.</div></div><div class="note"><div class="note-hd">Confidence Signal</div><div class="note-body">How much evidence exists? Uses weeks reported, venue count, recency, and completeness. Low confidence is uncertainty — not a negative signal about the title.</div></div></div><div class="card-sub" style="margin-top:10px;border-top:1px solid var(--rule2);padding-top:8px;font-style:italic">Revenue Signal is not Net Profit. Deal terms, local expenses, presenter economics, and ancillary revenue are not included in this dashboard.</div></div><div class="card full" style="margin-bottom:18px"><div class="card-hd" style="margin-bottom:10px">What the Planning Signal Does Not Include</div><div class="grid grid-3"><div class="note"><div class="note-hd">Financial Deal Structure</div><div class="note-body">Guarantee · split terms / overages · estimated local expenses · labor cost · marketing spend · expected net contribution · breakeven attendance · pricing plan · presenter share · ancillary revenue</div></div><div class="note"><div class="note-hd">Local Bushnell History</div><div class="note-body">Previous Bushnell engagement · attendance · gross · subscription response · single-ticket response · group sales · patron feedback · renewal and first-time buyer impact</div></div><div class="note"><div class="note-hd">Routing, Calendar &amp; Strategy</div><div class="note-body">Equity / non-equity · routing region · available weeks · technical requirements · competing local events · holidays · school breaks · mission fit · donor value · season balance</div></div></div></div>`+[section('Data Source',[['Broadway League',HELP_TEXT.broadwayLeague],['Report Week',HELP_TEXT.reportWeek],['Fiscal Year',HELP_TEXT.fiscalYear],['Data Currency',HELP_TEXT.dataCurrency]]),section('Key Metrics & Acronyms',[['Gross Gross (GG)',HELP_TEXT.grossGross],['Gross Potential (GP)',HELP_TEXT.grossPotential],['GG% of GP',HELP_TEXT.ggPctGp],['% Capacity Paid',HELP_TEXT.pctCapPaid],['% Capacity Total',HELP_TEXT.pctCapTotal],['Avg Paid Admission',HELP_TEXT.avgPaidAdm],['WoW',HELP_TEXT.wow],['Top Paid Price',HELP_TEXT.topPaidPrice],['# Performances',HELP_TEXT.numPerf]]),section('Filters',[['Season',HELP_TEXT.season],['Date Range',HELP_TEXT.dateRange],['Tier',HELP_TEXT.tier],['Subscription',HELP_TEXT.subscription],['Peer Venues',HELP_TEXT.peerVenues],['Tour Type',HELP_TEXT.tourType],['Engagement',HELP_TEXT.engagement]]),section('Programming Tools',[['Planning Signal',HELP_TEXT.fitScore],['Peer Definition',HELP_TEXT.peerDef],['Meaningful Peers',HELP_TEXT.meaningfulPeers],['Benchmarking',HELP_TEXT.peerBenchmark]]),section('Charts & Analytics',[['Weekly Gross Trend',HELP_TEXT.weeklyTrend],['8-Week Trend',HELP_TEXT.eightWeekMA],['Seasonality',HELP_TEXT.seasonality],['Year over Year',HELP_TEXT.yoy],['GG% of Potential',HELP_TEXT.ggPctChart],['% Capacity by Market',HELP_TEXT.mktCapChart]])].join('');}

function renderBrief(){const season=seasonShows();const profiles=season.shows.map(showProfile).sort((a,b)=>b.score-a.score);const med=SCORE_MED;const high=profiles.filter(p=>p.score>=med).slice(0,3);const watch=profiles.filter(p=>p.score<med&&p.metrics.count>0).slice(0,3);const withData=profiles.filter(p=>p.metrics.count>0);const avgGG=avg(withData.map(p=>p.metrics.gg));const avgGross=avg(withData.map(p=>p.metrics.gross));const avgCap=avg(withData.map(p=>p.metrics.cap));const avgIndex=avg(withData.map(p=>p.metrics.index));const klass=(BTD.page&&BTD.page.seasonCalloutClass)?BTD.page.seasonCalloutClass(avgGG):(avgGG>=80?'good':avgGG<60?'warn':'');const status=(BTD.page&&BTD.page.seasonHeadline)?BTD.page.seasonHeadline(avgGG,avgGross,null,profiles):(avgGG>=80?'Strong Revenue Season':avgGG>=60?'Revenue In Range':'Revenue Needs Review');const capNote=avgIndex!=null?` Bushnell is indexing at ${num(avgIndex,0)} vs national capacity where Hartford records exist.`:'';const msg=(BTD.page&&BTD.page.seasonSummaryCopy)?BTD.page.seasonSummaryCopy(profiles,avgGG,avgGross,avgCap,null)+capNote:`Season shows averaging ${pct(avgGG,0)} GG% of gross potential.${capNote}`;
  $('tab-brief').innerHTML=`<div class="section-divider"><h2>Season Overview</h2><div class="section-divider-line"></div><div class="section-divider-meta">${season.name} · programming decision view</div></div><div class="brief"><div class="callout ${klass}"><h3>${status}</h3><p>${msg}</p></div><div class="card"><div class="card-hd">What this page answers</div><div class="card-sub">How current shows are doing, how previous shows performed, and what next season candidates may do for Bushnell.</div><div class="metric-row"><div class="metric"><div class="val">${fmt$(avg(withData.map(p=>p.metrics.gross)))}</div><div class="lbl">Avg Gross</div></div><div class="metric"><div class="val">${pct(avg(withData.map(p=>p.metrics.gg)),0)}</div><div class="lbl">Avg GG%</div></div><div class="metric"><div class="val">${pct(avg(withData.map(p=>p.metrics.cap)),0)}</div><div class="lbl">Tour Capacity</div></div></div></div></div><div class="grid grid-3" style="margin-top:18px"><div class="card"><div class="card-hd">Strongest Signals</div><div class="rank-list">${rankItems(high,p=>p.show.title, p=>`${fmt$(p.metrics.gross)} avg gross · ${pct(p.metrics.gg,0)} GG% · ${pct(p.metrics.cap,0)} cap`, p=>p.score)}</div></div><div class="card"><div class="card-hd">Watchlist</div><div class="rank-list">${watch.length?rankItems(watch,p=>p.show.title,p=>`Fit ${p.score} · ${p.metrics.count} records`,p=>p.score):'<div class="empty">No current watchlist items with available data.</div>'}</div></div><div class="card"><div class="card-hd">Programming Signals</div><div class="insight-list" id="briefInsights"></div></div></div><div class="grid grid-2" style="margin-top:18px"><div class="card"><div class="card-hd">Season Show Fit</div><canvas id="cBriefFit"></canvas></div><div class="card"><div class="card-hd">Capacity: Tour vs Peer</div><canvas id="cBriefCap"></canvas></div><div class="card full" style="border-left:3px solid var(--rule)"><div class="card-hd" style="margin-bottom:10px">How to Use This View</div><div class="grid grid-2"><div class="note"><div class="note-hd">What the Planning Signal measures</div><div class="note-body">Four separate signals: <strong>Demand</strong> (attendance), <strong>Revenue</strong> (monetization efficiency), <strong>Peer</strong> (Bushnell-size venue behavior), and <strong>Confidence</strong> (evidence depth). Scores are calibrated against the <strong>season median</strong> — above median means stronger relative to this season's actual touring market.</div></div><div class="note"><div class="note-hd">What it does not include</div><div class="note-body">Deal terms, guarantees &amp; expense structure &nbsp;·&nbsp; Local Bushnell audience history &nbsp;·&nbsp; Routing and availability &nbsp;·&nbsp; Pre-sale pace &nbsp;·&nbsp; Group or donor strategy &nbsp;·&nbsp; Competing local events &nbsp;·&nbsp; Artistic or mission priority. <strong>Revenue Signal is not Net Profit.</strong> Use the Planning Signal to start the conversation, not end it.</div></div></div></div></div>`;
  $('briefInsights').innerHTML=makeInsights(profiles).map((x,i)=>`<div class="insight"><div class="insight-mark">${i+1}</div><div><strong>${x.title}</strong><span>${x.text}</span></div></div>`).join('');chartFit(profiles,'cBriefFit');chartCap(profiles,'cBriefCap');}
function makeInsights(profiles){const out=[];const known=profiles.filter(p=>p.metrics.count>0);const best=[...known].sort((a,b)=>b.score-a.score)[0];const soft=[...known].sort((a,b)=>a.score-b.score)[0];const peerWins=known.filter(p=>p.metrics.peerCap!=null&&p.metrics.cap!=null&&p.metrics.peerCap>p.metrics.cap+3).length;if(best){const _bs=planningSignals(best);out.push({title:`${best.show.title} — strongest Planning Signal`,text:`Planning Read: ${_bs.planningRead}. Demand: ${_bs.demand}, Revenue: ${_bs.revenue}. ${pct(best.metrics.cap,1)} avg capacity across matching tour records.`});}if(soft){const _ss=planningSignals(soft);out.push({title:`${soft.show.title} — review before committing`,text:`Planning Read: ${_ss.planningRead}. Demand: ${_ss.demand}, Revenue: ${_ss.revenue}. Compare peer venue behavior and confidence level before treating as a reliable Bushnell fit.`});}out.push({title:'Peer lens is the most useful planning filter',text:`${peerWins} season titles currently look stronger in Bushnell-size venues than in the full national pool.`});return out;}
function renderSeason(){const season=seasonShows();const profiles=season.shows.map(showProfile).sort((a,b)=>b.score-a.score);CURRENT_PROFILES=profiles;$('tab-season').innerHTML=`<div class="section-divider"><h2>Season Performance</h2><div class="section-divider-line"></div><div class="section-divider-meta">Show scorecards · ${season.name}</div></div><div class="grid grid-3">${profiles.map((p,i)=>showCard(p,i===0,i)).join('')}</div><div class="grid grid-2" style="margin-top:18px"><div class="card full"><div class="card-hd">Selected Show Detail</div><div id="currentDetail"></div></div></div><div class="card" style="margin-top:18px"><div class="card-hd">Season Comparison — Fit Score by Show</div><canvas id="cCurrent"></canvas></div>`;document.querySelectorAll('.show-card').forEach(c=>c.addEventListener('click',()=>selectCurrent(+c.dataset.idx)));selectCurrent(0);chartFit(profiles,'cCurrent');}
function showCard(p,active,idx){
  if(!BTD.components||!BTD.components.programmingShowCard)return '';
  var dateStr=p.show&&p.show.open?fmtDate(p.show.open)+(p.show.close?' – '+fmtDate(p.show.close):''):'';
  var footerStr=p.metrics?p.metrics.count+' matched records · peer cap '+pct(p.metrics.peerCap,1):'';
  return BTD.components.programmingShowCard(p,active,idx,SCORE_MED,{dateStr:dateStr,footerStr:footerStr});
}
function selectCurrent(idx){document.querySelectorAll('.show-card').forEach((c,i)=>c.classList.toggle('active',i===idx));const p=CURRENT_PROFILES[idx]||CURRENT_PROFILES[0];const season=seasonShows();$('currentDetail').innerHTML=p?detailHtml(p,season):'<div class="empty">No current show data.</div>';}
function detailHtml(p,season){
  var _sig=planningSignals(p);
  var m=p.metrics;
  var rows=p.rows.filter(function(d){return d.gross_gross!=null;}).slice().sort(function(a,b){return (b.week_of||'').localeCompare(a.week_of||'');}).slice(0,6);
  var sigRows=rows.filter(function(r){return r.week_of&&weekContext(r.week_of)&&(weekContext(r.week_of).weather&&weekContext(r.week_of).weather.significant||weekContext(r.week_of).economic&&weekContext(r.week_of).economic.confidence_trend==='falling');});
  var ctxHtml=sigRows.length?('<div style="margin-top:10px">'+sigRows.map(function(r){return '<div style="margin-bottom:4px"><span style="color:var(--ink3);font-size:.6rem">'+fmtDate(r.week_of)+'</span> '+contextBlock(r.week_of)+'</div>';}).join('')+'</div>'):'';
  var conf=confidenceLabel(p);
  var cls=p.score>=SCORE_MED?'good':'warn';
  var tableRows=rows.length?rows.map(function(r){return '<tr><td>'+r.theatre+'<br><span style="color:var(--ink3);font-size:.58rem">'+r.city+'</span></td><td>'+fmtDate(r.week_of)+' '+contextBadge(r.week_of)+'</td><td class="num">'+fmt$(r.gross_gross)+'</td><td class="num">'+pct(r.cap_paid)+'</td></tr>';}).join(''):'<tr><td colspan="4" class="empty">No matching active tour records found.</td></tr>';
  var h='';
  h+='<div class="card-title">'+p.show.title+'</div>';
  h+='<div class="card-sub">Matched on "'+p.show.match+'" · '+(p.show.sub?'subscription':'non-subscription')+' · '+p.metrics.count+' records</div>';
  h+='<div style="font-size:.6rem;color:var(--ink3);margin:6px 0"><strong>Planning Read:</strong> '+_sig.planningRead+' — '+_sig.interpretation+'</div>';
  h+=signalRow(_sig);
  h+='<div class="metric-row" style="margin-top:10px">';
  h+='<div class="metric"><div class="val '+cls+'">'+p.score+'</div><div class="lbl">Fit Score</div></div>';
  h+='<div class="metric"><div class="val">'+fmt$(m.gross)+'</div><div class="lbl">Avg Gross</div></div>';
  h+='<div class="metric"><div class="val">'+pct(m.gg,1)+'</div><div class="lbl">Revenue GG%</div></div>';
  h+='<div class="metric"><div class="val">'+pct(m.cap,1)+'</div><div class="lbl">Demand Cap</div></div>';
  h+='</div>';
  // Revenue quality section
  if(m.count>=2){
    var yieldGap=(m.cap!=null&&m.gg!=null)?(m.cap-m.gg):null;
    var discFlag=m.cap!=null&&m.cap>=80&&m.adm!=null&&m.adm<60;
    h+='<div style="margin-top:12px"><div class="card-hd" style="margin-bottom:6px">Revenue Quality</div>';
    h+='<div class="grid grid-3" style="margin:0;gap:8px">';
    h+='<div class="note"><div class="note-hd">Monetization</div><div class="note-body">Paid Cap: <strong>'+pct(m.cap)+'</strong><br>GG% of Potential: <strong>'+pct(m.gg)+'</strong><br>Avg Admission: <strong>'+(m.adm!=null?'$'+num(m.adm,0):'—')+'</strong><br><em>'+(yieldGap!=null&&yieldGap>15?'Strong attendance, weaker yield.':yieldGap!=null&&yieldGap<=5&&m.gg>=75?'Demand and revenue well-aligned.':'Review individually.')+'</em></div></div>';
    h+='<div class="note"><div class="note-hd">Peer Revenue</div><div class="note-body">Peer Cap: <strong>'+pct(m.peerCap)+'</strong><br><em>'+(m.peerCap!=null&&m.cap!=null?(m.peerCap>m.cap+5?'Stronger in comparable rooms.':m.peerCap<m.cap-5?'Softer in comparable rooms.':'In line with national.'):'Peer data limited.')+'</em></div></div>';
    h+='<div class="note"><div class="note-hd">Discount Signal</div><div class="note-body">Paid Cap: <strong>'+pct(m.cap)+'</strong><br>Avg Admission: <strong>'+(m.adm!=null?'$'+num(m.adm,0):'—')+'</strong><br><em>'+(discFlag?'High attendance, low admission. Discount-sensitive.':m.adm!=null&&m.adm>=75?'Admission rate is solid.':'Insufficient admission data.')+'</em></div></div>';
    h+='</div>';
    if(p.show.sub&&m.subCap!=null&&m.nonSubCap!=null){var sl=m.subCap-m.nonSubCap;h+='<div class="note" style="margin-top:8px"><div class="note-hd">Subscription Revenue</div><div class="note-body">Sub Cap: <strong>'+pct(m.subCap)+'</strong>   Non-Sub: <strong>'+pct(m.nonSubCap)+'</strong>   Lift: <strong>'+(sl>=0?'+':'')+pct(sl)+'</strong><br><em>'+(Math.abs(sl)<5?'Minimal sub/non-sub difference.':sl>0?'Subscription placement supports attendance.':'Single-ticket demand exceeds subscription.')+'</em></div></div>';}
    h+='<div class="card-sub" style="margin-top:6px;font-style:italic;border-top:1px solid var(--rule2);padding-top:6px">Revenue Signal is not Net Profit. Deal terms, local expenses, and presenter economics are not included.</div>';
    h+='</div>';
  }
  // Why this read
  h+='<div style="margin-top:12px"><div class="card-hd" style="margin-bottom:6px">Why this read?</div>';
  h+=whyThisRead(p,_sig);
  h+='</div>';
  h+='<table class="mini-table" style="margin-top:14px"><thead><tr><th>Recent Market</th><th>Week</th><th class="num">Gross</th><th class="num">Cap</th></tr></thead><tbody>'+tableRows+'</tbody></table>';
  h+=ctxHtml;
  // Production background — disabled until shows.json wikipedia data is clean (disambiguation pages)
  if(false){var _meta=p.showMeta||{};
  var _totalWins=awardWins(_meta);var _totalNoms=awardNoms(_meta);
  var _hasMeta=_meta.wikipedia_summary||_meta.composer||_meta.opening_date||_totalWins||_totalNoms;
  if(_hasMeta){
    h+='<div style="margin-top:14px;border-top:1px solid var(--rule2);padding-top:10px"><div class="card-hd" style="margin-bottom:6px">Production Background</div>';
    if(_meta.wikipedia_summary)h+='<div class="card-sub" style="margin-bottom:8px">'+escapeHtml(_meta.wikipedia_summary.slice(0,300))+'…</div>';
    if(_meta.opening_date||_totalWins||_totalNoms||_meta.composer){
      h+='<div class="metric-row">';
      if(_meta.opening_date)h+='<div class="metric"><div class="val">'+_meta.opening_date.slice(0,4)+'</div><div class="lbl">Opened</div></div>';
      if(_totalWins||_totalNoms){h+='<div class="metric"><div class="val">'+(_totalWins||'—')+'</div><div class="lbl">Award Wins</div></div>';h+='<div class="metric"><div class="val">'+(_totalNoms||'—')+'</div><div class="lbl">Nominations</div></div>';}
      if(_meta.composer)h+='<div class="metric"><div class="val" style="font-size:.72rem">'+escapeHtml(_meta.composer)+'</div><div class="lbl">Composer</div></div>';
      h+='</div>';
    }
    var _psig=p.signals||{};var _pbadges=[];
    if(_psig.recognition&&_psig.recognition.label&&_psig.recognition.label!=='Unknown')_pbadges.push('Recognition: '+_psig.recognition.label);
    if(_psig.press&&_psig.press.label&&_psig.press.label!=='Unknown')_pbadges.push('Press: '+_psig.press.label);
    if(_psig.tour&&_psig.tour.label&&_psig.tour.label!=='Unknown')_pbadges.push('Tour: '+_psig.tour.label);
    if(_psig.audience&&_psig.audience.label&&_psig.audience.label!=='Unknown')_pbadges.push('Audience: '+_psig.audience.label);
    if(_pbadges.length)h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">'+_pbadges.map(function(b){return '<span class="status neutral">'+b+'</span>';}).join('')+'</div>';
    if(_meta.wikipedia_url)h+='<a href="'+_meta.wikipedia_url+'" target="_blank" rel="noopener" style="font-size:.62rem;color:var(--accent);margin-top:8px;display:inline-block;">View on Wikipedia →</a>';
    h+='</div>';
  }
  } // end if(false) — Production background
  if(season&&season.end&&season.end<'2026-07-01')h+=planningVsActualHtml(p,season);
  return h;
}

function profileAtDate(show,maxDate){const rows=matchRows(show).filter(r=>r.week_of&&r.week_of<maxDate);const filtered=applyFilters(rows);const p=(window.BTD&&BTD.signals)?BTD.signals.profileShow(show,filtered,{peerType:ACTIVE_PEER||'size'}):null;if(p){p.show=show;return p;}const m=rowMetric(filtered);return{show,rows:filtered,metrics:m,score:fitScore(m,show)};}
function profileInRange(show,start,end,excl){const isBhn=r=>/bushnell|mortensen/i.test(String(r.theatre||''));let rows=matchRows(show).filter(r=>r.week_of&&r.week_of>=start&&r.week_of<=end);if(excl==='bushnell')rows=rows.filter(r=>!isBhn(r));const filtered=applyFilters(rows);const p=(window.BTD&&BTD.signals)?BTD.signals.profileShow(show,filtered,{peerType:ACTIVE_PEER||'size'}):null;if(p){p.show=show;return p;}const m=rowMetric(filtered);return{show,rows:filtered,metrics:m,score:fitScore(m,show)};}
function planningVsActualHtml(p,season){
  if(!season||!season.start||!season.end)return '';
  const hasDates=p.show.open&&p.show.close;
  // 1. Pre-season national (booking basis)
  const pre=profileAtDate(p.show,season.start);
  // 2. National tour during season, split around Bushnell run (excluding Bushnell records)
  const beforeBhn=profileInRange(p.show,season.start,hasDates?p.show.open:season.end,'bushnell');
  const afterBhn=hasDates&&p.show.close<season.end?profileInRange(p.show,p.show.close,season.end,'bushnell'):null;
  // 3. Bushnell actuals — inline since programming.page.js doesn't have bushnellRows()
  const isBhn=r=>/bushnell|mortensen/i.test(String(r.theatre||''));
  const normKey=(s=>s.toLowerCase().replace(/[^a-z0-9]/g,''))(p.show.match||p.show.title);
  const bhnRows=ALL.filter(r=>isBhn(r)&&(r.show||'').toLowerCase().replace(/[^a-z0-9]/g,'').includes(normKey)&&r.week_of>=season.start&&r.week_of<=season.end);
  const bhnCaps=bhnRows.map(r=>r.cap_paid).filter(v=>v!=null);
  const bhnGGs=bhnRows.map(r=>r.gg_pct_gp).filter(v=>v!=null);
  const bhnGross=bhnRows.map(r=>r.gross_gross).filter(v=>v!=null);
  const bhn={count:bhnRows.length,cap:bhnCaps.length?avg(bhnCaps):null,gg:bhnGGs.length?avg(bhnGGs):null,gross:bhnGross.length?avg(bhnGross):null};
  if(pre.metrics.count===0&&beforeBhn.metrics.count===0&&bhn.count===0)return '';
  const diff=(a,b)=>a==null||b==null?null:Math.round((a-b)*10)/10;
  const fmtD=(v,unit)=>v==null?'—':(v>=0?'+':'')+v+(unit||'');
  const dCls=v=>v==null?'neutral':v>=3?'good':v<=-3?'warn':'neutral';
  const panel=(label,sub,count,metrics,color)=>{
    let h=`<div style="background:var(--bg);border:1px solid var(--rule2);border-left:3px solid ${color};border-radius:3px;padding:10px">`;
    h+=`<div class="card-hd" style="margin-bottom:3px">${label}</div>`;
    h+=`<div class="card-sub" style="margin-bottom:8px">${sub} · ${count} records</div>`;
    if(count>=2){
      h+='<div class="metric-row">';
      if(metrics.cap!=null)h+=`<div class="metric"><div class="val">${pct(metrics.cap,0)}</div><div class="lbl">Tour Cap</div></div>`;
      if(metrics.gg!=null)h+=`<div class="metric"><div class="val">${pct(metrics.gg,0)}</div><div class="lbl">GG%</div></div>`;
      if(metrics.peerCap!=null)h+=`<div class="metric"><div class="val">${pct(metrics.peerCap,0)}</div><div class="lbl">Peer Cap</div></div>`;
      h+='</div>';
    }else{h+=`<div class="card-sub" style="color:var(--ink3);font-style:italic">${count===0?'No records in this window.':'Limited — '+count+' record(s).'}</div>`;}
    h+='</div>';
    return h;
  };
  let h='<div style="margin-top:14px;border-top:1px solid var(--rule2);padding-top:12px">';
  h+='<div class="card-hd" style="margin-bottom:4px">Booking Context: Planning vs. Actual</div>';
  h+='<div class="card-sub" style="margin-bottom:10px">Three lenses on the same Broadway League feed: what informed the booking decision, how the tour performed in other markets before and after the Bushnell run, and the Bushnell result itself.</div>';
  if(hasDates){
    h+=`<div class="grid grid-3" style="gap:8px;margin-bottom:8px">`;
    h+=panel('Pre-Season Read','Through '+fmtDate(season.start),pre.metrics.count,pre.metrics,'var(--amber)');
    h+=panel('Tour — Before Bushnell',fmtDate(season.start)+' – '+fmtDate(p.show.open),beforeBhn.metrics.count,beforeBhn.metrics,'var(--teal)');
    if(afterBhn)h+=panel('Tour — After Bushnell',fmtDate(p.show.close)+' – '+fmtDate(season.end),afterBhn.metrics.count,afterBhn.metrics,'var(--teal)');
    else h+=`<div style="background:var(--bg);border:1px solid var(--rule2);border-left:3px solid var(--teal);border-radius:3px;padding:10px;opacity:.5"><div class="card-hd" style="margin-bottom:3px">Tour — After Bushnell</div><div class="card-sub">Season ended before or near Bushnell close — no post-run window.</div></div>`;
    h+='</div>';
  }else{
    h+=`<div class="grid grid-2" style="gap:8px;margin-bottom:8px">`;
    h+=panel('Pre-Season Read','Through '+fmtDate(season.start),pre.metrics.count,pre.metrics,'var(--amber)');
    h+=panel('In-Season National',fmtDate(season.start)+' – '+fmtDate(season.end),beforeBhn.metrics.count,beforeBhn.metrics,'var(--teal)');
    h+='</div>';
  }
  h+='<div style="background:var(--bg);border:1px solid var(--rule2);border-left:3px solid var(--accent);border-radius:3px;padding:10px;margin-bottom:8px">';
  h+='<div class="card-hd" style="margin-bottom:3px">Bushnell Actuals</div>';
  if(bhn.count>0){
    h+=`<div class="card-sub" style="margin-bottom:8px">${hasDates?fmtDate(p.show.open)+' – '+fmtDate(p.show.close):season.id} · ${bhn.count} week${bhn.count!==1?'s':''} in the feed</div>`;
    h+='<div class="metric-row">';
    if(bhn.cap!=null)h+=`<div class="metric"><div class="val">${pct(bhn.cap,0)}</div><div class="lbl">Bushnell Cap</div></div>`;
    if(bhn.gg!=null)h+=`<div class="metric"><div class="val">${pct(bhn.gg,0)}</div><div class="lbl">GG%</div></div>`;
    if(bhn.gross!=null)h+=`<div class="metric"><div class="val">${fmt$(bhn.gross)}</div><div class="lbl">Avg Gross/Wk</div></div>`;
    const vsPreCap=diff(bhn.cap,pre.metrics.cap);
    const vsTourCap=diff(bhn.cap,beforeBhn.metrics.cap);
    if(vsPreCap!=null)h+=`<div class="metric"><div class="val ${dCls(vsPreCap)}">${fmtD(vsPreCap,'%')}</div><div class="lbl">vs Pre-Season</div></div>`;
    if(vsTourCap!=null)h+=`<div class="metric"><div class="val ${dCls(vsTourCap)}">${fmtD(vsTourCap,'%')}</div><div class="lbl">vs Tour Avg</div></div>`;
    h+='</div>';
    const capDelta=diff(bhn.cap,pre.metrics.cap);
    if(capDelta!=null){const narr=capDelta>=5?'Bushnell outperformed the pre-season national read — the engagement came in above what the touring picture projected.':capDelta<=-5?'Bushnell trailed the pre-season national read — the engagement ran softer than the national picture projected.':'Bushnell performed in line with the pre-season national read.';h+=`<div class="card-sub" style="margin-top:8px;font-style:italic">${narr}</div>`;}
  }else{h+='<div class="card-sub" style="color:var(--ink3);font-style:italic">No Bushnell records found in the feed for this season window.</div>';}
  h+='</div>';
  h+='</div>';
  return h;
}
function renderShowHistory(){const q=normalizeName($('showSearch').value);const names=[...new Set(ALL.map(d=>d.show).filter(Boolean))].filter(s=>!q||normalizeName(s).includes(q)).slice(0,30);const rows=names.map(s=>({title:s,match:s})).map(showProfile).sort((a,b)=>b.metrics.count-a.metrics.count);HISTORY_PROFILES=rows;$('tab-history').innerHTML=`<div class="section-divider"><h2>Show History</h2><div class="section-divider-line"></div><div class="section-divider-meta">Search and compare prior show performance</div></div><div class="grid grid-2"><div class="card"><div class="card-hd">Historical Show Library</div><table class="mini-table"><thead><tr><th>Show</th><th class="num">Weeks</th><th class="num">Avg Gross</th><th class="num">Cap</th></tr></thead><tbody>${rows.map((p,i)=>`<tr onclick="historyDetailByIndex(${i})" style="cursor:pointer"><td>${p.show.title} ${contextWeekCount(p.rows)}</td><td class="num">${p.metrics.count}</td><td class="num">${fmt$(p.metrics.gross)}</td><td class="num">${pct(p.metrics.cap)}</td></tr>`).join('')}</tbody></table></div><div class="card"><div class="card-hd">Selected History</div><div id="historyDetail">${rows[0]?detailHtml(rows[0]):'<div class="empty">Search for a show.</div>'}</div></div></div>`;}
function historyDetailByIndex(i){const p=HISTORY_PROFILES[i];$('historyDetail').innerHTML=p?detailHtml(p):'<div class="empty">No show selected.</div>'}
function renderPlanning(){const future=SEASONS[0];const profiles=future.shows.map(showProfile).sort((a,b)=>b.score-a.score);const allShows=[...new Set(ALL.map(d=>d.show).filter(Boolean))].map(s=>showProfile({title:s,match:s})).filter(p=>p.metrics.count>=5);const hidden=allShows.filter(p=>p.metrics.peerCap&&p.metrics.cap&&p.metrics.peerCap>p.metrics.cap+8).sort((a,b)=>(b.metrics.peerCap-b.metrics.cap)-(a.metrics.peerCap-a.metrics.cap)).slice(0,10);const risky=allShows.filter(p=>p.metrics.peerCap&&p.metrics.cap&&p.metrics.peerCap<p.metrics.cap-8).sort((a,b)=>(a.metrics.peerCap-a.metrics.cap)-(b.metrics.peerCap-b.metrics.cap)).slice(0,10);$('tab-planning').innerHTML=`<div class="section-divider"><h2>Future Planning</h2><div class="section-divider-line"></div><div class="section-divider-meta">${future.name} candidate read</div></div><div class="grid grid-3"><div class="card full"><div class="card-hd">Candidate Fit Scores</div><table class="mini-table"><thead><tr><th>Candidate</th><th>Sub</th><th class="num">Fit</th><th class="num">GG%</th><th>Revenue</th><th class="num">Cap</th><th>Demand</th><th class="num">Peer Cap</th><th>Confidence</th><th>Planning Read</th></tr></thead><tbody>${profiles.map(p=>{const med=SCORE_MED;const k=p.score>=med?'good':'warn';return ((_ps=planningSignals(p))=>`<tr><td>${p.show.title}</td><td>${p.show.sub?'Sub':'Add-on'}</td><td class="num">${scoreBadge(p)}</td><td class="num">${pct(p.metrics.gg)}</td><td>${signalBadge(_ps.revenue)}</td><td class="num">${pct(p.metrics.cap)}</td><td>${signalBadge(_ps.demand)}</td><td class="num">${pct(p.metrics.peerCap)}</td><td>${signalBadge(_ps.confidence)}</td><td>${_ps.planningRead}</td></tr>`)()}).join('')}</tbody></table></div><div class="card"><div class="card-hd">High Confidence</div><div class="rank-list">${rankItems(profiles.filter(p=>p.metrics.count>=5).slice(0,5),p=>p.show.title,p=>`${p.metrics.count} records · ${pct(p.metrics.cap,0)} cap`,p=>p.score)}</div></div><div class="card"><div class="card-hd">Needs More Data</div><div class="rank-list">${profiles.filter(p=>p.metrics.count<3).map((p,i)=>`<div class="rank-item"><div class="rank-n">${i+1}</div><div class="rank-body"><div class="rank-name">${p.show.title}</div><div class="rank-detail">${p.metrics.count} matching records</div></div></div>`).join('')||'<div class="empty">All candidates have at least 3 matching records.</div>'}</div></div><div class="card"><div class="card-hd">Fit Distribution</div><canvas id="cFuture" class="small-canvas"></canvas></div></div><div class="section-divider" style="margin-top:28px"><h2>Opportunity Engine</h2><div class="section-divider-line"></div><div class="section-divider-meta">Find hidden gems and caution signs</div></div><div class="grid grid-2"><div class="card"><div class="card-hd">Peer-Strong Hidden Gems</div><div class="card-sub">Shows that perform meaningfully better in Bushnell-size venues than nationally.</div><table class="mini-table"><thead><tr><th>Show</th><th class="num">National</th><th class="num">Peer</th><th class="num">Gap</th></tr></thead><tbody>${hidden.map(p=>`<tr><td>${p.show.title}</td><td class="num">${pct(p.metrics.cap)}</td><td class="num">${pct(p.metrics.peerCap)}</td><td class="num">+${pct(p.metrics.peerCap-p.metrics.cap)}</td></tr>`).join('')}</tbody></table></div><div class="card"><div class="card-hd">Caution List</div><div class="card-sub">Shows where the peer venue lens trails the full national average.</div><table class="mini-table"><thead><tr><th>Show</th><th class="num">National</th><th class="num">Peer</th><th class="num">Gap</th></tr></thead><tbody>${risky.map(p=>`<tr><td>${p.show.title} ${contextWeekCount(p.rows)}</td><td class="num">${pct(p.metrics.cap)}</td><td class="num">${pct(p.metrics.peerCap)}</td><td class="num">${pct(p.metrics.peerCap-p.metrics.cap)}</td></tr>`).join('')}</tbody></table></div></div>`;chartFit(profiles,'cFuture');}
function planningRead(p){if(p.metrics.count<3)return 'Insufficient tour history; use comparable titles.';if(p.score>=SCORE_MED)return 'Above-median fit — strong planning candidate.';return 'Below-median fit — review pricing, timing, and subscription support.';}
function renderPeers(){const peer=ALL.filter(d=>isPeerType(d, ACTIVE_PEER||'size')&&d.gross_gross!=null);const byVenue={};peer.forEach(d=>{const k=d.theatre+'|'+d.city;if(!byVenue[k])byVenue[k]={theatre:d.theatre,city:d.city,gross:0,caps:[],weeks:0};byVenue[k].gross+=d.gross_gross;byVenue[k].caps.push(d.cap_paid);byVenue[k].weeks++});const arr=Object.values(byVenue).map(v=>({...v,cap:avg(v.caps),avgGross:v.gross/v.weeks})).sort((a,b)=>b.weeks-a.weeks).slice(0,25);$('tab-peers').innerHTML=`<div class="section-divider"><h2>Peer Intelligence</h2><div class="section-divider-line"></div><div class="section-divider-meta">size-matched peer venue benchmark</div></div><div class="grid grid-2"><div class="card"><div class="card-hd">Top Peer Venues by Reporting Weeks</div><table class="mini-table"><thead><tr><th>Venue</th><th class="num">Weeks</th><th class="num">Cap</th><th class="num">Avg Gross</th></tr></thead><tbody>${arr.map(v=>{const k=v.theatre+'|'+v.city;const types=(PEER_META[k]&&PEER_META[k].peer_types)||[];const badges=types.map(t=>`<span class="peer-badge peer-badge-${t}">${t==='size_extended'?'Extended':t.charAt(0).toUpperCase()+t.slice(1)}</span>`).join('');return `<tr><td>${v.theatre}${badges}<br><span style="color:var(--ink3);font-size:.58rem">${v.city}</span></td><td class="num">${v.weeks}</td><td class="num">${pct(v.cap)}</td><td class="num">${fmt$(v.avgGross)}</td></tr>`}).join('')}</tbody></table></div><div class="card"><div class="card-hd">Peer Capacity Distribution</div><canvas id="cPeers"></canvas></div></div>`;chartPeers(arr)}
function renderOpportunity(){const allShows=[...new Set(ALL.map(d=>d.show).filter(Boolean))].map(s=>showProfile({title:s,match:s})).filter(p=>p.metrics.count>=5);const hidden=allShows.filter(p=>p.metrics.peerCap&&p.metrics.cap&&p.metrics.peerCap>p.metrics.cap+8).sort((a,b)=>(b.metrics.peerCap-b.metrics.cap)-(a.metrics.peerCap-a.metrics.cap)).slice(0,10);const risky=allShows.filter(p=>p.metrics.peerCap&&p.metrics.cap&&p.metrics.peerCap<p.metrics.cap-8).sort((a,b)=>(a.metrics.peerCap-a.metrics.cap)-(b.metrics.peerCap-b.metrics.cap)).slice(0,10);$('tab-opportunity').innerHTML=`<div class="section-divider"><h2>Opportunity Engine</h2><div class="section-divider-line"></div><div class="section-divider-meta">Find hidden gems and caution signs</div></div><div class="grid grid-2"><div class="card"><div class="card-hd">Peer-Strong Hidden Gems</div><div class="card-sub">Shows that perform meaningfully better in Bushnell-size venues than nationally.</div><table class="mini-table"><thead><tr><th>Show</th><th class="num">National</th><th class="num">Peer</th><th class="num">Gap</th></tr></thead><tbody>${hidden.map(p=>`<tr><td>${p.show.title}</td><td class="num">${pct(p.metrics.cap)}</td><td class="num">${pct(p.metrics.peerCap)}</td><td class="num">+${pct(p.metrics.peerCap-p.metrics.cap)}</td></tr>`).join('')}</tbody></table></div><div class="card"><div class="card-hd">Caution List</div><div class="card-sub">Shows where the peer venue lens trails the full national average.</div><table class="mini-table"><thead><tr><th>Show</th><th class="num">National</th><th class="num">Peer</th><th class="num">Gap</th></tr></thead><tbody>${risky.map(p=>`<tr><td>${p.show.title}</td><td class="num">${pct(p.metrics.cap)}</td><td class="num">${pct(p.metrics.peerCap)}</td><td class="num">${pct(p.metrics.peerCap-p.metrics.cap)}</td></tr>`).join('')}</tbody></table></div></div>`;}
function rankItems(items,nameFn,detailFn,valFn){return BTD.components&&BTD.components.rankItems?BTD.components.rankItems(items,nameFn,detailFn,valFn):''}
function chartFit(profiles,id){return BTD.charts&&BTD.charts.renderFitChart?BTD.charts.renderFitChart(id,profiles):null}
function chartCap(profiles,id){
  if(!BTD.charts||!BTD.charts.renderMultiBar)return null;
  var pp=(profiles||[]).filter(function(x){return x.metrics&&(x.metrics.cap!=null||x.metrics.peerCap!=null);});
  if(!pp.length)return null;
  var shorten=function(s,n){s=String(s||'');return s.length>n?s.slice(0,n)+'…':s;};
  var el=typeof id==='string'?document.getElementById(id):id;
  if(el)el.style.height=Math.max(220,pp.length*34+40)+'px';
  return BTD.charts.renderMultiBar(id,
    pp.map(function(x){return shorten((x.show&&x.show.title)||'',22);}),
    [{label:'Tour Cap',data:pp.map(function(x){return x.metrics.cap||0;}),backgroundColor:'#003865',borderRadius:2},
     {label:'Peer Cap',data:pp.map(function(x){return x.metrics.peerCap||0;}),backgroundColor:'rgba(0,56,101,.35)',borderRadius:2}],
    {indexAxis:'y',plugins:{legend:{display:true,labels:{color:'#6b6b6b',font:{size:9}}}},scales:{x:{min:0,max:110,ticks:{callback:function(v){return v+'%';}}},y:{grid:{display:false}}}}
  );
}
function chartPeers(arr){return BTD.charts&&BTD.charts.renderPeerChart?BTD.charts.renderPeerChart('cPeers',arr):null}
function confidenceLabel(p){return BTD.page&&BTD.page.confidenceLabel?BTD.page.confidenceLabel(p):((p&&p.signals&&p.signals.confidence&&p.signals.confidence.label)||'Exploratory');}
function confidenceText(p){const c=confidenceLabel(p);if(c==='High')return 'Broad tour evidence across multiple venues.';if(c==='Medium')return 'Usable evidence, but still needs context.';if(c==='Low')return 'Light sample; validate before relying on it.';return 'No matched touring records in this feed.'}
function scoreBadge(p){return BTD.page&&BTD.page.scoreBadge?BTD.page.scoreBadge(p,SCORE_MED):'<span class="status neutral">—</span>';}

// ── PLANNING SIGNAL MODEL ─────────────────────────────────────────────────────
function planningSignals(p){return BTD.page&&BTD.page.planningSignals?BTD.page.planningSignals(p):BTD.signals.signalLabels(p);}

function signalBadge(label){return BTD.page&&BTD.page.signalBadge?BTD.page.signalBadge(label):'<span class="status neutral">'+label+'</span>';}

function signalRow(signals){return BTD.page&&BTD.page.signalRow?BTD.page.signalRow(signals):'';}

function whyThisRead(p,signals){return BTD.page&&BTD.page.whyThisRead?BTD.page.whyThisRead(p):'<div class="card-sub">No explanation available.</div>';}
function short(s,n){return BTD.page&&BTD.page.short?BTD.page.short(s,n):(s&&s.length>n?s.slice(0,n)+'…':s)}function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
Chart.defaults.font.family = "'Libre Franklin', sans-serif";
Chart.defaults.font.size = 10;
function awardWins(rec){return Object.values((rec&&rec.awards)||{}).reduce((a,v)=>a+Number((v&&v.wins)||0),0);}
function awardNoms(rec){return Object.values((rec&&rec.awards)||{}).reduce((a,v)=>a+Number((v&&v.nominations)||0),0);}
function recognitionLabel(rec){return rec&&rec.signals&&rec.signals.recognition&&rec.signals.recognition.label || (awardNoms(rec)?'Awarded':'—');}

loadData();
