/* nsmart.rs: live arrivals per stop + list of all stops. Ported from NSBusTablica (nstupido.py fetch/parse). */
(function (T) {
  'use strict';
  const API = 'https://online.nsmart.rs/sr/najava-dolaska/';
  const STATIONS_URL = 'https://online.nsmart.rs/sr/AnnouncementForStation/getAllStations';
  const HDR = { 'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };

  function num(v) { const x = parseFloat(v); return isFinite(x) ? x : null; }
  function int(v) { const x = parseInt(v, 10); return isFinite(x) ? x : null; }

  /* Global pacing for every nsmart request (like NStupido's Gate): one request at a time, at least `minMs`
   * apart, exponential backoff 5 s .. 180 s after a failure, the first success resets it. */
  function Gate(minMs) {
    this.minMs = minMs; this.next = 0; this.failures = 0; this.chain = Promise.resolve(); this.requests = 0;
  }
  Gate.prototype.backoffMs = function () {
    return this.failures ? Math.min(180000, 5000 * Math.pow(2, this.failures - 1)) : 0;
  };
  Gate.prototype.run = function (fn) {
    const self = this;
    const p = this.chain.then(async function () {
      const wait = self.next - Date.now();
      if (wait > 0) await T.sleep(wait);
      self.next = Date.now() + self.minMs;
      self.requests++;
      return fn();
    });
    this.chain = p.catch(function () {});
    return p;
  };
  Gate.prototype.failure = function () {
    this.failures++;
    this.next = Math.max(this.next, Date.now() + this.backoffMs());
  };
  Gate.prototype.success = function () { this.failures = 0; };

  const gate = new Gate(600);

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

  async function fetchStop(uid) {
    const body = 'station_uid=' + encodeURIComponent(uid) + '&ibfm=TS001831&direction=2&company_info_id=216&radius=';
    return gate.run(async function () {
      let r;
      try {
        r = await T.http('POST', API, body, HDR, 15000);
      } catch (e) {
        gate.failure();
        return { error: { type: 'network', message: String(e && e.message || e) } };
      }
      if (r.status !== 200) { gate.failure(); return { error: { type: 'http', status: r.status } }; }
      let d;
      try { d = JSON.parse(r.text); } catch (e) { gate.failure(); return { error: { type: 'bad_response' } }; }
      const res = parse(String(uid), d);
      if (res.error && !res.error.missing) gate.failure(); else gate.success();
      return res;
    });
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

  async function fetchStations() {
    return gate.run(async function () {
      const r = await T.http('POST', STATIONS_URL, '', { 'X-Requested-With': 'XMLHttpRequest' }, 60000);
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const st = compactStations(JSON.parse(r.text));
      if (Object.keys(st).length < 100) throw new Error('too few stations');
      return st;
    });
  }

  T.nsmart = { parse: parse, fetchStop: fetchStop, fetchStations: fetchStations, compactStations: compactStations,
               gate: gate, Gate: Gate };
})(globalThis.T = globalThis.T || {});
