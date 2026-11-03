import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createReaderServer} from './app';
for(const name of ['.env','.env.local'])if(existsSync(name))process.loadEnvFile(name);
const server=createReaderServer(resolve('dist'),process.env.DEEPSEEK_API_KEY||'');
server.listen(5173,'127.0.0.1',()=>{mkdirSync('output',{recursive:true});writeFileSync('output/server.pid',String(process.pid));console.log('笺读轻量服务 http://127.0.0.1:5173');});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
