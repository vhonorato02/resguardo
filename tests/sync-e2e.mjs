import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,normalize,extname} from 'node:path';
import {chromium} from 'playwright';

const root=new URL('../dist/',import.meta.url).pathname;
const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const site=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  const rel=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname).replace(/^\/+/,'');
  const file=normalize(join(root,rel));
  if(!file.startsWith(root)){res.writeHead(403).end();return;}
  try{const data=await readFile(file);res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'}).end(data);}
  catch{res.writeHead(404).end();}
});
const records=new Map(),objects=new Map(),checks=[];
const ua='00000000-0000-4000-a000-000000000001';
const ub='00000000-0000-4000-a000-000000000002';
const id='00000000-0000-4000-b000-000000000001';
const fileId='00000000-0000-4000-b000-000000000002';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRwwAAAAASUVORK5CYII=','base64');
function test(condition,label){if(!condition)throw Error('QA SYNC: '+label);checks.push(label)}
function response(route,data,status=200){return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})}
async function installMocks(page){
  await page.route('**/rest/v1/resguardo_records**',async route=>{
    const q=new URL(route.request().url()),r=route.request(),method=r.method();
    const account=(r.headers().authorization||'').replace(/^Bearer qa-/,'');
    if(![ua,ub].includes(account))return response(route,{message:'Unauthorized'},401);
    if(method==='GET'){
      return response(route,[...records.values()].filter(item=>item.owner_id===account).map(item=>({id:item.id,payload:item.payload,version:item.version,server_saved_at:item.server_saved_at})));}
    const body=r.postDataJSON();
    if(body.owner_id!==account)return response(route,{message:'Cross-owner'},403);
    if(method==='POST'){
      if(records.has(body.id))return response(route,{message:'duplicate'},409);
      records.set(body.id,{...body,version:1,server_saved_at:new Date().toISOString()});
      return response(route,[{id:body.id,version:1,server_saved_at:new Date().toISOString()}],201);}
    if(method==='PATCH'){
      const expected=Number(q.searchParams.get('version')?.replace('eq.',''));
      const recordId=q.searchParams.get('id')?.replace('eq.','');
      const old=records.get(recordId);
      if(!old||old.owner_id!==account||old.version!==expected)return response(route,[]);
      const next={...old,...body,version:old.version+1,server_saved_at:new Date().toISOString()};
      records.set(recordId,next);
      return response(route,[{id:recordId,version:next.version,server_saved_at:next.server_saved_at}]);}
    return response(route,{message:'invalid'},405);
  });
  await page.route('**/storage/v1/object/**',async route=>{
    const r=route.request(),url=new URL(r.url());
    const account=(r.headers().authorization||'').replace(/^Bearer qa-/,'');
    const key=url.pathname.split('resguardo-evidencias/')[1];
    if(!key||!key.startsWith(account+'/'))return response(route,{message:'denied'},403);
    if(r.method()==='POST'){
      objects.set(key,r.postDataBuffer());
      return response(route,{Key:key},200);}
    if(r.method()==='GET'){
      if(!objects.has(key))return response(route,{message:'not found'},404);
      return route.fulfill({status:200,contentType:'image/png',body:objects.get(key)});}
    return response(route,{},405);
  });
  await page.route('**/auth/v1/user',route=>{
    const account=(route.request().headers().authorization||'').replace(/^Bearer qa-/,'');
    return response(route,{id:account,email:'qa@example.invalid'});
  });
}
async function connect(browser,base,owner){
  const context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();
  await installMocks(page);
  await page.goto(base,{waitUntil:'networkidle'});
  await page.evaluate(async id=>{
    const auth=await import('/src/auth.mjs');
    auth.setSession({access_token:'qa-'+id,refresh_token:'r-'+id,
      expires_at:Math.floor(Date.now()/1000)+3600,user:{id,email:'qa@example.invalid'}});
  },owner);
  return{context,page};
}
async function run(page,fn,args){return page.evaluate(fn,args)}
let browser;
try{
  await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+site.address().port;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const a=await connect(browser,base,ua);
  const first=await run(a.page,async({id,owner})=>{
    const db=await import('/src/idb.mjs');
    const at=new Date().toISOString();
    await db.put('entries',{id,ownerId:owner,type:'incident',at,
      title:'A created',description:'Synthetic QA',attachments:[],updatedAt:at,createdAt:at,syncDirty:true});
    const sync=await import('/src/sync.mjs');await sync.syncNow();
    return db.get('entries',id);
  },{id,owner:ua});
  test(first.remoteVersion===1&&!first.syncDirty,'A record uploaded');
  test(records.get(id)?.version===1,'server revision 1');
  const b=await connect(browser,base,ua);
  const pulled=await run(b.page,async id=>{
    const db=await import('/src/idb.mjs');
    const sync=await import('/src/sync.mjs');const events=[];sync.onSync(e=>events.push(e));await sync.syncNow();
    return {data:await db.get('entries',id),events,user:(await import('/src/auth.mjs')).currentUser()?.id,online:navigator.onLine};
  },id);
  test(pulled?.data?.title==='A created'&&pulled.data.remoteVersion===1,'B pulls A record');
  const second=await run(b.page,async id=>{
    const db=await import('/src/idb.mjs'),sync=await import('/src/sync.mjs');
    const entry=await db.get('entries',id);
    await db.put('entries',{...entry,title:'B edited',syncDirty:true,updatedAt:new Date(Date.now()+1000).toISOString()});
    await sync.syncNow();return db.get('entries',id);
  },id);
  test(second.remoteVersion===2&&!second.syncDirty,'B updates to revision 2');
  const conflict=await run(a.page,async id=>{
    const db=await import('/src/idb.mjs'),sync=await import('/src/sync.mjs');
    const entry=await db.get('entries',id);
    await db.put('entries',{...entry,title:'A stale edit',syncDirty:true,updatedAt:new Date(Date.now()+2000).toISOString()});
    await sync.syncNow();return db.get('entries',id);
  },id);
  test(conflict?.conflict===true&&conflict?.syncDirty===true,'stale edit preserved as conflict');
  test(records.get(id)?.payload?.title==='B edited','remote newer revision not overwritten');
  const other=await connect(browser,base,ub);
  const foreign=await run(other.page,async(id)=>{
    const db=await import('/src/idb.mjs'),sync=await import('/src/sync.mjs');
    await sync.syncNow();return db.get('entries',id);
  },id);
  test(!foreign,'other account cannot pull record');
  const guest=await run(other.page,async()=>{
    const db=await import('/src/idb.mjs'),sync=await import('/src/sync.mjs');
    const id='00000000-0000-4000-b000-000000000099',at=new Date().toISOString();
    await db.put('entries',{id,type:'incident',title:'Guest not claimed',at,description:'Synthetic',updatedAt:at,syncDirty:true,attachments:[]});
    await sync.syncNow();return db.get('entries',id);
  });
  test(guest?.syncDirty===true&&![...records.values()].some(r=>r.id===guest.id),'guest data not auto-imported');
  const attachment=await run(b.page,async({owner,fileId,data})=>{
    const db=await import('/src/idb.mjs'),sync=await import('/src/sync.mjs');
    const id='00000000-0000-4000-b000-000000000003',at=new Date().toISOString();
    const raw=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    await db.put('files',{id:fileId,blob:new Blob([raw],{type:'image/png'}),name:'proof.png',type:'image/png'});
    await db.put('entries',{id,ownerId:owner,type:'incident',at,title:'Evidence',description:'QA',attachments:[{id:fileId,name:'proof.png',type:'image/png'}],createdAt:at,updatedAt:at,syncDirty:true});
    await sync.syncNow();
    return db.get('entries',id);
  },{owner:ua,fileId,data:png.toString('base64')});
  const path=attachment?.attachments?.[0]?.remotePath;
  test(path?.startsWith(ua+'/')&&objects.has(path),'attachment uploaded to owner-scoped storage');
  const receipt=await run(a.page,async path=>{
    const auth=await import('/src/auth.mjs');
    const blob=await auth.storageDownload(path);
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  },path);
  test(Buffer.from(receipt).equals(png),'downloaded remote evidence bytes equal original');
  console.log(JSON.stringify({result:'PASS',count:checks.length,checks}));
  for(const v of [a,b,other])await v.context.close();
}catch(e){console.error('SYNC FAIL '+e.stack);process.exitCode=1;}
finally{if(browser)await browser.close();await new Promise(resolve=>site.close(resolve));}

