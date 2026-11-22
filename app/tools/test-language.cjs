const {chromium,executablePath}=require('./browser-tools.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
  const browser=await chromium.launch({executablePath,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:412,height:892},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{if(!sessionStorage.getItem('languageTestStarted')){localStorage.removeItem('language');sessionStorage.setItem('languageTestStarted','1');}});
    await require('./offline-ui.cjs')(page);
    await page.route('**/js/ui.js',route=>route.fulfill({contentType:'application/javascript',body:
      fs.readFileSync(path.join(__dirname,'../www/js/ui.js'),'utf8').replace('map = L.map(','map = window.testMap = L.map(')
        .replace('busLayer = L.markerClusterGroup(','busLayer = window.testBuses = L.markerClusterGroup(')
        .replace('function openStop(uid) {','ui.testOpenStop = openStop; function openStop(uid) {')}));
    await page.goto('http://localhost:8787/');await page.waitForSelector('.splash.gone',{state:'attached'});
    assert.equal(await page.locator('html').getAttribute('lang'),'ru');
    assert.equal(await page.locator('#barTitle').innerText(),'Город в движении');

    await page.locator('#menuBtn').click();await page.locator('[data-language="en"]').click();
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.equal(await page.locator('#barTitle').innerText(),'The city in motion');
    assert.equal(await page.locator('.drawer-sub').innerText(),'Novi Sad buses');
    assert.equal(await page.locator('#filterAll').innerText(),'All buses');
    assert.equal(await page.locator('#statusTitle').innerText(),'On the map now');
    assert.equal(await page.locator('[data-language="en"]').getAttribute('aria-pressed'),'true');
    await page.locator('.nav-item[data-screen="map"]').click();

    await page.evaluate(()=>{
      window.apiCalls=0;T.http=async()=>{apiCalls++;throw Error('Unexpected API request');};
      T.model.lines={14:{base:'14',city:true,variants:['14','14S'],stops:['1','2']}};
      T.model.routes={};
      T.model.dayTypeFor=()=>'R';
      T.model.ensureTables=async()=>({rv:'rvg',dan:'R',vaziod:'2026-01-01',fetched:Date.now(),
        options:[{value:'14',label:'14 CENTAR'}],lines:{14:{title:'14 CENTAR',directions:[{header:'Smer A: CENTAR',departures:[1,2]}]}}});
    });
    await page.locator('.bottom-item[data-screen="lines"]').click();
    assert.equal(await page.locator('.group-title').innerText(),'CITY (1)');
    assert((await page.locator('.line-meta').innerText()).includes('2 stops · variants: 14S'));
    assert.equal(await page.locator('#lineSearch').getAttribute('placeholder'),'Number or area, for example 14 or Liman');
    await page.locator('.bottom-item[data-screen="timetable"]').click();await page.waitForSelector('[data-tt="14"]');
    assert.equal(await page.locator('#ttDay option').first().innerText(),'Weekday (today)');
    assert((await page.locator('#ttBody').innerText()).includes('Official gspns.rs timetable'));
    assert((await page.locator('#ttBody .line-meta').innerText()).includes('2 departures'));

    const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/raw_6712_live_far.json'),'utf8'));
    await page.evaluate(raw=>{
      const bus=T.nsmart.parse('6712',raw).buses[0],s=bus.stops.slice(4,8);
      s.forEach(x=>{T.model.stations[x[0]]={n:'Test stop',la:x[1],lo:x[2]};});
      T.model.routes={a:{k:'a',line:'14S',base:'14',dir:'A',s,t:Date.now(),dest:'VETERNIK'}};
      window.busItems=[{id:'bus-a',garage:'1015',rk:'a',base:'14',line:'14S',dir:'A',kind:'gps',la:s[1][1],lo:s[1][2],dest:'VETERNIK',age:12}];
      T.model.snapshot=()=>busItems;T.ui.show('map');testMap.setView([busItems[0].la,busItems[0].lo],17);
    },raw);
    await page.waitForTimeout(1300);
    const point=await page.evaluate(()=>{const e=testBuses.getLayers()[0].getElement(),r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
    await page.touchscreen.tap(point.x,point.y);await page.waitForSelector('.route-overview');
    let popup=await page.locator('.leaflet-popup-content').innerText();
    assert(popup.includes('Destination:')&&popup.includes('Fleet №:')&&popup.includes('GPS (precise)'));
    assert.equal(await page.locator('.route-overview').innerText(),'Show full route →');
    assert((await page.locator('#focusLabel').innerText()).includes('BUS №1015'));

    await page.locator('#menuBtn').click();await page.locator('[data-language="ru"]').click();
    popup=await page.locator('.leaflet-popup-content').innerText();
    assert(popup.includes('Куда:')&&popup.includes('Бортовой №:')&&popup.includes('GPS (точно)'));
    assert.equal(await page.locator('.route-overview').innerText(),'Показать маршрут целиком →');
    assert((await page.locator('#focusLabel').innerText()).includes('АВТОБУС №1015'));
    await page.locator('[data-language="en"]').click();
    await page.locator('.nav-item[data-screen="map"]').click();
    await page.evaluate(()=>{
      T.model.stations.test={n:'Test stop',c:'T1',l:['14']};
      T.model.arrivals=async()=>({at:Date.now(),dataAt:Date.now(),list:[{base:'14',line:'14S',kind:'gps',dest:'VETERNIK',eta:120,between:2}]});
      T.ui.testOpenStop('test');
    });
    await page.waitForSelector('#sheet .arr');
    assert((await page.locator('#sheetBody').innerText()).includes('2 stops away'));
    assert((await page.locator('#sheetSub').innerText()).includes('Data from'));
    await page.locator('#menuBtn').click();await page.locator('[data-language="ru"]').click();
    assert((await page.locator('#sheetBody').innerText()).includes('2 остановки до вас'));
    assert((await page.locator('#sheetSub').innerText()).includes('Данные'));
    await page.locator('[data-language="en"]').click();
    assert((await page.locator('#sheetBody').innerText()).includes('2 stops away'));
    assert.equal(await page.evaluate(()=>apiCalls),0);
    await page.reload();await page.waitForSelector('.splash.gone',{state:'attached'});
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.equal(await page.locator('#barTitle').innerText(),'The city in motion');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('language'))),'en');
    assert.deepEqual(errors,[]);
    console.log('PASS: Russian default; English drawer selection; map, lines, timetable, bus popup and focus labels; persistence after reload; no API requests.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
