const {chromium,executablePath}=require('./browser-tools.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
  const browser=await chromium.launch({executablePath,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage({viewport:{width:412,height:892},isMobile:true,hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await require('./offline-ui.cjs')(page);
    await page.route('**/js/ui.js',route=>route.fulfill({contentType:'application/javascript',body:
      fs.readFileSync(path.join(__dirname,'../www/js/ui.js'),'utf8').replace('function openStop(uid) {','ui.testOpenStop=openStop; function openStop(uid) {')}));
    await page.goto('http://localhost:8787/');await page.waitForSelector('.splash.gone');
    const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/raw_6712_live_far.json'),'utf8'));
    await page.evaluate(raw=>{
      window.mockCalls=0;
      T.http=async()=>{window.mockCalls++;return {status:200,text:JSON.stringify(raw)};};
      T.ui.testOpenStop('6712');
    },fixture);
    await page.waitForSelector('#sheetBody .arr');
    const timestamp=await page.locator('#sheetSub').innerText();
    const observedAt=await page.evaluate(()=>T.model.vehicles['1015'].obsAt);
    for(let i=0;i<8;i++)await page.locator('#sheetRefresh').click();
    await page.locator('#sheetClose').click();
    await page.evaluate(()=>{T.ui.testOpenStop('6712');});
    await page.waitForSelector('#sheetBody .arr');
    assert.equal(await page.evaluate(()=>window.mockCalls),1,'Refresh/reopen uses the shared cached response');
    assert.equal(await page.evaluate(()=>T.model.vehicles['1015'].obsAt),observedAt);
    assert.equal(await page.locator('#sheetSub').innerText(),timestamp);
    assert.equal(await page.locator('#sheetRefresh').isEnabled(),true);
    await page.locator('#sheetClose').click();
    await page.evaluate(()=>{T.nsmart.gate.failure(429,'600');T.ui.testOpenStop('different-stop');});
    await page.waitForSelector('#sheetBody .err-box');
    assert((await page.locator('#sheetBody .err-box').innerText()).includes('Пауза'));
    assert.equal(await page.evaluate(()=>window.mockCalls),1,'A new stop also respects the shared API pause');
    await page.waitForFunction(()=>document.querySelector('#liveBadgeText').textContent==='ПАУЗА');
    assert.equal(await page.locator('#sheetRefresh').isEnabled(),true);
    assert.deepEqual(errors,[]);
    console.log('PASS: manual refresh + reopen share cache, preserve GPS timestamp and data label; rate-limit pause blocks other stops and is visible in UI. No upstream requests.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
