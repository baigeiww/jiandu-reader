import {execFile} from "node:child_process";
export function articleDownloads(){
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
