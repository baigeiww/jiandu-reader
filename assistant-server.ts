import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';

// Local conversation bridge. Paper data stays in memory; credentials never enter it.
export function assistantMiddleware(token:string){
  const sessions=new Map<string,{updated:number;papers:unknown[];visible:boolean;protocol:number}>();
  const jobs=new Map<string,any>();
  const waiters=new Map<string,()=>void>();
  const middleware=async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    const url=new URL(req.url||'/', 'http://127.0.0.1');
    if(!url.pathname.startsWith('/__assistant/'))return next();
    const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    const host=req.headers.host||'';
    if(!/^127\.0\.0\.1:\d+$/.test(host)||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')||
      (req.headers.origin&&req.headers.origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'只允许本机阅读器访问'});
    const sync=url.pathname==='/__assistant/sync';
    if(sync&&req.headers.origin!==`http://${host}`)return reply(403,{error:'需要阅读器来源'});
    if(!sync&&req.headers.authorization!==`Bearer ${token}`)return reply(403,{error:'需要本机访问令牌'});
    const now=Date.now();
    for(const [id,value] of sessions)if(now-value.updated>600000)sessions.delete(id);
    for(const [id,value] of jobs)if(now-value.created>1800000)jobs.delete(id);
    try{
      let body:any;
      if(req.method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'需要 JSON'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2*1024*1024)return reply(413,{error:'批次过大'});}
        body=JSON.parse(raw);
      }
      if(sync&&req.method==='POST'){
        if(typeof body.session!=='string'||body.session.length>100||!Array.isArray(body.papers)||!Array.isArray(body.completed))throw Error('无效同步数据');
        sessions.set(body.session,{updated:now,papers:body.papers,visible:body.visible!==false,protocol:body.protocol===2?2:1});
        for(const result of body.completed){const job=jobs.get(result.id);if(job?.session===body.session&&job.status==='pending'){job.status='done';job.result=result;}}
        const pending=()=>[...jobs.values()].filter(j=>j.session===body.session&&j.status==='pending').slice(0,1);
        if(body.protocol!==2||pending().length)return reply(200,{jobs:pending()});
        // The network response wakes background tabs without relying on throttled timers.
        waiters.get(body.session)?.();
        const finish=()=>{clearTimeout(timeout);if(waiters.get(body.session)===finish)waiters.delete(body.session);if(!res.destroyed)reply(200,{jobs:pending()});};
        const timeout=setTimeout(finish,25000);
        waiters.set(body.session,finish);
        res.once('close',()=>{clearTimeout(timeout);if(waiters.get(body.session)===finish)waiters.delete(body.session);});
        return;
      }
      if(url.pathname==='/__assistant/papers'&&req.method==='GET')return reply(200,[...sessions].map(([session,value])=>({session,...value,connected:now-value.updated<75000,ageSeconds:Math.floor((now-value.updated)/1000)})));
      if(url.pathname==='/__assistant/jobs'&&req.method==='POST'){
        if(!sessions.has(body.session))throw Error('请先打开目标浏览器中的阅读器');
        if(!['export','apply'].includes(body.action)||typeof body.source!=='string')throw Error('无效任务');
        if(body.action==='apply'&&body.batch){
          const batch=jobs.get(body.batch);
          if(!batch||batch.action!=='export'||batch.status!=='done'||batch.result?.error||batch.session!==body.session||batch.source!==body.source)throw Error('批次不存在、已过期或属于其他阅读器，请重新导出');
          if(!Array.isArray(body.translations)||!body.translations.length||body.translations.length>20)throw Error('每批回填 1–20 项');
          const seen=new Set<string>();
          body.items=body.translations.map((item:any)=>{
            const original=batch.result.items.find((b:any)=>b.id===item.id);
            if(!original||seen.has(item.id)||typeof item.translation!=='string')throw Error(`无效或重复段落：${item.id}`);
            seen.add(item.id);return {id:item.id,input:original.input,translation:item.translation};
          });
        }
        if(body.action==='apply'&&(!Array.isArray(body.items)||!body.items.length||body.items.length>20))throw Error('每批回填 1–20 项');
        const id=randomUUID();jobs.set(id,{id,session:body.session,action:body.action,source:body.source,items:body.items,limit:Math.min(20,Math.max(1,Number(body.limit)||8)),created:now,status:'pending'});
        waiters.get(body.session)?.();
        return reply(202,{id});
      }
      if(url.pathname.startsWith('/__assistant/jobs/')&&req.method==='GET'){
        const job=jobs.get(url.pathname.split('/').at(-1)!);return reply(job?200:404,job||{error:'任务不存在或已过期'});
      }
      reply(404,{error:'未知入口'});
    }catch(error){reply(400,{error:error instanceof Error?error.message:'请求失败'});}
  };
  return middleware;
}

export function assistantBridge(outputDirectory='output'){
  const token=randomUUID(),middleware=assistantMiddleware(token);
  const install=(server:any)=>{
    server.middlewares.use(middleware);
    server.httpServer?.once('listening',()=>{
      const address=server.httpServer.address();
      if(address&&typeof address==='object'){
        mkdirSync(outputDirectory,{recursive:true});
        writeFileSync(join(outputDirectory,'assistant-bridge.json'),JSON.stringify({url:`http://127.0.0.1:${address.port}/__assistant`,token},null,2));
      }
    });
  };
  return {name:'local-conversation-translation',configureServer:install,configurePreviewServer:install};
}
