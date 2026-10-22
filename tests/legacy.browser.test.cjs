const assert = require('node:assert/strict');
const { openApp, data } = require('./browser-harness.cjs');
const pause = page => page.waitForTimeout(80);
const advance = page => page.evaluate(() => { globalThis.__dzAdvance += 6000; });
const notificationKeys = ['id', 'text', 'date', 'read', 'actorId', 'spotId', 'eventType', 'eventId'].sort();

function fixtures({ comments = [], reports = [], selfSpot = false } = {}) {
    return [
        ...data.map(([path, value]) => [path, path === 'spots/spotOne' ? { ...value, comments, reports, ...(selfSpot ? { userId: 'alice' } : {}) } : value]),
        ['users/bob', { favorites: ['privateSpot'], notifications: [], bio: 'Private profile' }]
    ];
}

async function scenario(label, options, run) {
    const { browser, page, errors } = await openApp(options);
    try {
        await run(page);
        assert.deepEqual(errors, [], 'Uncaught browser errors');
        console.log('PASS', label);
    } catch (error) {
        console.error('FAIL', label, error.stack);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

async function confirmComment(page, text) {
    await page.locator('#comment-input').fill(text);
    await page.evaluate(() => window.submitComment());
    await page.getByRole('button', { name: 'Onayla', exact: true }).click();
    await pause(page);
}

(async () => {
    await scenario('legacy favorite and owner notification share one transaction without reading owner profile', { seed: fixtures() }, async page => {
        await page.evaluate(() => window.openSpotDetail('spotOne'));
        await page.locator('#btn-toggle-favorite').click();
        await pause(page);
        const result = await page.evaluate(() => ({
            profile: __dzMock.data.get('users/alice'),
            recipient: __dzMock.data.get('users/bob'),
            transaction: __dzMock.transactions.at(-1),
            recipientReads: __dzMock.reads.filter(read => read.path === 'users/bob')
        }));
        assert.deepEqual(result.profile.favorites, ['spotOne']);
        assert.deepEqual(result.recipient.favorites, ['privateSpot']);
        assert.equal(result.recipient.bio, 'Private profile');
        assert.equal(result.recipient.notifications.length, 1);
        const notification = result.recipient.notifications[0];
        assert.deepEqual(Object.keys(notification).sort(), notificationKeys);
        assert.equal(notification.actorId, 'alice');
        assert.equal(notification.spotId, 'spotOne');
        assert.equal(notification.eventType, 'favorite');
        assert.equal(notification.eventId, 'alice');
        assert.equal(notification.read, false);
        assert.equal(notification.text, 'Alice Rider "İzmir Bowl" adlı spotunuzu favorilere ekledi!');
        assert.deepEqual(result.transaction.reads, ['users/alice', 'spots/spotOne']);
        assert.deepEqual(result.transaction.writes.map(([, ref]) => ref.path), ['users/alice', 'users/bob']);
        assert.deepEqual(result.recipientReads, []);
        await advance(page);
        await page.locator('#btn-toggle-favorite').click();
        await pause(page);
        assert.deepEqual(await page.evaluate(() => __dzMock.data.get('users/alice').favorites), []);
        assert.equal(await page.evaluate(() => __dzMock.data.get('users/bob').notifications.length), 1);
        await advance(page);
        await page.evaluate(() => { __dzMock.failNextTransaction = true; });
        const before = await page.evaluate(() => __dzMock.writes.length);
        await page.locator('#btn-toggle-favorite').click();
        await pause(page);
        assert.equal(await page.evaluate(() => __dzMock.writes.length), before);
        assert.deepEqual(await page.evaluate(() => __dzMock.data.get('users/alice').favorites), []);
    });

    await scenario('legacy spot comment and owner notification share one transaction with matching event id', { seed: fixtures() }, async page => {
        await page.evaluate(() => window.openSpotDetail('spotOne'));
        const text = '<img src=x onerror="globalThis.legacyXss=true"> Görüşürüz!';
        await confirmComment(page, text);
        const result = await page.evaluate(() => ({
            comments: __dzMock.data.get('spots/spotOne').comments,
            notifications: __dzMock.data.get('users/bob').notifications,
            transaction: __dzMock.transactions.at(-1),
            recipientReads: __dzMock.reads.filter(read => read.path === 'users/bob'),
            xss: globalThis.legacyXss
        }));
        assert.equal(result.comments.length, 1);
        assert.equal(result.comments[0].text, text);
        assert.equal(result.comments[0].userName, 'Alice Rider');
        assert.equal(result.notifications.length, 1);
        assert.equal(result.notifications[0].eventType, 'comment');
        assert.equal(result.notifications[0].eventId, result.comments[0].id);
        assert.equal(result.notifications[0].text, 'Alice Rider "İzmir Bowl" adlı spotunuza yorum yaptı.');
        assert.deepEqual(Object.keys(result.notifications[0]).sort(), notificationKeys);
        assert.deepEqual(result.transaction.reads, ['spots/spotOne']);
        assert.deepEqual(result.transaction.writes.map(([, ref]) => ref.path), ['spots/spotOne', 'users/bob']);
        assert.deepEqual(result.recipientReads, []);
        assert.equal(result.xss, undefined);
        assert.equal(await page.locator('#detail-comments-list img').count(), 0);
        await advance(page);
        await page.evaluate(() => { __dzMock.failNextTransaction = true; });
        await confirmComment(page, 'Başarısız işlemde yorumum korunsun');
        assert.equal(await page.locator('#comment-input').inputValue(), 'Başarısız işlemde yorumum korunsun');
        assert.equal(await page.evaluate(() => __dzMock.data.get('spots/spotOne').comments.length), 1);
        assert.equal(await page.evaluate(() => __dzMock.data.get('users/bob').notifications.length), 1);
    });

    await scenario('own spot actions skip self notifications and unnamed signed-in actor uses Rider', {
        seed: fixtures({ selfSpot: true }),
        initialState: { user: { uid: 'alice', displayName: null, email: 'alice@example.test', photoURL: null } }
    }, async page => {
        await page.evaluate(() => window.openSpotDetail('spotOne'));
        await page.locator('#btn-toggle-favorite').click();
        await pause(page);
        assert.deepEqual(await page.evaluate(() => __dzMock.transactions.at(-1).writes.map(([, ref]) => ref.path)), ['users/alice']);
        await advance(page);
        await confirmComment(page, 'Kendi spotuma yorum');
        assert.equal(await page.evaluate(() => __dzMock.data.get('spots/spotOne').comments[0].userName), 'Rider');
        assert.deepEqual(await page.evaluate(() => __dzMock.data.get('users/alice').notifications), []);
        assert.deepEqual(await page.evaluate(() => __dzMock.transactions.at(-1).writes.map(([, ref]) => ref.path)), ['spots/spotOne']);
    });

    await scenario('signed-in UI survives failed profile read and keeps community publishing usable', {
        seed: fixtures(), initialState: { failGetDocPaths: ['users/alice'] }
    }, async page => {
        assert.ok((await page.locator('#auth-section').innerText()).includes('Alice Rider'));
        await page.evaluate(() => window.openCommunity());
        assert.equal(await page.locator('#community-text').isDisabled(), false);
        await page.locator('#community-text').fill('Profil yüklenmese de oturumum açık');
        await page.locator('#community-publish').click();
        await pause(page);
        assert.ok(await page.evaluate(() => [...__dzMock.data.entries()].some(([path, value]) => path.startsWith('communityPosts/') && value.text === 'Profil yüklenmese de oturumum açık')));
    });

    const quotedName = "O'Rider');globalThis.legacyXss=true;// <img src=x onerror=globalThis.legacyXss=true>";
    const quotedId = "comment');globalThis.legacyXss=true;//";
    await scenario('quoted legacy comment author and id remain inert when reply/delete controls are clicked', {
        seed: fixtures({ comments: [{ id: quotedId, userId: 'alice', userName: quotedName, text: 'Eski yorum', date: Date.now(), replyToId: null }] })
    }, async page => {
        await page.evaluate(() => window.openSpotDetail('spotOne'));
        const reply = page.locator('#detail-comments-list [data-reply-comment]');
        assert.equal(await reply.getAttribute('onclick'), null);
        await reply.click();
        assert.equal(await page.locator('#reply-to-name').innerText(), `@${quotedName}`);
        assert.equal(await page.evaluate(() => globalThis.legacyXss), undefined);
        assert.equal(await page.locator('#detail-comments-list img').count(), 0);
        const remove = page.locator('#detail-comments-list [data-delete-comment]');
        assert.equal(await remove.getAttribute('onclick'), null);
        await remove.click();
        assert.equal(await page.locator('#confirm-modal').isVisible(), true);
        await page.getByRole('button', { name: 'İptal', exact: true }).click();
        assert.equal(await page.evaluate(() => globalThis.legacyXss), undefined);
    });

    await scenario('stored report photo URLs cannot execute script schemes or inject image attributes', {
        seed: fixtures({ reports: [
            { id: 'unsafe', status: 'approved', type: '<img src=x onerror=globalThis.legacyXss=true>', date: Date.now(), photoUrl: 'javascript:globalThis.legacyXss=true', userId: 'bob' },
            { id: 'pending', status: 'pending', type: 'Kanıt', date: Date.now(), photoUrl: 'https://example.test/photo.jpg" onerror="globalThis.legacyXss=true', userId: 'bob' }
        ] }),
        initialState: { user: { uid: 'alice', displayName: 'Alice Rider', email: 'delidereliler@gmail.com', photoURL: null } }
    }, async page => {
        await page.evaluate(() => {
            globalThis.__openedPhotoUrls = [];
            window.open = (...args) => { __openedPhotoUrls.push(args[0]); return null; };
            window.openSpotDetail('spotOne');
        });
        await page.locator('#detail-active-reports').click();
        assert.deepEqual(await page.evaluate(() => __openedPhotoUrls), []);
        assert.equal(await page.locator('#detail-active-reports img').count(), 0);
        await page.evaluate(() => { window.closeModals(); window.openAdminReportsModal(); });
        const image = page.locator('#admin-reports-modal .report-preview-img');
        assert.equal(await image.count(), 1);
        assert.equal(await image.getAttribute('onerror'), null);
        assert.equal(await page.evaluate(() => globalThis.legacyXss), undefined);
    });
})();
