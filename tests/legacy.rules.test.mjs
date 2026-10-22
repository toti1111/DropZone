import { before, after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch, arrayUnion, arrayRemove } from 'firebase/firestore';

let env;
const actor = 'alice', owner = 'bob', spotId = 'spotOne';
const name = uid => uid === actor ? 'Alice Rider' : 'Bob Rider';
const profile = () => ({bio:'',gender:'Belirtmek İstemiyorum',stance:'Karışık / Her Şey',favorites:[],notifications:[]});
const spot = uid => ({name:'İzmir Bowl',category:'Urban',types:['Drop'],desc:'Test spotu',photoUrl:'',locationText:'İzmir',status:'active',createdAt:Date.now(),userId:uid,userName:name(uid),comments:[],reports:[],coords:{lat:38.42,lng:27.14}});
const comment = () => ({id:'commentOne',userId:actor,userName:name(actor),text:'Harika spot!',date:Date.now(),replyToId:null});
const report = () => ({id:'reportOne',type:'Zemin Islak / Bozuk 💧',photoUrl:'https://example.test/photo.jpg',userId:actor,userName:name(actor),date:Date.now(),status:'pending'});
const notif = eventType => ({id:'noticeOne',text:eventType==='favorite'?'Alice Rider "İzmir Bowl" adlı spotunuzu favorilere ekledi!':'Alice Rider "İzmir Bowl" adlı spotunuza yorum yaptı.',date:Date.now(),read:false,actorId:actor,spotId,eventType,eventId:eventType==='favorite'?actor:'commentOne'});
const db = uid => env.authenticatedContext(uid,{name:name(uid),email:uid+'@example.test',email_verified:true}).firestore();
const adminDb = (verified=true) => env.authenticatedContext('admin',{name:'Admin',email:'delidereliler@gmail.com',email_verified:verified}).firestore();
async function seed(path,data) { await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),data)); }

