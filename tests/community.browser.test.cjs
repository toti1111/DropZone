const assert=require('node:assert/strict');
const {openApp,data}=require('./browser-harness.cjs');
const results=[];
async function scenario(label,fn){try{await fn();results.push({label,status:'PASS'});console.log('PASS',label)}catch(error){results.push({label,status:'FAIL',error:error.message});console.error('FAIL',label,error.stack);process.exitCode=1}}
const settle=page=>page.waitForTimeout(80);
const advance=page=>page.evaluate(()=>globalThis.__dzAdvance+=6000);
const switchUser=(page,id)=>page.evaluate(id=>{const s=globalThis.__dzMock;s.user=id?{uid:id,displayName:id==='bob'?'Bob Rider':'Alice Rider',email:id+'@example.test',photoURL:null}:null;for(const cb of s.authCallbacks||[])cb(s.user)},id);
(async()=>{
await scenario('anonymous reader has disabled composer and no write side effects',async()=>{
 const {browser,page,errors}=await openApp({authenticated:false});try{
 await page.evaluate(()=>window.openCommunity());await page.locator('[data-post-id="seedPost"]').waitFor();assert.equal(await page.locator('#community-text').isDisabled(),true);assert.equal(await page.locator('#community-publish').isDisabled(),true);assert.equal(await page.locator('#community-auth-prompt').isVisible(),true);
 const p=page.locator('[data-post-id="seedPost"]');await p.locator('.dz-post-actions button').nth(0).click();assert.equal(await page.evaluate(()=>__dzMock.writes.length),0);assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
await scenario('publish with selected map spot, escaped content, likes, comments, notifications, deletion',async()=>{
 const {browser,page,errors}=await openApp();try{
 await page.evaluate(()=>window.openCommunity());await page.locator('[data-post-id="seedPost"]').waitFor();
 assert.equal(await page.locator('#community-spot option').count(),3);
 const malicious='<img src=x onerror="globalThis.communityXss=true"> Harika bir sürüş!';
 await page.locator('#community-text').fill(malicious);await page.locator('#community-attach-spot').click();await page.locator('#community-spot').selectOption('spotTwo');await page.locator('#community-publish').click();await settle(page);
 assert.equal(await page.locator('#community-feed article').count(),2);assert.equal(await page.locator('#community-compose-status').textContent(),'Paylaşımın ekibe ulaştı.');
 await page.screenshot({path:require('node:path').join(__dirname,'artifacts','community-desktop.png'),fullPage:true});
 const created=await page.evaluate(()=>[...__dzMock.data.entries()].find(([p,v])=>p.startsWith('communityPosts/')&&p.split('/').length===2&&v.authorId==='alice'));
 assert.equal(created[1].spotId,'spotTwo');assert.equal(created[1].text,malicious);assert.equal(await page.evaluate(()=>globalThis.communityXss),undefined);assert.equal(await page.locator('#community-feed .dz-post-text img').count(),0);
 const bob=page.locator('[data-post-id="seedPost"]');await advance(page);await bob.locator('.dz-post-actions button').nth(0).click();await settle(page);assert.equal(await bob.locator('.dz-post-actions button').nth(0).getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>__dzMock.data.get('communityPosts/seedPost').likeCount),1);
 await bob.locator('.dz-post-actions button').nth(1).click();await bob.locator('.dz-comment-form textarea').fill('<script>globalThis.communityXss=true</script> Orada görüşürüz');await advance(page);await bob.locator('.dz-comment-form button').click();await settle(page);assert.equal(await bob.locator('.dz-comment').count(),1);assert.equal(await page.evaluate(()=>__dzMock.data.get('communityPosts/seedPost').commentCount),1);assert.equal(await page.evaluate(()=>globalThis.communityXss),undefined);
 const recipientNotifs=await page.evaluate(()=>[...__dzMock.data.entries()].filter(([p])=>p.startsWith('communityInbox/bob/notifications/')).map(([p,v])=>({p,...v})));assert.equal(recipientNotifs.length,2);assert.deepEqual(recipientNotifs.map(n=>n.type).sort(),['comment','like']);
 await advance(page);await bob.locator('.dz-post-actions button').nth(0).click();await settle(page);assert.equal(await page.evaluate(()=>__dzMock.data.get('communityPosts/seedPost').likeCount),0);await advance(page);await bob.locator('.dz-post-actions button').nth(0).click();await settle(page);assert.equal(await page.evaluate(()=>__dzMock.data.get('communityPosts/seedPost').likeCount),1);assert.equal(await page.evaluate(()=>[...__dzMock.data.keys()].filter(p=>p.startsWith('communityInbox/bob/notifications/')).length),2);
 await switchUser(page,'bob');await settle(page);assert.equal(await page.locator('#notification-badge').textContent(),'2');await page.evaluate(()=>window.openNotificationsModal());await settle(page);assert.equal(await page.locator('#notifications-list .dz-inbox-item').count(),2);assert.equal(await page.evaluate(()=>[...__dzMock.data.entries()].filter(([p])=>p.startsWith('communityInbox/bob/notifications/')).every(([,v])=>v.read)),true);
 await page.locator('#notifications-list .dz-inbox-item').first().click();await settle(page);assert.equal(await page.locator('#notifications-modal').isVisible(),false);assert.equal(await bob.locator('.dz-comments').isVisible(),true);
 await switchUser(page,'alice');await settle(page);
 await page.locator('[data-community-action="filter"]').click();await page.locator('#community-filter-spot').selectOption('spotOne');await settle(page);assert.equal(await page.locator('#community-feed article').count(),1);await page.locator('[data-community-action="all"]').click();await settle(page);assert.equal(await page.locator('#community-feed article').count(),2);
 await page.locator(`[data-post-id="${created[0].split('/')[1]}"] [aria-label="Paylaşımı sil"]`).click();await page.getByRole('button',{name:'Onayla',exact:true}).click();await settle(page);assert.equal(await page.evaluate(p=>__dzMock.data.get(p).deleted,created[0]),true);assert.equal(await page.locator('#community-feed article').count(),1);
 await page.screenshot({path:require('node:path').join(__dirname,'artifacts','community-desktop.png'),fullPage:true});
 const activeBefore=await page.evaluate(()=>[...__dzMock.listeners].filter(x=>x.q.path.startsWith('communityPosts')).length);assert.ok(activeBefore>=1);await page.locator('[data-community-action="close"]').click();assert.equal(await page.evaluate(()=>[...__dzMock.listeners].filter(x=>x.q.path.startsWith('communityPosts')).length),0);assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
await scenario('bounded pagination, spot filter and mobile layout',async()=>{
 const seed=[...data.filter(([p])=>!p.startsWith('communityPosts/'))];for(let i=0;i<45;i++)seed.push([`communityPosts/post${String(i).padStart(3,'0')}`,{...data.find(([p])=>p==='communityPosts/seedPost')[1],text:`Sürüş paylaşımı ${i} `+'uzunmetin'.repeat(i===0?90:0),spotId:i%2?'spotTwo':'spotOne',createdAt:{seconds:Math.floor(Date.now()/1000)-i*60,nanoseconds:0}}]);
 const {browser,page,errors}=await openApp({mobile:true,seed});try{
 await page.evaluate(()=>window.openCommunity());await page.locator('#community-feed article').first().waitFor();assert.equal(await page.locator('#community-feed article').count(),20);await page.locator('#community-load-more').click();await settle(page);assert.equal(await page.locator('#community-feed article').count(),40);await page.locator('#community-load-more').click();await settle(page);assert.equal(await page.locator('#community-feed article').count(),45);assert.equal(await page.locator('#community-load-more').isVisible(),false);
 await page.locator('[data-community-action="filter"]').click();await page.locator('#community-filter-spot').selectOption('spotTwo');await settle(page);assert.equal(await page.locator('#community-feed article').count(),20);assert.equal(await page.locator('#community-feed .dz-post-spot').filter({hasText:'İstanbul Park'}).count(),20);
 const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,modal:document.getElementById('community-modal').scrollWidth,main:document.getElementById('community-scroll').scrollWidth,mainClient:document.getElementById('community-scroll').clientWidth}));assert.ok(overflow.document<=overflow.viewport,JSON.stringify(overflow));assert.ok(overflow.main<=overflow.mainClient,JSON.stringify(overflow));
 await page.screenshot({path:require('node:path').join(__dirname,'artifacts','community-mobile.png'),fullPage:true});await page.keyboard.press('Escape');assert.equal(await page.locator('#community-modal').isVisible(),false);assert.equal(await page.evaluate(()=>[...__dzMock.listeners].filter(x=>x.q.path.startsWith('communityPosts')).length),0);assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
console.log(JSON.stringify(results));
})();
