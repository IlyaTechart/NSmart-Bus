/* The engine: where is every bus right now.
 *
 * Built on the NSBusTablica ideas (see ../../NSBusTablica_analysis.md):
 *  - nsmart answers "which buses are coming to stop X" (with GPS + the bus's whole route). There is no
 *    "all buses" request, so we poll a set of "sentinel" stops chosen along every learned route, so that every bus
 *    is in front of at least one of them (a stop sees buses ~15-20 min ahead).
 *  - Between two answers a bus is moved along its route by the seconds nsmart gave for every next stop
 *    (second_left_by_route): smooth movement without new GPS ("est", yellow).
 *  - Trips of the official gspns timetable that no real bus covers are drawn "virtually": departure time +
 *    scheduled minutes from the terminal (tt_time) for each stop, interpolated between stops ("sched", grey).
 *  - A live bus is matched to its timetable trip (same departure +-1 min, else nearest progress +-6 min), so a
 *    trip is never drawn twice.
 */
(function (T) {
  'use strict';
  const G = T.gspns, N = T.nsmart;

  const LIVE_MAX_AGE = 40e3;      // seen within 40 s = fresh GPS (green)
  const HOLD_MAX = 20 * 60e3;     // forget a vehicle not seen for 20 min (NStupido HOLD_MAX)
  const END_GRACE = 90e3;         // ... or 90 s after its extrapolation reached the end of its route
  const MATCH_EXACT = 60e3;       // live bus <-> timetable trip: same departure +-1 min ...
  const MATCH_NEAR = 6 * 60;      // ... else nearest progress +-6 min (s)
  const GAP_MIN = 10;             // a sentinel stop at least every 10 scheduled minutes along each route
  const BOOT_STOPS = 4;           // stops polled for a line whose route is not learned yet
  const ROUTE_TTL = 90 * 86400e3; // forget learned routes not seen for 90 days
  const STATIONS_MAX_AGE = 14 * 86400e3;
  const DEFAULT_SPEED = 7;        // m/s, only when nsmart gives no per-stop seconds

  const M = T.model = {
    stations: {}, stationsAt: 0,
    routes: {},                   // key -> {k, line, base, dir, actual, title, dest, s:[[id,lat,lon,tt]], t}
    vehicles: {},                 // garage_no -> live vehicle
    lines: {},                    // base -> {base, city, variants:[...], stops:[uid]}
    sched: { index: null, tables: {}, error: null, loading: false },
    trips: [], tripsAt: 0, matched: {},   // active timetable trips + which are covered by a real bus
    focus: null,                  // base route shown alone, or null = all
    cats: { city: true, sub: true },
    active: true,                 // polling on (map visible, app in foreground)
    queue: [], qi: 0, cycleStart: 0, lastCycleS: null, lastOkAt: 0, lastError: null,
    requests: 0, listeners: []
  };

  // ---------------- helpers ----------------
  function dist(la1, lo1, la2, lo2) {
    const k = Math.PI / 180;
    const x = (lo2 - lo1) * k * Math.cos((la1 + la2) / 2 * k);
    return Math.hypot(x, (la2 - la1) * k) * 6371000;
  }
  M.dist = dist;
  function emit(what) { M.listeners.forEach(function (f) { try { f(what); } catch (e) { /* ignore */ } }); }
  M.on = function (f) { M.listeners.push(f); };
  M.isCity = function (b) { const l = M.lines[b]; return l ? l.city : (parseInt(b, 10) < 21); };

  /* nsmart departure "HH:MM:SS" (no date) -> epoch ms nearest to now within [now-20h, now+4h] */
  function depTs(dep, now) {
    if (!dep || dep === '00:00:00') return null;
    const p = dep.split(':').map(function (x) { return parseInt(x, 10); });
    if (!isFinite(p[0]) || !isFinite(p[1])) return null;
    const b = T.bg(now);
    let best = null;
    [-1, 0, 1].forEach(function (k) {
      const ts = T.bgTs(b.y, b.m, b.d + k, p[0], p[1], p[2] || 0);
      const d = ts - now;
      if (d >= -20 * 3600e3 && d <= 4 * 3600e3 && (best === null || Math.abs(d) < Math.abs(best - now))) best = ts;
    });
    return best;
  }
  M.depTs = depTs;

  // ---------------- stations + line catalogue ----------------
  function buildLines() {
    const L = {};
    Object.keys(M.stations).forEach(function (uid) {
      const s = M.stations[uid];
      (s.l || []).forEach(function (line) {
        const b = G.base(line);
        const e = L[b] || (L[b] = { base: b, city: false, variants: {}, stops: [] });
        e.variants[line] = 1;
        if (String((s.t || {})[line]) === '1') e.city = true;
        e.stops.push(uid);
      });
    });
    Object.keys(L).forEach(function (b) { L[b].variants = Object.keys(L[b].variants).sort(); });
    M.lines = L;
  }
  M.lineList = function () { return Object.keys(M.lines).sort(G.lineSort).map(function (b) { return M.lines[b]; }); };

  async function refreshStations() {
    try {
      const st = await N.fetchStations();
      M.stations = st; M.stationsAt = Date.now();
      T.store.set('stations_v1', { at: M.stationsAt, st: st });
      buildLines();
      emit('stations');
    } catch (e) { M.lastError = 'список остановок: ' + (e && e.message || e); }
  }

  // ---------------- routes (learned from nsmart all_stations) ----------------
  let routesDirty = false, routeCache = {};
  function learnRoute(b, now) {
    if (!b.line || !b.stops || b.stops.length < 2) return null;
    const first = b.stops[0][0], last = b.stops[b.stops.length - 1][0];
    const k = b.line + '|' + first + '|' + last + '|' + b.stops.length;
    const old = M.routes[k];
    if (old && now - old.t < 3600e3) { old.t = Math.max(old.t, now); return k; }
    let prevTt = 0;
    const s = b.stops.map(function (x) {
      const st = M.stations[x[0]];
      const tt = x[3] == null ? prevTt : x[3];
      prevTt = tt;
      return [x[0], x[1] != null ? x[1] : (st ? st.la : null), x[2] != null ? x[2] : (st ? st.lo : null), tt];
    });
    M.routes[k] = { k: k, line: b.line, base: G.base(b.line), dir: b.dir, actual: b.actual, title: b.title,
                    dest: b.dest, s: s, t: now };
    if (!old) routeCache = {};
    routesDirty = true;
    return k;
  }
  M.learnRoute = learnRoute;
  function saveRoutes() {
    if (!routesDirty) return;
    routesDirty = false;
    T.store.set('routes_v1', M.routes);
  }

  /* which learned route a timetable departure runs on: base + direction + the departure's variant mark */
  function routeFor(base, dir, mark) {
    const ck = base + '|' + dir + '|' + (mark || '');
    if (ck in routeCache) return routeCache[ck];
    const cands = Object.values(M.routes).filter(function (r) { return r.base === base && r.dir === dir; });
    let res = null;
    if (cands.length) {
      const sfx = function (r) { return G.norm(r.line.indexOf(r.base) === 0 ? r.line.slice(r.base.length) : r.line); };
      let want = '';
      if (mark) {
        const m = G.norm(mark);
        const tries = [m];
        if (m.indexOf('NR') === 0 && m.length > 2) tries.push(m.slice(2));
        if (m.indexOf('N') === 0 && m.length > 1) tries.push(m.slice(1));
        const all = cands.map(sfx);
        want = tries.find(function (t) { return all.indexOf(t) >= 0; });
        if (want === undefined) {
          for (const t of tries) {
            const hits = Array.from(new Set(all.filter(function (x) { return x && (x.indexOf(t) === 0 || t.indexOf(x) === 0); })));
            if (hits.length === 1) { want = hits[0]; break; }
          }
        }
        if (want === undefined) want = '';
      }
      let pool = cands.filter(function (r) { return sfx(r) === want; });
      if (!pool.length) pool = cands;          // not learned yet: the closest thing we have (approximate path)
      pool.sort(function (a, b) { return (b.s.length - a.s.length) || (b.t - a.t); });
      res = pool[0];
    }
    routeCache[ck] = res;
    return res;
  }
  M.routeFor = routeFor;

  // ---------------- live vehicles ----------------
  /* time line of one observation: [{t seconds after the observation, la, lo, j stop index}] */
  function timeline(v) {
    const R = M.routes[v.rk];
    const pts = [];
    if (!R) {
      if (v.lat != null) pts.push({ t: 0, la: v.lat, lo: v.lng, j: -1 });
      return pts;
    }
    const s = R.s;
    let k = Math.min(Math.max((v.next || 1) - 1, 0), s.length - 1);
    if (v.lat != null) pts.push({ t: 0, la: v.lat, lo: v.lng, j: k - 0.5 });
    else if (s[Math.max(k - 1, 0)][1] != null) pts.push({ t: 0, la: s[Math.max(k - 1, 0)][1], lo: s[Math.max(k - 1, 0)][2], j: k - 1 });
    else return pts;
    let lastT = 0, any = false;
    for (let j = k; j < s.length; j++) {
      const t = v.slr[j] || 0;
      if (t > 0 && t >= lastT && s[j][1] != null) { pts.push({ t: t, la: s[j][1], lo: s[j][2], j: j }); lastT = t; any = true; }
    }
    if (!any) {                                   // no per-stop seconds: scheduled minutes + distance to next stop
      pts.length = 1;
      const t0 = s[k][1] != null ? dist(pts[0].la, pts[0].lo, s[k][1], s[k][2]) / DEFAULT_SPEED : 60;
      for (let j = k; j < s.length; j++) {
        if (s[j][1] == null) continue;
        pts.push({ t: t0 + (s[j][3] - s[k][3]) * 60, la: s[j][1], lo: s[j][2], j: j });
      }
    }
    return pts;
  }

  function along(pts, sec) {
    if (!pts.length) return null;
    if (pts.length === 1 || sec <= 0) return { la: pts[0].la, lo: pts[0].lo, nextJ: pts[1] ? pts[1].j : null, done: false };
    for (let i = 1; i < pts.length; i++) {
      if (sec <= pts[i].t) {
        const a = pts[i - 1], b = pts[i];
        const f = b.t > a.t ? (sec - a.t) / (b.t - a.t) : 1;
        return { la: a.la + (b.la - a.la) * f, lo: a.lo + (b.lo - a.lo) * f, nextJ: b.j, done: false,
                 left: b.t - sec };
      }
    }
    const z = pts[pts.length - 1];
    return { la: z.la, lo: z.lo, nextJ: null, done: true, over: sec - z.t };
  }

  M.observe = function (buses, now) {
    let n = 0;
    (buses || []).forEach(function (b) {
      if (b.planned || !b.line) return;
      const rk = learnRoute(b, now);
      const sig = [b.line, b.dep, b.lat, b.lng, b.next].join('|');
      const v = M.vehicles[b.garage];
      if (v && v.sig === sig) { v.seenAt = now; return; }   // same snapshot again: keep counting from the first time
      const nv = { g: b.garage, line: b.line, base: G.base(b.line), dir: b.dir, actual: b.actual, dest: b.dest,
                   title: b.title, dep: b.dep, lat: b.lat, lng: b.lng, cur: b.cur, next: b.next, rk: rk,
                   slr: b.stops.map(function (x) { return x[4]; }), obsAt: now, seenAt: now, sig: sig };
      nv.tl = timeline(nv);
      M.vehicles[b.garage] = nv;
      n++;
    });
    return n;
  };

  M.vehiclePos = function (v, now) { return along(v.tl, (now - v.obsAt) / 1000); };
  M.isFresh = function (v, now) {
    return v.lat != null && v.lng != null && now - v.obsAt <= LIVE_MAX_AGE;
  };

  function prune(now) {
    Object.keys(M.vehicles).forEach(function (g) {
      const v = M.vehicles[g];
      const p = M.vehiclePos(v, now);
      if (now - v.seenAt > HOLD_MAX || !p || (p.done && p.over * 1000 > END_GRACE)) delete M.vehicles[g];
    });
  }

  /* where a live bus is on the schedule: seconds since its departure as tt_time counts them */
  function progressSec(v, now) {
    const R = M.routes[v.rk];
    if (!R) return null;
    const p = M.vehiclePos(v, now);
    if (!p) return null;
    if (p.nextJ == null || p.nextJ < 0) return R.s[R.s.length - 1][3] * 60;
    return R.s[p.nextJ][3] * 60 - (p.left || 0);
  }

  // ---------------- timetable ----------------
  function vaziodFor(isoDay) {
    const idx = M.sched.index;
    const vs = (idx && idx.vaziod) || [];
    if (!vs.length) return null;
    const past = vs.filter(function (v) { return v <= isoDay; });
    return past.length ? past[past.length - 1] : vs[0];
  }
  M.vaziodFor = vaziodFor;
  function dayTypeFor(isoDay) {
    const idx = M.sched.index;
    return (idx && idx.day === isoDay && idx.dayType) || G.fallbackDayType(isoDay);
  }
  M.dayTypeFor = dayTypeFor;

  async function ensureIndex() {
    const today = T.isoDay(T.bg(Date.now()));
    let idx = M.sched.index || T.store.get('gspns_index', null);
    if (!idx || idx.day !== today) {
      try {
        const x = await G.loadIndex();
        idx = { day: today, dayType: x.dayType, vaziod: x.vaziod.length ? x.vaziod : (idx && idx.vaziod) || [], at: Date.now() };
        T.store.set('gspns_index', idx);
      } catch (e) {
        M.sched.error = 'gspns.rs: ' + (e && e.message || e);
        if (!idx) return null;
      }
    }
    M.sched.index = idx;
    return idx;
  }

  /* timetables of every line for one (rv, day type): 2 gspns requests, cached for a week */
  async function ensureTables(rv, dan, force) {
    const idx = await ensureIndex();
    if (!idx) throw new Error(M.sched.error || 'нет связи с gspns.rs');
    const vaziod = vaziodFor(T.isoDay(T.bg(Date.now())));
    const key = 'tt2|' + vaziod + '|' + rv + '|' + dan;
    let obj = M.sched.tables[rv + '|' + dan];
    if (!force && obj && obj.key === key) return obj;
    obj = force ? null : T.store.get(key, null);
    if (!obj || Date.now() - obj.fetched > 7 * 86400e3) {
      const opts = await G.loadOptions(rv, vaziod, dan);
      const lines = await G.loadTables(rv, vaziod, dan, opts.map(function (o) { return o.value; }));
      obj = { key: key, rv: rv, dan: dan, vaziod: vaziod, fetched: Date.now(), options: opts, lines: lines };
      // keep localStorage small: drop older copies of the same (rv, dan)
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.indexOf('tt2|') === 0 && k.endsWith('|' + rv + '|' + dan) && k !== key) localStorage.removeItem(k);
        }
      } catch (e) { /* no localStorage (node) */ }
      T.store.set(key, obj);
    }
    G.addBases(obj.options.map(function (o) { return o.value; }));
    routeCache = {};
    M.sched.tables[rv + '|' + dan] = obj;
    return obj;
  }
  M.ensureTables = ensureTables;

  async function loadSchedule() {
    if (M.sched.loading) return;
    M.sched.loading = true;
    try {
      const now = Date.now();
      const days = [T.isoDay(T.bg(now))];
      if (T.bg(now).hh < 5) days.push(T.isoDay(T.bg(now - 86400e3)));
      await ensureIndex();
      const dans = Array.from(new Set(days.map(dayTypeFor)));
      for (const dan of dans) for (const rv of ['rvg', 'rvp']) await ensureTables(rv, dan);
      M.sched.error = null;
      M.tripsAt = 0;
      emit('schedule');
    } catch (e) {
      M.sched.error = 'расписание: ' + (e && e.message || e);
    } finally { M.sched.loading = false; }
  }
  M.loadSchedule = loadSchedule;

  /* timetable departures in [from, to] (both service days that can matter) -> trip objects */
  function departures(now, from, to, onlyBase) {
    const out = [];
    const days = [T.bg(now), T.bg(now - 86400e3)];
    days.forEach(function (b) {
      const dan = dayTypeFor(T.isoDay(b));
      ['rvg', 'rvp'].forEach(function (rv) {
        const tbl = M.sched.tables[rv + '|' + dan];
        if (!tbl) return;
        Object.keys(tbl.lines).forEach(function (base) {
          if (onlyBase && base !== onlyBase) return;
          const t = tbl.lines[base];
          t.directions.forEach(function (d, ci) {
            const L = G.headerLetter(d.header) || (ci ? 'B' : 'A');
            const x = d._x || (d._x = G.expandDepartures(d.departures));
            x.forEach(function (q) {
              const ts = T.bgTs(b.y, b.m, b.d + q[0], q[1], q[2], 0);
              if (ts < from || ts > to) return;
              out.push({ id: rv + '|' + base + '|' + L + '|' + ts, rv: rv, base: base, dir: L, mark: q[3], depTs: ts,
                         dest: G.destination(d.header), header: d.header });
            });
          });
        });
      });
    });
    return out;
  }
  M.departures = departures;

  /* trips on the road now (departed, not yet at the end of their route), matched with live buses */
  function refreshTrips(now) {
    const trips = [];
    departures(now, now - 3 * 3600e3, now).forEach(function (t) {
      const R = routeFor(t.base, t.dir, t.mark);
      if (!R) return;
      const dur = R.s[R.s.length - 1][3] * 60e3;
      if (now > t.depTs + dur + 60e3) return;
      t.rk = R.k; t.line = R.line;
      trips.push(t);
    });
    // match: a trip covered by a real bus is not drawn virtually
    const matched = {}, byV = {};
    const groups = {};
    trips.forEach(function (t) { (groups[t.base + '|' + t.dir] = groups[t.base + '|' + t.dir] || { t: [], v: [] }).t.push(t); });
    Object.values(M.vehicles).forEach(function (v) {
      const g = groups[v.base + '|' + v.dir];
      if (g) g.v.push(v);
    });
    Object.values(groups).forEach(function (g) {
      const left = g.v.slice();
      // 1) same departure +-1 min
      for (let i = left.length - 1; i >= 0; i--) {
        const v = left[i], d = depTs(v.dep, now);
        if (d == null) continue;
        let best = null;
        g.t.forEach(function (t) {
          if (matched[t.id] || Math.abs(t.depTs - d) > MATCH_EXACT) return;
          if (!best || Math.abs(t.depTs - d) < Math.abs(best.depTs - d)) best = t;
        });
        if (best) { matched[best.id] = v.g; byV[v.g] = best; left.splice(i, 1); }
      }
      // 2) nearest position on the schedule +-6 min
      left.forEach(function (v) {
        const pr = progressSec(v, now);
        if (pr == null) return;
        let best = null, bd = MATCH_NEAR + 1;
        g.t.forEach(function (t) {
          if (matched[t.id]) return;
          const d = Math.abs((now - t.depTs) / 1000 - pr);
          if (d < bd) { bd = d; best = t; }
        });
        if (best) { matched[best.id] = v.g; byV[v.g] = best; }
      });
    });
    M.trips = trips; M.matched = matched; M.tripOf = byV; M.tripsAt = now;
  }

  function tripPos(t, now) {
    const R = M.routes[t.rk];
    if (!R) return null;
    const pts = [];
    R.s.forEach(function (x, j) { if (x[1] != null) pts.push({ t: x[3] * 60, la: x[1], lo: x[2], j: j }); });
    return along(pts, (now - t.depTs) / 1000);
  }

  // ---------------- what to draw ----------------
  M.snapshot = function (now) {
    if (now - M.tripsAt > 15e3) { prune(now); refreshTrips(now); }
    const out = [];
    const want = function (b) { return M.focus ? b === M.focus : (M.isCity(b) ? M.cats.city : M.cats.sub); };
    Object.values(M.vehicles).forEach(function (v) {
      if (!want(v.base)) return;
      const p = M.vehiclePos(v, now);
      if (!p || (p.done && p.over * 1000 > END_GRACE)) return;
      const R = M.routes[v.rk];
      const trip = M.tripOf && M.tripOf[v.g];
      out.push({ id: 'v' + v.g, kind: M.isFresh(v, now) ? 'gps' : 'est', base: v.base, line: v.line,
                 dir: v.dir, dest: v.dest || (R && R.dest), title: v.title, la: p.la, lo: p.lo, garage: v.g,
                 age: Math.round((now - v.obsAt) / 1000), seen: Math.round((now - v.seenAt) / 1000),
                 next: R && p.nextJ != null && p.nextJ >= 0 ? stationName(R.s[p.nextJ][0]) : null,
                 dep: v.dep && v.dep !== '00:00:00' ? v.dep.slice(0, 5) : (trip ? T.hhmm(trip.depTs) : null), rk: v.rk });
    });
    M.trips.forEach(function (t) {
      if (M.matched[t.id] || !want(t.base)) return;
      const p = tripPos(t, now);
      if (!p || p.done || now < t.depTs) return;
      const R = M.routes[t.rk];
      out.push({ id: 't' + t.id, kind: 'sched', base: t.base, line: t.line, dir: t.dir, dest: t.dest || (R && R.dest),
                 title: R && R.title, la: p.la, lo: p.lo, dep: T.hhmm(t.depTs), mark: t.mark,
                 next: p.nextJ != null && p.nextJ >= 0 ? stationName(R.s[p.nextJ][0]) : null, rk: t.rk });
    });
    return out;
  };

  function stationName(uid) { const s = M.stations[uid]; return s ? s.n : null; }
  M.stationName = stationName;

  M.routesOf = function (base) {
    return Object.values(M.routes).filter(function (r) { return r.base === base && Date.now() - r.t < ROUTE_TTL; });
  };

  // ---------------- one stop: when is the next bus (NStupido G / E / P) ----------------
  M.arrivals = async function (uid) {
    const r = await N.fetchStop(uid);
    const now = Date.now();
    prune(now);
    const out = [];
    const seen = {};
    if (!r.error) {
      M.observe(r.buses, now);
      r.buses.forEach(function (b) {
        if (b.planned) return;
        seen[b.garage] = 1;
        out.push({ kind: 'gps', base: G.base(b.line), line: b.line, dest: b.dest, eta: b.seconds,
                   between: b.between, garage: b.garage, dep: b.dep && b.dep !== '00:00:00' ? b.dep.slice(0, 5) : null });
      });
    }
    // remembered buses no longer in the answer, still heading here (estimated)
    Object.values(M.vehicles).forEach(function (v) {
      if (seen[v.g] || now - v.seenAt > HOLD_MAX) return;
      const R = M.routes[v.rk];
      if (!R) return;
      const sec = (now - v.obsAt) / 1000;
      const pt = v.tl.find(function (p) { return R.s[p.j] && R.s[p.j][0] === uid; });
      if (!pt || pt.t - sec < -30 || pt.t - sec > 3600) return;
      seen[v.g] = 1;
      out.push({ kind: 'est', base: v.base, line: v.line, dest: v.dest, eta: Math.max(0, Math.round(pt.t - sec)), garage: v.g });
    });
    // timetable trips (departed or departing within the hour) not covered by a real bus
    if (now - M.tripsAt > 15e3) refreshTrips(now);
    departures(now, now - 3 * 3600e3, now + 3600e3).forEach(function (t) {
      if (M.matched[t.id]) return;
      const R = routeFor(t.base, t.dir, t.mark);
      if (!R) return;
      const j = R.s.findIndex(function (x) { return x[0] === uid; });
      if (j < 0) return;
      const eta = (t.depTs + R.s[j][3] * 60e3 - now) / 1000;
      if (eta < -60 || eta > 3600) return;
      // a live/estimated bus of this route already arriving about then = this trip
      if (out.some(function (o) { return o.base === t.base && o.kind !== 'sched' && Math.abs(o.eta - eta) < MATCH_NEAR; })) return;
      out.push({ kind: 'sched', base: t.base, line: R.line, dest: t.dest || R.dest, eta: Math.max(0, Math.round(eta)),
                 dep: T.hhmm(t.depTs) });
    });
    out.sort(function (a, b) { return a.eta - b.eta; });
    return { name: (r && r.name) || stationName(uid), error: r.error || null, list: out, at: now };
  };

  // ---------------- polling plan ----------------
  function sentinelsOf(R, chosen) {
    const s = R.s, n = s.length, res = [];
    if (n < 3) return [s[n - 1][0]];
    let i = n - 2;
    res.push(s[i][0]);
    while (i > 1) {
      let j = i - 1;
      while (j - 1 >= 1 && s[i][3] - s[j - 1][3] <= GAP_MIN) j--;
      let pick = j;
      for (let q = j; q < i; q++) if (chosen.has(s[q][0])) { pick = q; break; }
      i = pick;
      res.push(s[i][0]);
    }
    return res;
  }

  function bootstrap(b, k) {
    const line = M.lines[b];
    if (!line) return [];
    const pts = line.stops.map(function (u) { return M.stations[u]; }).filter(function (s) { return s && s.la != null; });
    const ids = line.stops.filter(function (u) { return M.stations[u] && M.stations[u].la != null; });
    if (!pts.length) return [];
    const cla = pts.reduce(function (a, s) { return a + s.la; }, 0) / pts.length;
    const clo = pts.reduce(function (a, s) { return a + s.lo; }, 0) / pts.length;
    const picked = [];
    let far = 0, fd = -1;
    pts.forEach(function (s, i) { const d = dist(cla, clo, s.la, s.lo); if (d > fd) { fd = d; far = i; } });
    picked.push(far);
    while (picked.length < Math.min(k, pts.length)) {
      let bi = -1, bd = -1;
      pts.forEach(function (s, i) {
        if (picked.indexOf(i) >= 0) return;
        const d = Math.min.apply(null, picked.map(function (p) { return dist(pts[p].la, pts[p].lo, s.la, s.lo); }));
        if (d > bd) { bd = d; bi = i; }
      });
      if (bi < 0) break;
      picked.push(bi);
    }
    return picked.map(function (i) { return ids[i]; });
  }

  // Poll the visible area first. Rotate by last attempt, including failed/empty stops,
  // so neither busy stops nor off-screen routes can starve the remaining candidates.
  M.viewport = null;
  M.polledAt = {};
  M.prioritize = function (order) {
    const area = M.viewport;
    const nearby = function (u) {
      const s = M.stations[u];
      return area && s && s.la >= area.south && s.la <= area.north && s.lo >= area.west && s.lo <= area.east;
    };
    const ageOrder = function (a, b) { return (M.polledAt[a] || 0) - (M.polledAt[b] || 0); };
    const local = order.filter(nearby).sort(ageOrder);
    const selected = local.slice(0, 24);
    const picked = new Set(selected);
    const rest = order.filter(function (u) { return !picked.has(u); }).sort(ageOrder);
    // 24 local requests and 8 discovery requests per sweep (32 total).
    return selected.concat(rest.slice(0, 32 - selected.length));
  };
  M.setViewport = function (area) {
    M.viewport = area;
    if (!Object.keys(M.lines).length) return;
    M.queue = M.plan(); M.qi = 0; M.cycleStart = Date.now();
  };

  M.plan = function () {
    const chosen = new Set(), order = [];
    const pick = function (u) { if (u && !chosen.has(u)) { chosen.add(u); order.push(u); } };
    const want = function (b) { return M.focus ? b === M.focus : (M.isCity(b) ? M.cats.city : M.cats.sub); };
    const dirs = {};
    const now = Date.now();
    Object.values(M.routes)
      .filter(function (r) { return want(r.base) && now - r.t < ROUTE_TTL; })
      .sort(function (a, b) { return b.s.length - a.s.length; })
      .forEach(function (r) {
        (dirs[r.base] = dirs[r.base] || {})[r.dir] = 1;
        sentinelsOf(r, chosen).forEach(pick);
      });
    Object.keys(M.lines).forEach(function (b) {
      if (want(b) && Object.keys(dirs[b] || {}).length < 2) bootstrap(b, BOOT_STOPS).forEach(pick);
    });
    return M.prioritize(order);
  };

  M.setFocus = function (base) {
    M.focus = base || null;
    M.queue = M.plan(); M.qi = 0; M.cycleStart = Date.now();
    M.tripsAt = 0;
    emit('focus');
  };
  M.setCats = function (c) { M.cats = Object.assign({}, M.cats, c); M.queue = M.plan(); M.qi = 0; M.tripsAt = 0; emit('focus'); };

  let looping = false;
  async function pollLoop() {
    if (looping) return;
    looping = true;
    while (true) {
      if (!M.active) { await T.sleep(1000); continue; }
      if (M.qi >= M.queue.length) {
        // At least 40 seconds per sweep; wake frequently so focus/pause changes take effect.
        if (M.queue.length && Date.now() - M.cycleStart < 40000) {
          await T.sleep(500); continue;
        }
        if (M.cycleStart && M.queue.length) M.lastCycleS = Math.round((Date.now() - M.cycleStart) / 1000);
        M.queue = M.plan(); M.qi = 0; M.cycleStart = Date.now();
        saveRoutes();
        if (!M.queue.length) { await T.sleep(3000); continue; }
      }
      const uid = M.queue[M.qi++];
      M.polledAt[uid] = Date.now();
      let r;
      try { r = await N.fetchStop(uid); } catch (e) { r = { error: { type: 'network', message: String(e) } }; }
      M.requests++;
      if (r.error) {
        if (!r.error.missing) M.lastError = 'nsmart: ' + (r.error.message || r.error.type + (r.error.status ? ' ' + r.error.status : ''));
      } else {
        M.lastOkAt = Date.now(); M.lastError = null;
        M.observe(r.buses, Date.now());
      }
      emit('poll');
    }
  }

  // ---------------- start ----------------
  M.init = async function () {
    const seed = T.SEED || {};
    const cached = T.store.get('stations_v1', null);
    if (cached && cached.st) { M.stations = cached.st; M.stationsAt = cached.at; }
    else if (seed.stations) { M.stations = seed.stations; M.stationsAt = seed.stationsAt || 0; }
    buildLines();
    const now = Date.now();
    const stored = T.store.get('routes_v1', {}) || {};
    const all = Object.assign({}, seed.routes || {});
    Object.keys(stored).forEach(function (k) { if (!all[k] || stored[k].t > all[k].t) all[k] = stored[k]; });
    Object.keys(all).forEach(function (k) {
      const r = all[k];
      if (!r || !r.s || now - r.t > ROUTE_TTL) return;
      r.base = G.base(r.line);
      M.routes[k] = r;
    });
    if (!Object.keys(M.stations).length) await refreshStations();
    else if (now - M.stationsAt > STATIONS_MAX_AGE) refreshStations();
    M.queue = M.plan(); M.cycleStart = Date.now();
    pollLoop();
    loadSchedule();
    setInterval(function () { saveRoutes(); }, 30e3);
    setInterval(function () { loadSchedule(); }, 30 * 60e3);
    emit('ready');
  };
})(globalThis.T = globalThis.T || {});
