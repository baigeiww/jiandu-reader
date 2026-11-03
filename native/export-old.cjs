// Run under the old Electron executable with a private COPY of its storage.
const {app,BrowserWindow,protocol}=require('electron');
const fs=require('node:fs');
app.setPath('userData',process.env.READER_PROFILE_COPY);
app.whenReady().then(async()=>{
  protocol.handle('http',()=>new Response('<html></html>',{headers:{'Content-Type':'text/html'}}));
  const w=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
  await w.loadURL('http://127.0.0.1:5173/');
  const script=fs.readFileSync(process.env.READER_BACKUP_SCRIPT,'utf8');
  const snapshot=await w.webContents.executeJavaScript(script+';ReaderTransfer.exportBackup(localStorage)');
  fs.writeFileSync(process.env.READER_SNAPSHOT,JSON.stringify(snapshot),{mode:0o600,flag:'wx'});
  console.log('Exported papers:',snapshot.library.papers.length,'translations:',snapshot.library.papers.reduce((n,p)=>n+Object.keys(p.results).length,0));
  app.quit();
}).catch(()=>app.exit(1));
