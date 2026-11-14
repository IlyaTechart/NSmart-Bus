/* gspns.rs official timetables + route naming + Serbian holidays.
 * Ported from NSBusTablica (timetable.py, routes.py Naming, rs_holidays.py). */
(function (T) {
  'use strict';
  const GSPNS = 'http://gspns.rs';
  const DAY_TYPES = ['R', 'S', 'N', 'P'];
  const DAY_NAMES = { R: 'Радни дан (будни)', S: 'Субота', N: 'Недеља', P: 'Празник' };
  const INDICATOR = { 'RADNI DAN': 'R', 'SUBOTA': 'S', 'NEDELJA': 'N', 'PRAZNIK': 'P',
                      'РАДНИ ДАН': 'R', 'СУБОТА': 'S', 'НЕДЕЉА': 'N', 'ПРАЗНИК': 'P' };
  const NIGHT_MAX_HOUR = 5;

  // ---------------- naming ----------------
  const LOOP_NUMBERS = { '7': 1, '11': 1, '18': 1 };
  const bases = new Set(['3A', '3B', '5N', '6A', '7A', '7B', '11A', '11B', '18A', '18B']);
  for (let n = 1; n < 100; n++) if (!LOOP_NUMBERS[String(n)]) bases.add(String(n));
  const TRANS = { 'Č': 'C', 'Ć': 'C', 'Ž': 'Z', 'Š': 'S', 'Đ': 'DJ', 'č': 'c', 'ć': 'c', 'ž': 'z', 'š': 's', 'đ': 'dj' };

  function norm(s) {
    s = String(s || '').replace(/[ČĆŽŠĐčćžšđ]/g, function (c) { return TRANS[c]; }).toUpperCase();
    s = s.normalize ? s.normalize('NFKD').replace(/[̀-ͯ]/g, '') : s;
    return s.replace(/[^A-Z0-9]/g, '');
  }

  function prefixBase(s) {
    let best = null;
    bases.forEach(function (b) {
      if (s.indexOf(b) === 0 && !/^\d/.test(s.slice(b.length)) && (best === null || b.length > best.length)) best = b;
    });
    return best;
  }

  /* nsmart line name / gspns option -> base route: '14S'->'14', '3A'->'3A', '54"A"'->'54', '9A'->'9', '1GL'->'1' */
  function base(line) {
    line = String(line || '').trim().replace(/[.*]+$/, '');
    const b = prefixBase(line);
    if (b) return b;
    const m = /^\d+/.exec(line);
    return m ? m[0] : line;
  }

  function addBases(list) { (list || []).forEach(function (b) { if (b) bases.add(String(b).replace(/[.*]+$/, '')); }); }

  function lineSort(a, b) {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
    if (isFinite(na) !== isFinite(nb)) return isFinite(na) ? -1 : 1;
    return String(a).localeCompare(String(b));
  }

  // ---------------- holidays / day type ----------------
  function orthodoxEaster(y) {
    const a = y % 4, b = y % 7, c = y % 19;
    const d = (19 * c + 15) % 30;
    const e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
    const dt = new Date(Date.UTC(y, month - 1, day));
    dt.setUTCDate(dt.getUTCDate() + 13);                 // Julian -> Gregorian (1900-2099)
    return dt;
  }
  function iso(dt) { return dt.toISOString().slice(0, 10); }
  function holidays(y) {
    const D = function (m, d) { return new Date(Date.UTC(y, m - 1, d)); };
    const add = function (dt, n) { const x = new Date(dt.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; };
    const h = {};
    const state = [[D(1, 1), D(1, 2)], [D(2, 15), D(2, 16)], [D(5, 1), D(5, 2)], [D(11, 11)]];
    const e = orthodoxEaster(y);
    const relig = [[D(1, 7)], [add(e, -2), add(e, -1), e, add(e, 1)]];
    state.concat(relig).forEach(function (ds) { ds.forEach(function (d) { h[iso(d)] = 1; }); });
    state.forEach(function (ds) {                       // Sunday rule: first next working day is off
      if (ds.some(function (d) { return d.getUTCDay() === 0; })) {
        let x = add(ds[ds.length - 1], 1);
        while (x.getUTCDay() === 0 || x.getUTCDay() === 6 || h[iso(x)]) x = add(x, 1);
        h[iso(x)] = 1;
      }
    });
    return h;
  }
  /* isoDay 'YYYY-MM-DD' -> R/S/N/P (when gspns did not say) */
  function fallbackDayType(isoDay) {
    const y = +isoDay.slice(0, 4);
    if (holidays(y)[isoDay]) return 'P';
    const wd = new Date(isoDay + 'T00:00:00Z').getUTCDay();
    return wd === 6 ? 'S' : wd === 0 ? 'N' : 'R';
  }

  // ---------------- parsing ----------------
  function unescapeHtml(s) {
    return String(s || '')
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
      .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }
  function txt(s) { return unescapeHtml(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }

  function parseIndex(h) {
    const m = /(?:danas voze po redu vo[žz]nje za|данас возе по реду вожње за)\s*([\s\S]*?)<\/p>/i.exec(h);
    const ind = m ? txt(m[1]).toUpperCase() : null;
    const v = {};
    let mm;
    const re = /<option value="(\d{4}-\d\d-\d\d)"/g;
    while ((mm = re.exec(h))) v[mm[1]] = 1;
    return { dayType: INDICATOR[ind] || null, indicator: ind, vaziod: Object.keys(v).sort() };
  }

  /* lista-linija -> [{value:'14', label:'14 CENTAR - SAJLOVO - VETERNIK'}] (value keeps '.'/'*' as gspns wants) */
  function parseLineOptions(h) {
    const out = [];
    const re = /<option value="([^"]*)">([\s\S]*?)<\/option>/g;
    let m;
    while ((m = re.exec(h))) out.push({ value: unescapeHtml(m[1]), label: txt(m[2]) });
    return out;
  }

  /* ispis-polazaka -> {base: {title, directions:[{header, departures:[{t,mark,low}]}], legend}} */
  function parseTimetables(h) {
    const out = {};
    const chunks = String(h || '').split('table-title').slice(1);
    chunks.forEach(function (chunk) {
      const afterGt = chunk.slice(chunk.indexOf('>') + 1);
      let title = txt(afterGt.split('</div>')[0]).replace(/^\S+\s*:\s*/, '');
      const b = title.split(' ')[0];
      const ths = [], tds = [];
      let m;
      const reTh = /<th>([\s\S]*?)<\/th>/g;
      while ((m = reTh.exec(chunk))) ths.push(txt(m[1]));
      const reTd = /<td\s+valign='top'[^>]*>([\s\S]*?)<\/td>/g;
      while ((m = reTd.exec(chunk))) tds.push(m[1]);
      const dirs = [];
      for (let i = 0; i < Math.min(ths.length, tds.length); i++) {
        const deps = [];
        let hour = null;
        const re = /<br\/><b>(\d\d)<\/b>|<span class='([^']*)'>(\d\d)<b>([^<]*)<\/b><\/span>/g;
        while ((m = re.exec(tds[i]))) {
          if (m[1]) { hour = parseInt(m[1], 10); continue; }
          if (hour === null) continue;
          const mark = unescapeHtml(unescapeHtml(m[4])).trim() || null;
          deps.push({ t: String(hour).padStart(2, '0') + ':' + m[3], mark: mark, low: m[2].indexOf('niskopodni') >= 0 });
        }
        dirs.push({ header: ths[i], departures: deps });
      }
      const foot = /tabelapolascifooter[^>]*>([\s\S]*?)<\/td>/.exec(chunk);
      out[b] = { title: title, directions: dirs, legend: foot ? txt(foot[1]) : null };
    });
    return out;
  }

  /* 'Smer A: ...' -> 'A'; suburban 'Polasci za X' = A (leaving Novi Sad), 'Polasci iz X' = B */
  function headerLetter(header) {
    const h = String(header || '');
    const m = /^\s*(?:Smer|Смер)\s+([ABАБ])(?![A-Za-zА-Яа-я])/.exec(h);
    if (m) return { 'А': 'A', 'Б': 'B' }[m[1]] || m[1];
    if (/polasci za|поласци за/i.test(h)) return 'A';
    if (/polasci iz|поласци из/i.test(h)) return 'B';
    return null;
  }

  function destination(header) {
    let h = String(header || '').replace(/^.*?:\s*/, '').replace(/^(polasci za|polasci iz)\s*/i, '');
    const parts = h.split(/\s+-\s+|\s*–\s*/);
    return (parts[parts.length - 1] || '').trim();
  }

  /* departures in timetable order -> [[dayOffset, hh, mm, mark]]; lists wrap past midnight (…23:40, 00:15) and a
   * direction with only small-hours departures (night line) is entirely after midnight of the service day */
  function expandDepartures(deps) {
    const out = [];
    let prev = null, off = 0;
    const hours = deps.map(function (x) { return parseInt(x.t.slice(0, 2), 10); });
    const night = hours.length > 0 && Math.max.apply(null, hours) < NIGHT_MAX_HOUR;
    deps.forEach(function (x, i) {
      const h = hours[i];
      if (prev !== null && h < prev) off = 1;
      prev = h;
      out.push([night ? 1 : off, h, parseInt(x.t.slice(3, 5), 10), x.mark || null]);
    });
    return out;
  }

  // ---------------- fetching (sequential, 1 s apart: gspns is a small municipal site) ----------------
  let chain = Promise.resolve(), last = 0;
  function get(path, params) {
    let q = '';
    if (params) {
      q = '?' + Object.keys(params).map(function (k) {
        const v = params[k];
        return (Array.isArray(v) ? v : [v]).map(function (x) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(x);
        }).join('&');
      }).join('&');
    }
    const p = chain.then(async function () {
      const wait = last + 1000 - Date.now();
      if (wait > 0) await T.sleep(wait);
      try {
        const r = await T.http('GET', GSPNS + path + q, '', {}, 25000);
        if (r.status !== 200) throw new Error('gspns HTTP ' + r.status);
        return r.text;
      } finally { last = Date.now(); }
    });
    chain = p.catch(function () {});
    return p;
  }

  async function loadIndex() {
    return parseIndex(await get('/red-voznje/gradski', { selected_lang: 'lat' }));
  }
  async function loadOptions(rv, vaziod, dan) {
    return parseLineOptions(await get('/red-voznje/lista-linija', { rv: rv, vaziod: vaziod, dan: dan }));
  }
  async function loadTables(rv, vaziod, dan, values) {
    if (!values.length) return {};
    return parseTimetables(await get('/red-voznje/ispis-polazaka',
      { rv: rv, vaziod: vaziod, dan: dan, 'linija[]': values }));
  }

  T.gspns = {
    DAY_TYPES: DAY_TYPES, DAY_NAMES: DAY_NAMES, norm: norm, base: base, addBases: addBases, lineSort: lineSort,
    holidays: holidays, fallbackDayType: fallbackDayType, parseIndex: parseIndex, parseLineOptions: parseLineOptions,
    parseTimetables: parseTimetables, headerLetter: headerLetter, destination: destination,
    expandDepartures: expandDepartures, loadIndex: loadIndex, loadOptions: loadOptions, loadTables: loadTables
  };
})(globalThis.T = globalThis.T || {});
