const assert=require('node:assert/strict');
const {openApp,data}=require('./browser-harness.cjs');
const settle=page=>page.waitForTimeout(120);
const baseSpot=data.find(([key])=>key==='spots/spotOne')[1];
const basePost=data.find(([key])=>key==='communityPosts/seedPost')[1];
const now=Math.floor(Date.now()/1000);
const spots=Array.from({length:11},(_,index)=>[`spots/mapSpot${index+1}`,{...baseSpot,name:`Harita durağı ${index+1}`,coords:{lat:38.45+index*.012,lng:27.19+index*.014},createdAt:Date.now()-index*1000}]);
const seed=[...data,...spots];
const manySpotSeed=[...seed,...Array.from({length:130},(_,index)=>['spots/aBulk'+String(index).padStart(3,'0'),{...baseSpot,name:'Kalabalık spot '+index,coords:{lat:39+index*.001,lng:28+index*.001}}]),['spots/zzFinalSpot',{...baseSpot,name:'Uzak son spot',coords:{lat:39.99,lng:28.55}}]];
const ranked=Array.from({length:30},(_,index)=>[`communityPosts/rank${String(index).padStart(2,'0')}`,{...basePost,text:`Sıralama paylaşımı ${index}`,likeCount:index,createdAt:{seconds:now-index*60-120,nanoseconds:0}}]);
ranked.push(['communityPosts/deletedPopular',{...basePost,text:'',deleted:true,likeCount:999,createdAt:{seconds:now,nanoseconds:0}}]);
const switchUser=(page,uid)=>page.evaluate(uid=>{const state=__dzMock;state.user=uid?{uid,displayName:uid,email:uid+'@example.test',photoURL:null}:null;for(const callback of state.authCallbacks||[])callback(state.user)},uid);
async function scenario(name,run,options={}){
 if(process.env.DZ_TEST_MATCH&&!name.includes(process.env.DZ_TEST_MATCH))return;
 const {browser,page,errors}=await openApp({seed,...options});
 try{await page.waitForFunction(()=>window.DropZoneRideTools);await run(page);assert.deepEqual(errors,[]);console.log('PASS',name)}
 catch(error){console.error('FAIL',name,error.stack);if(errors.length)console.error('PAGE ERRORS',errors);process.exitCode=1}
 finally{await browser.close()}
}
const feedIds=page=>page.locator('#community-feed article').evaluateAll(nodes=>nodes.map(node=>node.dataset.postId));
async function openCommunity(page){await page.evaluate(()=>window.openCommunity());await page.locator('#community-feed article').first().waitFor()}
async function writePost(page,id,values){await page.evaluate(async({id,values})=>{const firebase=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');await firebase.updateDoc(firebase.doc(firebase.getFirestore(),'communityPosts',id),values)},{id,values});await settle(page)}
async function openRoutes(page){await page.evaluate(()=>window.DropZoneRideTools.open('routes'));await page.locator('#ride-tools-modal').waitFor()}
async function mapPick(page,id){
 await page.waitForFunction(()=>!document.querySelector('.leaflet-cluster-anim'));
 const coords=await page.evaluate(id=>__dzMock.data.get('spots/'+id).coords,id);
 await page.evaluate(coords=>window.flyToSpot(coords.lat,coords.lng),coords);
 const marker=page.locator('.leaflet-marker-icon[data-spot-id="'+id+'"]');await marker.waitFor();await page.waitForFunction(()=>!document.querySelector('.leaflet-cluster-anim'));await marker.click();await settle(page);
}
async function showShareOptions(page){await page.locator('.dzt-share-options').evaluate(element=>{element.open=true})}
(async()=>{
 await scenario('route preview returns to unchanged route and numbered stops follow reorder',async page=>{
  await page.emulateMedia({reducedMotion:'reduce'});await openRoutes(page);
  for(const id of ['mapSpot1','mapSpot2','mapSpot3']){await page.locator('#ride-route-spot').selectOption(id);await page.locator('#ride-route-add').click()}
  await page.locator('#ride-route-stops [data-ride-action="down"][data-id="mapSpot1"]').click();
  const before=await page.locator('#ride-route-stops').innerText();await page.locator('#ride-route-preview').click();await page.locator('#ride-map-toolbar').waitFor();
  assert.equal(await page.locator('#ride-tools-modal').isVisible(),false);assert.equal(await page.locator('#ride-map-undo').isVisible(),false);assert.deepEqual(await page.locator('.dzt-route-number').allTextContents(),['1','2','3']);
  const labels=await page.locator('.dzt-route-number-icon').evaluateAll(markers=>markers.map(marker=>marker.getAttribute('aria-label')||marker.getAttribute('title')||marker.textContent));assert.ok(labels[0].includes('2'),'first numbered marker must identify reordered spot2');
  await page.locator('#ride-map-return').click();await page.locator('#ride-tools-modal').waitFor();assert.equal(await page.locator('#ride-route-stops').innerText(),before);assert.equal(await page.locator('#ride-map-toolbar').isVisible(),false);
  await page.locator('#ride-route-preview').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#ride-tools-modal').isVisible(),true);assert.equal(await page.locator('#ride-route-stops').innerText(),before);
 });
 await scenario('map spot clicks draw numbered route, reject duplicates and enforce max10 with undo',async page=>{
  await page.emulateMedia({reducedMotion:'reduce'});await openRoutes(page);await page.locator('#ride-route-map-pick').click();await page.locator('#ride-map-toolbar').waitFor();
  await mapPick(page,'mapSpot1');await mapPick(page,'mapSpot2');await mapPick(page,'mapSpot3');
  assert.equal(await page.locator('#add-spot-modal').isVisible(),false);assert.equal(await page.locator('#spot-detail-modal').isVisible(),false);assert.deepEqual(await page.locator('.dzt-route-number').allTextContents(),['1','2','3']);
  await page.evaluate(()=>window.flyToSpot(38.45,27.19));await page.locator('.dzt-route-number-icon').first().click();assert.equal(await page.locator('#ride-map-stops li').count(),3);
  await page.locator('#ride-map-undo').click();assert.equal(await page.locator('#ride-map-stops li').count(),2);
  for(let index=3;index<=10;index++)await mapPick(page,'mapSpot'+index);
  assert.equal(await page.locator('#ride-map-stops li').count(),10);await mapPick(page,'mapSpot11');assert.equal(await page.locator('#ride-map-stops li').count(),10);assert.equal(await page.locator('#add-spot-modal').isVisible(),false);
  await page.locator('#ride-map-return').click();assert.equal(await page.locator('#ride-route-stops li').count(),10);assert.ok((await page.locator('#ride-route-count').innerText()).startsWith('10'));
 });
 await scenario('journal map chooser preserves draft fields, can cancel, and clears private draft when account changes',async page=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.DropZoneRideTools.open('journal'));
  await page.locator('#ride-journal-spot').selectOption('spotOne');const date=new Date().toISOString().slice(0,10);await page.locator('#ride-journal-date').fill(date);await page.locator('#ride-journal-tricks').fill('manual');await page.locator('#ride-journal-notes').fill('Alice kişisel taslak');await showShareOptions(page);await page.locator('#ride-journal-visibility').selectOption('shareable');
  const writes=await page.evaluate(()=>__dzMock.writes.length);await page.locator('#ride-journal-map-pick').click();await mapPick(page,'mapSpot5');await page.locator('#ride-tools-modal').waitFor();
  assert.equal(await page.locator('#ride-journal-spot').inputValue(),'mapSpot5');assert.equal(await page.locator('#ride-journal-date').inputValue(),date);assert.equal(await page.locator('#ride-journal-tricks').inputValue(),'manual');assert.equal(await page.locator('#ride-journal-notes').inputValue(),'Alice kişisel taslak');assert.equal(await page.locator('#ride-journal-visibility').inputValue(),'shareable');assert.equal(await page.evaluate(()=>__dzMock.writes.length),writes);
  await page.locator('#ride-journal-map-pick').click();await page.locator('#ride-map-return').click();assert.equal(await page.locator('#ride-journal-spot').inputValue(),'mapSpot5');assert.equal(await page.locator('#ride-journal-notes').inputValue(),'Alice kişisel taslak');
  await page.locator('#ride-journal-map-pick').click();await switchUser(page,'bob');await settle(page);assert.equal(await page.locator('#ride-map-toolbar').isVisible(),false);assert.equal(await page.locator('.dzt-route-number-icon').count(),0);
  await page.evaluate(()=>window.DropZoneRideTools.open('journal'));assert.equal(await page.locator('#ride-journal-notes').inputValue(),'');assert.equal(await page.locator('#ride-journal-tricks').inputValue(),'');
 });
 await scenario('map journal choice remains selectable beyond100 search results',async page=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.DropZoneRideTools.open('journal'));assert.ok(await page.locator('#ride-journal-spot option').count()<=102);await page.locator('#ride-journal-notes').fill('Çok spotlu günlük taslağı');await page.locator('#ride-journal-map-pick').click();await mapPick(page,'zzFinalSpot');await page.locator('#ride-tools-modal').waitFor();assert.equal(await page.locator('#ride-journal-spot').inputValue(),'zzFinalSpot');assert.equal(await page.locator('#ride-journal-notes').inputValue(),'Çok spotlu günlük taslağı');await page.locator('#ride-journal-save').click();await settle(page);assert.ok((await page.locator('#ride-journal-list').innerText()).includes('Uzak son spot'));
 },{seed:manySpotSeed});
 await scenario('mobile map toolbar stays on screen and reduced motion disables route menu animation',async page=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const width of [320,390]){await page.setViewportSize({width,height:700});await openRoutes(page);await page.locator('[data-ride-action=clear-route]').click();await page.locator('#ride-route-map-pick').click();await mapPick(page,'mapSpot1');
   const rect=await page.locator('#ride-map-toolbar').boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width+1&&rect.y+rect.height<=701,JSON.stringify(rect));assert.equal(await page.locator('#ride-map-toolbar').evaluate(element=>element.scrollWidth>element.clientWidth),false);
   await page.locator('#ride-map-return').click();assert.ok(await page.locator('#ride-tools-modal .dzt-card').evaluate(element=>parseFloat(getComputedStyle(element).animationDuration)<=.01));await page.evaluate(()=>window.DropZoneRideTools.close());
  }
 },{mobile:true});
 await scenario('popular feed queries likes before recency, pages unique posts, and updates changed ranks',async page=>{
  await openCommunity(page);assert.equal(await page.locator('#community-sort').inputValue(),'popular');
  let ids=await feedIds(page);assert.equal(ids.length,20);assert.equal(ids[0],'rank29');assert.equal(ids.at(-1),'rank10');
  const ordering=await page.evaluate(()=>[...__dzMock.listeners].find(entry=>entry.q.path==='communityPosts').q.clauses.filter(clause=>clause.op==='orderBy').map(clause=>[clause.field,clause.direction]));assert.deepEqual(ordering,[['likeCount','desc'],['createdAt','desc']]);
  await page.locator('#community-load-more').click();await settle(page);ids=await feedIds(page);assert.equal(ids.length,31);assert.equal(new Set(ids).size,31);
  await page.evaluate(()=>{document.getElementById('community-scroll').scrollTop=0});await writePost(page,'rank00',{likeCount:50});ids=await feedIds(page);assert.equal(ids[0],'rank00');assert.equal(new Set(ids).size,ids.length);
  await page.locator('#community-load-more').click();await settle(page);ids=await feedIds(page);assert.equal(ids.length,31);assert.equal(new Set(ids).size,31);assert.equal(ids[0],'rank00');
  await page.locator('#community-sort').selectOption('newest');await settle(page);ids=await feedIds(page);assert.equal(ids[0],'seedPost');assert.equal(ids[1],'rank00');
 },{seed:[...seed,...ranked]});
 await scenario('own like updates ranking through the preserved-scroll refresh',async page=>{
  await openCommunity(page);assert.equal((await feedIds(page))[0],'sameNewer');await page.locator('[data-post-id="sameOlder"] .dz-post-actions button').first().click();await settle(page);if(await page.locator('#community-new-posts button').isVisible()){await page.locator('#community-new-posts button').click();await settle(page)}assert.equal((await feedIds(page))[0],'sameOlder');assert.equal(await page.locator('[data-post-id="sameOlder"] .dz-post-actions button').first().innerText(),'6');
 },{seed:[...seed,['communityPosts/sameNewer',{...basePost,likeCount:5,createdAt:{seconds:now-100,nanoseconds:0}}],['communityPosts/sameOlder',{...basePost,likeCount:5,createdAt:{seconds:now-200,nanoseconds:0}}]]});
 await scenario('pending rank refresh preserves valid bumped posts and removes remote deletions with bounded reads',async page=>{
  await openCommunity(page);const post=page.locator('[data-post-id="rank29"]');await post.locator('.dz-post-actions button').nth(1).click();await post.locator('.dz-comments').waitFor();await page.locator('#community-load-more').click();await settle(page);await page.locator('#community-scroll').evaluate(element=>{element.scrollTop=500});await writePost(page,'rank00',{likeCount:99});await page.locator('#community-new-posts button').waitFor();assert.equal((await feedIds(page)).length,31);assert.ok((await feedIds(page)).includes('rank10'));
  const bumpedReads=()=>page.evaluate(()=>(__dzMock.reads||[]).filter(read=>read.method==='getDoc'&&read.path==='communityPosts/rank10').length);assert.equal(await bumpedReads(),1);await writePost(page,'rank28',{text:'Güncel metin; sıra değişmedi'});assert.equal(await bumpedReads(),1);assert.equal(await page.locator('#community-new-posts button').isVisible(),true);
  await writePost(page,'rank29',{deleted:true,text:''});assert.equal(await post.count(),0);assert.equal(await page.evaluate(()=>[...__dzMock.listeners].filter(entry=>entry.q.path==='communityPosts/rank29/comments').length),0);assert.equal(await page.evaluate(()=>(__dzMock.reads||[]).filter(read=>read.method==='getDoc'&&read.path==='communityPosts/rank29').length),1);assert.equal(await bumpedReads(),1);
 },{seed:[...seed,...ranked]});
 await scenario('same-order boundary like changes preserve old pages until accepting fresh pagination',async page=>{
  await openCommunity(page);await page.locator('#community-load-more').click();await settle(page);const before=await feedIds(page);await page.locator('#community-scroll').evaluate(element=>{element.scrollTop=500});await writePost(page,'rank10',{likeCount:101});await page.locator('#community-new-posts button').waitFor();assert.deepEqual(await feedIds(page),before);assert.equal(await page.locator('#community-load-more').isDisabled(),true);await page.locator('#community-new-posts button').click();await settle(page);assert.equal((await feedIds(page)).length,20);await page.locator('#community-load-more').click();await settle(page);const ids=await feedIds(page);assert.equal(ids.length,31);assert.equal(new Set(ids).size,31);
 },{seed:[...seed,...ranked.map(([key,value])=>[key,{...value,likeCount:value.likeCount*10}])]});
 await scenario('rank changes while reading preserve scroll until refresh and restart pagination at the new boundary',async page=>{
  await openCommunity(page);await page.locator('#community-load-more').click();await settle(page);
  await page.locator('#community-scroll').evaluate(element=>{element.scrollTop=500});const scrollBefore=await page.locator('#community-scroll').evaluate(element=>element.scrollTop);assert.ok(scrollBefore>250);
  await writePost(page,'rank00',{likeCount:99});assert.equal(await page.locator('#community-new-posts button').isVisible(),true);assert.equal((await feedIds(page))[0],'rank29');
  await page.locator('#community-new-posts button').click();await settle(page);let ids=await feedIds(page);assert.equal(ids[0],'rank00');assert.equal(ids.length,20);
  await page.locator('#community-load-more').click();await settle(page);ids=await feedIds(page);assert.equal(ids.length,31);assert.equal(new Set(ids).size,31);
 },{seed:[...seed,...ranked]});
})();
