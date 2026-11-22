/* Presentation adapter for the 1.12 screens. Transit is the Android bridge to
 * the repository and Rust engine. The browser preview has its own model. */
(function (T, native) {
  'use strict';
  const listeners = [];
  const pending = new Map();
  let sequence = 0, ready = false, active = false, orderedLines = [], blockedUntil = 0;
  function request(send) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      try { send(id); } catch (error) { pending.delete(id); reject(error); }
    });
  }
  window.transitReply = (id, value, error) => {
    const task = pending.get(id);
    if (!task) return;
    pending.delete(id);
    if (error) task.reject(new Error(error)); else task.resolve(value);
  };
  const settings = JSON.parse(native.settings());
  if (settings.language) T.i18n.set(settings.language);
  T.i18n.onChange(lang => native.language(lang === 'en'));
  if (settings.city != null && settings.sub != null)
    T.store.set('cats', {city: settings.city, sub: settings.sub});

  T.gspns = {
    DAY_TYPES: ['R', 'S', 'N', 'P'],
    expandDepartures(rows) { return JSON.parse(native.departures(JSON.stringify(rows))); }
  };
  const model = T.model = {
    stations: {}, lines: {}, routes: {}, sched: { tables: {}, error: '' },
    focus: null, cats: { city: true, sub: true }, lastOkAt: 0, lastError: '',
    get active() { return active; },
    set active(value) { active = value; if (ready) native.polling(value); },
    prioritizeLive() {}, // The repository starts polling on resume.
    on(listener) { listeners.push(listener); },
    lineList() { return orderedLines; },
    isCity(base) { return !!(model.lines[base] && model.lines[base].city); },
    dayTypeFor() { return native.dayType(); },
    setViewport(b) { native.viewport(b.south, b.north, b.west, b.east); },
    setFocus(base) { model.focus = base; native.focus(base || ''); },
    setCats(cats) { model.cats = cats; native.categories(cats.city, cats.sub); },
    routesOf(base) { return Object.values(model.routes).filter(route => route.base === base); },
    geometry(key) { return JSON.parse(native.geometry(key)); },
    snapshot() {
      const items = JSON.parse(native.snapshot(model.focus || '', model.cats.city, model.cats.sub));
      for (const item of items) item.roadAligned = item.road_aligned;
      return items;
    },
    arrivals(uid) { return request(id => native.arrivals(id, uid)); },
    ensureTables(rv, day, force) { return request(id => native.timetable(id, rv, day, !!force)); },
    init() {
      refreshCatalog();
      refreshRoutes();
      native.categories(model.cats.city, model.cats.sub);
      ready = true;
      native.polling(active);
    }
  };
  T.nsmart = {policy: {cacheMs: 30000}, gate: {backoffMs: () => Math.max(0, blockedUntil - Date.now())}};
  function refreshCatalog() {
    const catalog = JSON.parse(native.catalog());
    model.stations = catalog.stations;
    orderedLines = catalog.lines;
    model.lines = Object.fromEntries(orderedLines.map(line => [line.base, line]));
    model.sched.tables = catalog.tables;
  }
  function refreshRoutes() {
    const routes = JSON.parse(native.routes());
    for (const route of Object.values(routes))
      route.s = route.s.map(stop => [stop.id, stop.la, stop.lo, stop.tt, stop.slr]);
    model.routes = routes;
  }
  window.transitUpdate = event => {
    if (!ready) return;
    const status = JSON.parse(native.status());
    model.lastOkAt = status.ok;
    model.lastError = status.error;
    model.sched.error = status.scheduleError;
    blockedUntil = status.until;
    if (event === 'stations' || event === 'schedule') refreshCatalog();
    if (event === 'poll') refreshRoutes();
    for (const listener of listeners) listener(event);
  };
})(window.T, window.Transit);
