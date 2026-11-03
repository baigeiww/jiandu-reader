import {defineConfig,loadEnv} from 'vite';
import {articleDownloads} from './article-downloads';
import {assistantBridge} from './assistant-server';
import {localDeepSeek} from './local-deepseek';

// These public article hosts require the system network stack on this Windows setup.
// Accept only article/table paths, never a caller-supplied destination or headers.

// The user's local gateway has no CORS preflight handler. Keep this proxy fixed
// to loopback: it must never become an arbitrary remote proxy.
const proxy={
  '/local-anthropic':{
    target:'http://127.0.0.1:7864',
    changeOrigin:true,
    rewrite:(path:string)=>path.replace(/^\/local-anthropic/,''),
  },
};
export default defineConfig(({mode})=>({plugins:[articleDownloads(),assistantBridge(),localDeepSeek(loadEnv(mode,process.cwd(),'DEEPSEEK_').DEEPSEEK_API_KEY||'')],server:{proxy},preview:{proxy}}));

