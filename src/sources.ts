import {arxivUrl,fetchArxiv} from './arxiv';
import {frontiersArticle} from './frontiers';

export function paperUrl(input:string){
  const value=input.trim();
  if(!/^https?:\/\//i.test(value))return arxivUrl(value);
  const url=new URL(value);
  if(url.username||url.password||url.port)throw Error('请使用论文网站的标准 HTML 网址。');
  if(['arxiv.org','www.arxiv.org'].includes(url.hostname))return arxivUrl(value);
  if(['nature.com','www.nature.com'].includes(url.hostname)&&/^\/articles\/[a-z\d-]+\/?$/i.test(url.pathname))return 'https://www.nature.com'+url.pathname.replace(/\/$/,'');
  if(url.hostname==='pmc.ncbi.nlm.nih.gov'&&/^\/articles\/PMC\d+\/?$/i.test(url.pathname))return 'https://pmc.ncbi.nlm.nih.gov/articles/'+url.pathname.split('/')[2].toUpperCase()+'/';
  if(['frontiersin.org','www.frontiersin.org'].includes(url.hostname)&&/^\/(?:journals\/[a-z\d-]+\/)?articles\/10\.3389\/[a-z\d.-]+\/(?:full|abstract|pdf)\/?$/i.test(url.pathname))return 'https://www.frontiersin.org'+url.pathname.replace(/\/(?:full|abstract|pdf)\/?$/i,'/full');
  throw Error('支持 arXiv、Nature、PMC 和 Frontiers 的论文全文网址。');
}
export function sourceKind(source:string){return source.includes('frontiersin.org/')?'frontiers':source.includes('nature.com/')?'nature':source.includes('pmc.ncbi.nlm.nih.gov/')?'pmc':'arxiv';}
export function sourceLabel(source:string){return {arxiv:'arXiv',nature:'Nature',pmc:'PMC',frontiers:'Frontiers'}[sourceKind(source)];}
export function paperPdfUrl(source:string){
  const kind=sourceKind(source);
  return kind==='pmc'?undefined:kind==='frontiers'?source.replace(/\/full$/,'/pdf'):kind==='arxiv'?source.replace('/html/','/pdf/'):source+'.pdf';
}
export async function fetchPaper(input:string,signal?:AbortSignal){
  const source=paperUrl(input),kind=sourceKind(source);
  if(kind==='arxiv')return fetchArxiv(source,signal);
  const timeout=signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
  async function load(path:string){
    let response:Response;
    try{response=await fetch('/paper-'+kind+path,{signal:timeout});}catch(error){if(signal?.aborted)throw error;throw Error(`无法连接 ${sourceLabel(source)}，请检查网络后重试。`);}
    if(!response.ok)throw Error(`${sourceLabel(source)} 返回 ${response.status}；请确认论文公开可访问后重试。`);
    return response.text();
  }
  const path=new URL(source).pathname;
  if(kind==='frontiers'){
    // Frontiers' server-rendered HTML leaves some equations empty. Its official
    // JATS XML retains the full text and MathML; the page supplies web image URLs.
    const [page,xml]=await Promise.all([load(path),load(path.replace(/\/full$/,'/xml'))]);
    return {html:frontiersArticle(xml,page,source),source};
  }
  let html=await load(path);
  if(kind==='nature'){
    const doc=new DOMParser().parseFromString(html,'text/html');
    // Nature keeps table cells on separate public table pages.
    await Promise.all([...doc.querySelectorAll('.c-article-table')].map(async container=>{
      const href=container.querySelector('a[data-test="table-link"]')?.getAttribute('href');if(!href)return;
      const url=new URL(href,source);
      if(url.origin!==new URL(source).origin||!url.pathname.startsWith(new URL(source).pathname+'/tables/'))return;
      const tableDoc=new DOMParser().parseFromString(await load(url.pathname),'text/html');
      const table=tableDoc.querySelector('table');if(!table)throw Error('Nature 表格内容加载失败，请稍后重新导入。');
      container.querySelector('figure')?.append(doc.importNode(table,true));
    }));
    html=doc.documentElement.outerHTML;
  }
  return {html,source};
}
