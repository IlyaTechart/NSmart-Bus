const {chromium,executablePath}=require('./browser-tools.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
const www=path.join(__dirname,'../www');
(async()=>{
  const browser=await chromium.launch({executablePath,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:412,height:892},isMobile:true,hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.bootEvents=[];
      const interval=window.setInterval;
      window.setInterval=function(fn,ms,...args){return ms===1000?0:interval(fn,ms,...args);};
    });
    const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/raw_6712_live_far.json'),'utf8'));
    await page.route('**/js/model.js',route=>route.fulfill({contentType:'application/javascript',body:
      fs.readFileSync(path.join(www,'js/model.js'),'utf8')+
      '\nT.gspns.loadIndex=()=>new Promise(()=>{});'+
      '\nT.http=async function(method,url,body){bootEvents.push(url.includes("najava-dolaska")?"gps-request":"catalogue-request");return new Promise(resolve=>{window.releaseGPS=()=>resolve({status:200,text:'+JSON.stringify(JSON.stringify(raw))+'});});};'}));
    await page.route('**/leaflet-maplibre-gl.js',route=>route.fulfill({contentType:'application/javascript',body:
      fs.readFileSync(path.join(www,'lib/maplibre/leaflet-maplibre-gl.js'),'utf8')+
      '\nconst createBasemap=L.maplibreGL;L.maplibreGL=function(options){bootEvents.push("basemap-init");return createBasemap(options);};'}));
    await page.goto('http://localhost:8787/');
    await page.waitForSelector('.splash.gone');
    const events=await page.evaluate(()=>bootEvents);
    assert(events.includes('gps-request'));assert(events.indexOf('gps-request')<events.indexOf('basemap-init'),'GPS dispatch precedes WebGL initialization');
    assert(!events.includes('catalogue-request'),'A bundled catalogue does not block the initial GPS request');
    assert.equal(await page.locator('#nGps').innerText(),'0','No fabricated live positions while waiting');
    await page.evaluate(()=>{releaseGPS();});
    // The regular 1-second tick is disabled: only the immediate poll listener can paint this reply.
    await page.waitForFunction(()=>Number(document.querySelector('#nGps').textContent)>0,{},{timeout:3000});
    assert.deepEqual(errors,[]);
    console.log('PASS: real app startup dispatches GPS before basemap init, opens the map without waiting for GPS, paints the first response without the 1-second timer; no upstream API requests.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
