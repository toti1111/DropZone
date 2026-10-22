import {before,after,beforeEach,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,getDocs,collection,query,limit,setDoc,updateDoc,writeBatch,serverTimestamp,Timestamp,deleteField} from 'firebase/firestore';

let env;
const actor='alice',owner='bob',postId='pollPost';
const name=uid=>uid==='alice'?'Alice Rider':'Bob Rider';
const database=(uid=actor)=>env.authenticatedContext(uid,{name:name(uid)}).firestore();
const stamp=offset=>Timestamp.fromMillis(Date.now()+offset);
const poll=(overrides={})=>({question:'Hafta sonu hangi spot?',options:['Bowl','Dirt','Urban','Park'],endsAt:stamp(3600000),totalVotes:0,counts:[0,0,0,0],...overrides});
const post=(overrides={})=>({authorId:owner,authorName:name(owner),text:'Birlikte seçelim.',spotId:'',createdAt:stamp(-60000),deleted:false,likeCount:0,commentCount:0,lastEvent:{type:'post',id:postId,actorId:owner},poll:poll(),...overrides});
const rate=(type,id,pid=postId)=>({lastActionAt:serverTimestamp(),eventType:type,postId:pid,eventId:id});
const features=(overrides={})=>({difficulty:'intermediate',dropHeight:1.5,landing:'wide',surface:'concrete',...overrides});
const spot=(overrides={})=>({name:'Yeni Bowl',category:'Urban',types:['Drop'],desc:'Geniş iniş.',photoUrl:'',locationText:'İzmir',status:'active',createdAt:Date.now(),userId:actor,userName:name(actor),comments:[],reports:[],coords:{lat:38.42,lng:27.14},features:features(),...overrides});
async function seed(path,data){await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),data));}
async function expireRate(){await seed(`communityRateLimits/${actor}`,{lastActionAt:stamp(-60000),eventType:'post',postId,eventId:postId});}
function createPoll(overrides={},id='newPoll'){
  const db=database(),batch=writeBatch(db);
  batch.set(doc(db,'communityPosts',id),post({authorId:actor,authorName:name(actor),createdAt:serverTimestamp(),lastEvent:{type:'post',id,actorId:actor},poll:poll(overrides)}));
  batch.set(doc(db,'communityRateLimits',actor),rate('post',id,id));return batch.commit();
}
function vote({option=2,counts=[0,0,1,0],totalVotes=1,withRate=true,withChild=true,withParent=true,authorId=actor,pathUid=actor,pollOverrides={}}={}){
  const db=database(),batch=writeBatch(db);
  if(withChild)batch.set(doc(db,'communityPosts',postId,'votes',pathUid),{authorId,option,createdAt:serverTimestamp()});
  if(withParent)batch.update(doc(db,'communityPosts',postId),{poll:poll({counts,totalVotes,...pollOverrides}),lastEvent:{type:'vote',id:actor,actorId:actor}});
  if(withRate)batch.set(doc(db,'communityRateLimits',actor),rate('vote',actor));
  return batch.commit();
}
// The vote fixture must preserve the exact immutable deadline from its seeded parent.
let seededPoll;
function atomicVote(overrides={}){return vote({...overrides,pollOverrides:{endsAt:seededPoll.endsAt,...overrides.pollOverrides}});}
before(async()=>{
 const [host,port]=(process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:8085').split(':');
 env=await initializeTestEnvironment({projectId:'demo-dropzone',firestore:{host,port:Number(port),rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
});
after(async()=>{await env?.cleanup()});
beforeEach(async()=>{await env.clearFirestore();seededPoll=poll();await seed(`communityPosts/${postId}`,post({poll:seededPoll}));});

test('new poll accepts two to four distinct options with zero counters',async()=>{
 await assertSucceeds(createPoll({options:['Bowl','Dirt'],counts:[0,0]},'twoOptions'));await expireRate();
 await assertSucceeds(createPoll({options:['Bowl','Dirt','Urban'],counts:[0,0,0]},'threeOptions'));await expireRate();
 await assertSucceeds(createPoll({},'fourOptions'));
});
test('empty, oversized and incorrectly counted poll choices are rejected',async()=>{
 await assertFails(createPoll({options:['Bowl','Bowl'],counts:[0,0]}));
 await assertFails(createPoll({question:'   '}));
 await assertFails(createPoll({options:['Bowl','   '],counts:[0,0]}));
 await assertFails(createPoll({options:['Bowl','x'.repeat(81)],counts:[0,0]}));
 await assertFails(createPoll({counts:[0,0,0]}));
 await assertFails(createPoll({counts:[0,0,1,0],totalVotes:1}));
});
test('poll deadline must be in the bounded future at creation',async()=>{
 await assertFails(createPoll({endsAt:stamp(-1000)}));
 await assertFails(createPoll({endsAt:stamp(5*60000)}));
 await assertFails(createPoll({endsAt:stamp(80*3600000)}));
});
test('vote, matching aggregate and rate record succeed atomically',async()=>{
 await assertSucceeds(atomicVote());
 const data=(await getDoc(doc(database(),'communityPosts',postId))).data();
 if(data.poll.totalVotes!==1||data.poll.counts[2]!==1)throw Error('poll counter was not incremented');
});
test('direct aggregate changes, child-only votes and missing rate records are rejected',async()=>{
 await assertFails(atomicVote({withChild:false}));
 await assertFails(atomicVote({withParent:false}));
 await assertFails(atomicVote({withRate:false}));
});
test('a vote cannot target another user or forge its author',async()=>{
 await assertFails(atomicVote({authorId:'mallory'}));
 await assertFails(atomicVote({pathUid:'mallory'}));
});
test('negative, fractional and out-of-range vote indexes are rejected',async()=>{
 await assertFails(atomicVote({option:-1}));
 await assertFails(atomicVote({option:1.5}));
 await assertFails(atomicVote({option:4}));
});
test('one vote cannot increase several options or fabricate the total',async()=>{
 await assertFails(atomicVote({counts:[0,1,1,0],totalVotes:2}));
 await assertFails(atomicVote({counts:[0,0,2,0],totalVotes:2}));
 await assertFails(atomicVote({counts:[1,0,0,0]}));
});
test('voting cannot rewrite immutable choices, question or deadline',async()=>{
 await assertFails(atomicVote({pollOverrides:{question:'Yeni soru'}}));
 await assertFails(atomicVote({pollOverrides:{options:['Yeni','Dirt','Urban','Park']}}));
 await assertFails(atomicVote({pollOverrides:{endsAt:stamp(7200000)}}));
});
test('a user votes once; vote rewrites and deletes remain forbidden',async()=>{
 await assertSucceeds(atomicVote());await expireRate();
 await assertFails(atomicVote({counts:[0,0,2,0],totalVotes:2}));
 await assertFails(updateDoc(doc(database(),'communityPosts',postId,'votes',actor),{option:1}));
});
test('server time rejects closed polls and deleted parent posts',async()=>{
 seededPoll=poll({endsAt:stamp(-1000)});await seed(`communityPosts/${postId}`,post({poll:seededPoll}));
 await assertFails(atomicVote());
 seededPoll=poll();await seed(`communityPosts/${postId}`,post({poll:seededPoll,deleted:true,text:''}));
 await assertFails(atomicVote());
});
test('vote documents are private while aggregate results remain public',async()=>{
 await assertSucceeds(atomicVote());
 await assertSucceeds(getDoc(doc(database(),'communityPosts',postId,'votes',actor)));
 await assertFails(getDoc(doc(database(owner),'communityPosts',postId,'votes',actor)));
 await assertFails(getDocs(query(collection(database(),'communityPosts',postId,'votes'),limit(20))));
 await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'communityPosts',postId)));
});
test('new spot supports optional physical metadata and legacy spots remain valid',async()=>{
 await assertSucceeds(setDoc(doc(database(),'spots','withFeatures'),spot()));
 const plain=spot();delete plain.features;
 await assertSucceeds(setDoc(doc(database(),'spots','legacySpot'),plain));
});
test('only owner or admin may update physical metadata and core identity stays immutable',async()=>{
 await seed('spots/spotOne',spot());
 await assertSucceeds(updateDoc(doc(database(),'spots','spotOne'),{features:features({difficulty:'advanced'}),desc:'Yeni ölçüm.'}));
 await assertFails(updateDoc(doc(database(owner),'spots','spotOne'),{features:features()}));
 await assertFails(updateDoc(doc(database(),'spots','spotOne'),{features:features(),userId:owner}));
});
test('invalid height, unknown enum, missing metadata fields and extra fields are rejected',async()=>{
 await assertFails(setDoc(doc(database(),'spots','height'),spot({features:features({dropHeight:31})})));
 await assertFails(setDoc(doc(database(),'spots','difficulty'),spot({features:features({difficulty:'expert'})})));
 await assertFails(setDoc(doc(database(),'spots','extra'),spot({features:{...features(),secret:'extra'}})));
 const missing=features();delete missing.surface;
 await assertFails(setDoc(doc(database(),'spots','missing'),spot({features:missing})));
});

test('poll soft deletion must remove its question and choices from the public parent',async()=>{
 const ref=doc(database(owner),'communityPosts',postId);
 await assertFails(updateDoc(ref,{deleted:true,text:''}));
 await assertFails(updateDoc(ref,{deleted:true,text:'',poll:{...seededPoll,question:'Changed on delete'}}));
 await assertSucceeds(updateDoc(ref,{deleted:true,text:'',poll:deleteField()}));
 const remaining=(await getDoc(doc(env.unauthenticatedContext().firestore(),'communityPosts',postId))).data();
 if('poll' in remaining||remaining.text!=='')throw Error('deleted content remained public');
});
