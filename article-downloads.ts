import {spawn} from 'node:child_process';
import type {IncomingMessage,ServerResponse} from 'node:http';

const maxArticleBytes=20*1024*1024;

function downloadArticle(url:string){
  return spawn(process.platform==='win32'?'curl.exe':'curl',[
      '--location','--max-time','50','--fail','--silent','--proto','=https','--proto-redir','=https',url
    ],{windowsHide:true,timeout:55000,stdio:['ignore','pipe','ignore']});
}

export function articleDownloads(download=downloadArticle){
  const middleware=(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    const path=(req.url||'').split('?')[0];
    if(!path.startsWith('/paper-nature/')&&!path.startsWith('/paper-pmc/'))return next();
    const nature=path.match(/^\/paper-nature(\/articles\/[a-z\d-]+(?:\/tables\/\d+)?\/?)$/i);
    const pmc=path.match(/^\/paper-pmc(\/articles\/PMC\d+\/)$/i);
    if(req.method!=='GET'||(!nature&&!pmc)){res.writeHead(400);res.end('不支持的论文路径');return;}
    const url=nature?'https://www.nature.com'+nature[1]:'https://pmc.ncbi.nlm.nih.gov'+pmc![1];
    const child=download(url);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    function fail(){
      if(res.destroyed||res.writableEnded)return;
      // A partial paper must reject response.text() in the reader.
      if(res.headersSent){res.destroy();return;}
      res.statusCode=502;
      res.end('论文网站暂时无法访问，请检查网络或稍后重试。');
    }
    let bytes=0;
    child.stdout.on('data',(chunk:Buffer)=>{
      if(res.destroyed||res.writableEnded)return;
      bytes+=chunk.length;
      if(bytes>maxArticleBytes){child.kill();fail();return;}
      if(!res.write(chunk))child.stdout.pause();
    });
    res.on('drain',()=>child.stdout.resume());
    res.once('close',()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});
    child.stdout.once('error',fail);
    child.once('error',fail);
    child.once('close',code=>{
      if(code!==0)fail();
      else if(!res.destroyed&&!res.writableEnded)res.end();
    });
  };
  return {name:'public-article-downloads',configureServer(server:any){server.middlewares.use(middleware);},configurePreviewServer(server:any){server.middlewares.use(middleware);}};
}
