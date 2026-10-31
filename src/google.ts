import {RateLimitError,retryAfterMs} from './modelApi';
export class GoogleQuotaError extends RateLimitError {
  status:number;
  constructor(status:number,delay=60000) {
    super(`Google 免密钥入口返回 ${status}，请求过于密集；请稍后重试，或改用 Google Cloud。`,delay);
    this.name='GoogleQuotaError';
    this.status=status;
  }
}

const SINGLE='https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=';
const BATCH='https://translate.googleapis.com/translate_a/t?client=gtx&sl=en&tl=zh-CN&';
const MAX_TEXT=4500;
const BATCH_BUDGET=5000;
const BATCH_MAX=20;

export async function googleTranslate(text:string, apiKey='',signal?:AbortSignal):Promise<string> {
  const timeout=(ms:number)=>signal?AbortSignal.any([signal,AbortSignal.timeout(ms)]):AbortSignal.timeout(ms);
  if(apiKey) {
    const response=await fetch('https://translation.googleapis.com/language/translate/v2?key='+encodeURIComponent(apiKey),{
      method:'POST',headers:{'Content-Type':'application/json'},signal:timeout(30000),
      body:JSON.stringify({q:text,source:'en',target:'zh-CN',format:'text'})
    });
    if(response.status===429)throw new RateLimitError('Google Cloud 返回 429（请求受限）。',retryAfterMs(response.headers.get('Retry-After')));
    if(!response.ok)throw Error(`Google Cloud 返回 ${response.status}，请检查 API Key、服务启用状态和额度。`);
    const data=await response.json();const output=data.data?.translations?.[0]?.translatedText;
    if(typeof output!=='string'||!output.trim())throw Error('Google Cloud 没有返回有效译文。');
    return output;
  }
  if(text.length>MAX_TEXT)throw Error('本段超过免密钥入口的 Demo 长度限制，请选中较短文本翻译，或使用官方 API。');
  const response=await fetch(SINGLE+encodeURIComponent(text),{signal:timeout(20000)});
  if(response.status===429||response.status===403)throw new GoogleQuotaError(response.status,retryAfterMs(response.headers.get('Retry-After')));
  if(!response.ok)throw Error(`Google 免密钥入口返回 ${response.status}，当前网络可能受限；可稍后重试或改用 Google Cloud。`);
  const data=await response.json();
  if(!Array.isArray(data[0]))throw Error('Google 免密钥入口的响应格式发生变化。');
  const output=data[0].map((part:unknown[])=>typeof part[0]==='string'?part[0]:'').join('');
  if(!output.trim())throw Error('Google 没有返回有效译文。');
  return output;
}

// 免密钥入口对短时间内连续的单条请求很敏感，因此按编码后的长度把段落打包成一次请求。
export function splitBatch(texts:string[], budget=BATCH_BUDGET, max=BATCH_MAX):string[][] {
  const chunks:string[][]=[];
  let current:string[]=[];
  let used=0;
  for(const text of texts) {
    const cost=encodeURIComponent(text).length+3;
    if(current.length&&(used+cost>budget||current.length>=max)) {chunks.push(current);current=[];used=0;}
    current.push(text);used+=cost;
  }
  if(current.length)chunks.push(current);
  return chunks;
}

function readBatch(data:unknown, expected:number):string[]|null {
  if(typeof data==='string')return expected===1?[data]:null;
  if(Array.isArray(data)&&data.length===expected&&data.every(item=>typeof item==='string'))return data as string[];
  return null;
}

export async function googleTranslateBatch(texts:string[]):Promise<string[]> {
  const output:string[]=[];
  for(const chunk of splitBatch(texts)) {
    for(const text of chunk) if(text.length>MAX_TEXT) throw Error('本段超过免密钥入口的 Demo 长度限制，请选中较短文本翻译，或使用官方 API。');
    const url=BATCH+chunk.map(text=>'q='+encodeURIComponent(text)).join('&');
    let values:string[]|null=null;
    try {
      const response=await fetch(url,{signal:AbortSignal.timeout(25000)});
      if(response.status===429||response.status===403) throw new GoogleQuotaError(response.status);
      if(response.ok) values=readBatch(await response.json(),chunk.length);
    } catch(e) {
      if(e instanceof GoogleQuotaError) throw e;
      if(chunk.length===1) throw e;
    }
    // 批量接口格式变化或被限流时，退回逐条请求，保证行为与改动前一致。
    if(!values) {for(const text of chunk) output.push(await googleTranslate(text));continue;}
    output.push(...values);
  }
  return output;
}