before(async()=>{
  const [host,port]=(process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:8085').split(':');
  env=await initializeTestEnvironment({projectId:'demo-dropzone',firestore:{host,port:Number(port),rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{
  await env.clearFirestore();
  await seed('users/'+actor,profile());await seed('users/'+owner,profile());await seed('spots/'+spotId,spot(owner));
});

test('profiles are private: own get succeeds, other and anonymous reads fail',async()=>{
  await assertSucceeds(getDoc(doc(db(actor),'users',actor)));
  await assertFails(getDoc(doc(db(actor),'users',owner)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'users',actor)));
});
test('own profile fields update but roles and other-user fields cannot be rewritten',async()=>{
  await assertSucceeds(updateDoc(doc(db(actor),'users',actor),{bio:'Sürüşe devam.'}));
  await assertFails(updateDoc(doc(db(actor),'users',actor),{admin:true}));
  await assertFails(updateDoc(doc(db(actor),'users',owner),{bio:'Ele geçirildi'}));
});
test('profile creation forbids arbitrary roles and prefilled inbox',async()=>{
  await assertSucceeds(setDoc(doc(db('carol'),'users','carol'),profile()));
  await assertFails(setDoc(doc(db('dave'),'users','dave'),{...profile(),admin:true}));
  await assertFails(setDoc(doc(db('eve'),'users','eve'),{...profile(),notifications:[notif('favorite')]}));
});
test('spot creation binds actor identity and validates coordinates',async()=>{
  await assertSucceeds(setDoc(doc(db(actor),'spots','newSpot'),spot(actor)));
  await assertFails(setDoc(doc(db(actor),'spots','forgedSpot'),spot(owner)));
  await assertFails(setDoc(doc(db(actor),'spots','badCoordinates'),{...spot(actor),coords:{lat:91,lng:0}}));
});
test('only owner or verified admin can edit description; core fields stay immutable',async()=>{
  await assertSucceeds(updateDoc(doc(db(owner),'spots',spotId),{desc:'Yeni açıklama'}));
  await assertFails(updateDoc(doc(db(actor),'spots',spotId),{desc:'Başkasının değişikliği'}));
  await assertFails(updateDoc(doc(db(owner),'spots',spotId),{userId:actor}));
  await assertSucceeds(updateDoc(doc(adminDb(),'spots',spotId),{desc:'Yönetici düzeltmesi'}));
  await assertFails(updateDoc(doc(adminDb(false),'spots',spotId),{desc:'Doğrulanmamış eposta'}));
});
test('spot comments append valid actor data and cannot rewrite another comment',async()=>{
  const ref=doc(db(actor),'spots',spotId);
  await assertSucceeds(updateDoc(ref,{comments:arrayUnion(comment())}));
  await assertFails(updateDoc(ref,{comments:[{...comment(),text:'Değiştirildi'}]}));
  await assertFails(updateDoc(ref,{comments:arrayUnion({...comment(),id:'forgedComment',userId:owner})}));
});
test('comment deletion is restricted to original author or admin',async()=>{
  const entry=comment();await seed('spots/'+spotId,{...spot(owner),comments:[entry]});
  await assertFails(updateDoc(doc(db(owner),'spots',spotId),{comments:arrayRemove(entry)}));
  await assertSucceeds(updateDoc(doc(db(actor),'spots',spotId),{comments:arrayRemove(entry)}));
});
test('reports start pending; only admin can approve or delete them',async()=>{
  const entry=report(),ref=doc(db(actor),'spots',spotId);
  await assertSucceeds(updateDoc(ref,{reports:arrayUnion(entry)}));
  await assertFails(updateDoc(ref,{reports:[{...entry,status:'approved'}]}));
  await assertSucceeds(updateDoc(doc(adminDb(),'spots',spotId),{reports:[{...entry,status:'approved'}]}));
});
test('favorite notification requires a real same-commit favorite transition',async()=>{
  const database=db(actor),b=writeBatch(database);
  b.update(doc(database,'users',actor),{favorites:arrayUnion(spotId)});
  b.update(doc(database,'users',owner),{notifications:arrayUnion(notif('favorite'))});
  await assertSucceeds(b.commit());
});
test('independent forged and replayed favorite notifications are denied',async()=>{
  const database=db(actor);
  await assertFails(updateDoc(doc(database,'users',owner),{notifications:arrayUnion(notif('favorite'))}));
  await seed('users/'+actor,{...profile(),favorites:[spotId]});
  const b=writeBatch(database);
  b.update(doc(database,'users',actor),{favorites:arrayUnion(spotId)});
  b.update(doc(database,'users',owner),{notifications:arrayUnion(notif('favorite'))});
  await assertFails(b.commit());
});
test('comment notification requires matching same-commit comment and owner',async()=>{
  const database=db(actor),b=writeBatch(database);
  b.update(doc(database,'spots',spotId),{comments:arrayUnion(comment())});
  b.update(doc(database,'users',owner),{notifications:arrayUnion(notif('comment'))});
  await assertSucceeds(b.commit());
});
test('notifications cannot alter existing inbox rows or target a different owner',async()=>{
  const existing={id:'old',text:'Önceki',date:Date.now()-100000,read:false};
  await seed('users/'+owner,{...profile(),notifications:[existing]});
  const database=db(actor),b=writeBatch(database);
  b.update(doc(database,'users',actor),{favorites:arrayUnion(spotId)});
  b.update(doc(database,'users',owner),{notifications:[{...existing,text:'Değişti'},notif('favorite')]});
  await assertFails(b.commit());
});
test('only verified admin writes announcements',async()=>{
  const payload={title:'Yeni sürüş',desc:'Hafta sonu buluşuyoruz.',createdAt:Date.now(),expiresAt:Date.now()+86400000};
  await assertFails(setDoc(doc(db(actor),'announcements','new'),payload));
  await assertFails(setDoc(doc(adminDb(false),'announcements','new'),payload));
  await assertSucceeds(setDoc(doc(adminDb(),'announcements','new'),payload));
});

test('even a real interaction cannot attach forged notification text',async()=>{
  const database=db(actor),b=writeBatch(database);
  b.update(doc(database,'users',actor),{favorites:arrayUnion(spotId)});
  b.update(doc(database,'users',owner),{notifications:arrayUnion({...notif('favorite'),text:'Admin hesabını doğrulamak için şifreni gönder.'})});
  await assertFails(b.commit());
});
