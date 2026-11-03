import {readUtf8Body} from './server/request-body';
import type {IncomingMessage,ServerResponse} from 'node:http';

// The real credential stays on this Mac; only this fixed API is reachable.
export function localDeepSeek(apiKey:string,request:typeof fetch=fetch){
  const middleware=async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    const path=(req.url||'').split('?')[0];
    if(path!=='/local-reader-config'&&!path.startsWith('/local-deepseek/'))return next();
    const reply=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    const host=req.headers.host||'';
    if(!/^127\.0\.0\.1:\d+$/.test(host)||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')||
      (req.headers.origin&&req.headers.origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:{message:'只允许本机阅读器访问'}});
    if(path==='/local-reader-config'&&req.method==='GET')return reply(200,{enabled:!!apiKey,model:'deepseek-flash'});
    if(path!=='/local-deepseek/v1/chat/completions'||req.method!=='POST')return reply(404,{error:{message:'未知入口'}});
    if(req.headers.origin!==`http://${host}`||!req.headers['content-type']?.startsWith('application/json'))return reply(403,{error:{message:'需要同源 JSON 请求'}});
    if(!apiKey)return reply(503,{error:{message:'本机尚未配置 DeepSeek Key'}});
    const controller=new AbortController();
    res.once('close',()=>controller.abort());
    try{
      const raw=await readUtf8Body(req,1024*1024);if(raw===undefined)return reply(413,{error:{message:'请求过大'}});
      const body=JSON.parse(raw);
      if(!Array.isArray(body.messages)||typeof body.model!=='string'||body.stream)return reply(400,{error:{message:'需要非流式对话请求'}});
      const upstream=await request('https://api.deepseek.com/v1/chat/completions',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},
        body:raw,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])
      });
      const content=(await upstream.text()).split(apiKey).join('[密钥已隐藏]');
      if(res.destroyed)return;
      res.writeHead(upstream.status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(upstream.headers.has('Retry-After')?{'Retry-After':upstream.headers.get('Retry-After')!}:{})});res.end(content);
    }catch{if(!res.destroyed)reply(502,{error:{message:'DeepSeek 连接失败，请检查网络后重试'}});}
  };
  const install=(server:any)=>{server.middlewares.use(middleware);};
  return {name:'local-deepseek',configureServer:install,configurePreviewServer:install};
}
