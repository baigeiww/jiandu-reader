import {readUtf8Body} from './request-body';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {createReadStream,realpathSync} from 'node:fs';
import {stat,realpath} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {assistantBridge} from '../assistant-server';
import {localDeepSeek} from '../local-deepseek';
import {articleDownloads} from '../article-downloads';
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
type Middleware=(req:IncomingMessage,res:ServerResponse,next:()=>void)=>unknown;
export function createReaderServer(directory:string,apiKey='',gateway='http://127.0.0.1:7864',bridgeDirectory='output'){
  const root=realpathSync(directory),middlewares:Middleware[]=[];
  const server=createServer((req,res)=>{
    const host=req.headers.host||'';
    if(!/^127\.0\.0\.1:\d+$/.test(host)){res.writeHead(403);res.end();return;}
    let index=0;
    const next=()=>{const fn=middlewares[index++];if(fn)void Promise.resolve(fn(req,res,next)).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});else void serve(req,res);};next();
  });
  const adapter={httpServer:server,middlewares:{use(fn:Middleware){middlewares.push(fn);}}};
  for(const plugin of [articleDownloads(),assistantBridge(bridgeDirectory),localDeepSeek(apiKey)])plugin.configurePreviewServer(adapter);
  async function serve(req:IncomingMessage,res:ServerResponse){
    try{
      const url=new URL(req.url||'/','http://127.0.0.1');
      if(url.pathname==='/__reader/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({runtime:'standalone',pid:process.pid}));return;}
      if(url.pathname.startsWith('/local-anthropic/')){
        if(req.headers.origin!==`http://${req.headers.host}`||req.method!=='POST'||!['/local-anthropic/v1/messages','/local-anthropic/messages'].includes(url.pathname)){res.writeHead(403);res.end();return;}
        const body=await readUtf8Body(req,2*1024*1024);if(body===undefined){res.writeHead(413);res.end();return;}
        const response=await fetch(gateway+url.pathname.replace('/local-anthropic',''),{method:'POST',headers:{'Content-Type':'application/json',Authorization:req.headers.authorization||'','anthropic-version':String(req.headers['anthropic-version']||'2023-06-01')},body,signal:AbortSignal.timeout(90000)});
        const content=await response.text();res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store',...(response.headers.has('Retry-After')?{'Retry-After':response.headers.get('Retry-After')!}:{})});res.end(content);return;
      }
      if(!['GET','HEAD'].includes(req.method||'')){res.writeHead(405);res.end();return;}
      const pathname=decodeURIComponent(url.pathname),file=resolve(root,pathname==='/'?'index.html':'.'+pathname);
      if(!file.startsWith(root+sep)||pathname.split('/').some(part=>part.startsWith('.'))){res.writeHead(403);res.end();return;}
      const actual=await realpath(file);if(!actual.startsWith(root+sep)){res.writeHead(403);res.end();return;}
      const info=await stat(actual);if(!info.isFile()){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':info.size,'X-Content-Type-Options':'nosniff','Cache-Control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
      if(req.method==='HEAD')res.end();else {const stream=createReadStream(actual);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}
    }catch{if(!res.headersSent)res.writeHead(404);res.end();}
  }
  return server;
}
