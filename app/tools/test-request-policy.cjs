// No upstream requests: all responses and time are controlled locally.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const www=path.join(__dirname,'../www');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/raw_6712_live_far.json'),'utf8'));
function harness(saved, initial=Date.UTC(2026,10,15,12)) {
  let clock=initial, calls=[], active=0, maxActive=0;
  const store=saved||{};
  class Clock extends Date { static now(){return clock;} }
  const ctx={console,Date:Clock,Intl,setTimeout,clearTimeout,AbortController};vm.createContext(ctx);
  function load(file){vm.runInContext(fs.readFileSync(path.join(www,file),'utf8'),ctx,{filename:file});}
  load('js/net.js');
  const T=ctx.T;
  T.store={get:(key,fallback)=>key in store?JSON.parse(JSON.stringify(store[key])):fallback,
    set:(key,value)=>{store[key]=JSON.parse(JSON.stringify(value));}};
  T.sleep=async ms=>{clock+=ms;};
  let response=()=>({status:200,text:JSON.stringify(fixture)});
  T.http=async(method,url,body)=>{
    calls.push({at:clock,url,body});active++;maxActive=Math.max(active,maxActive);
    try { await Promise.resolve();return await response(url,body); } finally {active--;}
  };
  load('js/gspns.js');load('js/nsmart.js');load('js/model.js');
  return {ctx,T,calls,store,load,now:()=>clock,advance:ms=>{clock+=ms;},setResponse:fn=>{response=fn;},maxActive:()=>maxActive};
}
function assertBudget(calls){
  for(let i=0;i<calls.length;i++){
    if(i)assert(calls[i].at-calls[i-1].at>=3000,'At least 3 seconds between starts');
    assert(calls.filter(c=>c.at<=calls[i].at&&c.at>calls[i].at-60000).length<=20,'At most 20 starts in each rolling minute');
  }
}
(async()=>{
  let h=harness();
  await Promise.all(Array.from({length:45},(_,i)=>{
    h.T.model.setViewport({south:45,north:46,west:19,east:20});
    h.T.model.setFocus(null);h.T.model.setCats({city:true,sub:true});
    return h.T.nsmart.fetchStop(String(i));
  }));
  assert.equal(h.calls.length,45);assert.equal(h.maxActive(),1);assertBudget(h.calls);
  // Restarting the JS app restores its last request time and rolling budget.
  let restarted=harness(h.store,h.now());
  await restarted.T.nsmart.fetchStop('after-restart');assertBudget([...h.calls,...restarted.calls]);

  h=harness();let resolve;
  h.setResponse(()=>new Promise(r=>{resolve=r;}));
  const p=h.T.nsmart.fetchStop('6712');
  for(let i=0;i<30;i++)assert.strictEqual(h.T.nsmart.fetchStop('6712'),p,'Concurrent map/manual requests share one promise');
  await Promise.resolve();await Promise.resolve();
  resolve({status:200,text:JSON.stringify(fixture)});const original=await p;
  h.advance(29000);const cached=await h.T.nsmart.fetchStop('6712');
  assert.equal(h.calls.length,1);assert.equal(cached.cached,true);assert.equal(cached.receivedAt,original.receivedAt);
  h.setResponse(()=>({status:200,text:JSON.stringify(fixture)}));h.advance(1000);
  await h.T.nsmart.fetchStop('6712');assert.equal(h.calls.length,2,'30-second expiry permits a new request');

  h=harness();h.setResponse(()=>({status:429,text:'busy',retryAfter:'900'}));
  const errors=await Promise.all(['1','2','3','4'].map(id=>h.T.nsmart.fetchStop(id)));
  assert.equal(h.calls.length,1,'Queued requests do not continue after 429');
  assert.equal(errors[0].error.status,429);assert.equal(errors[1].error.type,'cooldown');
  assert.equal(h.T.nsmart.gate.backoffMs(),900000,'Retry-After overrides the five-minute minimum');
  restarted=harness(h.store,h.now());
  assert.equal((await restarted.T.nsmart.fetchStop('5')).error.type,'cooldown');assert.equal(restarted.calls.length,0);
  restarted.advance(900000);await restarted.T.nsmart.fetchStop('5');assert.equal(restarted.calls.length,1);

  h=harness();h.setResponse(()=>({status:403,text:'forbidden'}));await h.T.nsmart.fetchStop('1');
  assert.equal(h.T.nsmart.gate.backoffMs(),300000);
  h.advance(300000);await h.T.nsmart.fetchStop('1');assert.equal(h.T.nsmart.gate.backoffMs(),600000);
  h=harness();h.setResponse(()=>({status:503,text:'busy',retryAfter:new Date(h.now()+3600000).toUTCString()}));
  await h.T.nsmart.fetchStop('1');assert.equal(h.T.nsmart.gate.backoffMs(),3600000,'HTTP-date Retry-After is honored');
  h=harness();h.setResponse(()=>({status:500,text:'error'}));
  await h.T.nsmart.fetchStop('1');assert.equal(h.T.nsmart.gate.backoffMs(),15000);
  h.advance(15000);await h.T.nsmart.fetchStop('1');assert.equal(h.T.nsmart.gate.backoffMs(),30000);

  h=harness();await h.T.nsmart.fetchStop('1');
  h.T.sleep=async ms=>{h.advance(ms);h.T.model.active=false;};
  assert.equal((await h.T.nsmart.fetchStop('2')).error.type,'paused');assert.equal(h.calls.length,1,'Going into background cancels a waiting dispatch');
  h=harness();await h.T.nsmart.fetchStop('1');
  h.T.sleep=async ms=>{h.advance(ms);h.T.nsmart.gate.failure(429);};
  assert.equal((await h.T.nsmart.fetchStop('2')).error.type,'cooldown');assert.equal(h.calls.length,1,'A newly imposed pause is rechecked after waiting');

  h=harness();
  const stations=Array.from({length:110},(_,i)=>({id:String(i),name:'Stop',coordinates:{latitude:45.25,longitude:19.85}}));
  h.setResponse(url=>({status:200,text:JSON.stringify(url.includes('getAllStations')?stations:fixture)}));
  await h.T.nsmart.fetchStop('1');
  const download=h.T.nsmart.fetchStations();assert.strictEqual(h.T.nsmart.fetchStations(),download);
  await download;assert.equal(h.calls.length,2);assertBudget(h.calls);
  h=harness();h.setResponse(()=>({status:429,text:'busy',retryAfter:'600'}));
  await assert.rejects(h.T.nsmart.fetchStations());
  assert.equal((await h.T.nsmart.fetchStop('1')).error.type,'cooldown');assert.equal(h.calls.length,1,'Station-download restriction applies to stop requests');
  h=harness();h.setResponse(()=>({status:200,text:'not JSON'}));await h.T.nsmart.fetchStop('1');assert(h.T.nsmart.gate.backoffMs()>0);
  h=harness();h.setResponse(()=>({status:200,text:JSON.stringify([{station_name:'Stop',seconds_left:1,all_stations:{unexpected:true}}])}));
  await assert.rejects(h.T.nsmart.fetchStop('1'));assert(h.T.nsmart.gate.backoffMs()>0,'Unexpected API schema also backs off');

  h=harness();const first=await h.T.model.arrivals('6712'),obs=h.T.model.vehicles['1015'].obsAt;
  h.advance(20000);const second=await h.T.model.arrivals('6712');
  const a=first.list.find(v=>v.garage==='1015'),b=second.list.find(v=>v.garage==='1015');
  assert(a&&b);assert.equal(h.calls.length,1);assert.equal(b.eta,Math.max(0,a.eta-20));
  assert.equal(h.T.model.vehicles['1015'].obsAt,obs);assert.equal(h.T.model.lastOkAt,obs,'Cache reuse does not pretend a new successful network response');
  const newer=JSON.parse(JSON.stringify(h.T.nsmart.parse('6712',fixture).buses));newer[0].lat+=.001;
  h.T.model.observe(newer,h.now());const latest=h.T.model.vehicles['1015'];
  await h.T.model.arrivals('6712');assert.strictEqual(h.T.model.vehicles['1015'],latest,'Old cached stop does not overwrite a newer GPS observation');

  // Retry-After must survive both the native bridge and direct fetch transports.
  const ctx={console,setTimeout,clearTimeout,AbortController};vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(www,'js/net.js'),'utf8'),ctx);
  ctx.AndroidNet={request:id=>ctx.__httpDone(id,429,'busy','1200')};
  assert.equal((await ctx.T.http('POST','https://example.test','')).retryAfter,'1200');
  delete ctx.AndroidNet;ctx.fetch=async()=>({status:503,headers:{get:()=> '600'},text:async()=> 'busy'});
  assert.equal((await ctx.T.http('POST','https://example.test','')).retryAfter,'600');
  console.log('PASS: rolling 20/min + 3s spacing, one in-flight request, pan/focus independence, persistent budget/backoff, coalescing, cache expiry/ETA, 403/429/Retry-After, background cancellation, shared station budget, native/fetch header transport. No upstream requests.');
})().catch(e=>{console.error(e);process.exitCode=1;});
