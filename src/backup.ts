import {exportLibrary,importLibrary,listGroups,verifyLibraryImport,type LibrarySnapshot,type Result} from './library';
import {CONFIG_KEY,readConfiguration,type Configuration} from './settings';
import {paperUrl} from './sources';
import {parsePaper,clean} from './paper';

type Backup={format:'jiandu-backup';version:1;configuration:Configuration;preferences:Record<string,string>;library:LibrarySnapshot};
const preferences=['reader-last-source','reader-formula-window','reader-sidebar-width','reader-sidebar-collapsed','reader-theme','reader-font-size'];
export async function exportBackup(storage:Storage){
  const library=await exportLibrary();
  const keys=new Set(library.translations.map(([key])=>key));
  for(let i=0;i<storage.length;i++){
    const name=storage.key(i)!;if(!name.startsWith('translation:'))continue;
    try{const result=JSON.parse(storage.getItem(name)!);const key=name.slice(12);if(!keys.has(key)&&isResult(result)){library.translations.push([key,result]);keys.add(key);}}catch{/* Ignore corrupt legacy cache entries. */}
  }
  return {format:'jiandu-backup',version:1,configuration:readConfiguration(storage),preferences:Object.fromEntries(preferences.flatMap(key=>{const value=storage.getItem(key);return value===null?[]:[[key,value]];})),library} satisfies Backup;
}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function isResult(value:unknown):value is Result{return object(value)&&typeof value.html==='string'&&['sample','api','google','assistant'].includes(String(value.type));}
export function validateBackup(value:unknown):Backup{
  if(!object(value)||value.format!=='jiandu-backup'||value.version!==1||!object(value.configuration)||!object(value.preferences)||!object(value.library))throw Error('这不是有效的笺读备份文件。');
  const config=value.configuration;
  const normalized=readConfiguration({getItem:key=>key===CONFIG_KEY?JSON.stringify(config):null});
  if(config.version!==1||!Array.isArray(config.profiles)||normalized.profiles.length!==config.profiles.length||normalized.activeId!==config.activeId)throw Error('备份中的 API 配置不完整。');
  const library=value.library;
  if(!Array.isArray(library.papers)||!Array.isArray(library.groups)||!Array.isArray(library.translations))throw Error('备份中的论文记录不完整。');
  const groups=library.groups;
  for(const group of groups)if(!object(group)||typeof group.id!=='string'||!group.id||typeof group.name!=='string')throw Error('备份中的分组无效。');
  const safeResult=(result:Result):Result=>({...result,html:clean(result.html)});
  const papers=library.papers.map(record=>{
    if(!object(record)||typeof record.source!=='string'||paperUrl(record.source)!==record.source||!object(record.paper)||typeof record.paper.html!=='string'||typeof record.groupId!=='string'||typeof record.openedAt!=='number'||!Number.isFinite(record.openedAt)||!object(record.results)||!Object.values(record.results).every(isResult))throw Error('备份中的论文或译文无效。');
    if(record.groupId&&!groups.some(g=>g.id===record.groupId))throw Error('备份中的论文缺少对应分组。');
    if(record.headings!==undefined&&(!object(record.headings)||!Object.values(record.headings).every(value=>object(value)&&typeof value.original==='string'&&typeof value.translated==='string')))throw Error('备份中的中文目录无效。');
    return {source:record.source,paper:parsePaper(record.paper.html,record.source),workId:typeof record.workId==='string'?record.workId:undefined,groupId:record.groupId,openedAt:record.openedAt,headings:record.headings as LibrarySnapshot['papers'][number]['headings'],results:Object.fromEntries(Object.entries(record.results).map(([key,result])=>[key,safeResult(result as Result)]))};
  });
  const translations:[string,Result][]=library.translations.map(entry=>{if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||!isResult(entry[1]))throw Error('备份中的翻译缓存无效。');return [entry[0],safeResult(entry[1])];});
  const prefs:Record<string,string>={};for(const key of preferences)if(typeof value.preferences[key]==='string')prefs[key]=value.preferences[key];
  if(prefs['reader-last-source'])prefs['reader-last-source']=paperUrl(prefs['reader-last-source']);
  return {format:'jiandu-backup',version:1,configuration:normalized,preferences:prefs,library:{papers,groups:groups.map(group=>({id:group.id,name:group.name})),translations}};
}
export async function importBackup(value:unknown,storage:Storage){
  const backup=validateBackup(value),groups=await listGroups(),current=readConfiguration(storage);
  // Keep unrelated destination data, remapping identifiers on genuine conflicts.
  const groupIds=new Map<string,string>();
  for(const group of backup.library.groups){const match=groups.find(g=>g.id===group.id);if(match&&match.name!==group.name){const old=group.id;group.id=crypto.randomUUID();groupIds.set(old,group.id);}}
  backup.library.papers.forEach(p=>{p.groupId=groupIds.get(p.groupId)||p.groupId;});
  for(const profile of backup.configuration.profiles){const match=current.profiles.find(p=>p.id===profile.id);if(match&&JSON.stringify(match)!==JSON.stringify(profile)){const old=profile.id;profile.id=crypto.randomUUID();if(backup.configuration.activeId===old)backup.configuration.activeId=profile.id;}}
  const merged:Configuration={version:1,activeId:backup.configuration.activeId||current.activeId,profiles:[...current.profiles.filter(p=>!backup.configuration.profiles.some(incoming=>p.id===incoming.id)),...backup.configuration.profiles]};
  const writes:Record<string,string>={[CONFIG_KEY]:JSON.stringify(merged),...backup.preferences};
  const before=Object.fromEntries(Object.keys(writes).map(key=>[key,storage.getItem(key)]));
  try{
    for(const [key,value] of Object.entries(writes))storage.setItem(key,value);
    await importLibrary(backup.library,{parsed:true});
  }catch(error){for(const [key,value] of Object.entries(before)){if(value===null)storage.removeItem(key);else storage.setItem(key,value);}throw error;}
  try{await verifyLibraryImport(backup.library);}catch{throw Error('论文、分组或译文保存核对失败，请保留备份后重试。');}
  const savedConfig=readConfiguration(storage);
  if(backup.configuration.profiles.some(profile=>JSON.stringify(savedConfig.profiles.find(p=>p.id===profile.id))!==JSON.stringify(profile)))throw Error('API 配置保存核对失败，请保留备份后重试。');
  if(Object.entries(backup.preferences).some(([key,value])=>storage.getItem(key)!==value))throw Error('阅读偏好保存核对失败，请保留备份后重试。');
  const report={profiles:backup.configuration.profiles.length,groups:backup.library.groups.length,papers:backup.library.papers.length,paragraphs:backup.library.papers.reduce((sum,p)=>sum+Object.keys(p.results).length,0),cacheEntries:backup.library.translations.length};
  storage.setItem('reader-import-report',JSON.stringify(report));return report;
}
