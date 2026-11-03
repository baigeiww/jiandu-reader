const {app,BrowserWindow,Menu,shell,dialog}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const origin='http://127.0.0.1:5173';
// The .app lives next to the project so moving the entire folder remains supported.
const root=app.isPackaged?path.resolve(path.dirname(process.execPath),'../../..'):path.resolve(__dirname,'..');
let window,ownedServer;
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();
else{
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.whenReady().then(async()=>{
    try{
      let running=false;
      try{const response=await fetch(origin,{signal:AbortSignal.timeout(1000)});running=(await response.text()).includes('笺读');if(!running)throw Error('端口 5173 已被其他程序占用。');}
      catch(error){if(error.message.includes('端口'))throw error;}
      if(!running){
        process.chdir(root);
        const {parseEnv}=require('node:util');
        const local={};for(const name of ['.env','.env.local'])if(fs.existsSync(path.join(root,name)))Object.assign(local,parseEnv(fs.readFileSync(path.join(root,name),'utf8')));
        const {createReaderServer}=require(path.join(root,'dist-server/app.cjs'));
        ownedServer=createReaderServer(path.join(root,'dist'),process.env.DEEPSEEK_API_KEY||local.DEEPSEEK_API_KEY||'');
        await new Promise((resolve,reject)=>{ownedServer.once('error',reject);ownedServer.listen(5173,'127.0.0.1',resolve);});
      }
      app.setName('笺读');
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        {label:'笺读',submenu:[{role:'about'}, {type:'separator'},{role:'hide'},{role:'hideOthers'},{type:'separator'},{role:'quit'}]},
        {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
        {label:'显示',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}]},
        {label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'close'},{role:'front'}]}
      ]));
      const create=()=>{
        window=new BrowserWindow({title:'笺读',width:1320,height:880,minWidth:780,minHeight:600,backgroundColor:'#f4f5f7',show:false,
          titleBarStyle:'hiddenInset',trafficLightPosition:{x:18,y:20},
          webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,spellcheck:false}});
        window.once('ready-to-show',()=>window.show());
        window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
        const external=url=>{try{const parsed=new URL(url);if(['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password)void shell.openExternal(url);}catch{}};
        window.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
        window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin){event.preventDefault();external(url);}});
        window.on('closed',()=>{window=undefined;});
        window.webContents.once('did-finish-load',()=>{
          fs.mkdirSync(path.join(root,'output'),{recursive:true});
          fs.writeFileSync(path.join(root,'output/desktop-ready.json'),JSON.stringify({title:window.getTitle(),url:window.webContents.getURL(),electron:process.versions.electron,readyAt:new Date().toISOString()},null,2));
        });
        void window.loadURL(origin).catch(()=>dialog.showErrorBox('笺读加载失败','本机阅读服务暂时不可用，请退出应用后重新打开。'));
      };
      create();app.on('activate',()=>{if(!window)create();});
    }catch(error){dialog.showErrorBox('笺读启动失败',error.message);app.quit();}
  });
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',()=>{ownedServer?.close();});
}
