const assert = require('node:assert/strict');
const path = require('node:path');
const {openApp, data} = require('./browser-harness.cjs');
const settle = page => page.waitForTimeout(220);
const advance = page => page.evaluate(() => { globalThis.__dzAdvance += 6000; });
const seed = data.map(([key,value]) => [key, key==='spots/spotOne' ? {...value,features:{difficulty:'beginner',dropHeight:0.8,landing:'wide',surface:'concrete'}} : key==='spots/spotTwo' ? {...value,features:{difficulty:'advanced',dropHeight:3,landing:'narrow',surface:'dirt'}} : value]);
seed.push(['spots/spotThree',{...data.find(([p])=>p==='spots/spotOne')[1],name:'Eski Kayıt',coords:{lat:38.45,lng:27.18},locationText:'İzmir',createdAt:Date.now()-3000}]);
const switchUser=(page,uid)=>page.evaluate(uid=>{const s=__dzMock;s.user=uid?{uid,displayName:uid==='bob'?'Bob Rider':'Alice Rider',email:uid+'@example.test',photoURL:null}:null;for(const fn of s.authCallbacks||[])fn(s.user)},uid);
async function scenario(name, run, options={}) {
 if(process.env.DZ_TEST_MATCH&&!name.includes(process.env.DZ_TEST_MATCH))return;
 const {browser,page,errors}=await openApp({seed,...options});
 try {await page.waitForFunction(()=>window.DropZoneRideTools&&window.DropZoneOffline,null,{timeout:10000});await run(page);assert.deepEqual(errors,[]);console.log('PASS',name)}
 catch(error){console.error('FAIL',name,error.stack);if(errors.length)console.error('PAGE ERRORS',errors);process.exitCode=1}
 finally{await browser.close()}
}
async function openRoutes(page){await page.evaluate(()=>window.DropZoneRideTools.open('routes'));await page.locator('#ride-tools-modal').waitFor()}
async function addStop(page,id){await page.locator('#ride-route-spot').selectOption(id);await page.locator('#ride-route-add').click();await settle(page)}
async function openCommunity(page){await page.evaluate(()=>window.openCommunity());await page.locator('#community-feed article').first().waitFor()}
const spotKeys=page=>page.evaluate(()=>[...__dzMock.data.keys()].filter(p=>p.startsWith('spots/')&&p.split('/').length===2));
(async()=>{
 await scenario('physical filters distinguish known features and legacy unknown data without hiding all spots',async page=>{
  await page.evaluate(()=>window.toggleSidebar());await page.locator('#sidebar .dz-advanced summary').click();
  await page.locator('#dz-filter-difficulty').selectOption('beginner');await settle(page);assert.equal(await page.locator('#spot-count').innerText(),'1');assert.ok((await page.locator('#spot-list').innerText()).includes('İzmir Bowl'));
  await page.locator('#dz-filter-difficulty').selectOption('advanced');await settle(page);assert.equal(await page.locator('#spot-count').innerText(),'1');assert.ok((await page.locator('#spot-list').innerText()).includes('İstanbul Park'));
  await page.locator('#dz-filter-difficulty').selectOption('unknown');await settle(page);assert.equal(await page.locator('#spot-count').innerText(),'1');assert.ok((await page.locator('#spot-list').innerText()).includes('Eski Kayıt'));
  await page.locator('#dz-filter-reset').click();await page.locator('#dz-filter-drop-max').fill('2');await page.locator('#dz-filter-drop-max').dispatchEvent('input');await settle(page);assert.equal(await page.locator('#spot-count').innerText(),'1');
  await page.locator('#dz-filter-reset').click();assert.equal(await page.locator('#spot-count').innerText(),'3');
 });
 await scenario('nearby duplicate warning cancels before any spot write; explicit continue preserves physical metadata',async page=>{
  await page.evaluate(()=>window.openManualAddSpotModal());await page.locator('#spot-name').fill('Aynı koordinatta yeni ad');await page.locator('#spot-lat').fill('38.42001');await page.locator('#spot-lng').fill('27.14001');
  await page.locator('#add-spot-form details summary').click();await page.locator('#dz-spot-difficulty').selectOption('intermediate');await page.locator('#dz-spot-dropHeight').fill('1.5');await page.locator('#dz-spot-landing').selectOption('wide');await page.locator('#dz-spot-surface').selectOption('concrete');
  const before=await spotKeys(page);await page.locator('#add-spot-form button[type=submit]').click();await page.locator('#dz-duplicate-modal').waitFor();assert.deepEqual(await spotKeys(page),before);assert.ok((await page.locator('#dz-duplicate-modal').innerText()).includes('İzmir Bowl'));
  await page.locator('#dz-duplicate-cancel').click();assert.deepEqual(await spotKeys(page),before);assert.equal(await page.locator('#spot-name').inputValue(),'Aynı koordinatta yeni ad');
  await advance(page);await page.locator('#add-spot-form button[type=submit]').click();await page.locator('#dz-duplicate-continue').click();await settle(page);
  const added=await page.evaluate(()=>[...__dzMock.data.entries()].find(([p,v])=>p.startsWith('spots/')&&v.name==='Aynı koordinatta yeni ad'));
  assert.ok(added);assert.deepEqual(added[1].features,{difficulty:'intermediate',dropHeight:1.5,landing:'wide',surface:'concrete'});
 });
 await scenario('three-stop routes reorder, save per account, and label distance as straight-line estimate',async page=>{
  await openRoutes(page);await addStop(page,'spotOne');await addStop(page,'spotTwo');await addStop(page,'spotThree');
  assert.ok((await page.locator('#ride-route-count').innerText()).startsWith('3'));
  assert.ok((await page.locator('#ride-route-panel').innerText()).includes('kuş uçuşu'));
  assert.ok((await page.locator('#ride-route-summary').innerText()).match(/km/));
  const navigation=await page.locator('#ride-route-navigate').getAttribute('href');const url=new URL(navigation);assert.equal(url.hostname,'www.google.com');assert.ok(url.searchParams.get('waypoints'));assert.equal(url.searchParams.get('travelmode'),'bicycling');
  await page.locator('#ride-route-stops [data-ride-action="down"][data-id="spotOne"]').click();
  const text=await page.locator('#ride-route-stops').innerText();assert.ok(text.indexOf('İstanbul Park')<text.indexOf('İzmir Bowl'));
  await page.locator('#ride-route-name').fill('İzmir deneme rotası');await page.locator('#ride-route-save').click();await settle(page);assert.ok((await page.locator('#ride-route-saved').innerText()).includes('İzmir deneme rotası'));
  await switchUser(page,'bob');await settle(page);assert.ok(!(await page.locator('#ride-route-saved').innerText()).includes('İzmir deneme rotası'));
  await switchUser(page,'alice');await settle(page);assert.ok((await page.locator('#ride-route-saved').innerText()).includes('İzmir deneme rotası'));
  await page.locator('#ride-route-saved [data-ride-action="delete-route"]').click();await settle(page);assert.ok(!(await page.locator('#ride-route-saved').innerText()).includes('İzmir deneme rotası'));
 });
 await scenario('journal stays private, supports edits, and only creates a community draft after explicit sharing',async page=>{
  await page.evaluate(()=>window.DropZoneRideTools.open('journal'));await page.locator('#ride-journal-spot').selectOption('spotOne');await page.locator('#ride-journal-date').fill(new Date().toISOString().slice(0,10));await page.locator('#ride-journal-tricks').fill('manual');await page.locator('#ride-journal-notes').fill('<img src=x onerror=globalThis.journalXss=true> Özel not');
  const writes=await page.evaluate(()=>__dzMock.writes.length);await page.locator('#ride-journal-save').click();await settle(page);assert.equal(await page.evaluate(()=>__dzMock.writes.length),writes);assert.equal(await page.locator('#ride-journal-list img').count(),0);assert.equal(await page.evaluate(()=>globalThis.journalXss),undefined);assert.equal(await page.locator('#ride-journal-list [data-ride-action="share-entry"]').count(),0);
  await page.locator('#ride-journal-list [data-ride-action="edit-entry"]').click();await page.locator('.dzt-share-options').evaluate(element=>{element.open=true});await page.locator('#ride-journal-visibility').selectOption('shareable');await page.locator('#ride-journal-notes').fill('Bugün manual daha iyiydi.');await page.locator('#ride-journal-save').click();await settle(page);
  await page.locator('#ride-journal-list [data-ride-action="share-entry"]').click();await settle(page);assert.equal(await page.locator('#community-modal').isVisible(),true);assert.ok((await page.locator('#community-text').inputValue()).includes('Bugün manual daha iyiydi.'));assert.equal(await page.locator('#community-spot').inputValue(),'spotOne');assert.equal(await page.evaluate(()=>__dzMock.writes.length),writes);
  await page.evaluate(()=>window.closeCommunity());await page.evaluate(()=>window.DropZoneRideTools.open('journal'));await page.locator('#ride-journal-list [data-ride-action="delete-entry"]').click();await settle(page);assert.ok((await page.locator('#ride-journal-count').innerText()).startsWith('0'));
 });
 await scenario('loaded-feed search normalizes Turkish text and hashtag clicks filter without executing content',async page=>{
  await openCommunity(page);await page.evaluate(async()=>{const m=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');await m.setDoc(m.doc(m.getFirestore(),'communityPosts','taggedPost'),{authorId:'bob',authorName:'Bob Rider',text:'İZMİR için #BMX ve #sürüş <img src=x onerror=globalThis.tagXss=true>',spotId:'spotOne',createdAt:m.serverTimestamp(),deleted:false,likeCount:0,commentCount:0,lastEvent:{type:'post',id:'taggedPost',actorId:'bob'}})});await settle(page);
  await page.locator('#community-search').fill('izmir');await page.waitForTimeout(350);assert.ok((await page.locator('#community-feed').innerText()).includes('#BMX'));assert.ok((await page.locator('#community-search-scope').innerText()).match(/yüklenen/i));
  await page.locator('#community-search-clear').click();await page.locator('[data-post-id="taggedPost"] .dz-hashtag').filter({hasText:'#BMX'}).click();await settle(page);assert.equal((await page.locator('#community-search').inputValue()).toLocaleLowerCase('tr-TR'),'#bmx');assert.equal(await page.locator('#community-feed .dz-post-text img').count(),0);assert.equal(await page.evaluate(()=>globalThis.tagXss),undefined);
  await page.locator('#community-search').fill('olmayanbirkelime');await page.waitForTimeout(350);assert.equal(await page.locator('#community-feed article').count(),0);
 });
 await scenario('timed poll creates valid options and atomic vote; repeated and expired votes do not write',async page=>{
  await openCommunity(page);await page.locator('#community-poll-toggle').click();await page.locator('#community-poll-question').fill('Hangi spot?');await page.locator('.dz-poll-option-input').nth(0).fill('İzmir');await page.locator('.dz-poll-option-input').nth(1).fill('İstanbul');await page.locator('#community-poll-add-option').click();await page.locator('.dz-poll-option-input').nth(2).fill('Ankara');await page.locator('#community-poll-duration').selectOption('1');await page.locator('#community-text').fill('Sürüş planını oylayalım');await page.locator('#community-publish').click();await settle(page);
  const created=await page.evaluate(()=>[...__dzMock.data.entries()].find(([p,v])=>p.startsWith('communityPosts/')&&p.split('/').length===2&&v.poll?.question==='Hangi spot?'));assert.ok(created);assert.deepEqual(created[1].poll.counts,[0,0,0]);assert.equal(created[1].poll.totalVotes,0);
  const article=page.locator(`[data-post-id="${created[0].split('/')[1]}"]`);await advance(page);await article.locator('.dz-poll-choice').nth(1).click();await settle(page);
  const result=await page.evaluate(p=>({post:__dzMock.data.get(p),vote:__dzMock.data.get(p+'/votes/alice'),tx:__dzMock.transactions.at(-1)}),created[0]);assert.equal(result.vote.option,1);assert.equal(result.post.poll.totalVotes,1);assert.deepEqual(result.post.poll.counts,[0,1,0]);assert.ok(result.tx.writes.some(([,ref])=>ref.path===created[0]));assert.ok(result.tx.writes.some(([,ref])=>ref.path===created[0]+'/votes/alice'));
  const before=await page.evaluate(()=>__dzMock.writes.length);await advance(page);await article.locator('.dz-poll-choice').nth(0).dispatchEvent('click');await settle(page);assert.equal(await page.evaluate(()=>__dzMock.writes.length),before);
  await switchUser(page,'bob');await settle(page);await page.evaluate(()=>{globalThis.__dzAdvance+=3700000});const oldWrites=await page.evaluate(()=>__dzMock.writes.length);await article.locator('.dz-poll-choice').nth(0).click({force:true});await settle(page);assert.equal(await page.evaluate(()=>__dzMock.writes.length),oldWrites);
  await switchUser(page,'alice');await settle(page);await article.locator('[aria-label="Paylaşımı sil"]').click();await page.getByRole('button',{name:'Onayla',exact:true}).click();await settle(page);
  const removed=await page.evaluate(p=>__dzMock.data.get(p),created[0]);assert.equal(removed.deleted,true);assert.equal(removed.text,'');assert.equal(Object.hasOwn(removed,'poll'),false,'public tombstone must not retain poll question/options');
 });
 await scenario('spot package saves bounded public data and can be deleted without touching private account data',async page=>{
  await page.evaluate(()=>window.DropZoneOffline.open());await page.locator('#offline-pack-name').fill('İzmir yedek');
  await page.locator('#offline-pack-form button[type=submit]').click();await settle(page);assert.ok((await page.locator('#offline-pack-list').innerText()).includes('İzmir yedek'));
  const pack=await page.evaluate(()=>window.DropZoneOffline.getActivePack());assert.ok(pack);assert.ok(pack.spots.length<=500);assert.equal(JSON.stringify(pack).includes('notifications'),false);assert.equal(JSON.stringify(pack).includes('favorites'),false);
  const remove=page.locator('#offline-pack-list [data-offline-action="delete"]');await remove.first().click();await settle(page);assert.ok(!(await page.locator('#offline-pack-list').innerText()).includes('İzmir yedek'));
  assert.equal(await page.evaluate(()=>__dzMock.data.get('users/alice').notifications.length),0);
 });

 await scenario('new feature dialogs stay usable on narrow mobile layouts',async page=>{
  const noOverflow=async selector=>assert.equal(await page.locator(selector).evaluate(el=>el.scrollWidth>el.clientWidth),false,selector+' overflow');
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});await openRoutes(page);await addStop(page,'spotOne');await addStop(page,'spotTwo');await noOverflow('#ride-tools-modal .dzt-card');
   await page.evaluate(()=>window.DropZoneRideTools.close());await page.evaluate(()=>window.DropZoneRideTools.open('journal'));await noOverflow('#ride-tools-modal .dzt-card');
   await page.evaluate(()=>window.DropZoneRideTools.close());await page.evaluate(()=>window.DropZoneOffline.open());await noOverflow('#offline-modal .dzo-card');
   await page.evaluate(()=>window.DropZoneOffline.close());await openCommunity(page);
   if(!await page.locator('#community-poll-builder').isVisible())await page.locator('#community-poll-toggle').click();
   await noOverflow('#community-scroll');await noOverflow('#community-compose');
   if(width===390)await page.screenshot({path:path.join(__dirname,'artifacts','new-features-mobile.png')});
   await page.evaluate(()=>window.closeCommunity());
  }
 },{mobile:true});


 await scenario('account switch cancels a pending private journal share without copying Alice content into Bob draft',async page=>{
  await openCommunity(page);await page.locator('#community-text').fill('Alice mevcut paylaşım taslağı');await page.waitForTimeout(300);
  await page.evaluate(()=>window.DropZoneRideTools.open('journal'));await page.locator('#ride-journal-spot').selectOption('spotOne');await page.locator('#ride-journal-date').fill(new Date().toISOString().slice(0,10));await page.locator('#ride-journal-notes').fill('ALICE GÜNLÜĞÜ ÖZEL İÇERİK');await page.locator('.dzt-share-options').evaluate(element=>{element.open=true});await page.locator('#ride-journal-visibility').selectOption('shareable');await page.locator('#ride-journal-save').click();await settle(page);
  await page.locator('#ride-journal-list [data-ride-action="share-entry"]').click();await page.locator('#confirm-modal').waitFor();
  await switchUser(page,'bob');await settle(page);assert.equal(await page.locator('#confirm-modal').isVisible(),false);
  await page.evaluate(()=>window.executeConfirm());await settle(page);
  assert.equal(await page.locator('#community-text').inputValue(),'');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('dropzone:community:draft:v1:bob')),null);
  assert.equal(await page.evaluate(()=>[...__dzMock.data.entries()].filter(([p,v])=>p.startsWith('communityPosts/')&&p.split('/').length===2&&String(v.text).includes('ALICE GÜNLÜĞÜ')).length),0);
 });
 await scenario('returning from a cached package to an empty live collection removes every old cached row',async page=>{
  await page.evaluate(()=>window.DropZoneOffline.open());await page.locator('#offline-pack-name').fill('Geçici paket');await page.locator('#offline-pack-form button[type=submit]').click();await settle(page);
  const pack=await page.evaluate(()=>window.DropZoneOffline.getActivePack());assert.ok(pack.spots.length>0);
  await page.locator('#offline-pack-use').click();await settle(page);assert.equal(await page.locator('#dz-offline-banner').isVisible(),true);
  await page.evaluate(async()=>{const m=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');for(const key of [...__dzMock.data.keys()].filter(p=>p.startsWith('spots/')&&p.split('/').length===2))await m.deleteDoc(m.doc(m.getFirestore(),...key.split('/')))});await settle(page);
  assert.equal(await page.locator('#spot-count').innerText(),String(pack.spots.length));
  await page.locator('#dz-offline-banner button').click();await settle(page);
  assert.equal(await page.locator('#spot-count').innerText(),'0');assert.equal(await page.locator('#dz-offline-banner').isVisible(),false);assert.equal(await page.locator('#spot-list').innerText(),'');
 });

})();
