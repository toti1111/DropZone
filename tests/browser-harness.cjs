const { chromium } = require('playwright');
const fs = require('node:fs');
const path=require('node:path');
const root=__dirname;
const sourceRoot=path.resolve(root,'..');
const artifactRoot=path.join(root,'artifacts');fs.mkdirSync(artifactRoot,{recursive:true});
const data=[['spots/spotOne',{name:'İzmir Bowl',coords:{lat:38.42,lng:27.14},category:'Urban',types:[],status:'active',desc:'Test spotu',photoUrl:'',locationText:'İzmir',createdAt:Date.now()-1000,userId:'bob',userName:'Bob Rider',comments:[],reports:[]}],['spots/spotTwo',{name:'İstanbul Park',coords:{lat:41.01,lng:28.97},category:'Urban',types:[],status:'active',desc:'İstanbul test spotu',photoUrl:'',locationText:'İstanbul',createdAt:Date.now()-2000,userId:'bob',userName:'Bob Rider',comments:[],reports:[]}],['users/alice',{favorites:[],notifications:[],stance:'Urban'}],['communityPosts/seedPost',{authorId:'bob',authorName:'Bob Rider',text:'Bugün İzmir Bowl’da buluşuyoruz! 🛹',spotId:'spotOne',createdAt:{seconds:Math.floor(Date.now()/1000)-60,nanoseconds:0},deleted:false,likeCount:0,commentCount:0,lastEvent:{type:'post',id:'seedPost',actorId:'bob'}}]];
async function openApp({mobile=false,authenticated=true,seed=data,initialState={},rememberRules=true}={}){
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({seed,authenticated,initialState,rememberRules})=>{if(rememberRules){localStorage.setItem('dropzone:community:rules:v1:alice','accepted');localStorage.setItem('dropzone:community:rules:v1:bob','accepted');}const realNow=Date.now.bind(Date);globalThis.__dzAdvance=0;Date.now=()=>realNow()+globalThis.__dzAdvance;globalThis.__dzMock={data:new Map(seed),listeners:new Set(),writes:[],id:0,user:authenticated?{uid:'alice',displayName:'Alice Rider',photoURL:null,email:'alice@example.test'}:null,...initialState}}, {seed,authenticated,initialState,rememberRules});
 const mock=fs.readFileSync(root+'/firebase-mock.mjs','utf8');
 await page.route('**/*',async route=>{const url=new URL(route.request().url());let file,type;
  if(url.hostname==='dropzone.test'){file=sourceRoot+(url.pathname==='/'?'/index.html':url.pathname);type=url.pathname.endsWith('.json')?'application/json':'text/html'}
  else if(url.hostname==='www.gstatic.com'&&url.pathname.includes('/firebasejs/'))return route.fulfill({body:mock,contentType:'text/javascript'});
  else if(url.hostname==='cdn.tailwindcss.com')return route.fulfill({contentType:'text/javascript',body:`globalThis.tailwind={};const s=document.createElement('style');s.textContent=${JSON.stringify(fs.readFileSync(artifactRoot+'/tailwind.css','utf8'))};document.head.append(s);`});
  else if(url.hostname==='unpkg.com'){const paths={'/leaflet@1.9.4/dist/leaflet.js':'leaflet/dist/leaflet.js','/leaflet@1.9.4/dist/leaflet.css':'leaflet/dist/leaflet.css','/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js':'leaflet.markercluster/dist/leaflet.markercluster.js','/leaflet.markercluster@1.4.1/dist/MarkerCluster.css':'leaflet.markercluster/dist/MarkerCluster.css','/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css':'leaflet.markercluster/dist/MarkerCluster.Default.css'};if(paths[url.pathname]){file=root+'/node_modules/'+paths[url.pathname];type=file.endsWith('.css')?'text/css':'text/javascript'}}
  else if(url.hostname==='cdnjs.cloudflare.com'&&url.pathname.includes('/font-awesome/6.4.0/')){file=root+'/node_modules/@fortawesome/fontawesome-free/'+url.pathname.split('/font-awesome/6.4.0/')[1];type=file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'font/ttf'}
  if(file&&fs.existsSync(file))return route.fulfill({body:fs.readFileSync(file),contentType:type});
  if(route.request().resourceType()==='image')return route.fulfill({body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lmgAAAAASUVORK5CYII=','base64'),contentType:'image/png'});
  if(route.request().resourceType()==='stylesheet')return route.fulfill({body:'',contentType:'text/css'});
  return route.abort();
 });
 await page.goto('http://dropzone.test',{waitUntil:'networkidle'});
 try { await page.waitForFunction(()=>typeof window.openCommunity==='function',null,{timeout:10000}); }
 catch (error) { await browser.close();throw new Error('Application startup did not finish: '+JSON.stringify(errors)); }
 return {browser,page,errors};
}
module.exports={openApp,data};
if(require.main===module)(async()=>{const {browser,page,errors}=await openApp();console.log(JSON.stringify({title:await page.title(),errors,state:await page.evaluate(()=>({leaflet:typeof L,mapControls:document.querySelectorAll('.leaflet-control').length,currentUser:globalThis.__dzMock.user?.uid,auth:document.getElementById('auth-section').innerText}))}));await browser.close();if(errors.length)process.exitCode=1})()
