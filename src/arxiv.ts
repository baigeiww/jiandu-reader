export function arxivUrl(input:string):string {
  let id=input.trim();
  if(/^https?:\/\//i.test(id)) {
    const url=new URL(id);
    if(!['arxiv.org','www.arxiv.org'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
      throw Error('请使用 arxiv.org 的论文链接，或直接输入论文编号。');
    }
    const match=url.pathname.match(/^\/(?:html|abs|pdf)\/(.+?)\/?$/);
    if(!match)throw Error('支持 arXiv 的 abs、html、pdf 链接或论文编号。');
    id=match[1].replace(/\.pdf$/i,'');
  }
  if(!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v[1-9]\d*)?$/i.test(id)) {
    throw Error('论文编号格式不正确，例如 2602.04299v1 或 2303.08774。');
  }
  return 'https://arxiv.org/html/'+id;
}

export async function fetchArxiv(input:string,signal?:AbortSignal) {
  const source=arxivUrl(input);
  let response:Response;
  try {response=await fetch(source,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});}
  catch(error) {
    if(signal?.aborted)throw error;
    throw Error('无法连接 arXiv，请检查网络后重试。也可以先使用示例论文。');
  }
  if(response.status===404)throw Error('这篇论文没有可用的 arXiv HTML 版本，或编号不存在。请换一篇论文。');
  if(!response.ok)throw Error(`arXiv 返回 ${response.status}，请稍后重试。`);
  const html=await response.text();
  const resolved=arxivUrl(response.url || source);
  return {html,source:resolved};
}
