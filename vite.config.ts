import {defineConfig} from 'vite';
import {execFile} from 'node:child_process';
import {assistantBridge} from './assistant-server';

// These public article hosts require the system network stack on this Windows setup.
// Accept only article/table paths, never a caller-supplied destination or headers.
function articleDownloads(){
  const middleware=(req:any,res:any,next:any)=>{
    const path=String(req.url||'').split('?')[0];
    if(!path.startsWith('/paper-nature/')&&!path.startsWith('/paper-pmc/'))return next();
    const nature=path.match(/^\/paper-nature(\/articles\/[a-z\d-]+(?:\/tables\/\d+)?\/?$)/i);
    const pmc=path.match(/^\/paper-pmc(\/articles\/PMC\d+\/$)/i);
    if(req.method!=='GET'||(!nature&&!pmc)){res.writeHead(400);res.end('不支持的论文路径');return;}
    const url=nature?'https://www.nature.com'+nature[1]:'https://pmc.ncbi.nlm.nih.gov'+pmc![1];
    const child=execFile(process.platform==='win32'?'curl.exe':'curl',['--location','--max-time','50','--fail','--silent','--show-error','--proto','=https','--proto-redir','=https',url],{windowsHide:true,timeout:55000,maxBuffer:20*1024*1024},(error,html)=>{
      if(res.destroyed)return;
      res.writeHead(error?502:200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(error?'论文网站暂时无法访问，请检查网络或稍后重试。':html);
    });
    res.on('close',()=>{if(!child.killed)child.kill();});
  };
  return {name:'public-article-downloads',configureServer(server:any){server.middlewares.use(middleware);},configurePreviewServer(server:any){server.middlewares.use(middleware);}};
}

// The user's local gateway has no CORS preflight handler. Keep this proxy fixed
// to loopback: it must never become an arbitrary remote proxy.
const proxy={
  '/local-anthropic':{
    target:'http://127.0.0.1:7864',
    changeOrigin:true,
    rewrite:(path:string)=>path.replace(/^\/local-anthropic/,''),
  },
};
export default defineConfig({plugins:[articleDownloads(),assistantBridge()],server:{proxy},preview:{proxy}});
