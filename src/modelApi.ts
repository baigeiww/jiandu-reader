import type {Settings} from './settings';

export class RateLimitError extends Error {
  constructor(message:string,public retryAfterMs=60000){super(message);this.name='RateLimitError';}
}
export function retryAfterMs(value:string|null,now=Date.now()){
  if(!value)return 60000;
  const seconds=Number(value),delay=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now;
  return Number.isFinite(delay)&&delay>0?delay:60000;
}

export function modelEndpoint(settings:Settings) {
  const url=new URL(settings.endpoint);
  if(!['http:','https:'].includes(url.protocol) || (url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname)))throw Error('翻译接口请使用 HTTPS；本机服务可使用 HTTP。');
  if(url.username||url.password||url.search||url.hash)throw Error('接口地址不应包含用户名、密码、查询参数或锚点。');
  const base=settings.endpoint.replace(/\/+$/,'');
  if(settings.provider!=='anthropic')return base.endsWith('/chat/completions')?base:base+'/chat/completions';
  const endpoint=base.endsWith('/messages')?base:base.endsWith('/v1')?base+'/messages':base+'/v1/messages';
  if(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='7864') {
    return '/local-anthropic'+new URL(endpoint).pathname;
  }
  return endpoint;
}

export async function modelRequest(settings:Settings,system:string,text:string,maxTokens=8192,signal?:AbortSignal) {
  if(!settings.key.trim())throw Error('请先在翻译设置中填写 API Key 或 Token。');
  const anthropic=settings.provider==='anthropic';
  const headers:Record<string,string>={'Content-Type':'application/json','Authorization':`Bearer ${settings.key}`};
  if(anthropic)headers['anthropic-version']='2023-06-01';
  const payload=anthropic?{
    model:settings.model,max_tokens:maxTokens,system,messages:[{role:'user',content:text}],stream:false,
  }:{
    model:settings.model,messages:[{role:'system',content:system},{role:'user',content:text}],temperature:0.2,
  };
  let response:Response;
  try{response=await fetch(modelEndpoint(settings),{method:'POST',headers,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000),body:JSON.stringify(payload)});}
  catch(error){if(error instanceof TypeError)throw Error('无法连接翻译服务，请检查服务是否运行及网络或跨域设置。');throw error;}
  if(!response.ok){
    if(response.status===429||(response.status===503&&response.headers.has('Retry-After')))throw new RateLimitError(`翻译服务返回 ${response.status}（请求受限）。`,retryAfterMs(response.headers.get('Retry-After')));
    let detail='';
    try{const data=await response.json();const message=data.error?.message||data.message||data.detail;if(typeof message==='string')detail=message;}catch{/* Non-JSON gateway errors only expose the HTTP status. */}
    detail=detail.split(settings.key).join('[密钥已隐藏]').replace(/(?:wbk_|sk-)[\w-]+/g,'[密钥已隐藏]').slice(0,500);
    throw Error(`翻译服务返回 ${response.status}${detail?'：'+detail:'，请检查接口、模型名称和密钥是否匹配。'}`);
  }
  const data=await response.json();
  const output=anthropic?(Array.isArray(data.content)?data.content.filter((part:{type:string;text?:string})=>part.type==='text'&&typeof part.text==='string').map((part:{text:string})=>part.text).join(''):undefined):data.choices?.[0]?.message?.content;
  if(typeof output!=='string'||!output.trim())throw Error('服务未返回有效文本，请检查 API 协议和模型配置。');
  if(anthropic&&data.stop_reason==='max_tokens')throw Error('模型输出达到长度限制，请缩短选区后重试。');
  return output;
}
