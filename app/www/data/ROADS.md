# Local road network

`roads.js` contains an OpenStreetMap-derived road graph extracted from the same OpenFreeMap / OpenMapTiles vector source as the displayed map. Its `tileSource` field identifies the snapshot; `bounds` identifies coverage around Novi Sad, Veternik, Futog, Petrovaradin and Sremska Kamenica. No routing server is queried during vehicle updates.

Data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), made available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Vector tiles provided by [OpenFreeMap](https://openfreemap.org/) using the [OpenMapTiles](https://openmaptiles.org/) schema. The bundled derived graph is distributed under ODbL 1.0.

Rebuild with Node.js 18+, curl, and the development dependencies installed:

```sh
cd app
npm ci
node tools/build-roads.cjs
node tools/test-roads.cjs
```

The builder reads the current OpenFreeMap TileJSON and caches source tiles in the operating system's temporary directory (`trecker-road-tiles`). Remove that cache before regenerating from a newer source snapshot.

Routing preserves bends, uses mapped one-way directions and excludes inaccessible roads and parking aisles. Intermediate stops constrain the route; this is not an official bus-route shape. Bus-only exceptions and turn-restriction relations are not present in these vector tiles. Coverage and map completeness are finite: if a reliable connecting path cannot be found, the model retains its previous approximate interpolation and the vehicle popup labels the trajectory as unaligned. Road alignment improves display geometry, not the freshness or accuracy of NSmart GPS/ETA data.
