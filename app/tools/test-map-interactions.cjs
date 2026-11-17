const { chromium, executablePath } = require('./browser-tools.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert');
(async () => {
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await require('./offline-ui.cjs')(page);
    // Observe the real Leaflet instances without shipping test accessors in the app.
    await page.route('**/js/ui.js', route => route.fulfill({ contentType: 'application/javascript', body:
      fs.readFileSync(path.join(__dirname, '../www/js/ui.js'), 'utf8').replace('map = L.map(', 'map = window.testMap = L.map(')
        .replace('busLayer = L.markerClusterGroup(', 'busLayer = window.testBuses = L.markerClusterGroup(') }));
    await page.goto('http://localhost:8787/');
    await page.waitForSelector('.splash.gone', { state: 'attached', timeout: 45000 });
    assert.equal(await page.locator('#splash').evaluate(e => getComputedStyle(e).display), 'none', 'Dismissed splash leaves the compositing tree');
    assert.equal(await page.locator('#status').evaluate(e => getComputedStyle(e).backdropFilter), 'none', 'WebGL map has no backdrop-filter overlay');
    assert.equal(await page.locator('#mapSearch').count(), 0);
    await page.locator('#statusToggle').click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#statusToggle').getAttribute('aria-expanded'), 'false');
    assert(await page.locator('#statusDetails').evaluate(e => e.inert));
    await page.screenshot({ path: path.resolve(__dirname, '../../map-collapsed-preview.png') });
    const session = await page.context().newCDPSession(page);
    async function swipe(from, to) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      for (let i=1; i<=8; i++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x:from.x+(to.x-from.x)*i/8, y:from.y+(to.y-from.y)*i/8 }] });
        await page.waitForTimeout(20);
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(350);
    }
    let handle = await page.locator('#statusToggle').boundingBox();
    await swipe({x:handle.x+handle.width/2,y:handle.y+10}, {x:handle.x+handle.width/2,y:handle.y-100});
    assert.equal(await page.locator('#statusToggle').getAttribute('aria-expanded'), 'true', 'Swipe up expands');
    handle = await page.locator('#statusToggle').boundingBox();
    await swipe({x:handle.x+handle.width/2,y:handle.y+10}, {x:handle.x+handle.width/2,y:handle.y+140});
    assert.equal(await page.locator('#statusToggle').getAttribute('aria-expanded'), 'false', 'Swipe down collapses');
    await page.locator('#statusToggle').click();
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      T.model.active = false;
      T.model.snapshot = () => Array.from({length:5}, (_,i) => ({ id:'fixture'+i, base:['8','14','77','4','9'][i], line:'8', kind:i<3?'gps':i===3?'est':'sched', la:45.2517, lo:19.8533 }));
      testMap.setView([45.2517,19.8533],14);
    });
    await page.waitForTimeout(1600);
    for (const zoom of [13,15,14,17,14]) {
      await page.evaluate(z => { testMap.setZoom(z); }, zoom);
      await page.waitForTimeout(600);
      assert.deepEqual(await page.evaluate(() => {
        const children = testBuses.getLayers();
        return { count:children.length, represented:children.every(m => !!testBuses.getVisibleParent(m)) };
      }), {count:5,represented:true}, 'Every bus stays represented at zoom '+zoom);
    }
    const cluster = page.locator('.vehicle-cluster');
    assert.equal(await cluster.count(),1);
    assert((await cluster.innerText()).includes('авто'));
    await page.evaluate(() => { window.oldClusterIcon = document.querySelector('.vehicle-cluster'); });
    await page.waitForTimeout(2100);
    assert(await page.evaluate(() => oldClusterIcon === document.querySelector('.vehicle-cluster')), 'Stationary clusters keep the same DOM');
    await page.screenshot({ path: path.resolve(__dirname, '../../cluster-preview.png') });
    await cluster.click(); await page.waitForTimeout(800);
    await cluster.click(); await page.waitForTimeout(600);
    assert.equal(await page.locator('.vehicle').count(),5,'Overlapping buses fan out');
    const before = await page.locator('.vehicle-hit').evaluateAll(es => es.map(e => e.style.transform));
    await page.waitForTimeout(2100);
    assert.deepEqual(await page.locator('.vehicle-hit').evaluateAll(es => es.map(e => e.style.transform)),before,'Updates do not undo expanded markers');
    await page.screenshot({ path: path.resolve(__dirname, '../../cluster-expanded-preview.png') });
    await page.click('#filterGps'); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => testBuses.getLayers().length),3,'GPS filter also filters expanded groups');
    assert.deepEqual(errors,[]);
    console.log('PASS: button + real touch swipes; all 5 buses represented over 5 zoom changes; stable cluster DOM; fan-out survives updates; GPS filter.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
