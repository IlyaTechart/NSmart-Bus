// Real Chromium / mobile viewport review. Uses the locally installed Playwright Core.
const { chromium, executablePath } = require('./browser-tools.cjs');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
    await page.goto('http://localhost:8787/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.splash.gone', { state: 'attached', timeout: 45000 });
    await page.waitForTimeout(14000);
    await page.screenshot({ path: path.resolve(__dirname, '../../map-preview.png') });
    console.log('map:', await page.evaluate(() => ({ canvas: !!document.querySelector('.maplibregl-canvas'), overflow: document.documentElement.scrollWidth > innerWidth,
      markers: document.querySelectorAll('.vehicle').length, error: !document.querySelector('#mapError').classList.contains('hidden'), status: document.querySelector('#statusLine').textContent })));
    await page.click('#filterGps');
    if (await page.locator('.vehicle.est, .vehicle.sched').count()) throw Error('GPS filter includes other positions');
    await page.click('#filterAll');
    await page.click('.bottom-item[data-screen="lines"]');
    await page.waitForSelector('#screen-lines.active');
    await page.locator('#lineSearch').fill('9');
    await page.screenshot({ path: path.resolve(__dirname, '../../routes-preview.png') });
    await page.locator('[data-base="9"]').click();
    await page.waitForSelector('#focusChip:not(.hidden)');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.resolve(__dirname, '../../route-preview.png') });
    await page.locator('#focusClear').click();
    if (await page.locator('#focusChip:not(.hidden)').count()) throw Error('Focus not cleared');
    await page.locator('.bottom-item[data-screen="lines"]').click();
    await page.locator('.bottom-item[data-screen="map"]').click();
    await page.locator('#overviewBtn').click();
    await page.locator('.leaflet-control-zoom-out').click();
    await page.waitForTimeout(600);
    const clusters = await page.locator('.vehicle-cluster').count();
    const visibleCluster = await page.locator('.vehicle-cluster').evaluateAll(es => es.findIndex(e => { const r=e.getBoundingClientRect(); return r.top>210 && r.bottom<500 && r.left>0 && r.right<innerWidth; }));
    if (visibleCluster >= 0) {
      await page.locator('.vehicle-cluster').nth(visibleCluster).click();
      await page.waitForTimeout(700);
    }
    await page.locator('#overviewBtn').click();
    await page.waitForTimeout(600);
    await page.locator('.leaflet-control-zoom-in').click();
    await page.waitForTimeout(600);
    const stop = page.locator('.leaflet-overlay-pane canvas');
    // Canvas stops are tested through a real pointer at a known station, projected by Leaflet.
    const stationPoint = await page.evaluate(() => {
      const s = Object.values(T.model.stations).find(s => s.la && Math.abs(s.la - 45.2517) < .002 && Math.abs(s.lo - 19.8533) < .002);
      if (!s) return null;
      // Leaflet's project() is public; center and zoom match the overview + one zoom click.
      const p = L.CRS.EPSG3857.latLngToPoint(L.latLng(s.la,s.lo),15);
      const center = L.CRS.EPSG3857.latLngToPoint(L.latLng(45.2517,19.8533),15);
      const r = document.querySelector('#map').getBoundingClientRect();
      return { x: r.left+r.width/2+p.x-center.x, y: r.top+r.height/2+p.y-center.y };
    });
    if (stationPoint) {
      await page.mouse.click(stationPoint.x, stationPoint.y);
      await page.waitForSelector('#sheet.open', { timeout: 3000 });
      await page.screenshot({ path: path.resolve(__dirname, '../../stop-preview.png') });
      await page.locator('#sheetClose').click();
    }
    await page.locator('#overviewBtn').click();
    await page.setViewportSize({ width: 360, height: 640 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.resolve(__dirname, '../../map-small-preview.png') });
    console.log('small:', await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
      search: document.querySelector('.map-top').getBoundingClientRect().bottom, card: document.querySelector('#status').getBoundingClientRect().top,
      cardBottom: document.querySelector('#status').getBoundingClientRect().bottom, nav: document.querySelector('.bottom-nav').getBoundingClientRect().top })));
    if (errors.length) throw Error(errors.join('\n'));
    console.log('PASS: actual mobile rendering, GPS filter, search, route selection, clear, navigation, clusters (' + clusters + '), stop sheet (' + !!stationPoint + '); no JS exceptions.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
