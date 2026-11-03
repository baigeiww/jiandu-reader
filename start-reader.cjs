const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const url='http://127.0.0.1:5173/';
async function running(){
  try{const response=await fetch(url,{signal:AbortSignal.timeout(1500)});const html=await response.text();if(!html.includes('笺读'))throw Error('端口 5173 已被其他程序占用。');return true;}
  catch(error){if(error.message.includes('端口'))throw error;return false;}
}
async function main(){
  if(!await running()){
    if(!fs.existsSync(path.join(__dirname,'dist/index.html')))throw Error('未找到应用文件，请先运行 npm run build。');
    fs.mkdirSync(path.join(__dirname,'output'),{recursive:true});
    const log=fs.openSync(path.join(__dirname,'output/server.log'),'a');
    if(!fs.existsSync(path.join(__dirname,'dist-server/reader.cjs')))throw Error('未找到本机服务，请先运行 npm run build。');
    const server=spawn(process.execPath,[path.join(__dirname,'dist-server/reader.cjs')],{cwd:__dirname,windowsHide:true,detached:true,stdio:['ignore',log,log]});
    let startupError;server.on('error',error=>{startupError=error;});
    server.unref();fs.closeSync(log);
    let ready=false;
    for(let attempt=0;attempt<25;attempt++){await new Promise(resolve=>setTimeout(resolve,300));if(startupError)throw startupError;if(await running()){ready=true;break;}}
    if(!ready)throw Error('阅读器启动失败，请查看 output/server.log。');
  }
  if(!process.argv.includes('--check')){
    fs.mkdirSync(path.join(__dirname,'output'),{recursive:true});
    const command=process.platform==='darwin'?'/usr/bin/open':process.platform==='win32'?'rundll32.exe':'xdg-open';
    const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
    const browser=spawn(command,args,{windowsHide:true,detached:true,stdio:'ignore'});browser.on('error',error=>{fs.writeFileSync(path.join(__dirname,'output/launch-error.txt'),error.message);});browser.unref();
  }
  console.log('Reader ready: '+url);
}
main().catch(error=>{fs.mkdirSync(path.join(__dirname,'output'),{recursive:true});fs.writeFileSync(path.join(__dirname,'output/launch-error.txt'),error.message);console.error(error.message);process.exitCode=1;});

