const state = globalThis.__dzMock ||= {data:new Map(), listeners:new Set(), user:null,writes:[],id:0};
const clone=x=>x===undefined?undefined:structuredClone(x);
export class Timestamp { constructor(seconds,nanoseconds=0){this.seconds=seconds;this.nanoseconds=nanoseconds;} static fromMillis(value){const seconds=Math.floor(value/1000);return new Timestamp(seconds,Math.floor((value-seconds*1000)*1e6));} static now(){return Timestamp.fromMillis(Date.now());} toMillis(){return this.seconds*1000+Math.floor(this.nanoseconds/1e6);} toDate(){return new Date(this.toMillis());} }
const hydrate=x=>{if(x&&typeof x==='object'){if(typeof x.seconds==='number')Object.setPrototypeOf(x,Timestamp.prototype);else for(const k of Object.keys(x))x[k]=hydrate(x[k]);}return x};
const snap=(path)=>({id:path.split('/').at(-1),ref:{path},exists:()=>state.data.has(path),data:()=>hydrate(clone(state.data.get(path)))});
const ref=(base,...parts)=>{const path=[typeof base==='string'?base:base?.path,...parts].filter(Boolean).join('/');return{path,id:path.split('/').at(-1)}};
export const initializeApp=()=>({});
export const getFirestore=()=>({path:''});
export const collection=(base,...parts)=>({...ref(base,...parts),type:'collection'});
export const doc=(base,...parts)=>({...ref(base,...(parts.length?parts:[`mock${++state.id}`])),type:'doc'});
export const orderBy=(field,direction='asc')=>({op:'orderBy',field,direction});
export const where=(field,operator,value)=>({op:'where',field,operator,value});
export const limit=(n)=>({op:'limit',n});
export const startAfter=(snapshot)=>({op:'startAfter',snapshot});
export const documentId=()=> '__name__';
export const query=(base,...clauses)=>({...base,clauses});
function rows(q){let result=[...state.data.keys()].filter(p=>p.startsWith(q.path+'/')&&p.split('/').length===q.path.split('/').length+1).map(snap);for(const c of q.clauses||[]){if(c.op==='where')result=result.filter(s=>s.data()[c.field]===c.value);if(c.op==='orderBy')result.sort((a,b)=>{let x=c.field==='__name__'?a.id:a.data()[c.field],y=c.field==='__name__'?b.id:b.data()[c.field];x=typeof x?.seconds==='number'?x.seconds*1000:x;y=typeof y?.seconds==='number'?y.seconds*1000:y;return ((x>y)-(x<y))*(c.direction==='desc'?-1:1)});if(c.op==='startAfter'){const i=result.findIndex(s=>s.id===c.snapshot.id);if(i>=0)result=result.slice(i+1)}if(c.op==='limit')result=result.slice(0,c.n)}return result}
function snapshot(q){if(q.type==='doc')return snap(q.path);let docs=rows(q);return{docs,size:docs.length,empty:docs.length===0,forEach:cb=>docs.forEach(cb),docChanges:()=>docs.map(doc=>({type:'added',doc}))}}
function emit(){queueMicrotask(()=>{for(const entry of [...state.listeners])entry.cb(snapshot(entry.q))})}
function transformed(value,old){if(value?.__op==='timestamp')return{seconds:Math.floor(Date.now()/1000),nanoseconds:0};if(value?.__op==='increment')return(old||0)+value.value;if(value?.__op==='union')return[...new Set([...(old||[]),...value.values])];if(value?.__op==='remove')return(old||[]).filter(x=>!value.values.includes(x));return clone(value)}
function write(kind,target,values,options){const old=state.data.get(target.path)||{};if(kind==='delete')state.data.delete(target.path);else{const out=kind==='update'||options?.merge?{...old}:{};for(const[k,v]of Object.entries(values)){if(v?.__op==='delete')delete out[k];else out[k]=transformed(v,old[k]);}state.data.set(target.path,out)}state.writes.push({kind,path:target.path,data:clone(values)});}
export const serverTimestamp=()=>({__op:'timestamp'});
export const deleteField=()=>({__op:'delete'});
export const increment=value=>({__op:'increment',value});
export const arrayUnion=(...values)=>({__op:'union',values});
export const arrayRemove=(...values)=>({__op:'remove',values});
export const getDoc=async target=>{(state.reads ||= []).push({method:'getDoc',path:target.path});if(state.failGetDocPaths?.includes(target.path)){const error=new Error('permission-denied');error.code='permission-denied';throw error;}return snap(target.path)};
export const getDocs=async target=>snapshot(target);
export const getCountFromServer=async target=>({data:()=>({count:rows(target).length})});
export const onSnapshot=(q,...callbacks)=>{const cb=typeof callbacks[0]==='function'?callbacks[0]:callbacks[1];const entry={q,cb};state.listeners.add(entry);queueMicrotask(()=>{if(state.listeners.has(entry))cb(snapshot(q))});return()=>state.listeners.delete(entry)};
export const setDoc=async(target,values,options)=>{write('set',target,values,options);emit()};
export const updateDoc=async(target,values)=>{write('update',target,values);emit()};
export const deleteDoc=async target=>{write('delete',target);emit()};
export const addDoc=async(target,values)=>{const child=doc(target);write('set',child,values);emit();return child};
export const runTransaction=async(db,fn)=>{if(state.failNextTransaction){const e=new Error('permission-denied');e.code='permission-denied';state.failNextTransaction=false;throw e;}const writes=[],reads=[];const tx={get:async target=>{reads.push(target.path);(state.reads ||= []).push({method:'transaction',path:target.path});return snap(target.path)},set:(...args)=>writes.push(['set',...args]),update:(...args)=>writes.push(['update',...args]),delete:(...args)=>writes.push(['delete',...args])};const result=await fn(tx);(state.transactions ||= []).push({reads:[...reads],writes:clone(writes)});for(const args of writes)write(...args);emit();return result};
export const writeBatch=()=>{const writes=[];return{set:(...a)=>writes.push(['set',...a]),update:(...a)=>writes.push(['update',...a]),delete:(...a)=>writes.push(['delete',...a]),commit:async()=>{for(const a of writes)write(...a);emit()}}};
export const getAuth=()=>({get currentUser(){return state.user}});
export class GoogleAuthProvider{}
export const onAuthStateChanged=(auth,callback)=>{state.authCallbacks ||= new Set();state.authCallbacks.add(callback);queueMicrotask(()=>callback(state.user));return()=>state.authCallbacks.delete(callback)};
export const signOut=async()=>{state.user=null;[...(state.authCallbacks||[])].forEach(cb=>cb(null))};
export const signInWithPopup=async()=>{state.user={uid:'alice',displayName:'Alice Rider',photoURL:null,email:'alice@example.test'};[...(state.authCallbacks||[])].forEach(cb=>cb(state.user));return{user:state.user}};
