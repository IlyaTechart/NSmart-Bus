// Keep automated interaction tests from polling the real NSmart/GSP services.
const fs=require('fs'),path=require('path');
module.exports=async function offlineModel(page){
  await page.route('**/js/model.js',route=>route.fulfill({contentType:'application/javascript',body:
    fs.readFileSync(path.join(__dirname,'../www/js/model.js'),'utf8')+
    '\nT.model.init=async function(){this.stations=T.SEED.stations||{};this.snapshot=function(){return [];};};\n'}));
};
