import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,type Server} from 'node:http';
import {createReaderServer} from './app';
const listen=(server:Server)=>new Promise<string>(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+(server.address() as {port:number}).port)));
const close=(server:Server)=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});

test('轻量服务支持静态资源、助手、本机配置与固定网关，拒绝源码和越界路径',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'jiandu-server-')),root=join(directory,'dist');
  await mkdir(join(root,'assets'),{recursive:true});await writeFile(join(root,'index.html'),'<title>笺读</title>');await writeFile(join(root,'assets/a.js'),'export {}');await writeFile(join(root,'.env.local'),'secret');
  const gateway=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;assert.equal(req.url,'/v1/messages');assert.equal(req.headers.authorization,'Bearer test');assert.equal(JSON.parse(raw).model,'model');res.writeHead(200,{'Content-Type':'application/json'});res.end('{"content":[{"type":"text","text":"OK"}]}');});
  const upstream=await listen(gateway),server=createReaderServer(root,'private-key',upstream,join(directory,'bridge')),origin=await listen(server);
  try{
    assert.match(await fetch(origin).then(r=>r.text()),/笺读/);
    const asset=await fetch(origin+'/assets/a.js');assert.match(asset.headers.get('cache-control')!,/immutable/);assert.match(asset.headers.get('content-type')!,/javascript/);
    const head=await fetch(origin+'/assets/a.js',{method:'HEAD'});assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),'9');
    assert.equal((await fetch(origin+'/.env.local')).status,403);assert.equal((await fetch(origin+'/..%2f..%2f.env.local')).status,403);assert.equal((await fetch(origin+'/server/main.ts')).status,404);
    assert.equal((await fetch(origin+'/__reader/health').then(r=>r.json())).runtime,'standalone');
    const config=await fetch(origin+'/local-reader-config').then(r=>r.text());assert.equal(config.includes('private-key'),false);assert.equal(JSON.parse(config).enabled,true);
    assert.equal((await fetch(origin+'/paper-nature/arbitrary')).status,400);
    assert.equal((await fetch(origin+'/__assistant/papers')).status,403);
    const bridge=JSON.parse(await readFile(join(directory,'bridge/assistant-bridge.json'),'utf8'));
    assert.deepEqual(await fetch(origin+'/__assistant/papers',{headers:{Authorization:'Bearer '+bridge.token}}).then(r=>r.json()),[]);
    assert.equal((await fetch(origin+'/local-anthropic/v1/messages',{method:'POST',headers:{Origin:'https://untrusted.example'}})).status,403);
    const response=await fetch(origin+'/local-anthropic/v1/messages',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer test'},body:JSON.stringify({model:'model'})});assert.equal(response.status,200);assert.equal((await response.json()).content[0].text,'OK');
  }finally{await close(server);await close(gateway);await rm(directory,{recursive:true,force:true});}
});
