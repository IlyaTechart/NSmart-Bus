const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const www=path.join(__dirname,'../www');
const code=fs.readFileSync(path.join(www,'js/roads.js'),'utf8');
function router(nodes,edges){const ctx={T:{ROAD_DATA:{nodes,edges}}};vm.runInNewContext(code,ctx);return ctx.T.roads;}
const nodes=[[45.25,19.85],[45.252,19.85],[45.252,19.853],[45.25,19.853]];
const p=i=>({la:nodes[i][0],lo:nodes[i][1]});
let r=router(nodes,[[0,1,3,1],[1,2,3,1]]),shape=r.path(p(0),p(2));
assert(shape&&shape.points.length>=3,'Route includes the road corner');
for(let f=0;f<=1;f+=.02){const q=r.point(shape,f);assert(Math.abs(q.lo-19.85)<1e-8||Math.abs(q.la-45.252)<1e-8,'Interpolated point stays on the L-shaped road');}
assert.strictEqual(r.path(p(0),p(2)),shape,'Repeated positions reuse cached geometry');
r=router(nodes,[[0,1,1,1],[1,2,1,1],[2,3,1,1],[3,0,1,1]]);
assert(r.path(p(1),p(0)).length>600,'One-way street forces a legal detour');
assert.strictEqual(r.path({la:0,lo:0},p(1)),null,'Distant positions are not snapped into the city');
r=router(nodes,[[0,1,3,1],[2,3,3,1]]);
assert.strictEqual(r.path(p(0),p(2)),null,'Disconnected roads do not gain invented connections');
const ctx={console};vm.createContext(ctx);
for(const file of ['js/net.js','js/nsmart.js','js/gspns.js','data/roads.js','js/roads.js','js/model.js'])vm.runInContext(fs.readFileSync(path.join(www,file),'utf8'),ctx);
const T=ctx.T,now=Date.now();
const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/raw_6712_live_far.json'),'utf8'));
T.model.observe(T.nsmart.parse('6712',raw).buses,now);
const v=T.model.vehicles['1015'],road=T.model.routes[v.rk];let count=0;
for(let j=1;j<road.s.length;j++){
  const a=road.s[j-1],b=road.s[j];if(a[1]==null||b[1]==null)continue;
  assert(T.roads.path({la:a[1],lo:a[2]},{la:b[1],lo:b[2]}),'Road exists for recorded route 14 segment '+j);count++;
}
const q=T.model.vehiclePos(v,now+1209e3),stop=road.s.find(s=>s[0]==='6712');
assert(q.roadAligned,'The model uses roads, not just a visual marker adjustment');
assert(T.model.dist(q.la,q.lo,stop[1],stop[2])<=70,'Original ETA still reaches the road beside the destination stop');
for(let sec=0;sec<1209;sec+=20)assert(T.model.vehiclePos(v,now+sec*1000).roadAligned,'Prediction stays road-aligned at '+sec+' s');
console.log('PASS: corners, one-way detour, disconnected/distant roads, geometry cache, '+count+' real route segments, ETA and model integration.');
