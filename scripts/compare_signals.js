#!/usr/bin/env node
/* Phase 2 regression check: confirms canonical Planning Signals can be produced for every season title. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const ctx = { console, window: {}, document: {}, fetch: null };
ctx.window = ctx;
vm.createContext(ctx);
['config','state','format','metrics','peers','seasons','signals'].forEach(name => {
  const file = path.join(src, 'js', 'core', `${name}.js`);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
});
const dataRaw = JSON.parse(fs.readFileSync(path.join(src, 'data', 'data.json'), 'utf8'));
ctx.BTD.state.all = (dataRaw.records || dataRaw).map(r => ({ ...r, on_sub: r.on_sub ? 1 : 0 }));
const seasonsRaw = JSON.parse(fs.readFileSync(path.join(src, 'data', 'seasons.json'), 'utf8'));
ctx.BTD.state.seasons = Object.entries(seasonsRaw).map(([id, data]) => ({
  id,
  name: `${id} Season`,
  start: `${id.slice(0,4)}-07-01`,
  end: `${Number(id.slice(0,4))+1}-06-30`,
  shows: (data.shows || []).map(s => ({ title: s.name, match: s.league_name, open: s.open || null, close: s.close || null, sub: s.sub }))
})).sort((a,b) => b.id.localeCompare(a.id));
const peersRaw = JSON.parse(fs.readFileSync(path.join(src, 'data', 'peers.json'), 'utf8'));
ctx.BTD.state.peerMeta = {};
(peersRaw.venues || []).forEach(v => { ctx.BTD.state.peerMeta[`${v.theatre}|${v.city}`] = v; });
const seasonId = process.argv[2] || ctx.BTD.state.seasons[0].id;
const season = ctx.BTD.state.seasons.find(s => s.id === seasonId) || ctx.BTD.state.seasons[0];
const profiles = season.shows.map(show => ctx.BTD.signals.profileShow(show, ctx.BTD.state.all, { seasonId, peerType: 'size' }));
const bad = profiles.filter(p => !p.signals || !p.planning || !p.signals.demand || !p.signals.revenue || !p.signals.peer || !p.signals.confidence);
console.log(`Canonical signal report: ${season.id} (${profiles.length} titles)`);
console.log('Title\tDemand\tRevenue\tPeer\tConfidence\tRead\tRecords');
profiles.forEach(p => {
  console.log([p.title, p.signals.demand.label, p.signals.revenue.label, p.signals.peer.label, p.signals.confidence.label, p.planning.read, p.metrics.count].join('\t'));
});
if (bad.length) {
  console.error(`FAIL: ${bad.length} profiles missing signal fields.`);
  process.exit(1);
}
console.log('PASS: all profiles have canonical Demand / Revenue / Peer / Confidence / Planning Read.');
