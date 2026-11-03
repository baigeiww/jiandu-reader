const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'..');
async function main(){
  const target=path.join(root,'笺读.app');
  if(fs.existsSync(target))throw Error('目标应用已存在，请先关闭并移走旧应用再重新打包。');
  const {packager}=await import('../.runtime/desktop-tools/node_modules/@electron/packager/dist/index.js');
  const version=require('../.runtime/desktop-tools/node_modules/electron/package.json').version;
  const zipDir=path.join(root,'.runtime/electron-zips');
  const results=await packager({dir:__dirname,out:path.join(root,'.runtime/desktop-build'),name:'笺读',platform:'darwin',arch:'arm64',
    electronVersion:version,appBundleId:'com.baigeiww.jiandu-reader',appCategoryType:'public.app-category.education',
    asar:true,overwrite:true,ignore:[/build\.cjs$/],
    ...(fs.existsSync(path.join(zipDir,`electron-v${version}-darwin-arm64.zip`))?{electronZipDir:zipDir}:{download:{cacheRoot:path.join(root,'.runtime/electron-cache')}})});
  const source=path.join(results[0],'笺读.app');
  fs.renameSync(source,target);console.log('已创建 '+target);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
