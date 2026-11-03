// The parent holds stdin open. Losing the window process also stops its service.
const {createReaderServer}=require('./app.cjs');
const fs=require('node:fs');
const path=require('node:path');
const {parseEnv}=require('node:util');
const files={};
for(const name of ['.env','.env.local']){
  if(fs.existsSync(name))Object.assign(files,parseEnv(fs.readFileSync(name,'utf8')));
}
const server=createReaderServer(path.join(__dirname,'dist'),process.env.DEEPSEEK_API_KEY||files.DEEPSEEK_API_KEY||'');
process.stdin.on('end',()=>process.exit(0)).resume();
server.on('error',()=>process.exit(1));
server.listen(5173,'127.0.0.1',()=>console.log('READY'));
