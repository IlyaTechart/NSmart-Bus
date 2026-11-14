/* Local directed road routing. No per-vehicle routing requests or map-tile dependency. */
(function (T) {
  'use strict';
  const data=T.ROAD_DATA;
  if (!data) return;
  const X=78380, Y=111320, CELL=180;
  const xy=data.nodes.map(function(p){return [p[1]*X,p[0]*Y];});
  const adj=xy.map(function(){return [];});
  const grid=new Map(), cache=new Map();
  const hypot=Math.hypot;
  const edges=data.edges.map(function(e,i){
    const a=xy[e[0]], b=xy[e[1]], len=hypot(b[0]-a[0],b[1]-a[1]);
    if(e[2]&1) adj[e[0]].push([e[1],len*e[3]]);
    if(e[2]&2) adj[e[1]].push([e[0],len*e[3]]);
    for(let x=Math.floor(Math.min(a[0],b[0])/CELL);x<=Math.floor(Math.max(a[0],b[0])/CELL);x++)
      for(let y=Math.floor(Math.min(a[1],b[1])/CELL);y<=Math.floor(Math.max(a[1],b[1])/CELL);y++) {
        const k=x+','+y; if(!grid.has(k)) grid.set(k,[]); grid.get(k).push(i);
      }
    return {a:e[0],b:e[1],flags:e[2],weight:e[3],len:len};
  });
  function project(p,a,b) {
    const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy;
    const t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d)):0;
    const q=[a[0]+dx*t,a[1]+dy*t]; return {t:t,p:q,d:hypot(q[0]-p[0],q[1]-p[1])};
  }
  function candidates(p) {
    const x=Math.floor(p[0]/CELL),y=Math.floor(p[1]/CELL),seen=new Set(),out=[];
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++)
      (grid.get((x+dx)+','+(y+dy))||[]).forEach(function(i){
        if(seen.has(i)) return; seen.add(i);
        const e=edges[i],q=project(p,xy[e.a],xy[e.b]);
        if(q.d<=70) {q.edge=e;q.id=i;out.push(q);}
      });
    return out.sort(function(a,b){return a.d-b.d;}).slice(0,5);
  }
  function heapPush(h,item) {h.push(item);let i=h.length-1;while(i){const p=(i-1)>>1;if(h[p][0]<=item[0])break;h[i]=h[p];i=p;}h[i]=item;}
  function heapPop(h) {const first=h[0],v=h.pop();if(h.length){let i=0;while(i*2+1<h.length){let c=i*2+1;if(c+1<h.length&&h[c+1][0]<h[c][0])c++;if(h[c][0]>=v[0])break;h[i]=h[c];i=c;}h[i]=v;}return first;}
  function makePath(points) {
    const cumulative=[0];for(let i=1;i<points.length;i++) cumulative.push(cumulative[i-1]+hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
    return {points:points,cumulative:cumulative,length:cumulative[cumulative.length-1]};
  }
  function route(a,b) {
    const A=[a.lo*X,a.la*Y],B=[b.lo*X,b.la*Y];
    const starts=candidates(A), ends=candidates(B);
    if(!starts.length||!ends.length) return null;
    const goals=new Map(), costs=new Map(), prev=new Map(), roots=new Map(), heap=[];
    let best=Infinity,result=null;
    function goal(n,c,q) {if(!goals.has(n)||goals.get(n).cost>c)goals.set(n,{cost:c,q:q});}
    ends.forEach(function(q){const e=q.edge;if(e.flags&1)goal(e.a,q.t*e.len*e.weight+q.d*4,q);if(e.flags&2)goal(e.b,(1-q.t)*e.len*e.weight+q.d*4,q);});
    function offer(n,c,parent,root) {
      if(c>=(costs.has(n)?costs.get(n):Infinity))return;
      costs.set(n,c);prev.set(n,parent);roots.set(n,root);
      heapPush(heap,[c+hypot(xy[n][0]-B[0],xy[n][1]-B[1]),n,c]);
    }
    starts.forEach(function(q){
      const e=q.edge;
      ends.forEach(function(r){if(q.id!==r.id)return;const d=r.t-q.t;if((d>=0&&(e.flags&1))||(d<=0&&(e.flags&2))){const cost=Math.abs(d)*e.len*e.weight+(q.d+r.d)*4;if(cost<best){best=cost;result={points:[q.p,r.p]};}}});
      if(e.flags&1)offer(e.b,(1-q.t)*e.len*e.weight+q.d*4,null,q);
      if(e.flags&2)offer(e.a,q.t*e.len*e.weight+q.d*4,null,q);
    });
    let visits=0;
    while(heap.length&&visits++<18000) {
      const entry=heapPop(heap),n=entry[1],c=entry[2];
      if(entry[0]>=best)break;if(c!==costs.get(n))continue;
      const g=goals.get(n);
      if(g&&c+g.cost<best){
        best=c+g.cost;
        const points=[g.q.p];for(let v=n;v!=null;v=prev.get(v))points.push(xy[v]);
        points.push(roots.get(n).p);points.reverse();result={points:points};
      }
      adj[n].forEach(function(e){offer(e[0],c+e[1],n,roots.get(n));});
    }
    if(!result)return null;
    const path=makePath(result.points);
    // Reject implausible detours rather than moving to a remote parallel street.
    return path.length<=Math.max(800,hypot(B[0]-A[0],B[1]-A[1])*5) ? path : null;
  }
  function path(a,b) {
    const key=[a.la.toFixed(6),a.lo.toFixed(6),b.la.toFixed(6),b.lo.toFixed(6)].join(',');
    if(cache.has(key))return cache.get(key);
    const result=route(a,b);cache.set(key,result);if(cache.size>768)cache.delete(cache.keys().next().value);return result;
  }
  function point(path,f) {
    const d=Math.max(0,Math.min(1,f))*path.length;
    for(let i=1;i<path.points.length;i++)if(d<=path.cumulative[i]){
      const a=path.points[i-1],b=path.points[i],len=path.cumulative[i]-path.cumulative[i-1];
      const t=len?(d-path.cumulative[i-1])/len:0;
      return {la:(a[1]+(b[1]-a[1])*t)/Y,lo:(a[0]+(b[0]-a[0])*t)/X};
    }
    const p=path.points[path.points.length-1];return {la:p[1]/Y,lo:p[0]/X};
  }
  T.roads={path:path,point:point,route:route,coordinates:function(p){return p.points.map(function(q){return [q[1]/Y,q[0]/X];});}};
})(globalThis.T=globalThis.T||{});
