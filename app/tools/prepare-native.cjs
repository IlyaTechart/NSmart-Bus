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


const web = path.join(output, 'www');
// Rebuild the generated web tree so removed scripts cannot leak into the APK.
fs.rmSync(web, { recursive: true, force: true });
fs.rmSync(path.join(output, 'map-style.json'), { force: true });
for (const entry of ['css', 'lib', 'data/map-style.json', 'js/net.js', 'js/i18n.js', 'js/ui.js']) {
  const target = path.join(web, entry);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(app, 'www', entry), target, { recursive: true });
}
fs.copyFileSync(path.join(app, 'native/web-model.js'), path.join(web, 'js/web-model.js'));
const html = fs.readFileSync(path.join(app, 'www/index.html'), 'utf8');
fs.writeFileSync(path.join(web, 'index.html'), html
  .replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="frame-src &apos;none&apos;; object-src &apos;none&apos;; script-src &apos;self&apos; blob:; worker-src blob: &apos;self&apos;">')
  .replace(/^<script src="(?:js\/(?:nsmart|roads|gspns)|data\/(?:seed|roads))\.js"><\/script>\s*/gm, '')
  .replace('src="js/model.js"', 'src="js/web-model.js"'));
