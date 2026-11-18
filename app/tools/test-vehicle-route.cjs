const {chromium,executablePath}=require('./browser-tools.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
  const browser=await chromium.launch({executablePath,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:412,height:892},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));await require('./offline-ui.cjs')(page);
    await page.route('**/js/ui.js',route=>route.fulfill({contentType:'application/javascript',body:
      fs.readFileSync(path.join(__dirname,'../www/js/ui.js'),'utf8').replace('map = L.map(','map = window.testMap = L.map(')
        .replace('busLayer = L.markerClusterGroup(','busLayer = window.testBuses = L.markerClusterGroup(')
        .replace('routeLayer = L.layerGroup(','routeLayer = window.testRoutes = L.layerGroup(')
        .replace('stopLayer = L.layerGroup(','stopLayer = window.testStops = L.layerGroup(')
        .replace('let openPopupId = null;','let openPopupId = null; window.testPopupId = () => openPopupId;')}));
    await page.goto('http://localhost:8787/');await page.waitForSelector('.splash.gone',{state:'attached'});
    const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/raw_6712_live_far.json'),'utf8'));
    await page.evaluate(raw=>{
      window.apiCalls=0;T.http=async()=>{apiCalls++;throw Error('Unexpected API request');};
      const bus=T.nsmart.parse('6712',raw).buses[0],s=bus.stops.slice(4,8);
      s.forEach(x=>{T.model.stations[x[0]]={n:'Test stop',la:x[1],lo:x[2]};});
      const route=(k,line,dir,stops)=>({k,line,base:'14',dir,s:stops,t:Date.now(),dest:dir==='A'?'VETERNIK':'CENTAR'});
      T.model.routes={a:route('a','14S','A',s),b:route('b','14S','B',s.slice().reverse()),variant:route('variant','14Z','A',s.slice(1))};
      window.busItems=[{id:'bus-a',garage:'1015',rk:'a',base:'14',line:'14S',dir:'A',kind:'gps',la:s[1][1],lo:s[1][2],dest:'VETERNIK'},
        {id:'bus-b',garage:'2020',rk:'b',base:'14',line:'14S',dir:'B',kind:'gps',la:s[1][1]+.002,lo:s[1][2]+.002,dest:'CENTAR'}];
      T.model.snapshot=()=>busItems;testMap.setView([busItems[0].la,busItems[0].lo],17);
    },raw);
    await page.waitForTimeout(1300);
    async function tapBus(id){
      // Real touch at the chosen individual marker, not a direct selection call.
      await page.waitForFunction(id=>{const m=testBuses.getLayers().find(m=>m._it.id===id);return m&&m.getElement();},id);
      const p=await page.evaluate(id=>{const e=testBuses.getLayers().find(m=>m._it.id===id).getElement();const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};},id);
      await page.touchscreen.tap(p.x,p.y);await page.waitForSelector('.route-overview');
    }
    async function assertRoute(key){
      assert.equal(await page.evaluate(()=>testRoutes.getLayers().length),2,'Only the selected route, not both directions or variants');
      assert(await page.evaluate(key=>{
        const r=T.model.routes[key],expected=[];
        for(let i=1;i<r.s.length;i++){const a=r.s[i-1],b=r.s[i];const p=T.roads.path({la:a[1],lo:a[2]},{la:b[1],lo:b[2]});if(p)expected.push(T.roads.coordinates(p));}
        const actual=testRoutes.getLayers()[1].getLatLngs().map(part=>part.map(p=>[p.lat,p.lng]));
        return expected.length>0&&JSON.stringify(actual)===JSON.stringify(expected);
      },key),'Displayed geometry matches this exact vehicle route');
    }
    await tapBus('bus-a');await assertRoute('a');
    assert(await page.evaluate(()=>{
      const layers=testRoutes.getLayers();
      return layers[0].options.className==='selected-route-halo'&&layers[0].options.color==='#7ee2a8'&&layers[0].options.weight===16&&
        layers[1].options.className==='selected-route-line'&&layers[1].options.color==='#087f5b'&&layers[1].options.weight===6;
    }),'The exact vehicle route has a visible highlight halo');
    assert((await page.locator('#focusLabel').innerText()).includes('1015'));assert((await page.locator('#focusName').innerText()).includes('VETERNIK'));
    assert.equal(await page.locator('.vehicle.selected').count(),1);
    await page.evaluate(()=>{window.stablePopupTitle=document.querySelector('.pop-title');window.stableRouteButton=document.querySelector('.route-overview');busItems[0].age=2;});
    await page.waitForTimeout(1200);await assertRoute('a');
    assert((await page.locator('[data-popup-age]').innerText()).includes('2'),'GPS age is filled immediately');
    await page.evaluate(()=>{busItems[0].age=3;});await page.waitForTimeout(1200);
    assert((await page.locator('[data-popup-age]').innerText()).includes('3'),'GPS age keeps updating');
    assert(await page.evaluate(()=>stablePopupTitle===document.querySelector('.pop-title')&&stableRouteButton===document.querySelector('.route-overview')),'Tick updates only the GPS age, not the whole popup DOM');
    await page.evaluate(()=>{
      const m=testBuses.getLayers().find(m=>m._it.id==='bus-a'),p=m.getLatLng();
      window.frozenPosition={lat:p.lat,lng:p.lng};busItems[0].la+=.0008;busItems[0].lo+=.0008;
    });
    await page.waitForTimeout(1200);
    assert(await page.evaluate(()=>{
      const m=testBuses.getLayers().find(m=>m._it.id==='bus-a'),p=m.getLatLng();
      return p.lat===frozenPosition.lat&&p.lng===frozenPosition.lng&&testMap.hasLayer(m.getPopup());
    }),'A moving bus and its open popup stay frozen at the original position');
    await page.locator('.leaflet-popup-close-button').click();await page.waitForTimeout(1200);
    assert(await page.evaluate(()=>{
      const m=testBuses.getLayers().find(m=>m._it.id==='bus-a');
      return m.getLatLng().distanceTo([busItems[0].la,busItems[0].lo])<1;
    }),'Closing the popup immediately catches the marker up to its latest calculated position');
    await tapBus('bus-a');await assertRoute('a');await page.waitForTimeout(1200);
    assert(await page.evaluate(()=>{const m=testBuses.getLayers().find(m=>m._it.id==='bus-a');return testPopupId()==='bus-a'&&testMap.hasLayer(m.getPopup());}),'Reopening after a position update keeps the new popup active');
    await page.locator('[data-route-overview]').click();await page.waitForTimeout(700);await assertRoute('a');
    await page.evaluate(()=>{busItems[0].la=frozenPosition.lat;busItems[0].lo=frozenPosition.lng;});await page.waitForTimeout(1200);
    await page.locator('#focusClear').click();assert.equal(await page.evaluate(()=>testRoutes.getLayers().length),0);
    await page.evaluate(()=>{testMap.setView([busItems[1].la,busItems[1].lo],17);});await page.waitForTimeout(700);
    await tapBus('bus-b');await assertRoute('b');assert((await page.locator('#focusName').innerText()).includes('CENTAR'));
    await page.evaluate(()=>{T.ui.back();});assert.equal(await page.evaluate(()=>testRoutes.getLayers().length),0,'Back clears vehicle selection');
    await page.evaluate(()=>{T.ui.setFocus('14');testMap.setView([busItems[0].la,busItems[0].lo],17);});await page.waitForTimeout(800);
    await tapBus('bus-a');await assertRoute('a');await page.locator('#focusClear').click();
    assert.equal(await page.evaluate(()=>testRoutes.getLayers().length),6,'Clearing a vehicle restores the selected line');
    await page.locator('#focusClear').click();
    // Missing data must not display another variant as if it belonged to this bus.
    await page.evaluate(()=>{busItems[0].rk='unknown';busItems[0].line='14NEW';testMap.setView([busItems[0].la,busItems[0].lo],17);});
    await page.waitForTimeout(1200);
    const p=await page.evaluate(()=>{const r=testBuses.getLayers().find(m=>m._it.id==='bus-a').getElement().getBoundingClientRect();return {x:r.left+28,y:r.top+24};});
    await page.touchscreen.tap(p.x,p.y);await page.waitForSelector('.leaflet-popup-content');
    assert.equal(await page.evaluate(()=>testRoutes.getLayers().length),0);assert((await page.locator('.leaflet-popup-content').innerText()).includes('ещё не получен'));
    await page.evaluate(()=>{T.model.routes.unknown=Object.assign({},T.model.routes.a,{k:'unknown',line:'14NEW'});});
    await page.waitForFunction(()=>testRoutes.getLayers().length===2);await assertRoute('unknown');
    await page.evaluate(()=>{T.roads.path=()=>null;T.model.routes.unknown=Object.assign({},T.model.routes.unknown);});
    await page.waitForFunction(()=>testRoutes.getLayers().some(l=>l.options.dashArray));
    await page.waitForFunction(()=>document.querySelector('.leaflet-popup-content').textContent.includes('Пунктиром'));
    assert.equal(await page.evaluate(()=>testRoutes.getLayers().filter(l=>l.options.dashArray).length),1,'Missing road geometry is displayed explicitly as approximate');
    assert.equal(await page.evaluate(()=>apiCalls),0);assert.deepEqual(errors,[]);
    console.log('PASS: real marker taps show exact road geometry/direction/variant; selection survives updates; overview, clear, back and line restoration; missing/late route data; zero API requests.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
