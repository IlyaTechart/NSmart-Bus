/* quick checks of the engine on real data: node tools/test_core.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const WWW = path.join(__dirname, '..', 'www');
for (const f of ['net.js', 'nsmart.js', 'gspns.js', 'model.js']) vm.runInThisContext(fs.readFileSync(path.join(WWW, 'js', f), 'utf8'), { filename: f });
const T = globalThis.T, G = T.gspns, M = T.model;
const assert = require('assert');
// naming
assert.deepStrictEqual(['14S', '3A', '54"A"', '9A', '1GL', '10APT', '35ČL', '7A', '18A', '24Š'].map(G.base), ['14', '3A', '54', '9', '1', '10', '35', '7A', '18A', '24']);
// fixture timetable (NSBusTablica tests/fixtures)
const fx = fs.readFileSync(path.join(__dirname, 'fixtures/ispis_rvg_R_14.html'), 'utf8');
const tt = G.parseTimetables(fx)['14'];
assert.ok(tt && tt.directions.length === 2, 'two directions');
console.log('14:', tt.title, '|', tt.directions.map(d => G.headerLetter(d.header) + ' ' + d.departures.length + ' deps, first ' + d.departures[0].t + (d.departures[0].mark || '')).join(' ; '));
console.log('legend:', (tt.legend || '').slice(0, 120));
assert.strictEqual(G.headerLetter('Polasci za VETERNIK'), 'A');
assert.deepStrictEqual(G.expandDepartures([{ t: '23:40' }, { t: '00:15', mark: 'X' }]), [[0, 23, 40, null], [1, 0, 15, 'X']]);
assert.strictEqual(G.fallbackDayType('2026-04-13'), 'P');   // Orthodox Easter Monday 2026
assert.strictEqual(G.fallbackDayType('2026-11-14'), 'S');
// Belgrade time helpers
const ts = T.bgTs(2026, 7, 1, 12, 0); assert.strictEqual(T.hhmm(ts), '12:00');
const ts2 = T.bgTs(2026, 12, 31, 24, 30); assert.strictEqual(T.isoDay(T.bg(ts2)), '2027-01-01');
// projection along a route, using a real sample (6712, bus 14S 1015)
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/raw_6712_live_far.json'), 'utf8'));
const res = T.nsmart.parse('6712', raw);
const t0 = Date.now();
M.observe(res.buses, t0);
const v = M.vehicles['1015'];
const p0 = M.vehiclePos(v, t0), p1 = M.vehiclePos(v, t0 + 600e3), pEnd = M.vehiclePos(v, t0 + 3000e3);
console.log('14S 1015 at obs', p0.la.toFixed(5), p0.lo.toFixed(5), 'next', M.routes[v.rk].s[p0.nextJ][0],
  '| +10 min', p1.la.toFixed(5), p1.lo.toFixed(5), 'next stop', M.routes[v.rk].s[p1.nextJ][0], '| +50 min done', pEnd.done);
assert.ok(!p0.done && !p1.done && pEnd.done);
// at +1209 s the bus must be at stop 6712 (second_left_by_route there = 1209)
const p12 = M.vehiclePos(v, t0 + 1209e3); const s6712 = M.routes[v.rk].s.find(x => x[0] === '6712');
console.log('+1209 s -> distance to 6712:', Math.round(M.dist(p12.la, p12.lo, s6712[1], s6712[2])), 'm');
assert.ok(M.dist(p12.la, p12.lo, s6712[1], s6712[2]) < 1, 'ETA reaches the observed stop');
assert.ok(M.isFresh(v, t0), 'new coordinates are fresh');
M.observe(res.buses, t0 + 60000);
assert.strictEqual(M.vehicles['1015'].obsAt, t0, 'repeated cached GPS must not reset observation time');
assert.strictEqual(M.isFresh(M.vehicles['1015'], t0 + 60000), false, 'cached coordinates become estimated');
assert.strictEqual(M.isFresh({lat:null,lng:null,obsAt:t0}, t0), false, 'missing GPS cannot be live');
assert.ok(T.nsmart.parse('6539', JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/raw_6539_empty.json'), 'utf8'))).buses.length === 0);
assert.ok(T.nsmart.parse('bad', [false, 3]).error);
// Viewport priority, bounded sweeps and fair rotation across empty/failed stops.
const oldStations = M.stations, oldArea = M.viewport, oldAttempts = M.polledAt;
M.stations = {}; M.polledAt = {}; M.viewport = {south:45,north:46,west:19,east:20};
const candidates = Array.from({length:100}, (_,i)=>String(i));
candidates.forEach((u,i)=>{ M.stations[u] = {la:i<50?45.25:47,lo:19.85}; });
let sweep = M.prioritize(candidates);
assert.strictEqual(sweep.length,32);
assert.strictEqual(new Set(sweep).size,32);
assert.ok(sweep.slice(0,24).every(u=>+u<50), 'visible stops first');
const polled = new Set();
for(let i=1;i<=15;i++) {
  sweep = M.prioritize(candidates);
  sweep.forEach(u=>{M.polledAt[u]=i;polled.add(u);});
}
assert.strictEqual(polled.size,100, 'offscreen stops are eventually polled');
assert.deepStrictEqual(M.prioritize(['1','2']),['1','2'], 'small queues retain all stops');
M.stations=oldStations;M.viewport=oldArea;M.polledAt=oldAttempts;
console.log('core OK; viewport priority and rotation OK');
(async () => {
  if (process.argv[2] !== 'live') return;
  const idx = await G.loadIndex(); console.log('gspns index', idx);
  const opts = await G.loadOptions('rvg', idx.vaziod[idx.vaziod.length - 1], idx.dayType || 'R');
  console.log('options', opts.length, opts.slice(0, 3));
  const tbl = await G.loadTables('rvg', idx.vaziod[idx.vaziod.length - 1], idx.dayType || 'R', opts.map(o => o.value));
  console.log('tables', Object.keys(tbl).length, Object.keys(tbl).join(' '));
  for (const b of ['3A', '7A', '18A']) if (tbl[b]) console.log(b, tbl[b].directions.map(d => d.header + ' (' + d.departures.length + ')').join(' | '));
  const sub = await G.loadOptions('rvp', idx.vaziod[idx.vaziod.length - 1], idx.dayType || 'R');
  const ts2 = await G.loadTables('rvp', idx.vaziod[idx.vaziod.length - 1], idx.dayType || 'R', sub.slice(0, 40).map(o => o.value));
  console.log('suburban tables', Object.keys(ts2).length, Object.values(ts2)[0].directions.map(d => d.header).join(' | '));
})();
