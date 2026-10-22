/* Real HTTP + real Service Worker cache. CDN responses are public fixtures; when offline,
   every attempted network request is aborted, so a route fulfil cannot fake a cold boot. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {data}=require('./browser-harness.cjs');
const root=__dirname, source=path.resolve(root,'..');
let networkEnabled=true, blockRequiredFont=true, server, browser;
const offlineAttempts=[];
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lmgAAAAASUVORK5CYII=','base64');
function contentType(file){return file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html'}
function workerMessage(page,type){return page.evaluate(type=>new Promise(async(resolve,reject)=>{const registration=await navigator.serviceWorker.ready;const worker=navigator.serviceWorker.controller||registration.active;const channel=new MessageChannel();const timeout=setTimeout(()=>reject(new Error('Worker message timeout')),30000);channel.port1.onmessage=event=>{clearTimeout(timeout);resolve(event.data)};worker.postMessage({type},[channel.port2]);}),type)}
(async()=>{
 try{
  server=http.createServer((request,response)=>{const pathname=new URL(request.url,'http://localhost').pathname;const name=pathname==='/'?'index.html':pathname.slice(1);if(!['index.html','sw.js','manifest.json','privacy.html','delete-account.html'].includes(name)){response.writeHead(404);return response.end('missing')}response.writeHead(200,{'Content-Type':contentType(name),'Cache-Control':'public, max-age=0'});response.end(fs.readFileSync(path.join(source,name)))});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:390,height:844}});const pageErrors=[];
  await context.addInitScript(seed=>{globalThis.__dzMock={data:new Map(navigator.onLine?seed:[]),listeners:new Set(),writes:[],id:0,user:null};},data);
  let mock=fs.readFileSync(path.join(root,'firebase-mock.mjs'),'utf8');
  mock=mock.replace('queueMicrotask(()=>{if(state.listeners.has(entry))cb(snapshot(q))});',"queueMicrotask(()=>{if(!state.listeners.has(entry))return;if(!navigator.onLine){const error=new Error('offline');error.code='unavailable';const failed=callbacks.filter(x=>typeof x==='function')[1];failed?.(error);return;}cb(snapshot(q))});");
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(!networkEnabled){offlineAttempts.push(url.href);return route.abort('internetdisconnected')}
   if(url.origin===origin)return route.continue();
   const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, OPTIONS','Cache-Control':'public, max-age=3600'};
   let file,body,type='text/javascript';
   if(url.hostname==='www.gstatic.com'&&url.pathname.includes('/firebasejs/10.12.2/')){
    if(url.pathname.endsWith('firebase-analytics.js'))return route.fulfill({body:'export const privateFixture=true;',contentType:type,headers:{...headers,'Cache-Control':'private, no-store'}});
    body=url.pathname.endsWith('firebase-offline-fixture.js')?'export const offlineDependency=true;':mock;
    if(url.pathname.endsWith('firebase-app.js'))body+="\nimport './firebase-offline-fixture.js';";
   }else if(url.hostname==='cdn.tailwindcss.com')body=`globalThis.tailwind={};const style=document.createElement('style');style.textContent=${JSON.stringify(fs.readFileSync(path.join(root,'artifacts/tailwind.css'),'utf8'))};document.head.append(style);`;
   else if(url.hostname==='unpkg.com'){
    const pairs={'/leaflet@1.9.4/dist/leaflet.js':'leaflet/dist/leaflet.js','/leaflet@1.9.4/dist/leaflet.css':'leaflet/dist/leaflet.css','/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js':'leaflet.markercluster/dist/leaflet.markercluster.js','/leaflet.markercluster@1.4.1/dist/MarkerCluster.css':'leaflet.markercluster/dist/MarkerCluster.css','/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css':'leaflet.markercluster/dist/MarkerCluster.Default.css'};
    if(pairs[url.pathname])file=path.join(root,'node_modules',pairs[url.pathname]);
   }else if(url.hostname==='cdnjs.cloudflare.com'&&url.pathname.includes('/font-awesome/6.4.0/')){
    if(blockRequiredFont&&url.pathname.endsWith('/fa-brands-400.woff2'))return route.abort('failed');
    file=path.join(root,'node_modules/@fortawesome/fontawesome-free',url.pathname.split('/font-awesome/6.4.0/')[1]);
   }else if(url.hostname==='firestore.googleapis.com')return route.fulfill({body:'{"secret":"private-fixture"}',contentType:'application/json',headers:{...headers,'Cache-Control':'private, no-store'}});
   if(file&&fs.existsSync(file)){type=file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':file.endsWith('.ttf')?'font/ttf':'text/javascript';body=fs.readFileSync(file)}
   if(body!==undefined)return route.fulfill({body,contentType:type,headers});
   if(request.resourceType()==='image')return route.fulfill({body:pixel,contentType:'image/png',headers});
   return route.abort();
  });
  let page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));await page.goto(origin,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>typeof window.openCommunity==='function'&&window.DropZoneOffline,null,{timeout:10000});
  await page.evaluate(()=>navigator.serviceWorker.register('./sw.js',{scope:'./'}));await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const incomplete=await workerMessage(page,'PREPARE_OFFLINE');assert.equal(incomplete.ready,false);assert.equal(incomplete.shellReady,true);assert.ok(incomplete.missing.some(url=>url.includes('fa-brands-400.woff2')));console.log('PASS offline readiness stays false when a required public dependency is missing');
  blockRequiredFont=false;const prepared=await workerMessage(page,'PREPARE_OFFLINE');assert.equal(prepared.ready,true,JSON.stringify(prepared));assert.deepEqual(prepared.missing,[]);
  await page.evaluate(async()=>{await fetch('https://firestore.googleapis.com/v1/projects/demo-dropzone/databases/(default)/documents/users/private',{headers:{Authorization:'Bearer fixture-only'}});await fetch('https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js')});
  const cached=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys()){const cache=await caches.open(name);for(const request of await cache.keys())result.push(request.url)}return result});assert.ok(cached.some(url=>url.endsWith('/index.html')));assert.ok(cached.some(url=>url.includes('firebase-firestore.js')));assert.ok(cached.some(url=>url.includes('firebase-offline-fixture.js')));assert.ok(!cached.some(url=>url.includes('firestore.googleapis.com')||url.includes('firebase-analytics.js')||url.includes('mt1.google.com')||url.includes('users/private')));console.log('PASS worker caches only approved public resources and never private data or map tiles');
  await page.evaluate(()=>window.DropZoneOffline.open());await page.locator('#offline-pack-name').fill('Çevrimdışı İzmir');await page.locator('#offline-pack-form button[type=submit]').click();await page.waitForTimeout(200);
  const savedPack=await page.evaluate(()=>window.DropZoneOffline.getActivePack());assert.ok(savedPack?.spots?.length>0);await page.close();
  networkEnabled=false;await context.setOffline(true);page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));await page.goto(origin,{waitUntil:'domcontentloaded',timeout:15000});await page.waitForFunction(()=>window.DropZoneOffline&&typeof window.openCommunity==='function',null,{timeout:10000});
  assert.equal(await page.evaluate(()=>navigator.onLine),false);await page.evaluate(()=>window.DropZoneOffline.open());await page.waitForTimeout(250);const restored=await page.evaluate(()=>window.DropZoneOffline.getActivePack());assert.ok(restored?.spots?.length>0);assert.ok((await page.locator('#offline-pack-list').innerText()).includes('Çevrimdışı İzmir'));assert.equal(await page.evaluate(()=>__dzMock.data.size),0);assert.equal(await page.evaluate(()=>__dzMock.writes.length),0);assert.deepEqual(pageErrors,[]);console.log('PASS cold browser page starts with network disabled using actual SW assets and saved spot package');
  assert.ok(offlineAttempts.every(url=>!url.includes('fixture-fallback-success')));
  const cleared=await workerMessage(page,'CLEAR_OFFLINE_CACHE');assert.equal(cleared.ready,false);assert.equal(cleared.shellReady,false);const packageAfter=await page.evaluate(()=>window.DropZoneOffline.getActivePack());assert.ok(packageAfter?.spots?.length>0);console.log('PASS clearing public asset cache preserves the user-selected local spot package');
  const unavailable=await page.reload({waitUntil:'domcontentloaded',timeout:15000});assert.equal(unavailable.status(),503);assert.equal(await page.evaluate(()=>typeof window.openCommunity),'undefined');console.log('PASS removing the prepared shell prevents offline boot, proving network mocks cannot fake readiness');
 }catch(error){console.error('FAIL actual Service Worker offline test',error.stack);process.exitCode=1}
 finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve))}
})();
