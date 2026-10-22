const assert = require('node:assert/strict');
const path = require('node:path');
const { openApp, data } = require('./browser-harness.cjs');
const pause = page => page.waitForTimeout(90);
const advance = page => page.evaluate(() => { globalThis.__dzAdvance += 6000; });
const postCount = page => page.evaluate(() => [...__dzMock.data.keys()].filter(p => p.startsWith('communityPosts/') && p.split('/').length === 2).length);
const switchUser = (page, uid) => page.evaluate(uid => {
  const state = __dzMock; state.user = uid ? {uid, displayName:uid === 'bob' ? 'Bob Rider' : 'Alice Rider', email:uid+'@example.test', photoURL:null} : null;
  for (const callback of state.authCallbacks || []) callback(state.user);
}, uid);
async function scenario(name, run, options={}) {
  const {browser,page,errors} = await openApp({rememberRules:false,...options});
  try { await page.evaluate(() => window.openCommunity()); await run(page); assert.deepEqual(errors,[]); console.log('PASS',name); }
  catch (error) { console.error('FAIL',name,error.stack); process.exitCode=1; }
  finally { await browser.close(); }
}
(async () => {
  await scenario('rules gate prevents writes until explicit acceptance; cancel retains text and spot', async page => {
    assert.equal(await page.locator('.dz-nav,.dz-rail,.dz-endnote').count(),0);
    assert.equal(await page.locator('#community-spot-panel').isVisible(),false);
    await page.locator('#community-text').fill('Kurallar onayından sonra gönder.');
    await page.locator('#community-attach-spot').click();
    await page.locator('#community-spot').selectOption('spotOne');
    assert.equal(await page.locator('#community-spot-panel').isVisible(),false);
    assert.ok((await page.locator('#community-attach-spot').innerText()).includes('İzmir Bowl'));
    await page.locator('#community-publish').click();
    assert.equal(await postCount(page),1);
    assert.equal(await page.locator('#community-rules').isVisible(),true);
    assert.equal(await page.locator('.dz-shell').evaluate(el=>el.inert),true);
    assert.equal(await page.locator('#community-rules-remember').isChecked(),false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#community-modal').isVisible(),true);
    assert.equal(await page.locator('#community-rules').isVisible(),false);
    assert.equal(await page.locator('#community-text').inputValue(),'Kurallar onayından sonra gönder.');
    assert.equal(await page.locator('#community-spot').inputValue(),'spotOne');
    assert.equal(await postCount(page),1);
    await page.locator('#community-publish').click();
    await page.locator('#community-rules-accept').click(); await pause(page);
    assert.equal(await postCount(page),2);
    assert.equal(await page.locator('#community-text').inputValue(),'');
    assert.equal(await page.locator('#community-spot').inputValue(),'');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('dropzone:community:draft:v1:alice')),null);
    await advance(page); await page.locator('#community-text').fill('Bir sonraki paylaşım.');
    await page.locator('#community-publish').click();
    assert.equal(await page.locator('#community-rules').isVisible(),true);
    assert.equal(await postCount(page),2);
    await page.locator('[data-community-action="rules-cancel"]').click();
  });
  await scenario('remember choice persists across reload, is account scoped and can be reset', async page => {
    await page.locator('#community-text').fill('Kuralları hatırla.'); await page.locator('#community-publish').click();
    await page.locator('#community-rules-remember').check(); await page.locator('#community-rules-accept').click(); await pause(page);
    assert.equal(await page.evaluate(()=>localStorage.getItem('dropzone:community:rules:v1:alice')),'accepted');
    await page.reload({waitUntil:'networkidle'}); await page.evaluate(()=>window.openCommunity());
    await page.locator('#community-text').fill('Yenilemeden sonra tekrar paylaş.'); await page.locator('#community-publish').click(); await pause(page);
    assert.equal(await postCount(page),2); assert.equal(await page.locator('#community-rules').isVisible(),false);
    await switchUser(page,'bob'); await pause(page); await page.locator('#community-text').fill('Bob için ilk paylaşım.'); await page.locator('#community-publish').click();
    assert.equal(await page.locator('#community-rules').isVisible(),true); assert.equal(await page.locator('#community-rules-remember').isChecked(),false);
    await page.keyboard.press('Escape'); await switchUser(page,'alice'); await pause(page);
    await page.locator('[data-community-action="rules"]').click();
    assert.equal(await page.locator('#community-rules-remember').isChecked(),true);
    await page.locator('#community-rules-remember').uncheck(); await page.locator('#community-rules-accept').click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('dropzone:community:rules:v1:alice')),null);
    await page.locator('#community-text').fill('Tercih sıfırlandı.'); await page.locator('#community-publish').click();
    assert.equal(await page.locator('#community-rules').isVisible(),true);
  });
  await scenario('draft survives reload and close, preserves spot, and is cleared on account change', async page => {
    await page.locator('#community-text').fill('Yarım kalan sürüş hikâyem.'); await page.locator('#community-attach-spot').click(); await page.locator('#community-spot').selectOption('spotTwo');
    await page.waitForTimeout(300); await page.reload({waitUntil:'networkidle'}); await page.evaluate(()=>window.openCommunity());
    assert.equal(await page.locator('#community-text').inputValue(),'Yarım kalan sürüş hikâyem.');
    assert.equal(await page.locator('#community-spot').inputValue(),'spotTwo');
    assert.equal(await page.locator('#community-draft-indicator').isVisible(),true);
    await page.locator('[data-community-action="close"]').click(); await page.evaluate(()=>window.openCommunity());
    assert.equal(await page.locator('#community-text').inputValue(),'Yarım kalan sürüş hikâyem.');
    await page.locator('#community-remove-spot').click(); assert.equal(await page.locator('#community-spot').inputValue(),'');
    await switchUser(page,'bob'); await pause(page);
    assert.equal(await page.locator('#community-text').inputValue(),'');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('dropzone:community:draft:v1:alice')),null);
    await switchUser(page,'alice'); await pause(page); assert.equal(await page.locator('#community-text').inputValue(),'');
  });
  await scenario('rules focus is trapped; closing or switching account cancels pending publication', async page => {
    await page.locator('#community-text').fill('Oturum değişirse gönderme.'); await page.locator('#community-publish').click();
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-community-action')),'rules-cancel');
    await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(()=>document.activeElement.id),'community-rules-remember');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-community-action')),'rules-cancel');
    await switchUser(page,'bob'); await pause(page);
    assert.equal(await page.locator('#community-rules').isVisible(),false); assert.equal(await postCount(page),1);
    assert.equal(await page.locator('.dz-shell').evaluate(el=>el.inert),false);
    await page.locator('#community-text').fill('Kapatılan ekran göndermez.'); await page.locator('#community-publish').click();
    await page.evaluate(()=>window.closeCommunity()); await pause(page);
    assert.equal(await postCount(page),1); assert.equal(await page.locator('#community-rules').isVisible(),false);
  });
  await scenario('blocked browser storage keeps consent functional and failed publish retains draft', async page => {
    await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('blocked','SecurityError')};Storage.prototype.getItem=()=>{throw new DOMException('blocked','SecurityError')}});
    await page.locator('#community-text').fill('Depolama kapalıyken paylaş.'); await page.locator('#community-publish').click();
    await page.locator('#community-rules-remember').check(); await page.locator('#community-rules-accept').click(); await pause(page);
    assert.equal(await postCount(page),2);
    await advance(page); await page.locator('#community-text').fill('Hata olursa sakla.'); await page.locator('#community-publish').click();
    await page.evaluate(()=>{__dzMock.failNextTransaction=true}); await page.locator('#community-rules-accept').click(); await pause(page);
    assert.equal(await page.locator('#community-text').inputValue(),'Hata olursa sakla.'); assert.equal(await postCount(page),2);
    assert.equal(await page.locator('#community-compose-status').getAttribute('data-error'),'true');
  });
  await scenario('keyboard publishing obeys rules and consent never publishes twice', async page => {
    await page.locator('#community-text').fill('Ctrl Enter ile paylaş.'); await page.locator('#community-text').press('Control+Enter');
    assert.equal(await page.locator('#community-rules').isVisible(),true); assert.equal(await postCount(page),1);
    await page.evaluate(()=>{const b=document.getElementById('community-rules-accept');b.click();b.click()}); await pause(page);
    assert.equal(await postCount(page),2);
  });
  await scenario('compact layout and rules fit small mobile screens and respect reduced motion', async page => {
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const width of [320,360,390,768,1440]) {
      await page.setViewportSize({width,height:700});
      assert.equal(await page.evaluate(()=>document.getElementById('community-scroll').scrollWidth>document.getElementById('community-scroll').clientWidth),false,`feed overflow ${width}`);
    }
    await page.setViewportSize({width:390,height:844}); await page.locator('#community-text').fill('Daha sade, daha akıcı.');
    await page.screenshot({path:path.join(__dirname,'artifacts','community-refresh-mobile.png')});
    await page.locator('#community-publish').click();
    const bounds=await page.locator('.dz-rules-card').boundingBox(); assert.ok(bounds.x>=0 && bounds.x+bounds.width<=390);
    assert.equal(await page.locator('.dz-rules-card').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.screenshot({path:path.join(__dirname,'artifacts','community-rules-mobile.png')});
    await page.keyboard.press('Escape'); await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(__dirname,'artifacts','community-refresh-desktop.png')});
  },{mobile:true});
})();
