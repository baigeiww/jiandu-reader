import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {localDeepSeek} from './local-deepseek';

test('本机 DeepSeek 转发保留真实鉴权，拒绝跨站请求并隐藏密钥',async()=>{
  const secret='private-test-key';let calls=0;
  const plugin=localDeepSeek(secret,(async(url,options)=>{
    calls++;assert.equal(url,'https://api.deepseek.com/v1/chat/completions');
    assert.equal((options!.headers as Record<string,string>).Authorization,'Bearer '+secret);
    return new Response(JSON.stringify({choices:[{message:{content:'译文'}}]}));
  }) as typeof fetch);
  let middleware:any;plugin.configurePreviewServer({middlewares:{use(fn:any){middleware=fn;}}});
  const server=createServer((req,res)=>{void middleware(req,res,()=>{res.writeHead(404);res.end();});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  try{
    const config=await fetch(origin+'/local-reader-config').then(r=>r.text());
    assert.ok(!config.includes(secret));assert.equal(JSON.parse(config).enabled,true);
    const send=(source:string,path='/local-deepseek/v1/chat/completions')=>fetch(origin+path,{method:'POST',headers:{Origin:source,'Content-Type':'application/json',Authorization:'Bearer local-managed'},body:JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'Translate'}]})});
    assert.equal((await send('https://untrusted.example')).status,403);assert.equal(calls,0);
    assert.equal((await send(origin,'/local-deepseek/other')).status,404);assert.equal(calls,0);
    const response=await send(origin);assert.equal(response.status,200);assert.equal(calls,1);
    assert.equal((await response.json()).choices[0].message.content,'译文');
  }finally{await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});}
});
