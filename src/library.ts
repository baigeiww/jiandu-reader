import {untranslatedBlocks,type parsePaper} from './paper';

export type Paper=ReturnType<typeof parsePaper>;
export type Result={html:string;type:'sample'|'api'|'google'|'assistant'};
export type DirectoryLabels=Record<string,{original:string;translated:string}>;
export type PaperRecord={source:string;paper:Paper;groupId:string;workId?:string;openedAt:number;results:Record<string,Result>;headings?:DirectoryLabels};
export type PaperSummary=Pick<PaperRecord,'source'|'groupId'|'workId'|'openedAt'> & {paper:Pick<Paper,'title'|'id'|'journal'>;translated:number;remaining:number};
export function workKey(record:Pick<PaperRecord,'source'|'workId'>){return record.workId||record.source;}
export function paperWorks<T extends Pick<PaperRecord,'source'|'workId'|'groupId'> & {paper:{title:string}}>(papers:T[]){
  const works=new Map<string,T[]>();
  for(const record of papers){const key=workKey(record);works.set(key,[...(works.get(key)||[]),record]);}
  return [...works.entries()].map(([id,versions])=>({id,versions,groupId:versions[0].groupId,title:versions[0].paper.title}));
}
export type PaperGroup={id:string;name:string};
export type LibrarySnapshot={papers:PaperRecord[];groups:PaperGroup[];translations:[string,Result][]};
let database:Promise<IDBDatabase>|undefined;
function open(){
  return database??=(new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('reader-library',1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      db.createObjectStore('papers',{keyPath:'source'});
      db.createObjectStore('groups',{keyPath:'id'});
      db.createObjectStore('translations');
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  })).catch(error=>{database=undefined;throw error;});
}
async function transaction<T>(stores:string[],mode:IDBTransactionMode,run:(tx:IDBTransaction,done:(value:T)=>void)=>void):Promise<T>{
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);let result:T;
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('本地存储操作已取消'));
    try{run(tx,value=>{result=value;});}catch(error){tx.abort();reject(error);}
  });
}
export function readPaper(source:string){return transaction<PaperRecord|undefined>(['papers'],'readonly',(tx,done)=>{const r=tx.objectStore('papers').get(source);r.onsuccess=()=>done(r.result);});}
export function listLibrary(){return transaction<{papers:PaperRecord[];groups:PaperGroup[]}>(['papers','groups'],'readonly',(tx,done)=>{
  const papers=tx.objectStore('papers').getAll(),groups=tx.objectStore('groups').getAll();
  const finish=()=>{if(papers.readyState==='done'&&groups.readyState==='done')done({papers:papers.result.sort((a,b)=>b.openedAt-a.openedAt),groups:groups.result});};
  papers.onsuccess=finish;groups.onsuccess=finish;
});}
// Only one snapshot is materialized at a time; callers retain no full paper HTML.
export function listLibrarySummaries(){return transaction<{papers:PaperSummary[];groups:PaperGroup[]}>(['papers','groups'],'readonly',(tx,done)=>{
  const summaries:PaperSummary[]=[],groups=tx.objectStore('groups').getAll();let finished=false;
  const finish=()=>{if(finished&&groups.readyState==='done')done({papers:summaries.sort((a,b)=>b.openedAt-a.openedAt),groups:groups.result});};
  const request=tx.objectStore('papers').openCursor();
  request.onsuccess=()=>{
    const cursor=request.result;if(!cursor){finished=true;finish();return;}
    const record=cursor.value as PaperRecord;
    summaries.push({source:record.source,groupId:record.groupId,workId:record.workId,openedAt:record.openedAt,
      paper:{title:record.paper.title,id:record.paper.id,journal:record.paper.journal},
      translated:Object.keys(record.results).length,remaining:untranslatedBlocks(record.paper.blocks,record.results).length});
    cursor.continue();
  };
  groups.onsuccess=finish;
});}
export function savePaper(paper:Paper){return transaction<void>(['papers'],'readwrite',tx=>{
  const store=tx.objectStore('papers'),r=store.getAll();
  r.onsuccess=()=>{
    const records=r.result as PaperRecord[],old=records.find(p=>p.source===paper.source);
    const arxivBase=(url:string)=>url.startsWith('https://arxiv.org/html/')?url.replace(/v\d+$/,''):undefined;
    const match=!old?records.find(p=>(paper.doi&&p.paper.doi===paper.doi)||(arxivBase(paper.source)&&arxivBase(p.source)===arxivBase(paper.source))):undefined;
    store.put({...old,source:paper.source,paper,workId:old?.workId||(match?workKey(match):paper.source),groupId:old?.groupId??match?.groupId??'',openedAt:Date.now(),results:old?.results||{}});
  };
});}
export function mergeWorks(from:string,to:string){return transaction<void>(['papers'],'readwrite',tx=>{
  const store=tx.objectStore('papers'),request=store.getAll();request.onsuccess=()=>{
    const records=request.result as PaperRecord[],target=records.find(p=>workKey(p)===to);if(!target){tx.abort();return;}
    for(const record of records)if(workKey(record)===from)store.put({...record,workId:to,groupId:target.groupId});
  };
});}
export function detachVersion(source:string){return transaction<void>(['papers'],'readwrite',tx=>{
  const store=tx.objectStore('papers'),request=store.getAll();request.onsuccess=()=>{
    const records=request.result as PaperRecord[],record=records.find(p=>p.source===source);if(!record)return;
    const remaining=records.filter(p=>p.source!==source&&workKey(p)===workKey(record));
    for(const member of remaining)store.put({...member,workId:remaining[0].source});
    store.put({...record,workId:source});
  };
});}
export function movePaper(source:string,groupId:string){return transaction<void>(['papers'],'readwrite',tx=>{
  const store=tx.objectStore('papers'),r=store.getAll();r.onsuccess=()=>{const records=r.result as PaperRecord[],record=records.find(p=>p.source===source);if(record)for(const member of records)if(workKey(member)===workKey(record))store.put({...member,groupId});};
});}
export function saveDirectory(source:string,headings:DirectoryLabels){return transaction<void>(['papers'],'readwrite',tx=>{
  const store=tx.objectStore('papers'),r=store.get(source);r.onsuccess=()=>{if(r.result)store.put({...r.result,headings:{...r.result.headings,...headings}});};
});}
export function saveGroup(group:PaperGroup){return transaction<void>(['groups'],'readwrite',tx=>{tx.objectStore('groups').put(group);});}
export function deleteGroup(id:string){return transaction<void>(['groups','papers'],'readwrite',tx=>{
  tx.objectStore('groups').delete(id);const r=tx.objectStore('papers').openCursor();
  r.onsuccess=()=>{const cursor=r.result;if(!cursor)return;if(cursor.value.groupId===id)cursor.update({...cursor.value,groupId:''});cursor.continue();};
});}
export function readTranslation(key:string){return transaction<Result|undefined>(['translations'],'readonly',(tx,done)=>{const r=tx.objectStore('translations').get(key);r.onsuccess=()=>done(r.result);});}
export function saveAssistantTranslations(source:string,items:{id:string;key:string;result:Result}[]){return transaction<string[]>(['papers','translations'],'readwrite',(tx,done)=>{
  const store=tx.objectStore('papers'),r=store.get(source);
  r.onsuccess=()=>{
    if(!r.result){tx.abort();return;}
    const record=r.result as PaperRecord,results={...record.results},saved:string[]=[];
    for(const item of items){if(results[item.id]?.html.trim())continue;results[item.id]=item.result;tx.objectStore('translations').put(item.result,item.key);saved.push(item.id);}
    store.put({...record,results});done(saved);
  };
});}
export function saveTranslation(source:string,blockId:string,key:string,result:Result){return transaction<void>(['papers','translations'],'readwrite',tx=>{
  tx.objectStore('translations').put(result,key);
  const store=tx.objectStore('papers'),r=store.get(source);
  r.onsuccess=()=>{if(r.result)store.put({...r.result,results:{...r.result.results,[blockId]:result}});};
});}
export function exportLibrary(){return transaction<LibrarySnapshot>(['papers','groups','translations'],'readonly',(tx,done)=>{
  const papers=tx.objectStore('papers').getAll(),groups=tx.objectStore('groups').getAll(),translations=tx.objectStore('translations').getAll(),keys=tx.objectStore('translations').getAllKeys();
  const finish=()=>{if([papers,groups,translations,keys].every(r=>r.readyState==='done'))done({papers:papers.result,groups:groups.result,translations:keys.result.map((key,i)=>[String(key),translations.result[i]])});};
  papers.onsuccess=finish;groups.onsuccess=finish;translations.onsuccess=finish;keys.onsuccess=finish;
});}
export function importLibrary(snapshot:LibrarySnapshot){return transaction<void>(['papers','groups','translations'],'readwrite',tx=>{
  for(const group of snapshot.groups)tx.objectStore('groups').put(group);
  for(const paper of snapshot.papers){const store=tx.objectStore('papers'),request=store.get(paper.source);request.onsuccess=()=>store.put({...paper,headings:{...request.result?.headings,...paper.headings},results:{...request.result?.results,...paper.results}});}
  for(const [key,result] of snapshot.translations)tx.objectStore('translations').put(result,key);
});}
