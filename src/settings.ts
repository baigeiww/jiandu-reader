import {TERMS} from './core';

export type Settings={provider:string;endpoint:string;model:string;key:string;glossary:string};
export type ApiProfile=Settings & {id:string;name:string};
export type Configuration={version:1;activeId:string;profiles:ApiProfile[]};
export const CONFIG_KEY='reader-api-profiles';
export const defaults:Settings={provider:'demo',endpoint:'https://api.deepseek.com/v1',model:'deepseek-flash',key:'',glossary:TERMS.map(x=>x.join(' → ')).join('\n')};
type StorageReader=Pick<Storage,'getItem'>;

function validSettings(value:unknown):value is Settings {
  if(!value||typeof value!=='object')return false;
  const settings=value as Record<string,unknown>;
  return ['provider','endpoint','model','key','glossary'].every(field=>typeof settings[field]==='string') && ['demo','google','google-cloud','llm','anthropic'].includes(settings.provider as string);
}

export function readConfiguration(storage:StorageReader):Configuration {
  try {
    const data=JSON.parse(storage.getItem(CONFIG_KEY)||'null');
    if(data?.version===1&&Array.isArray(data.profiles)&&data.profiles.every((p:unknown)=>validSettings(p)&&typeof (p as ApiProfile).id==='string'&&typeof (p as ApiProfile).name==='string')) {
      return {version:1,profiles:data.profiles,activeId:data.profiles.some((p:ApiProfile)=>p.id===data.activeId)?data.activeId:data.profiles[0]?.id||''};
    }
  }catch{/* Corrupt or disabled browser storage must not prevent reading. */}
  try {
    const legacy=JSON.parse(storage.getItem('reader-settings')||'null');
    if(legacy&&typeof legacy==='object') {
      const merged={...defaults,...legacy};
      if(validSettings(merged))return {version:1,activeId:'legacy',profiles:[{...merged,id:'legacy',name:'原有配置'}]};
    }
  }catch{/* Legacy settings are optional. */}
  return {version:1,activeId:'',profiles:[]};
}

export function activeSettings(config:Configuration):Settings {
  const profile=config.profiles.find(p=>p.id===config.activeId);
  if(!profile)return {...defaults};
  const {provider,endpoint,model,key,glossary}=profile;
  return {provider,endpoint,model,key,glossary};
}

export function saveProfile(config:Configuration,profile:ApiProfile):Configuration {
  const existing=config.profiles.some(p=>p.id===profile.id);
  return {version:1,activeId:profile.id,profiles:existing?config.profiles.map(p=>p.id===profile.id?profile:p):[...config.profiles,profile]};
}

export function deleteProfile(config:Configuration,id:string):Configuration {
  const profiles=config.profiles.filter(p=>p.id!==id);
  return {version:1,profiles,activeId:config.activeId===id?profiles[0]?.id||'':config.activeId};
}

export function writeConfiguration(storage:Pick<Storage,'setItem'>,config:Configuration) {
  storage.setItem(CONFIG_KEY,JSON.stringify(config));
}
