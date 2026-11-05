import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {join,normalize,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const root=new URL('../dist/',import.meta.url).pathname;
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const local=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/,'');
  const path=normalize(join(root,local));
  if(!path.startsWith(root)){res.writeHead(403).end();return;}
  try{
    const s=await stat(path);
    if(!s.isFile())throw new Error('Not a file');
    const data=await readFile(path);
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(data);
  }catch{
    res.writeHead(404).end('Not found');
  }
});
const success=[];
function assert(condition,name){
  if(!condition)throw Error('E2E FAIL: '+name);
  success.push(name);
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRwwAAAAASUVORK5CYII=','base64');
let browser;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const mobile=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true,serviceWorkers:'allow'});
  const page=await mobile.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Hoje',exact:true}).waitFor({timeout:15000});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile viewport fits');
  await page.getByRole('button',{name:/Iniciar jornada/}).click();
  await page.getByRole('button',{name:/Pausa/}).waitFor();
  assert(true,'start shift');
  await page.getByRole('button',{name:/Pausa/}).click();
  await page.getByRole('button',{name:/Retomar/}).waitFor();
  assert(true,'pause shift');
  await page.getByRole('button',{name:/Retomar/}).click();
  await page.getByRole('button',{name:/Finalizar jornada/}).click();
  await page.getByRole('button',{name:/Iniciar jornada/}).waitFor();
  assert(true,'finish shift');
  await page.locator('nav').getByRole('button',{name:'Problemas'}).click();
  await page.getByRole('button',{name:/Nova ocorrência/}).click();
  await page.locator('input[name=title]').fill('QA E2E <svg onload=alert(1)>');
  await page.locator('textarea[name=description]').fill('Apenas dados sintéticos para QA.');
  await page.locator('input[name=attachments]').setInputFiles({name:'evidence.png',mimeType:'image/png',buffer:png});
  await page.getByRole('button',{name:/Guardar ocorrência/}).click();
  await page.getByText(/QA E2E/).first().waitFor();
  assert(await page.locator('svg[onload]').count()===0,'incident HTML escaped');
  await page.getByText(/QA E2E/).first().click();
  let downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Abrir'}).click();
  let download=await downloadPromise;
  assert(createHash('sha256').update(await readFile(await download.path())).digest('hex')===createHash('sha256').update(png).digest('hex'),'original evidence SHA256');
  await page.locator('[data-action=close]').last().click();
  await page.getByRole('button',{name:'Ajustes'}).click();
  downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Backup completo'}).click();
  download=await downloadPromise;
  const backupBytes=await readFile(await download.path());
  const backup=JSON.parse(backupBytes.toString('utf8'));
  assert(backup.entries.length===2&&backup.files.length===1,'backup includes records and evidence');
  assert(Buffer.from(backup.files[0].data,'base64').equals(png),'backup evidence has original bytes');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await mobile.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Hoje',exact:true}).waitFor({timeout:15000});
  await page.locator('nav').getByRole('button',{name:'Histórico'}).click();
  assert(await page.getByText(/QA E2E/).first().count()===1,'incident available offline');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'history fits viewport');
  assert(errors.length===0,'no browser runtime exceptions');
  await mobile.setOffline(false);
  await mobile.close();

  const desktop=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const large=await desktop.newPage();
  large.on('dialog',d=>d.accept());
  await large.goto(base,{waitUntil:'networkidle'});
  await large.getByRole('button',{name:'Ajustes'}).click();
  await large.locator('#restore-file').setInputFiles({name:'qa-backup.json',mimeType:'application/json',buffer:backupBytes});
  await large.locator('nav').getByRole('button',{name:'Histórico'}).click();
  await large.getByText(/QA E2E/).first().waitFor();
  assert(await large.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'desktop fits viewport');
  assert(true,'backup restored into clean desktop browser');
  await large.getByText(/QA E2E/).first().click();
  downloadPromise=large.waitForEvent('download');
  await large.getByRole('button',{name:'Abrir'}).click();
  download=await downloadPromise;
  assert((await readFile(await download.path())).equals(png),'restored evidence retains bytes');
  assert(download.suggestedFilename()==='evidence.png','restored evidence retains filename');
  await desktop.close();
  console.log(JSON.stringify({result:'PASS',checks:success.length,names:success}));
}catch(e){
  console.error('E2E failure: '+e.stack);
  process.exitCode=1;
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}

