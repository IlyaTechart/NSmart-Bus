// Generate a compact local graph from the same OpenFreeMap / OpenMapTiles data as the basemap.
// Build-time only: node tools/build-roads.cjs (Node 18+, npm ci).
const fs=require('fs'), path=require('path'), {VectorTile}=require('@mapbox/vector-tile'), Pbf=require('pbf');
const {execFileSync}=require('child_process'), os=require('os');
const bbox=[45.17,19.70,45.34,19.96], z=13, scale=2**z;
const tileX=lon=>Math.floor((lon+180)/360*scale);
const tileY=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*scale);
const cache=path.join(os.tmpdir(),'trecker-road-tiles');fs.mkdirSync(cache,{recursive:true});
function get(url,file){if(!fs.existsSync(file))execFileSync('curl',['-fLsS','--max-time','30','--retry','2','-o',file,url]);return fs.readFileSync(file);}
const meta=JSON.parse(get('https://tiles.openfreemap.org/planet',path.join(cache,'planet.json')));
const nodes=[], edges=[], ids=new Map(), seen=new Set();let tiles=0;
// MVT grid coordinates are shared across tile borders. Connect shared vertices,
// not arbitrary line crossings (a bridge must not gain an edge to the road below).
function node(p){const key=p.map(n=>n.toFixed(6)).join(',');if(!ids.has(key)){ids.set(key,nodes.length);nodes.push(p.map(n=>+n.toFixed(6)));}return ids.get(key);}
for(let x=tileX(bbox[1]);x<=tileX(bbox[3]);x++)for(let y=tileY(bbox[2]);y<=tileY(bbox[0]);y++){
  const url=meta.tiles[0].replace('{z}',z).replace('{x}',x).replace('{y}',y);
  const tile=new VectorTile(new Pbf(get(url,path.join(cache,`${z}-${x}-${y}.pbf`))));
  const layer=tile.layers.transportation;if(!layer)continue;
  for(let i=0;i<layer.length;i++){
    const f=layer.feature(i), p=f.properties;
    if(!['motorway','trunk','primary','secondary','tertiary','minor','service','busway'].includes(p.class))continue;
    if(p.access==='no'||p.access==='private'||['parking_aisle','driveway'].includes(p.service))continue;
    const g=f.toGeoJSON(x,y,z).geometry;
    if(!['LineString','MultiLineString'].includes(g.type))continue;
    const parts=g.type==='LineString'?[g.coordinates]:g.coordinates;
    const flags=p.oneway===1?1:p.oneway===-1?2:3;
    const weight=p.class==='service'?1.8:p.class==='minor'?1.15:1;
    for(const part of parts)for(let j=1;j<part.length;j++){
      const a=node([part[j-1][1],part[j-1][0]]),b=node([part[j][1],part[j][0]]);
      const key=a+':'+b+':'+flags;
      if(a===b||seen.has(key))continue;seen.add(key);edges.push([a,b,flags,weight]);
    }
  }
  tiles++;process.stdout.write('.');
}
if(nodes.length<1000)throw Error('Incomplete graph');
const data={version:1,source:'OpenFreeMap / OpenMapTiles / OpenStreetMap contributors',license:'ODbL-1.0',tileSource:meta.tiles[0],bounds:bbox,zoom:z,nodes,edges};
fs.writeFileSync(path.join(__dirname,'../www/data/roads.js'),'/* OSM-derived road network; see data/ROADS.md. */\nT.ROAD_DATA='+JSON.stringify(data)+';\n');
console.log(`\n${tiles} tiles; ${nodes.length} nodes; ${edges.length} edges`);
