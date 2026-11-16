/* Screens: map of all buses, choose a line, timetable. Left drawer menu. */
(function (T) {
  'use strict';
  const M = T.model, G = T.gspns, tr = T.i18n.t, plural = T.i18n.count;
  const $ = function (s) { return document.querySelector(s); };
  const esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const ui = T.ui = { screen: 'map' };
  const CENTER = [45.2517, 19.8533];

  let map, busLayer, stopLayer, routeLayer, canvas, meMarker = null;
  const markers = {};
  let stopLoading = false, stopAt = 0;
  let sheetStop = null, sheetResult = null, ttState = { rv: 'rvg', dan: null, base: null };
  let gpsOnly = false;
  let selectedVehicle = null, selectedRouteRef = null, selectedRouteApproximate = false;
  let zooming = false, clusterAnimating = false, spiderfied = false, panelCollapsed = false;
  const BUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 10h14M8 21v-3M16 21v-3M8 14h1M15 14h1"/></svg>';

  // ---------------- drawer + navigation ----------------
  function openDrawer(on) {
    $('#drawer').classList.toggle('open', on);
    $('#drawer').setAttribute('aria-hidden', String(!on));
    $('#scrim').classList.toggle('open', on);
  }
  function show(screen) {
    ui.screen = screen;
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 'screen-' + screen); });
    document.querySelectorAll('.nav-item, .bottom-item').forEach(function (b) {
      const active = b.dataset.screen === screen;
      b.classList.toggle('on', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('#barTitle').textContent = screen === 'map' && M.focus ? tr('line', { base: M.focus }) : tr('title.' + screen);
    openDrawer(false);
    closeSheet();
    setActive();
    if (screen === 'map') setTimeout(function () { map.invalidateSize(); tick(); }, 50);
    if (screen === 'lines') renderLines();
    if (screen === 'timetable') renderTimetable();
  }
  ui.show = show;
  function setActive() {
    const active = !document.hidden && (ui.screen === 'map' || ui.screen === 'lines');
    const resumed = active && !M.active;
    M.active = active;
    if (resumed) M.prioritizeLive();
  }

  /* Android back button: close what is open, else let the app close */
  ui.back = function () {
    if ($('#sheet').classList.contains('open')) { closeSheet(); return true; }
    if ($('#drawer').classList.contains('open')) { openDrawer(false); return true; }
    if (ui.screen === 'timetable' && ttState.base) { ttState.base = null; renderTimetable(); return true; }
    if (ui.screen !== 'map') { show('map'); return true; }
    if (selectedVehicle) { clearVehicleSelection(); return true; }
    if (M.focus) { setFocus(null); return true; }
    return false;
  };

  // ---------------- map ----------------
  function initMap() {
    map = L.map('map', { zoomControl: false, preferCanvas: false, maxZoom: 19, minZoom: 9 }).setView(CENTER, 14);
    let base, baseTimer;
    const vectorCredit = '<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    function fallback() {
      clearTimeout(baseTimer);
      if (base) { map.removeLayer(base); base = null; }
      map.attributionControl.removeAttribution(vectorCredit);
      base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, updateWhenIdle: true,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);
      base.on('tileerror', function () { $('#mapError').classList.remove('hidden'); });
      base.on('tileload', function () { $('#mapError').classList.add('hidden'); });
    }
    function loadBasemap() {
      clearTimeout(baseTimer);
      if (base) { map.removeLayer(base); base = null; }
      $('#mapError').classList.add('hidden');
      try {
        base = L.maplibreGL({ style: 'data/map-style.json', interactive: false }).addTo(map);
        map.attributionControl.addAttribution(vectorCredit);
        const gl = base.getMaplibreMap();
        baseTimer = setTimeout(function () { if (!gl.loaded()) fallback(); }, 25000);
        gl.once('load', function () { clearTimeout(baseTimer); });
        gl.getCanvas().addEventListener('webglcontextlost', function () { fallback(); }, { once: true });
      } catch (e) { fallback(); }
    }
    $('#mapRetry').onclick = loadBasemap;
    // Dispatch the startup GPS request before WebGL/map-style initialization.
    setTimeout(loadBasemap, 0);
    map.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'bottomright', zoomInTitle: tr('zoom.in'), zoomOutTitle: tr('zoom.out') }).addTo(map);
    canvas = L.canvas({ padding: 0.3 });
    routeLayer = L.layerGroup().addTo(map);
    stopLayer = L.layerGroup().addTo(map);
    busLayer = L.markerClusterGroup({
      maxClusterRadius: 38, showCoverageOnHover: false, animate: true,
      animateAddingMarkers: false, removeOutsideVisibleBounds: false,
      spiderfyOnMaxZoom: false, zoomToBoundsOnClick: false, spiderfyDistanceMultiplier: 1.6,
      spiderLegPolylineOptions: { color: '#6d9c85', weight: 1.5, opacity: 0.6 },
      iconCreateFunction: function (cluster) {
        const children = cluster.getAllChildMarkers();
        const live = children.some(function (m) { return m._it && m._it.kind === 'gps'; });
        const count = children.length;
        const lines = Array.from(new Set(children.map(function (m) { return m._it ? m._it.base : ''; }))).filter(Boolean).sort(function (a,b) { return a.localeCompare(b, undefined, { numeric: true }); });
        const label = lines.slice(0, 3).join(' · ') + (lines.length > 3 ? ' …' : '');
        return L.divIcon({ className: 'vehicle-cluster' + (live ? ' live' : ''),
          html: '<span title="' + esc(plural('buses', count) + ': ' + lines.join(', ')) + '"><b>' + count + '<small>' + tr('cluster.short') + '</small></b><em>' + esc(label) + '</em></span>', iconSize: [76, 54], iconAnchor: [38, 27] });
      }
    }).addTo(map);
    map.on('zoomstart', function () { zooming = true; });
    map.on('zoomend', function () { zooming = false; if (!clusterAnimating) tick(); });
    busLayer.on('animationend', function () { clusterAnimating = false; });
    // MarkerCluster's animation is 300 ms. Never reinsert moving buses midway through it.
    map.on('zoomstart', function () { clusterAnimating = true; });
    map.on('zoomend', function () { setTimeout(function () { if (!zooming) { clusterAnimating = false; tick(); } }, 350); });
    busLayer.on('spiderfied', function () { spiderfied = true; });
    busLayer.on('unspiderfied', function () { spiderfied = false; });
    busLayer.on('clusterclick', function (e) {
      if (zooming || clusterAnimating) return;
      if (map.getZoom() >= 17) e.layer.spiderfy();
      else map.fitBounds(e.layer.getBounds(), { paddingTopLeft: [42, M.focus || selectedVehicle ? 138 : 68],
        paddingBottomRight: [48, panelSpace()], maxZoom: 17 });
    });
    function updateArea() {
      const b = map.getBounds().pad(0.25);
      M.setViewport({ south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() });
      drawStops();
    }
    map.on('moveend', updateArea);
    updateArea();
  }

  function busHtml(it) {
    return '<div class="vehicle ' + it.kind + (selectedVehicle && selectedVehicle.id === it.id ? ' selected' : '') + '">' + BUS_SVG + '<b>' + esc(it.base) + '</b></div>';
  }

  function popupContent(it) {
    let rows = '<div class="pop-title"><span class="bus ' + it.kind + '">' + esc(it.base) + '</span><span>' +
      esc(it.title || tr('line', { base: it.base })) + '</span></div>';
    if (it.dest) rows += '<div class="pop-row">' + tr('popup.destination') + ' <b>' + esc(it.dest) + '</b></div>';
    if (it.line !== it.base) rows += '<div class="pop-row">' + tr('popup.variant') + ' <b>' + esc(it.line) + '</b></div>';
    rows += '<div class="pop-row">' + tr('popup.status') + ' <b>' + tr('kind.' + it.kind) + '</b></div>';
    if (it.kind !== 'sched') {
      rows += '<div class="pop-row">' + tr('popup.fleet') + ' <b>' + esc(it.garage) + '</b></div>';
      rows += '<div class="pop-row">' + tr('popup.gpsReceived') + ' <b>' + ago(it.age) + '</b></div>';
    }
    if (it.next) rows += '<div class="pop-row">' + tr('popup.nextStop') + ' <b>' + esc(it.next) + '</b></div>';
    if (it.kind !== 'gps') rows += '<div class="pop-row">' + tr('popup.trajectory') + ' <b>' + tr(it.roadAligned ? 'popup.trajectoryRoad' : 'popup.trajectoryApprox') + '</b></div>';
    if (it.dep) rows += '<div class="pop-row">' + tr('popup.departure') + ' <b>' + esc(it.dep) + '</b></div>';
    if (it.kind === 'sched') rows += '<div class="pop-row" style="margin-top:4px">' + tr('popup.schedNote') + '</div>';
    if (selectedVehicle && selectedVehicle.id === it.id) {
      rows += routesOnMap().length ? '<button class="route-overview" data-route-overview>' + tr('popup.showFullRoute') + '</button>'
        : '<div class="pop-row">' + tr('popup.routeMissing') + '</div>';
      if (selectedRouteApproximate) rows += '<div class="pop-row">' + tr('popup.approxNote') + '</div>';
    }
    return rows;
  }
  function ago(sec) {
    if (sec == null) return '—';
    if (sec < 60) return plural('secondsAgo', sec);
    return tr('time.minutesSecondsAgo', { minutes: Math.floor(sec / 60), seconds: sec % 60 });
  }

  let openPopupId = null;
  function tick() {
    if (ui.screen !== 'map' || document.hidden) return;
    if (zooming || clusterAnimating) return;
    if (sheetStop && !stopLoading && Date.now() - stopAt >= T.nsmart.policy.cacheMs) loadStop(sheetStop);
    const now = Date.now();
    const items = M.snapshot(now);
    const seen = {};
    let nG = 0, nE = 0, nS = 0;
    const changed = [];
    items.forEach(function (it) {
      if (it.kind === 'gps') nG++; else if (it.kind === 'est') nE++; else nS++;
      if (spiderfied) return;
      if (gpsOnly && it.kind !== 'gps') return;
      seen[it.id] = 1;
      let m = markers[it.id];
      const html = busHtml(it), markerTitle = tr('line', { base: it.base }) + ' · ' + tr('kind.' + it.kind);
      if (!m) {
        m = L.marker([it.la, it.lo], {
          icon: L.divIcon({ className: 'bus-icon vehicle-hit', html: html, iconSize: [56, 48], iconAnchor: [28, 44] }),
          title: markerTitle,
          zIndexOffset: it.kind === 'gps' ? 300 : it.kind === 'est' ? 200 : 0
        });
        m._html = html;
        m._it = it;
        m.on('click', function () {
          selectVehicle(m._it);
          openPopupId = it.id;
          m.bindPopup(popupContent(m._it), { autoPan: true, offset: [0, -15], maxWidth: Math.min(300, window.innerWidth - 64), autoPanPaddingTopLeft: [16, 190], autoPanPaddingBottomRight: [16, 270] }).openPopup();
        });
        m.on('popupclose', function () { if (openPopupId === it.id) openPopupId = null; });
        m.addTo(busLayer);
        markers[it.id] = m;
      } else {
        // setLatLng emits a move event even for identical coordinates. That event
        // removes and reinserts the marker in MarkerCluster, causing flicker.
        if (m.getLatLng().distanceTo([it.la, it.lo]) > 1) m.setLatLng([it.la, it.lo]);
        if (m._html !== html) {
          m.setIcon(L.divIcon({ className: 'bus-icon vehicle-hit', html: html, iconSize: [56, 48], iconAnchor: [28, 44] }));
          m.setZIndexOffset(it.kind === 'gps' ? 300 : it.kind === 'est' ? 200 : 0);
          m._html = html;
          changed.push(m);
        }
      }
      m._it = it;
      m.options.title = markerTitle;
      const markerElement = m.getElement();
      if (markerElement) markerElement.title = markerTitle;
      if (openPopupId === it.id && m.getPopup()) m.getPopup().setContent(popupContent(it));
    });
    Object.keys(markers).forEach(function (id) {
      if (!spiderfied && !seen[id]) { busLayer.removeLayer(markers[id]); delete markers[id]; }
    });
    if (changed.length) busLayer.refreshClusters(changed);
    if (selectedVehicle) {
      const current = items.find(function (it) { return it.id === selectedVehicle.id; });
      if (current) selectedVehicle = Object.assign({}, current);
      const r = routesOnMap()[0] || null;
      if (r !== selectedRouteRef) { drawRoutes(); drawStops(); renderFocusChip(); }
    }
    $('#nGps').textContent = nG; $('#nEst').textContent = nE; $('#nSched').textContent = nS;
    statusLine(now);
  }

  function statusLine(now) {
    const el = $('#statusLine');
    const dot = $('#netDot');
    const fresh = M.lastOkAt && now - M.lastOkAt < 30e3;
    const offline = !fresh && !!M.lastError;
    const pauseMs = T.nsmart.gate.backoffMs();
    dot.className = 'net-dot ' + (fresh ? 'ok' : M.lastError ? 'err' : '');
    $('#connectionText').textContent = tr(pauseMs ? 'connection.paused' : fresh ? 'connection.online' : offline ? 'connection.offline' : M.lastOkAt ? 'connection.estimated' : 'connection.connecting');
    $('#liveBadge').classList.toggle('offline', !fresh || pauseMs > 0);
    $('#liveBadgeText').textContent = pauseMs ? tr('badge.pause') : fresh ? 'LIVE' : offline ? tr('badge.offline') : M.lastOkAt ? tr('badge.estimated') : tr('badge.loading');
    let s;
    if (pauseMs) {
      s = tr('status.retryAfter', { seconds: Math.ceil(pauseMs / 1000) });
    } else if (M.lastError && !fresh) {
      s = tr('status.noConnection');
    } else if (!M.lastOkAt) {
      s = tr('status.gettingData');
    } else {
      const age = Math.round((now - M.lastOkAt) / 1000);
      const ageText = age < 2 ? tr('status.justNow') : age < 60 ? plural('secondsAgo', age) : plural('minutesAgo', Math.floor(age / 60));
      s = tr('status.updated', { age: ageText });
    }
    if (M.sched.error && !Object.keys(M.sched.tables).length) s += ' · ' + tr('status.timetableUnavailable');
    el.textContent = s;
    el.classList.toggle('err', !!(M.lastError && !fresh));
  }

  // stops: all of them when zoomed in, or the stops of the chosen line
  function drawStops() {
    stopLayer.clearLayers();
    const z = map.getZoom();
    let ids = [];
    if (M.focus || selectedVehicle) {
      const set = {};
      routesOnMap().forEach(function (r) { r.s.forEach(function (x) { set[x[0]] = 1; }); });
      ids = Object.keys(set);
      if (!selectedVehicle && !ids.length && M.lines[M.focus]) ids = M.lines[M.focus].stops;
      if (z < 13) return;
    } else {
      if (z < 15) return;
      const b = map.getBounds().pad(0.2);
      ids = Object.keys(M.stations).filter(function (u) {
        const s = M.stations[u];
        return s.la != null && b.contains([s.la, s.lo]);
      }).slice(0, 600);
    }
    ids.forEach(function (u) {
      const s = M.stations[u];
      if (!s || s.la == null) return;
      L.circleMarker([s.la, s.lo], { renderer: canvas, radius: 14, stroke: false, fillOpacity: 0 })
        .on('click', function () { openStop(u); }).addTo(stopLayer);
      L.circleMarker([s.la, s.lo], { renderer: canvas, radius: z >= 16 ? 6 : 4, color: '#367e72', weight: 2,
                                     fillColor: '#fff', fillOpacity: 1, interactive: false })
        .addTo(stopLayer);
    });
  }

  function routesOnMap() {
    if (!selectedVehicle) return M.focus ? M.routesOf(M.focus) : [];
    const it = selectedVehicle, exact = it.rk && M.routes[it.rk];
    if (exact && exact.base === it.base && exact.dir === it.dir && exact.line === it.line) return [exact];
    // Never substitute another direction/variant, or arbitrarily choose between
    // multiple routes with the same display number when this vehicle has no key.
    const candidates = M.routesOf(it.base).filter(function (r) { return r.line === it.line && r.dir === it.dir; });
    return candidates.length === 1 ? candidates : [];
  }
  function renderFocusChip() {
    const it = selectedVehicle, base = it ? it.base : M.focus;
    $('#focusChip').classList.toggle('hidden', !base);
    $('#screen-map').classList.toggle('has-focus', !!base);
    if (!base) return;
    $('#focusNum').textContent = it ? it.line : base;
    $('#focusNum').className = 'bus gps';
    $('#focusLabel').textContent = it ? (it.garage ? tr('focus.busNumber', { garage: it.garage }) : tr('focus.selectedBus')) : tr('focus.selectedRoute');
    $('#focusName').textContent = it ? (it.dest ? '→ ' + it.dest : it.title || tr('line', { base: it.line })) : lineName(base) || tr('line', { base: base });
    $('#focusClear').setAttribute('aria-label', tr(it ? 'focus.clearVehicle' : 'focus.showAll'));
  }
  function highlightVehicle() {
    Object.keys(markers).forEach(function (id) {
      const el = markers[id].getElement();
      if (el) { const badge = el.querySelector('.vehicle'); if (badge) badge.classList.toggle('selected', !!selectedVehicle && selectedVehicle.id === id); }
    });
  }
  function selectVehicle(it) {
    selectedVehicle = Object.assign({}, it);
    closeSheet(); renderFocusChip(); drawRoutes(); drawStops(); highlightVehicle();
  }
  function clearVehicleSelection() {
    selectedVehicle = null; selectedRouteRef = null;
    map.closePopup(); renderFocusChip(); drawRoutes(); drawStops(); highlightVehicle();
  }
  function drawRoutes() {
    routeLayer.clearLayers();
    selectedRouteApproximate = false;
    const routes = routesOnMap();
    selectedRouteRef = selectedVehicle ? routes[0] || null : null;
    if (!M.focus && !selectedVehicle) return null;
    const bounds = [];
    routes.forEach(function (r) {
      const pts = r.s.filter(function (x) { return x[1] != null; }).map(function (x) { return [x[1], x[2]]; });
      pts.forEach(function (p) { bounds.push(p); });
      const segments = [];
      const approximate = [];
      for (let i = 1; i < pts.length; i++) {
        const path = T.roads && T.roads.path({la:pts[i-1][0],lo:pts[i-1][1]}, {la:pts[i][0],lo:pts[i][1]});
        if (path) segments.push(T.roads.coordinates(path));
        else if (!T.roads) segments.push([pts[i-1],pts[i]]);
        else if (selectedVehicle) approximate.push([pts[i-1],pts[i]]);
      }
      L.polyline(segments, { color: selectedVehicle ? '#7ee2a8' : '#fff', weight: selectedVehicle ? 16 : 7,
        opacity: selectedVehicle ? 0.32 : 0.95, className: selectedVehicle ? 'selected-route-halo' : '', interactive: false }).addTo(routeLayer);
      L.polyline(segments, { color: selectedVehicle ? '#087f5b' : r.dir === 'B' ? '#83ae42' : '#278d9b',
        weight: selectedVehicle ? 6 : 3, opacity: selectedVehicle ? 1 : 0.9,
        className: selectedVehicle ? 'selected-route-line' : '', interactive: false }).addTo(routeLayer);
      if (approximate.length) {
        selectedRouteApproximate = true;
        L.polyline(approximate, { color: '#70887b', weight: 3, opacity: 0.8, dashArray: '5 7', interactive: false }).addTo(routeLayer);
      }
    });
    if (!selectedVehicle && !bounds.length && M.lines[M.focus]) {
      M.lines[M.focus].stops.forEach(function (u) { const s = M.stations[u]; if (s && s.la != null) bounds.push([s.la, s.lo]); });
    }
    return bounds.length ? L.latLngBounds(bounds) : null;
  }

  function lineName(b) {
    let name = null;
    Object.values(M.sched.tables).forEach(function (t) {
      (t.options || []).forEach(function (o) {
        if (o.value.replace(/[.*]+$/, '') === b) name = o.label.replace(/^\S+\s*/, '');
      });
    });
    if (name) return name;
    const r = M.routesOf(b)[0];
    return r ? (r.title || r.dest || '') : '';
  }
  ui.lineName = lineName;

  function renderMapHeadings() {
    const b = M.focus;
    $('#statusEyebrow').textContent = tr(b ? 'focus.selectedRoute' : 'status.cityTransport');
    $('#statusTitle').textContent = b ? tr('status.bus', { base: b }) : tr('status.now');
    $('#chooseLineText').textContent = tr(b ? 'action.routeTimetable' : 'action.chooseRoute');
    $('#barTitle').textContent = b ? tr('line', { base: b }) : tr('title.map');
  }
  function setFocus(b) {
    selectedVehicle = null; selectedRouteRef = null; map.closePopup();
    M.setFocus(b);
    renderFocusChip();
    renderMapHeadings();
    Object.keys(markers).forEach(function (id) { busLayer.removeLayer(markers[id]); delete markers[id]; });
    const bounds = drawRoutes();
    if (b && bounds) map.fitBounds(bounds, { paddingTopLeft: [32, 138], paddingBottomRight: [60, panelSpace()], maxZoom: 15 });
    drawStops();
    tick();
  }
  ui.setFocus = setFocus;

  // ---------------- stop sheet: when is the next bus ----------------
  function renderStopHeading(uid) {
    const s = M.stations[uid] || {};
    $('#sheetTitle').textContent = s.n || tr('sheet.stop') + ' ' + uid;
    $('#sheetSub').textContent = (s.c ? tr('stop.code', { code: s.c }) + ' · ' : '') + tr('stop.lines', { lines: (s.l || []).join(', ') });
  }
  function openStop(uid) {
    sheetStop = uid;
    sheetResult = null;
    $('#screen-map').classList.add('has-stop');
    renderStopHeading(uid);
    $('#sheetBody').innerHTML = '<div class="empty">' + tr('stop.loading') + '</div>';
    $('#sheetBody').scrollTop = 0;
    $('#sheet').inert = false;
    $('#sheet').classList.add('open');
    $('#sheet').setAttribute('aria-hidden', 'false');
    loadStop(uid);
  }
  function renderArrivals(res) {
    const body = $('#sheetBody');
    let html = '';
    if (res.error) html += '<div class="err-box">' + tr(res.error.retryAt ? 'arrivals.paused' : 'arrivals.error', { time: res.error.retryAt ? T.hhmm(res.error.retryAt) : '' }) + '</div>';
    const list = res.list.filter(function (a) { return !M.focus || a.base === M.focus; });
    if (!list.length) html += '<div class="empty">' + tr('arrivals.empty') + '</div>';
    list.slice(0, 30).forEach(function (a) {
      const min = Math.floor(a.eta / 60);
      const eta = a.eta < 60 ? tr('time.now') : tr('time.minutesShort', { minutes: min });
      const sub = a.kind === 'gps' ? 'GPS' + (a.between != null ? ' · ' + plural('stopsAway', a.between) : '')
        : a.kind === 'est' ? tr('arrivals.estimated') : tr('arrivals.scheduled', { departure: a.dep });
      html += '<div class="arr"><span class="bus ' + a.kind + '">' + esc(a.base) + '</span>' +
        '<div class="arr-dest">' + esc(a.dest || '') + '<small>' + esc((a.line !== a.base ? a.line + ' · ' : '') + sub) + '</small></div>' +
        '<div class="arr-eta">' + eta + '<small>' + T.hhmm(res.at + a.eta * 1000) + '</small></div></div>';
    });
    body.innerHTML = html;
    $('#sheetSub').textContent = res.error ? tr(res.error.retryAt ? 'arrivals.updatePaused' : 'arrivals.availableEstimate', { time: res.error.retryAt ? T.hhmm(res.error.retryAt) : '' })
      : tr('arrivals.dataRefresh', { time: T.hhmm(res.dataAt || res.at) });
  }
  async function loadStop(uid) {
    if (stopLoading) return;
    stopLoading = true;
    $('#sheetRefresh').disabled = true;
    let res;
    try { res = await M.arrivals(uid); } catch (e) { res = { error: { message: String(e) }, list: [] }; }
    stopLoading = false; stopAt = Date.now();
    $('#sheetRefresh').disabled = false;
    if (sheetStop !== uid) { if (sheetStop) loadStop(sheetStop); return; }
    sheetResult = res;
    renderArrivals(res);
  }
  function closeSheet() {
    sheetStop = null;
    sheetResult = null;
    $('#screen-map').classList.remove('has-stop');
    $('#sheet').classList.remove('open');
    $('#sheet').classList.remove('dragging');
    $('#sheet').style.transform = '';
    if ($('#sheet').contains(document.activeElement)) document.activeElement.blur();
    $('#sheet').inert = true;
    $('#sheet').setAttribute('aria-hidden', 'true');
  }

  // ---------------- lines screen ----------------
  function renderLines() {
    const q = ($('#lineSearch').value || '').trim().toLowerCase();
    const counts = {};
    M.snapshot(Date.now()).forEach(function (it) { if (it.kind !== 'sched') counts[it.base] = (counts[it.base] || 0) + 1; });
    const all = M.lineList().filter(function (l) {
      if (!q) return true;
      return l.base.toLowerCase().indexOf(q) === 0 || lineName(l.base).toLowerCase().indexOf(q) >= 0 ||
        l.variants.some(function (v) { return v.toLowerCase() === q; });
    });
    const groups = [[tr('timetable.city'), all.filter(function (l) { return l.city; })],
                    [tr('timetable.suburban'), all.filter(function (l) { return !l.city; })]];
    let html = '';
    groups.forEach(function (g) {
      if (!g[1].length) return;
      html += '<div class="group-title">' + g[0] + ' (' + g[1].length + ')</div><div class="line-grid">';
      g[1].forEach(function (l) {
        const n = counts[l.base] || 0;
        const vars = l.variants.filter(function (v) { return v !== l.base; });
        html += '<button class="line-card" data-base="' + esc(l.base) + '">' +
          '<span class="line-num' + (l.city ? '' : ' sub') + '">' + esc(l.base) + '</span>' +
          '<span class="line-text"><div class="line-name">' + esc(lineName(l.base) || tr('line', { base: l.base })) + '</div>' +
          '<div class="line-meta">' + plural('stops', l.stops.length) + (vars.length ? ' · ' + esc(tr('lines.variants', { variants: vars.join(', ') })) : '') + '</div></span>' +
          (n ? '<span class="line-live">' + n + '<br>' + tr('lines.live') + '</span>' : '') + '</button>';
      });
      html += '</div>';
    });
    $('#linesList').innerHTML = html || '<div class="empty">' + tr('lines.empty') + '</div>';
  }

  // ---------------- timetable screen ----------------
  function todayType() { return M.dayTypeFor(T.isoDay(T.bg(Date.now()))); }

  async function renderTimetable(force) {
    const body = $('#ttBody');
    if (!ttState.dan) ttState.dan = todayType();
    const sel = $('#ttDay');
    sel.innerHTML = G.DAY_TYPES.map(function (d) {
      return '<option value="' + d + '"' + (d === ttState.dan ? ' selected' : '') + '>' + tr('day.' + d) + (d === todayType() ? ' ' + tr('day.today') : '') + '</option>';
    }).join('');
    document.querySelectorAll('#ttRv button').forEach(function (b) { b.classList.toggle('on', b.dataset.rv === ttState.rv); });
    body.innerHTML = '<div class="empty">' + tr('timetable.loading') + '</div>';
    let tbl;
    const want = ttState.rv + '|' + ttState.dan;
    try { tbl = await M.ensureTables(ttState.rv, ttState.dan, force); } catch (e) {
      body.innerHTML = '<div class="err-box">' + esc(tr('timetable.loadFailed', { error: e.message || e })) +
        '</div><button class="btn" id="ttRetry">' + tr('retry') + '</button>';
      $('#ttRetry').onclick = function () { renderTimetable(true); };
      return;
    }
    if (ui.screen !== 'timetable' || want !== ttState.rv + '|' + ttState.dan) return;
    if (ttState.base && tbl.lines[ttState.base]) return renderLineTable(tbl);
    ttState.base = null;
    let html = '<div class="tt-note">' + esc(tr('timetable.official', { date: tbl.vaziod })) + '</div><div class="line-grid">';
    tbl.options.forEach(function (o) {
      const b = o.value.replace(/[.*]+$/, '');
      const has = !!tbl.lines[b];
      const departureCounts = has ? tbl.lines[b].directions.map(function (d) { return d.departures.length; }) : [];
      const total = departureCounts.reduce(function (sum, n) { return sum + n; }, 0);
      const departures = has ? plural('departures', total, { n: departureCounts.join(' + ') }) : tr('timetable.noService');
      html += '<button class="line-card" data-tt="' + esc(b) + '"' + (has ? '' : ' disabled style="opacity:.5"') + '>' +
        '<span class="line-num' + (ttState.rv === 'rvg' ? '' : ' sub') + '">' + esc(b) + '</span>' +
        '<span class="line-text"><div class="line-name">' + esc(o.label.replace(/^\S+\s*/, '')) + '</div>' +
        '<div class="line-meta">' + departures + '</div></span></button>';
    });
    html += '</div><div class="tt-note">' + esc(tr('timetable.loaded', { date: new Date(tbl.fetched).toLocaleString(T.i18n.locale()) })) +
      ' · <a href="#" id="ttReload">' + tr('timetable.reload') + '</a></div>';
    body.innerHTML = html;
    $('#ttReload').onclick = function (e) { e.preventDefault(); renderTimetable(true); };
  }

  function renderLineTable(tbl) {
    const t = tbl.lines[ttState.base];
    const body = $('#ttBody');
    const isToday = ttState.dan === todayType();
    const now = T.bg(Date.now());
    const nowMin = now.hh * 60 + now.mm;
    let html = '<button class="tt-back" id="ttBack">' + tr('timetable.allLines') + '</button>' +
      '<div class="tt-head"><span class="line-num' + (ttState.rv === 'rvg' ? '' : ' sub') + '">' + esc(ttState.base) + '</span>' +
      '<div class="tt-title">' + esc(t.title.replace(/^\S+\s*/, '')) + '</div></div>' +
      '<div class="tt-actions"><button class="btn" id="ttMap">' + tr('timetable.showMap') + '</button></div>';
    t.directions.forEach(function (d) {
      const x = G.expandDepartures(d.departures);
      let nextIdx = -1;
      if (isToday) nextIdx = x.findIndex(function (q) { return q[0] * 1440 + q[1] * 60 + q[2] >= nowMin; });
      html += '<div class="dir-card"><div class="dir-name">' + esc(d.header.replace(/^(Smer|Смер)\s+([ABАБ]):\s*/, tr('timetable.direction'))) + '</div>';
      let hour = null, row = '';
      x.forEach(function (q, i) {
        if (q[1] !== hour) {
          if (row) html += row + '</div></div>';
          hour = q[1];
          row = '<div class="hour-row"><div class="hour">' + String(hour).padStart(2, '0') + '</div><div class="mins">';
        }
        const cls = isToday ? (i === nextIdx ? 'next' : (nextIdx < 0 || i < nextIdx ? 'past' : '')) : '';
        row += '<span class="' + cls + '">' + String(q[2]).padStart(2, '0') + (q[3] ? '<sup>' + esc(q[3]) + '</sup>' : '') + '</span>';
      });
      if (row) html += row + '</div></div>';
      if (!x.length) html += '<div class="empty">' + tr('timetable.noDepartures') + '</div>';
      html += '</div>';
    });
    if (t.legend) html += '<div class="legend"><b>' + tr('timetable.legend') + '</b> ' + esc(t.legend) + '</div>';
    if (isToday) html += '<div class="legend">' + tr('timetable.nextPast') + '</div>';
    body.innerHTML = html;
    body.scrollTop = 0;
    $('#ttBack').onclick = function () { ttState.base = null; renderTimetable(); };
    $('#ttMap').onclick = function () { const b = ttState.base; show('map'); setFocus(b); };
    const nx = body.querySelector('.next');
    if (nx) setTimeout(function () { nx.scrollIntoView({ block: 'center' }); }, 50);
  }

  // ---------------- my location ----------------
  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (p) {
      const ll = [p.coords.latitude, p.coords.longitude];
      if (!meMarker) meMarker = L.marker(ll, { icon: L.divIcon({ className: 'bus-icon', html: '<div class="me-dot"></div>', iconSize: [0, 0] }), zIndexOffset: 1000 }).addTo(map);
      else meMarker.setLatLng(ll);
      map.setView(ll, Math.max(map.getZoom(), 16));
    }, function (e) {
      $('#statusLine').textContent = tr('location.error', { error: e.message || e.code });
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  // ---------------- wiring ----------------
  function panelSpace() {
    return (panelCollapsed ? 90 : $('#status').offsetHeight) + 30;
  }
  function wirePanel() {
    const card = $('#status'), toggle = $('#statusToggle'), details = $('#statusDetails');
    let drag = null, suppressClick = false;
    function measure() {
      card.style.setProperty('--panel-shift', Math.max(0, card.offsetHeight - 90) + 'px');
      $('#screen-map').style.setProperty('--panel-space', panelSpace() + 'px');
    }
    function settle(collapsed) {
      panelCollapsed = collapsed;
      card.classList.toggle('collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', tr(collapsed ? 'panel.expand' : 'panel.collapse'));
      details.inert = collapsed;
      details.setAttribute('aria-hidden', String(collapsed));
      card.style.transform = ''; card.classList.remove('dragging');
      measure();
    }
    toggle.onclick = function () { if (suppressClick) { suppressClick = false; return; } settle(!panelCollapsed); };
    card.addEventListener('pointerdown', function (e) {
      if (!e.isPrimary || (e.button != null && e.button !== 0) || !e.target.closest('.status-toggle, .status-heading')) return;
      const handle = e.target.closest('.status-toggle, .status-heading');
      drag = { id: e.pointerId, handle: handle, y: e.clientY, start: panelCollapsed ? Math.max(0, card.offsetHeight - 90) : 0, moved: false };
      handle.setPointerCapture(e.pointerId);
    });
    card.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y;
      if (Math.abs(dy) > 5) drag.moved = true;
      if (!drag.moved) return;
      card.classList.add('dragging');
      card.style.transform = 'translateY(' + Math.max(0, Math.min(card.offsetHeight - 90, drag.start + dy)) + 'px)';
    });
    function finish(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y, moved = drag.moved, handle = drag.handle;
      drag = null;
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      if (moved) { suppressClick = true; settle(e.type === 'pointercancel' ? panelCollapsed : Math.abs(dy) > 28 ? dy > 0 : panelCollapsed); setTimeout(function () { suppressClick = false; }, 0); }
      else { card.style.transform = ''; card.classList.remove('dragging'); }
    }
    card.addEventListener('pointerup', finish); card.addEventListener('pointercancel', finish);
    new ResizeObserver(measure).observe(card);
    settle(false);
  }
  function wireStopSheet() {
    const sheet = $('#sheet'), body = $('#sheetBody');
    let drag = null;
    function begin(x, y, target) {
      if (!sheet.classList.contains('open') || target.closest('button, a, input, select')) return false;
      const header = !!target.closest('.sheet-head, .sheet-drag-handle');
      if (!header && (!body.contains(target) || body.scrollTop > 1)) return false;
      drag = { x: x, y: y, at: performance.now(), header: header, moved: false, dy: 0 };
      return true;
    }
    function move(x, y) {
      if (!drag || !sheet.classList.contains('open')) { drag = null; return false; }
      const dy = y - drag.y, dx = Math.abs(x - drag.x);
      if (!drag.moved) {
        // Let an upward or horizontal gesture in the list remain native scrolling.
        if (!drag.header && (dy < -5 || dx > Math.max(8, Math.abs(dy)))) { drag = null; return false; }
        if (Math.abs(dy) < 6) return false;
        drag.moved = true;
      }
      drag.dy = Math.max(0, dy);
      sheet.classList.add('dragging');
      sheet.style.transform = 'translateY(' + drag.dy + 'px)';
      return true;
    }
    function end(cancelled) {
      if (!drag) return;
      const d = drag; drag = null;
      const velocity = d.dy / Math.max(1, performance.now() - d.at);
      const dismiss = !cancelled && d.moved && (d.dy > Math.min(100, sheet.offsetHeight * .22) || (d.dy > 28 && velocity > .55));
      sheet.classList.remove('dragging'); sheet.style.transform = '';
      if (dismiss) closeSheet();
    }
    // A non-passive touchmove can hand a downward pull at scrollTop=0 to the
    // sheet while preserving ordinary native list scrolling in both directions.
    sheet.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { end(true); return; }
      begin(e.touches[0].clientX, e.touches[0].clientY, e.target);
    }, { passive: true });
    sheet.addEventListener('touchmove', function (e) {
      if (e.touches.length !== 1) { end(true); return; }
      if (move(e.touches[0].clientX, e.touches[0].clientY) && e.cancelable) e.preventDefault();
    }, { passive: false });
    sheet.addEventListener('touchend', function () { end(false); });
    sheet.addEventListener('touchcancel', function () { end(true); });
    sheet.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' || !e.isPrimary || e.button !== 0) return;
      if (begin(e.clientX, e.clientY, e.target)) sheet.setPointerCapture(e.pointerId);
    });
    sheet.addEventListener('pointermove', function (e) { if (e.pointerType !== 'touch') move(e.clientX, e.clientY); });
    sheet.addEventListener('pointerup', function (e) { if (e.pointerType !== 'touch') end(false); });
    sheet.addEventListener('pointercancel', function (e) { if (e.pointerType !== 'touch') end(true); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheetStop) closeSheet(); });
  }
  function refreshLanguage() {
    renderMapHeadings();
    if (ui.screen !== 'map') $('#barTitle').textContent = tr('title.' + ui.screen);
    renderFocusChip();
    statusLine(Date.now());
    $('#statusToggle').setAttribute('aria-label', tr(panelCollapsed ? 'panel.expand' : 'panel.collapse'));
    const zoomIn = document.querySelector('.leaflet-control-zoom-in'), zoomOut = document.querySelector('.leaflet-control-zoom-out');
    if (zoomIn) zoomIn.title = tr('zoom.in');
    if (zoomOut) zoomOut.title = tr('zoom.out');
    const allMarkers = Object.keys(markers).map(function (id) {
      const marker = markers[id], it = marker._it;
      marker.options.title = tr('line', { base: it.base }) + ' · ' + tr('kind.' + it.kind);
      const el = marker.getElement();
      if (el) el.title = marker.options.title;
      return marker;
    });
    if (allMarkers.length) busLayer.refreshClusters(allMarkers);
    const popupMarker = openPopupId && markers[openPopupId];
    if (popupMarker && popupMarker.getPopup()) popupMarker.getPopup().setContent(popupContent(popupMarker._it));
    if (sheetStop) {
      renderStopHeading(sheetStop);
      if (sheetResult) renderArrivals(sheetResult);
      else $('#sheetBody').innerHTML = '<div class="empty">' + tr('stop.loading') + '</div>';
    }
    if (ui.screen === 'lines') renderLines();
    if (ui.screen === 'timetable') renderTimetable();
  }
  function wire() {
    wirePanel();
    wireStopSheet();
    T.i18n.onChange(refreshLanguage);
    document.querySelectorAll('[data-language]').forEach(function (button) {
      button.onclick = function () { T.i18n.set(button.dataset.language); };
    });
    $('#menuBtn').onclick = function () { openDrawer(!$('#drawer').classList.contains('open')); };
    $('#scrim').onclick = function () { openDrawer(false); };
    document.querySelectorAll('.nav-item, .bottom-item').forEach(function (b) {
      b.onclick = function () {
        show(b.dataset.screen);
      };
    });
    $('#catCity').onchange = $('#catSub').onchange = function () {
      M.setCats({ city: $('#catCity').checked, sub: $('#catSub').checked });
      T.store.set('cats', M.cats);
      tick();
    };
    $('#focusClear').onclick = function () { if (selectedVehicle) clearVehicleSelection(); else setFocus(null); };
    $('#map').addEventListener('click', function (e) {
      if (!e.target.closest('[data-route-overview]') || !selectedVehicle) return;
      e.preventDefault();
      const bounds = drawRoutes();
      if (bounds) { map.closePopup(); map.fitBounds(bounds, { paddingTopLeft: [32, 138], paddingBottomRight: [60, panelSpace()], maxZoom: 15 }); }
    });
    $('#locateBtn').onclick = locate;
    $('#chooseLine').onclick = function () {
      if (M.focus) { ttState.base = M.focus; ttState.rv = M.isCity(M.focus) ? 'rvg' : 'rvp'; show('timetable'); }
      else show('lines');
    };
    function setGpsFilter(on) {
      busLayer.unspiderfy(); spiderfied = false;
      gpsOnly = on;
      $('#filterAll').classList.toggle('on', !on); $('#filterGps').classList.toggle('on', on);
      $('#filterAll').setAttribute('aria-pressed', String(!on)); $('#filterGps').setAttribute('aria-pressed', String(on));
      tick();
    }
    $('#filterAll').onclick = function () { setGpsFilter(false); };
    $('#filterGps').onclick = function () { setGpsFilter(true); };
    $('#overviewBtn').onclick = function () { map.setView(CENTER, 14); };
    $('#sheetClose').onclick = closeSheet;
    $('#sheetRefresh').onclick = function () { if (sheetStop && !stopLoading) loadStop(sheetStop); };
    $('#lineSearch').oninput = renderLines;
    $('#linesList').onclick = function (e) {
      const c = e.target.closest('[data-base]');
      if (!c) return;
      show('map');
      setFocus(c.dataset.base);
    };
    $('#ttRv').onclick = function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      ttState.rv = b.dataset.rv; ttState.base = null; renderTimetable();
    };
    $('#ttDay').onchange = function () { ttState.dan = this.value; renderTimetable(); };
    $('#ttBody').onclick = function (e) {
      const c = e.target.closest('[data-tt]');
      if (!c || c.disabled) return;
      ttState.base = c.dataset.tt;
      renderTimetable();
    };
    document.addEventListener('visibilitychange', function () { setActive(); if (!document.hidden) tick(); });
    // links inside popups / attribution open in the system browser (Android handles it)
  }

  async function start() {
    initMap();
    wire();
    const cats = T.store.get('cats', null);
    if (cats) { M.cats = cats; $('#catCity').checked = cats.city; $('#catSub').checked = cats.sub; }
    let lastRoutes = 0;
    M.on(function (what) {
      if (what === 'poll' && ui.screen === 'map') tick();
      if (what === 'schedule' && ui.screen === 'lines') renderLines();
      if (what === 'poll' && M.focus && Date.now() - lastRoutes > 30e3) { lastRoutes = Date.now(); drawRoutes(); }
      if (what === 'stations') { drawStops(); if (ui.screen === 'lines') renderLines(); }
    });
    setActive();
    try { await M.init(); } catch (e) { $('#statusLine').textContent = tr('startup.error', { error: e.message || e }); }
    $('#splash').classList.add('gone');
    // deep links (used for previews on the PC): #screen=lines, #screen=timetable, #drawer, #focus=14
    const h = location.hash || '';
    const ms = /screen=(\w+)/.exec(h), mf = /focus=([\w"]+)/.exec(h);
    if (ms && ['map', 'lines', 'timetable'].indexOf(ms[1]) >= 0) show(ms[1]);
    if (mf) setFocus(decodeURIComponent(mf[1]));
    if (/drawer/.test(h)) openDrawer(true);
    setActive();
    tick();
    setInterval(tick, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(globalThis.T = globalThis.T || {});
