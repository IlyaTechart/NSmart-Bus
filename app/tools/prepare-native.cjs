const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = path.join(__dirname, '..');
const output = path.join(app, 'native/app/src/main/assets');
fs.mkdirSync(output, { recursive: true });
const context = { T: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(app, 'www/data/seed.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(app, 'www/data/roads.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(app, 'www/js/gspns.js'), 'utf8'), context);
fs.writeFileSync(path.join(output, 'stations.json'), JSON.stringify(context.T.SEED.stations || {}));
const routes = Object.fromEntries(Object.entries(context.T.SEED.routes || {}).map(([key, route]) => [key, {
  ...route,
  actual: route.actual || '',
  base: route.base || context.T.gspns.base(route.line),
  s: route.s.map(stop => ({ id: stop[0], la: stop[1], lo: stop[2], tt: stop[3] || 0, slr: stop[4] || 0 })),
}]));
fs.writeFileSync(path.join(output, 'routes.json'), JSON.stringify(routes));
fs.writeFileSync(path.join(output, 'roads.json'), JSON.stringify(context.T.ROAD_DATA || null));
fs.copyFileSync(path.join(app, 'www/data/map-style.json'), path.join(output, 'map-style.json'));
