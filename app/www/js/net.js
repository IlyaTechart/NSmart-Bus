/* Network + storage helpers.
 * On the phone, requests go through the native Android bridge (window.AndroidNet): no CORS limits, plain HTTP
 * to gspns.rs allowed. In Node (tests / seed crawler) the global fetch() is used instead. */
(function (T) {
  'use strict';
  let seq = 0;
  const pending = {};

  // called by Java: AndroidNet answers asynchronously
  globalThis.__httpDone = function (id, status, text) {
    const cb = pending[id];
    if (!cb) return;
    delete pending[id];
    cb(status, text);
  };

  T.http = function (method, url, body, headers, timeoutMs) {
    timeoutMs = timeoutMs || 20000;
    return new Promise(function (resolve, reject) {
      const nb = globalThis.AndroidNet;
      if (nb) {
        const id = 'r' + (++seq);
        const watchdog = setTimeout(function () {
          if (!pending[id]) return;
          delete pending[id];
          reject(new Error('????????? ????? ???????? ????'));
        }, timeoutMs + 2000);
        pending[id] = function (status, text) {
          clearTimeout(watchdog);
          if (status > 0) resolve({ status: status, text: text });
          else reject(new Error(text || 'network error'));
        };
        try { nb.request(id, method, url, body || '', JSON.stringify(headers || {}), timeoutMs); }
        catch (e) { clearTimeout(watchdog); delete pending[id]; reject(e); }
        return;
      }
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs);
      fetch(url, { method: method, body: method === 'POST' ? body : undefined,
                   headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 (Trecker)' }, headers || {}),
                   signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.text().then(function (t) { resolve({ status: r.status, text: t }); }); })
        .catch(reject)
        .finally(function () { clearTimeout(timer); });
    });
  };

  T.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // localStorage wrapper (may be missing or full: never throws)
  const mem = {};
  T.store = {
    get: function (k, def) {
      try {
        const s = globalThis.localStorage ? localStorage.getItem(k) : mem[k];
        return s == null ? def : JSON.parse(s);
      } catch (e) { return def; }
    },
    set: function (k, v) {
      try {
        const s = JSON.stringify(v);
        if (globalThis.localStorage) localStorage.setItem(k, s); else mem[k] = s;
        return true;
      } catch (e) { return false; }
    },
    del: function (k) { try { if (globalThis.localStorage) localStorage.removeItem(k); else delete mem[k]; } catch (e) { /* ignore */ } }
  };

  // ---- time in Novi Sad (Europe/Belgrade), independent of the device time zone ----
  let fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Belgrade', hourCycle: 'h23', year: 'numeric',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) { fmt = null; }

  // -> {y, m (1-12), d, hh, mm, ss, wd (0 = Sunday)}
  T.bg = function (ts) {
    if (!fmt) {
      const x = new Date(ts);
      return { y: x.getFullYear(), m: x.getMonth() + 1, d: x.getDate(), hh: x.getHours(), mm: x.getMinutes(),
               ss: x.getSeconds(), wd: x.getDay() };
    }
    const p = {};
    fmt.formatToParts(new Date(ts)).forEach(function (q) { p[q.type] = q.value; });
    const y = +p.year, m = +p.month, d = +p.day;
    return { y: y, m: m, d: d, hh: +p.hour % 24, mm: +p.minute, ss: +p.second,
             wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
  };

  // Belgrade wall time -> epoch ms (day overflow allowed: d + 1, hh 25 ...)
  T.bgTs = function (y, m, d, hh, mm, ss) {
    const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
    let off = 0;
    for (let i = 0; i < 2; i++) {
      const b = T.bg(guess - off);
      off = Date.UTC(b.y, b.m - 1, b.d, b.hh, b.mm, b.ss) - (guess - off);
    }
    return guess - off;
  };

  T.isoDay = function (b) { return b.y + '-' + String(b.m).padStart(2, '0') + '-' + String(b.d).padStart(2, '0'); };
  T.hhmm = function (ts) { const b = T.bg(ts); return String(b.hh).padStart(2, '0') + ':' + String(b.mm).padStart(2, '0'); };
})(globalThis.T = globalThis.T || {});
