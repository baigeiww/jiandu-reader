import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {assistantMiddleware} from './assistant-server';

test('local bridge wakes long polls, restores original batch input and isolates sessions',async()=>{
  const middleware=assistantMiddleware('test-only-token');
  const server=createServer((req,res)=>{void middleware(req,res,()=>{res.writeHead(404);res.end();});});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address() as {port:number};const origin=`http://127.0.0.1:${address.port}`,base=origin+'/__assistant';
  const auth={Authorization:'Bearer test-only-token','Content-Type':'application/json'};
  const call=async(path:string,body?:unknown,headers:Record<string,string>=auth)=>{
    const response=await fetch(base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
    return {status:response.status,body:await response.json() as any};
  };
  const browser={...auth,Origin:origin};
  const sync=(completed:unknown[]=[],protocol=1)=>call('/sync',{session:'tab-1',papers:[{source:'paper-1',remaining:1}],completed,protocol,visible:false},browser);
  try{
    assert.equal((await call('/papers',undefined,{})).status,403);
    assert.equal((await call('/papers',undefined,{...auth,Origin:'https://example.org'})).status,403);
    assert.equal((await call('/sync',{})).status,403);
    await sync();
    const waiting=sync([],2);
    const exported=await call('/jobs',{session:'tab-1',action:'export',source:'paper-1',limit:20});
    assert.equal(exported.status,202);
    assert.equal((await waiting).body.jobs[0].id,exported.body.id);
    const original='Unchanged ⟦P0⟧ input';
    await sync([{id:exported.body.id,items:[{id:'p-1',input:original}],remaining:1}]);
    const apply=await call('/jobs',{session:'tab-1',action:'apply',source:'paper-1',batch:exported.body.id,translations:[{id:'p-1',translation:'译文 ⟦P0⟧'}]});
    assert.equal(apply.status,202);
    const work=(await sync()).body.jobs[0];assert.equal(work.items[0].input,original);assert.equal(work.items[0].translation,'译文 ⟦P0⟧');
    await sync([{id:apply.body.id,saved:1,skipped:0}]);
    assert.equal((await call('/jobs/'+apply.body.id)).body.result.saved,1);
    assert.deepEqual((await sync()).body.jobs,[]);
    const invalid={session:'tab-1',action:'apply',source:'paper-1',batch:exported.body.id,translations:[{id:'wrong',translation:'错项'}]};
    assert.equal((await call('/jobs',invalid)).status,400);
    assert.equal((await call('/jobs',{...invalid,source:'different-paper'})).status,400);
    await call('/sync',{session:'tab-2',papers:[],completed:[]},browser);
    assert.equal((await call('/jobs',{...invalid,session:'tab-2'})).status,400);
    assert.equal((await call('/jobs',{...invalid,translations:[{id:'p-1',translation:'一'},{id:'p-1',translation:'二'}]})).status,400);
    const inventory=(await call('/papers')).body;
    assert.equal(inventory.find((s:any)=>s.session==='tab-1').visible,false);
    assert.equal(inventory.find((s:any)=>s.session==='tab-1').connected,true);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('PowerShell client resumes pending jobs and keeps parallel batches separate',{skip:process.platform!=='win32'},async()=>{
  const middleware=assistantMiddleware('fixture-token');
  const server=createServer((req,res)=>{void middleware(req,res,()=>res.end());});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`,url=origin+'/__assistant';
  const temporary=await mkdtemp(path.join(tmpdir(),'reader-bridge-test-')),bridgeFile=path.join(temporary,'bridge.json');
  const batches:string[]=[];
  await writeFile(bridgeFile,JSON.stringify({url,token:'fixture-token'}));
  const command=async(args:string[])=>{
    const result=await promisify(execFile)('pwsh',['-NoProfile','-File',path.resolve('reader-assistant.ps1'),...args,'-BridgeFile',bridgeFile,'-WaitSeconds','1'],{timeout:15000,windowsHide:true});return result.stdout;
  };
  const sync=async(completed:unknown[]=[])=>{
    const r=await fetch(url+'/sync',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({session:'fixture-browser',papers:[{source:'fixture-paper',remaining:1}],completed})});return await r.json() as any;
  };
  const batchPath=(stdout:string)=>{const value=stdout.match(/Batch: (.+)/)![1].trim();batches.push(value);return value;};
  try{
    await sync();
    const exported=await command(['-Action','export','-Source','fixture-paper']);const batch=batchPath(exported);assert.match(exported,/pending/);
    const job=(await sync()).jobs[0];const input='Original "quoted" text\n公式 ⟦P0⟧';
    await sync([{id:job.id,source:'fixture-paper',items:[{id:'p1',input}],remaining:1}]);
    await command(['-Action','status','-Batch',batch]);
    assert.equal(JSON.parse(await readFile(path.join(batch,'packet.json'),'utf8')).items[0].input,input);
    await writeFile(path.join(batch,'translations.json'),JSON.stringify([{id:'p1',translation:'译文 ⟦P0⟧'}]));
    assert.match(await command(['-Action','apply','-Batch',batch]),/pending/);
    const apply=(await sync()).jobs[0];assert.equal(apply.items[0].input,input);
    await sync([{id:apply.id,saved:1,skipped:0}]);
    await command(['-Action','status','-Batch',batch]);
    assert.equal(JSON.parse(await readFile(path.join(batch,'receipt.json'),'utf8')).saved,1);
    await command(['-Action','apply','-Batch',batch]);assert.deepEqual((await sync()).jobs,[]);
    const parallel=await Promise.all([command(['-Action','export','-Source','fixture-paper']),command(['-Action','export','-Source','fixture-paper'])]);
    assert.notEqual(batchPath(parallel[0]),batchPath(parallel[1]));
  }finally{
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    for(const batch of batches){assert.equal(path.dirname(path.resolve(batch)),path.resolve('output/assistant'));await rm(batch,{recursive:true,force:true});}
    assert.equal(path.dirname(temporary),tmpdir());await rm(temporary,{recursive:true,force:true});
  }
});
