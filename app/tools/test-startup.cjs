const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const www=path.join(__dirname,'../www');
const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/raw_6712_live_far.json'),'utf8'));
const start=Date.UTC(2026,10,15,12),DAY=86400e3;
async function flush(){for(let i=0;i<70;i++)await Promise.resolve();}
function harness({stale=false,budget=null,empty=false}={}){
  let now=start;const timers=[],calls=[],events=[];
  class Clock extends Date{static now(){return now;}}
  const ctx={console,Date:Clock,Intl,setTimeout,clearTimeout,AbortController,setInterval:()=>0};vm.createContext(ctx);
  for(const f of ['net.js','nsmart.js','gspns.js','model.js'])vm.runInContext(fs.readFileSync(path.join(www,'js',f),'utf8'),ctx);
  const T=ctx.T,M=T.model;const store={};if(budget)store.nsmart_budget_v1=budget;
  T.store={get:(k,f)=>store[k]||f,set:(k,v)=>{store[k]=v;}};
  // nsmart was already loaded: restore the gate through the same persisted-state path.
  vm.runInContext(fs.readFileSync(path.join(www,'js/nsmart.js'),'utf8'),ctx);
  // Reload model so its N reference points at that restored gate.
  vm.runInContext(fs.readFileSync(path.join(www,'js/model.js'),'utf8'),ctx);
  const model=T.model;
  const station=(la,lo,lines)=>({la,lo,n:'Test stop',l:lines,t:Object.fromEntries(lines.map(l=>[l,'1']))});
  const stations={terminal:station(45.35,19.74,['1','2','3','4','5']),local1:station(45.251,19.852,['1']),
    localHub:station(45.252,19.853,['1','2','3','4']),local2:station(45.250,19.854,['5','6']),local3:station(45.253,19.850,['7','8']),local4:station(45.249,19.851,['9','10'])};
  T.SEED={stations:empty?{}:stations,stationsAt:now-(stale?20:1)*DAY,routes:{}};
  T.sleep=ms=>new Promise(resolve=>timers.push({at:now+ms,resolve}));
  T.http=async(method,url,body)=>{
    calls.push({at:now,url,uid:body&&new URLSearchParams(body).get('station_uid')});
    if(url.includes('getAllStations'))return {status:200,text:JSON.stringify(Array.from({length:110},(_,i)=>({id:'download'+i,name:'Stop',coordinates:{latitude:45.25,longitude:19.85},lines_for_station:['1'],lines_for_station_additional_data:[{line_number_for_display:'1',line_type:'1'}]})))};
    return {status:200,text:JSON.stringify(raw)};
  };
  T.gspns.loadIndex=()=>new Promise(()=>{});
  model.setViewport({south:45.24,north:45.26,west:19.84,east:19.87});
  model.on(what=>events.push({what,at:now,vehicles:Object.keys(model.vehicles).length}));
  async function advance(ms){const end=now+ms;await flush();while(true){timers.sort((a,b)=>a.at-b.at);if(!timers.length||timers[0].at>end)break;const t=timers.shift();now=t.at;t.resolve();await flush();}now=end;await flush();}
  return {T,model,calls,events,advance,now:()=>now};
}
(async()=>{
  let h=harness({stale:true});await h.model.init();await flush();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].at,start,'First GPS query dispatches at launch');
  assert.equal(h.calls[0].uid,'localHub','A nearby multi-line stop takes priority over remote terminals');
  assert(h.events.some(e=>e.what==='poll'&&e.vehicles>0),'First reply immediately publishes observed GPS');
  assert(h.model.isFresh(h.model.vehicles['1015'],h.now()),'Startup position comes from the fresh response');
  await h.advance(9000);
  assert.equal(h.calls.length,4,'The startup batch still uses three-second pacing');
  assert(h.calls.every(c=>c.uid&&c.uid.startsWith('local')),'All startup GPS requests target visible stops');
  await h.advance(3000);assert(h.calls[4].url.includes('getAllStations'),'Stale catalogue is refreshed after initial GPS queries');
  for(let i=1;i<h.calls.length;i++)assert(h.calls[i].at-h.calls[i-1].at>=3000);
  h=harness({budget:{starts:[start-1000],blockedUntil:0}});await h.model.init();await flush();assert.equal(h.calls.length,0);
  await h.advance(1999);assert.equal(h.calls.length,0);await h.advance(1);assert.equal(h.calls.length,1,'Startup respects persisted pacing');
  h=harness({budget:{starts:[],blockedUntil:start+60000,failures:1}});await h.model.init();await h.advance(59000);assert.equal(h.calls.length,0,'Startup does not bypass an API cooldown');
  await h.advance(1000);assert.equal(h.calls[0].uid,'localHub');
  h=harness();await h.model.init();await flush();h.model.active=false;await h.advance(3000);assert.equal(h.calls.length,1,'No waiting startup request dispatches in background');
  h.model.active=true;h.model.prioritizeLive();await h.advance(3000);assert(h.calls.length>1);
  h=harness();h.model.focus='5';await h.model.init();await flush();assert.equal(h.calls[0].uid,'local2','Focused line constrains startup discovery');
  h=harness({empty:true});await h.model.init();await flush();assert(h.calls[0].url.includes('getAllStations'),'Missing catalogue is downloaded only when needed');
  await h.advance(3000);assert(h.calls[1].uid,'GPS polling follows the required catalogue download');
  console.log('PASS: immediate startup GPS, visible interchange priority, immediate observation event, deferred catalogue, 3s spacing, persisted budget/cooldown, background/resume, focus and empty-catalogue fallback. No upstream requests.');
})().catch(e=>{console.error(e);process.exitCode=1;});
