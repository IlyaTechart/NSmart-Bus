const {chromium,executablePath}=require('./browser-tools.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
  const browser=await chromium.launch({executablePath,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage({viewport:{width:412,height:892},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/js/ui.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'../www/js/ui.js'),'utf8').replace('function openStop(uid) {','ui.testOpenStop = openStop; function openStop(uid) {')}));
    await page.goto('http://localhost:8787/');await page.waitForSelector('.splash.gone',{timeout:45000});
    await page.evaluate(()=>{T.model.active=false;T.model.snapshot=()=>[];T.model.arrivals=async()=>({at:Date.now(),list:Array.from({length:24},(_,i)=>({base:String(i+1),line:String(i+1),kind:'sched',dest:'NOVO NASELJE',dep:'21:10',eta:60*(i+1)}))});});
    const cdp=await page.context().newCDPSession(page);
    async function swipe(x,y,dy,cancel=false){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy*i/10}]});await page.waitForTimeout(22);}
      await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await page.waitForTimeout(350);
    }
    async function open(){await page.evaluate(()=>{T.ui.testOpenStop('6764');});await page.waitForSelector('#sheet.open');await page.waitForTimeout(300);}
    async function closed(){assert.equal(await page.locator('#sheet.open').count(),0);assert(await page.locator('#sheet').evaluate(e=>e.inert));assert.equal(await page.locator('#screen-map.has-stop').count(),0);}
    for(const viewport of [{width:412,height:892},{width:360,height:640}]){
      await page.setViewportSize(viewport);await open();
      let r=await page.locator('#sheetClose').boundingBox();assert(r.width>=48&&r.height>=48,'Close target >=48px');
      // A tap near the edge must work, not only on the icon strokes.
      await page.touchscreen.tap(r.x+4,r.y+4);await closed();
      await open();r=await page.locator('.sheet-drag-handle').boundingBox();await swipe(r.x+r.width/2,r.y+12,130);await closed();
      await open();r=await page.locator('.sheet-title').boundingBox();await swipe(r.x+25,r.y+10,130);await closed();
      await open();r=await page.locator('#sheetBody').boundingBox();await swipe(r.x+90,r.y+50,130);await closed();
      await open();r=await page.locator('#sheetBody').boundingBox();await swipe(r.x+90,r.y+150,-110);
      assert(await page.locator('#sheetBody').evaluate(e=>e.scrollTop>20),'Upward gesture scrolls arrivals');
      await page.waitForTimeout(500);r=await page.locator('#sheetBody').boundingBox();await swipe(r.x+90,r.y+60,55);
      assert.equal(await page.locator('#sheet.open').count(),1,'Scrolling a non-top list does not close it');
      await page.locator('#sheetBody').evaluate(e=>{e.scrollTop=0;});await page.waitForTimeout(100);
      r=await page.locator('.sheet-drag-handle').boundingBox();await swipe(r.x+r.width/2,r.y+12,18);
      assert.equal(await page.locator('#sheet.open').count(),1,'Short pull springs back');
      await swipe(r.x+r.width/2,r.y+12,90,true);assert.equal(await page.locator('#sheet.open').count(),1,'Cancelled gesture springs back');
      await page.locator('#sheetClose').click();await closed();
    }
    await page.evaluate(()=>{T.model.arrivals=()=>new Promise(resolve=>setTimeout(()=>resolve({at:Date.now(),list:[]}),600));});
    await open();await page.locator('#sheetClose').click();await page.waitForTimeout(900);await closed();
    assert.deepEqual(errors,[]);
    console.log('PASS: 48px edge tap, handle/header/list downward swipes, native list scrolling, short/cancelled pulls, reopen, late response; two mobile sizes.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
