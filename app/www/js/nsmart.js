/* nsmart.rs: live arrivals per stop + list of all stops. Ported from NSBusTablica (nstupido.py fetch/parse). */
(function (T) {
  'use strict';
  const API = 'https://online.nsmart.rs/sr/najava-dolaska/';
  const STATIONS_URL = 'https://online.nsmart.rs/sr/AnnouncementForStation/getAllStations';
  const HDR = { 'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };

  function num(v) { const x = parseFloat(v); return isFinite(x) ? x : null; }
  function int(v) { const x = parseInt(v, 10); return isFinite(x) ? x : null; }

  // One budget for map polling, stop sheets and station downloads on this client.
  // This is our conservative policy, not a published NSmart quota.
  const POLICY = { minMs: 3000, maxRequests: 20, windowMs: 60000, cacheMs: 30000 };
  function Gate(minMs, storeKey) {
    this.minMs = minMs || POLICY.minMs; this.storeKey = storeKey;
    const saved = storeKey && T.store && T.store.get(storeKey, {});
    this.starts = saved && Array.isArray(saved.starts) ? saved.starts.filter(function (t) { return Number.isFinite(t); }).slice(-20) : [];
    this.blockedUntil = saved && Number.isFinite(saved.blockedUntil) ? saved.blockedUntil : 0;
    this.failures = saved && saved.failures || 0;
    this.rateFailures = saved && saved.rateFailures || 0;
    this.chain = Promise.resolve(); this.requests = 0;
  }
  Gate.prototype.save = function () {
    if (this.storeKey && T.store) T.store.set(this.storeKey, { starts: this.starts, blockedUntil: this.blockedUntil,
      failures: this.failures, rateFailures: this.rateFailures });
  };
  Gate.prototype.readyAt = function () {
    const now = Date.now();
    this.starts = this.starts.filter(function (t) { return t > now - POLICY.windowMs; });
    const last = this.starts[this.starts.length - 1];
    return Math.max(this.blockedUntil, last == null ? 0 : last + Math.max(POLICY.minMs, this.minMs),
      this.starts.length >= POLICY.maxRequests ? this.starts[0] + POLICY.windowMs : 0);
  };
  Gate.prototype.backoffMs = function () { return Math.max(0, this.blockedUntil - Date.now()); };
  Gate.prototype.run = function (fn) {
    const self = this;
    const p = this.chain.then(async function () {
      while (true) {
        if (T.model && !T.model.active) return { error: { type: 'paused' } };
        if (self.blockedUntil > Date.now()) return { error: { type: 'cooldown', retryAt: self.blockedUntil } };
        const wait = self.readyAt() - Date.now();
        if (wait <= 0) break;
        await T.sleep(Math.min(wait, 1000));
      }
      self.starts.push(Date.now()); self.save();
      self.requests++;
      try { return await fn(); }
      catch (e) { self.failure(); throw e; }
    });
    this.chain = p.catch(function () {});
    return p;
  };
  Gate.prototype.failure = function (status, retryAfter) {
    this.failures++;
    const now = Date.now(), restricted = status === 429 || status === 403;
    if (restricted) this.rateFailures++;
    let delay = restricted ? Math.min(1800000, 300000 * Math.pow(2, Math.min(4, this.rateFailures - 1)))
      : Math.min(300000, 15000 * Math.pow(2, Math.min(5, this.failures - 1)));
    if (retryAfter != null && String(retryAfter).trim()) {
      const text = String(retryAfter).trim();
      const serverDelay = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
      if (Number.isFinite(serverDelay)) delay = Math.max(delay, serverDelay);
    }
    this.blockedUntil = Math.max(this.blockedUntil, now + delay); this.save();
  };
  Gate.prototype.success = function () { this.failures = 0; this.rateFailures = 0; this.blockedUntil = 0; this.save(); };

  const gate = new Gate(POLICY.minMs, 'nsmart_budget_v1');
  const stopCache = new Map(), pendingStops = new Map();
  let pendingStations = null;
  async function request(url, body, timeout) {
    let r;
    try { r = await T.http('POST', url, body, HDR, timeout); }
    catch (e) { gate.failure(); return { error: { type: 'network', message: String(e && e.message || e) }, fromNetwork: true }; }
    if (r.status !== 200) {
      gate.failure(r.status, r.retryAfter);
      return { error: { type: 'http', status: r.status, retryAt: gate.blockedUntil }, fromNetwork: true };
    }
    try { return { data: JSON.parse(r.text), receivedAt: Date.now(), fromNetwork: true }; }
    catch (e) { gate.failure(); return { error: { type: 'bad_response' }, fromNetwork: true }; }
  }

  /* One raw response -> {name, buses:[...]} or {error}. Each bus keeps its whole route (all_stations) with
   * coordinates, scheduled minutes from the terminal (tt) and seconds the bus needs to reach each stop (slr). */
  function parse(uid, d) {
    if (!Array.isArray(d) || !d.length) return { error: { type: 'bad_response' } };
    if (d[0] === false) return { error: { type: 'api', code: d[1] } };
    if (!d[0] || typeof d[0] !== 'object') return { error: { type: 'bad_response' } };
    if (d[0].station_name == null && d[0].gpsx == null) return { error: { type: 'api', code: 3, missing: true } };
    const out = { name: d[0].station_name, buses: [] };
    if (d[0].just_coordinates === '1') return out;      // nobody is coming right now: a normal answer
    for (const e of d) {
      if (!e || typeof e !== 'object' || !('seconds_left' in e)) continue;
      const veh = (e.vehicles && e.vehicles[0]) || {};
      const st = (e.all_stations || []).filter(function (s) { return s && typeof s === 'object'; });
      const actual = e.actual_line_number == null ? '' : String(e.actual_line_number).trim();
      out.buses.push({
        line: e.line_number,                        // display name with variant: "14S"
        actual: actual,                             // "141B" = route 14, variant 1, direction B
        dir: /B$/i.test(actual) ? 'B' : 'A',
        dest: e.to_price || null,
        title: e.line_title || null,
        seconds: int(e.seconds_left) || 0,          // ETA to the polled stop
        between: int(e.stations_between),
        garage: String(e.garage_no),
        lat: num(veh.lat), lng: num(veh.lng),
        cur: veh.station_name || null,
        dep: e.entered_departure_time || null,      // scheduled departure from the terminal "HH:MM:SS"
        next: int(e.next_station),                  // 1-based index of the bus's next stop in all_stations
        // terminals list planned departures "P1", "P2"...: not real vehicles
        planned: !/^\d+$/.test(String(e.garage_no)),
        stops: st.map(function (s) {
          const c = s.coordinates || {};
          return [String(s.id), num(c.latitude), num(c.longitude), int(s.tt_time), int(s.second_left_by_route) || 0];
        })
      });
    }
    return out;
  }

  function fetchStop(uid) {
    uid = String(uid);
    const cached = stopCache.get(uid);
    if (cached && Date.now() - cached.receivedAt < POLICY.cacheMs) return Promise.resolve(Object.assign({}, cached, { cached: true, fromNetwork: false }));
    if (pendingStops.has(uid)) return pendingStops.get(uid);
    const body = 'station_uid=' + encodeURIComponent(uid) + '&ibfm=TS001831&direction=2&company_info_id=216&radius=';
    const p = gate.run(async function () {
      const r = await request(API, body, 15000);
      if (r.error) return r;
      const res = Object.assign(parse(uid, r.data), { receivedAt: r.receivedAt, fromNetwork: true });
      if (res.error && !res.error.missing) gate.failure(); else gate.success();
      if (!res.error || res.error.missing) {
        stopCache.delete(uid); stopCache.set(uid, res);
        if (stopCache.size > 128) stopCache.delete(stopCache.keys().next().value);
      }
      return res;
    });
    pendingStops.set(uid, p);
    p.then(function () { pendingStops.delete(uid); }, function () { pendingStops.delete(uid); });
    return p;
  }

  /* getAllStations (~1.5 MB) -> {uid: {n name, c code, la, lo, l [lines], t {line: line_type}}} */
  function compactStations(raw) {
    const out = {};
    (raw || []).forEach(function (s) {
      if (!s || s.id == null) return;
      const c = s.coordinates || {};
      const t = {};
      (s.lines_for_station_additional_data || []).forEach(function (a) {
        if (a && a.line_number_for_display) t[a.line_number_for_display] = a.line_type;
      });
      out[String(s.id)] = { n: s.name, c: s.station_id, la: num(c.latitude), lo: num(c.longitude),
                            l: (s.lines_for_station || []).slice(), t: t };
    });
    return out;
  }

  function fetchStations() {
    if (pendingStations) return pendingStations;
    pendingStations = gate.run(async function () {
      const r = await request(STATIONS_URL, '', 60000);
      if (r.error) return r;
      const st = compactStations(r.data);
      if (Object.keys(st).length < 100) { gate.failure(); return { error: { type: 'bad_response' } }; }
      gate.success();
      return st;
    }).then(function (result) {
      if (result.error) throw new Error(result.error.type + (result.error.status ? ' HTTP ' + result.error.status : ''));
      return result;
    });
    pendingStations.then(function () { pendingStations = null; }, function () { pendingStations = null; });
    return pendingStations;
  }

  T.nsmart = { parse: parse, fetchStop: fetchStop, fetchStations: fetchStations, compactStations: compactStations,
               gate: gate, Gate: Gate, policy: POLICY };
})(globalThis.T = globalThis.T || {});
