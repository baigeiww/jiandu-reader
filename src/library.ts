import {isTranslatable,type parsePaper} from './paper';

export type Paper=ReturnType<typeof parsePaper>;
export type Result={html:string;type:'sample'|'api'|'google'|'assistant'};
export type DirectoryLabels=Record<string,{original:string;translated:string}>;
export type PaperRecord={source:string;paper:Paper;groupId:string;workId?:string;openedAt:number;results:Record<string,Result>;headings?:DirectoryLabels};
export type PaperSummary=Pick<PaperRecord,'source'|'groupId'|'workId'|'openedAt'> & {paper:Pick<Paper,'title'|'id'|'journal'|'doi'>;translated:number;remaining:number};
export function workKey(record:Pick<PaperRecord,'source'|'workId'>){return record.workId||record.source;}
export function paperWorks<T extends Pick<PaperRecord,'source'|'workId'|'groupId'> & {paper:{title:string}}>(papers:T[]){
  const works=new Map<string,T[]>();
  for(const record of papers){const key=workKey(record),versions=works.get(key);if(versions)versions.push(record);else works.set(key,[record]);}
  return [...works.entries()].map(([id,versions])=>({id,versions,groupId:versions[0].groupId,title:versions[0].paper.title}));
}
export type PaperGroup={id:string;name:string};
export type LibrarySnapshot={papers:PaperRecord[];groups:PaperGroup[];translations:[string,Result][]};
type Notes=Pick<PaperRecord,'source'|'results'|'headings'> & {targets:string[]};
type DocumentRow={source:string;paper:Paper;parserVersion?:number};
// Increment when the normalized document or block representation changes.
const parserVersion=2;
const paperStores=['papers','summaries','notes'];
let database:Promise<IDBDatabase>|undefined;

function counts(notes:Notes){
  return {translated:Object.keys(notes.results).length,remaining:notes.targets.reduce((n,id)=>n+Number(!notes.results[id]?.html.trim()),0)};
}
function storeRecord(tx:IDBTransaction,record:PaperRecord,version?:number){
  const {source,paper,results,headings,workId,groupId,openedAt}=record;
  const notes:Notes={source,results,headings,targets:paper.blocks.filter(isTranslatable).map(block=>block.id)};
  const {title,id,journal,doi}=paper;
  tx.objectStore('papers').put({source,paper,parserVersion:version} satisfies DocumentRow);
  tx.objectStore('summaries').put({source,workId,groupId,openedAt,paper:{title,id,journal,doi},...counts(notes)} satisfies PaperSummary);
  tx.objectStore('notes').put(notes);
}
function open(){
  return database??=(new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('reader-library',2);
    request.onupgradeneeded=event=>{
      const db=request.result,tx=request.transaction!;
      if(event.oldVersion===0){
        db.createObjectStore('papers',{keyPath:'source'});
        db.createObjectStore('groups',{keyPath:'id'});
        db.createObjectStore('translations');
      }
      db.createObjectStore('summaries',{keyPath:'source'});
      db.createObjectStore('notes',{keyPath:'source'});
      if(event.oldVersion===1){
        const each=tx.objectStore('papers').openCursor();
        each.onsuccess=()=>{const cursor=each.result;if(cursor){storeRecord(tx,cursor.value);cursor.continue();}};
      }
    };
    request.onblocked=()=>window.dispatchEvent(new Event('reader-library-blocked'));
    request.onsuccess=()=>{
      const db=request.result;
      db.onversionchange=()=>{db.close();database=undefined;};
      resolve(db);
    };
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
function reconstruct(doc:DocumentRow,summary:PaperSummary,notes:Notes):PaperRecord {
  const {source,groupId,workId,openedAt}=summary;
  return {source,paper:doc.paper,groupId,workId,openedAt,results:notes.results,headings:notes.headings};
}
function readRecord(tx:IDBTransaction,source:string,done:(doc:DocumentRow,summary:PaperSummary,notes:Notes)=>void){
  const doc=tx.objectStore('papers').get(source),info=tx.objectStore('summaries').get(source),notes=tx.objectStore('notes').get(source);
  // Requests in this transaction finish in the order they were queued.
  notes.onsuccess=()=>{if(doc.result)done(doc.result,info.result,notes.result);};
}
export function readPaper(source:string){return transaction<PaperRecord|undefined>(paperStores,'readonly',(tx,done)=>{
  readRecord(tx,source,(doc,info,notes)=>done(reconstruct(doc,info,notes)));
});}
export function openSavedPaper(source:string){return transaction<{record:PaperRecord;needsParse:boolean}|undefined>(paperStores,'readonly',(tx,done)=>{
  readRecord(tx,source,(doc,info,notes)=>{
    done({record:reconstruct(doc,info,notes),needsParse:doc.parserVersion!==parserVersion});
  });
});}
export function touchPaper(source:string){return transaction<void>(['summaries'],'readwrite',tx=>{
  const store=tx.objectStore('summaries'),r=store.get(source);
  r.onsuccess=()=>{if(r.result)store.put({...r.result,openedAt:Date.now()});};
});}
export function readNotes(source:string){return transaction<Notes|undefined>(['notes'],'readonly',(tx,done)=>{
  const request=tx.objectStore('notes').get(source);request.onsuccess=()=>done(request.result);
});}
function readLibrary(tx:IDBTransaction,done:(library:{papers:PaperRecord[];groups:PaperGroup[]})=>void){
  const docs=tx.objectStore('papers').getAll(),summaries=tx.objectStore('summaries').getAll(),notes=tx.objectStore('notes').getAll(),groups=tx.objectStore('groups').getAll();
  // All three paper stores have the same keys and IndexedDB returns primary-key order.
  groups.onsuccess=()=>done({papers:docs.result.map((doc,i)=>reconstruct(doc,summaries.result[i],notes.result[i])).sort((a,b)=>b.openedAt-a.openedAt),groups:groups.result});
}
export function listLibrary(){return transaction<{papers:PaperRecord[];groups:PaperGroup[]}>([...paperStores,'groups'],'readonly',readLibrary);}
export function listLibrarySummaries(){return transaction<{papers:PaperSummary[];groups:PaperGroup[]}>(['summaries','groups'],'readonly',(tx,done)=>{
  const info=tx.objectStore('summaries').getAll(),groups=tx.objectStore('groups').getAll();
  groups.onsuccess=()=>done({papers:info.result.sort((a,b)=>b.openedAt-a.openedAt),groups:groups.result});
});}
export function savePaper(paper:Paper){return transaction<void>(paperStores,'readwrite',tx=>{
  const summaries=tx.objectStore('summaries'),info=summaries.get(paper.source),notes=tx.objectStore('notes').get(paper.source);
  const save=(old?:PaperSummary,match?:PaperSummary)=>storeRecord(tx,{
    source:paper.source,paper,workId:old?.workId||(match?workKey(match):paper.source),groupId:old?.groupId??match?.groupId??'',
    openedAt:Date.now(),results:notes.result?.results||{},headings:notes.result?.headings
  },parserVersion);
  notes.onsuccess=()=>{
    if(info.result){save(info.result);return;}
    const all=summaries.getAll();
    const arxivBase=(url:string)=>url.startsWith('https://arxiv.org/html/')?url.replace(/v\d+$/,''):undefined;
    all.onsuccess=()=>save(undefined,all.result.find((p:PaperSummary)=>(paper.doi&&p.paper.doi===paper.doi)||(arxivBase(paper.source)&&arxivBase(p.source)===arxivBase(paper.source))));
  };
});}
export function mergeWorks(from:string,to:string){return transaction<void>(['summaries'],'readwrite',tx=>{
  const store=tx.objectStore('summaries'),request=store.getAll();request.onsuccess=()=>{
    const records=request.result as PaperSummary[],target=records.find(p=>workKey(p)===to);if(!target){tx.abort();return;}
    for(const record of records)if(workKey(record)===from)store.put({...record,workId:to,groupId:target.groupId});
  };
});}
export function detachVersion(source:string){return transaction<void>(['summaries'],'readwrite',tx=>{
  const store=tx.objectStore('summaries'),request=store.getAll();request.onsuccess=()=>{
    const records=request.result as PaperSummary[],record=records.find(p=>p.source===source);if(!record)return;
    const remaining=records.filter(p=>p.source!==source&&workKey(p)===workKey(record));
    for(const member of remaining)store.put({...member,workId:remaining[0].source});
    store.put({...record,workId:source});
  };
});}
export function movePaper(source:string,groupId:string){return transaction<void>(['summaries'],'readwrite',tx=>{
  const store=tx.objectStore('summaries'),r=store.getAll();r.onsuccess=()=>{const records=r.result as PaperSummary[],record=records.find(p=>p.source===source);if(record)for(const member of records)if(workKey(member)===workKey(record))store.put({...member,groupId});};
});}
export function saveDirectory(source:string,headings:DirectoryLabels){return transaction<void>(['notes'],'readwrite',tx=>{
  const store=tx.objectStore('notes'),r=store.get(source);r.onsuccess=()=>{if(r.result)store.put({...r.result,headings:{...r.result.headings,...headings}});};
});}
export function saveGroup(group:PaperGroup){return transaction<void>(['groups'],'readwrite',tx=>{tx.objectStore('groups').put(group);});}
export function deleteGroup(id:string){return transaction<void>(['groups','summaries'],'readwrite',tx=>{
  tx.objectStore('groups').delete(id);const r=tx.objectStore('summaries').openCursor();
  r.onsuccess=()=>{const cursor=r.result;if(!cursor)return;if(cursor.value.groupId===id)cursor.update({...cursor.value,groupId:''});cursor.continue();};
});}
export function readTranslation(key:string){return transaction<Result|undefined>(['translations'],'readonly',(tx,done)=>{const r=tx.objectStore('translations').get(key);r.onsuccess=()=>done(r.result);});}
export function readCachedTranslations(keys:string[]){return transaction<Map<string,Result>>(['translations'],'readonly',(tx,done)=>{
  const hits=new Map<string,Result>();done(hits);
  for(const key of keys){const request=tx.objectStore('translations').get(key);request.onsuccess=()=>{if(request.result)hits.set(key,request.result);};}
});}
type TranslationWrite={id:string;key:string;result:Result};
function writeResults(source:string,items:TranslationWrite[],overwrite:boolean){return transaction<{saved:string[];results:Record<string,Result>}>(['notes','summaries','translations'],'readwrite',(tx,done)=>{
  const notesStore=tx.objectStore('notes'),r=notesStore.get(source),summaries=tx.objectStore('summaries'),info=summaries.get(source);
  info.onsuccess=()=>{
    const notes=r.result as Notes|undefined,saved:string[]=[];
    if(!notes&&!overwrite){tx.abort();return;}
    for(const item of items){
      if(!overwrite&&notes?.results[item.id]?.html.trim())continue;
      tx.objectStore('translations').put(item.result,item.key);
      if(notes){notes.results[item.id]=item.result;saved.push(item.id);}
    }
    if(notes&&saved.length){notesStore.put(notes);summaries.put({...info.result,...counts(notes)});}
    done({saved,results:notes?.results||{}});
  };
});}
export function saveMissingTranslations(source:string,items:TranslationWrite[]){return writeResults(source,items,false);}
export async function saveAssistantTranslations(source:string,items:TranslationWrite[]){return (await saveMissingTranslations(source,items)).saved;}
export async function saveTranslation(source:string,blockId:string,key:string,result:Result){await writeResults(source,[{id:blockId,key,result}],true);}
export function exportLibrary(){return transaction<LibrarySnapshot>([...paperStores,'groups','translations'],'readonly',(tx,done)=>{
  const translations=tx.objectStore('translations').getAll(),keys=tx.objectStore('translations').getAllKeys();
  readLibrary(tx,library=>done({...library,translations:keys.result.map((key,i)=>[String(key),translations.result[i]])}));
});}
export function importLibrary(snapshot:LibrarySnapshot,{parsed=false}={}){return transaction<void>([...paperStores,'groups','translations'],'readwrite',tx=>{
  for(const group of snapshot.groups)tx.objectStore('groups').put(group);
  // Queue each read together with its write so duplicate sources merge in input order.
  let index=0;
  const next=()=>{
    const paper=snapshot.papers[index++];if(!paper)return;
    const request=tx.objectStore('notes').get(paper.source);
    request.onsuccess=()=>{
      storeRecord(tx,{...paper,headings:{...request.result?.headings,...paper.headings},results:{...request.result?.results,...paper.results}},parsed?parserVersion:undefined);
      next();
    };
  };
  next();
  for(const [key,result] of snapshot.translations)tx.objectStore('translations').put(result,key);
});}
export function listGroups(){return transaction<PaperGroup[]>(['groups'],'readonly',(tx,done)=>{
  const request=tx.objectStore('groups').getAll();request.onsuccess=()=>done(request.result);
});}
export function verifyLibraryImport(snapshot:LibrarySnapshot){return transaction<void>([...paperStores,'groups','translations'],'readonly',tx=>{
  // Check the committed rows by key; never deserialize a document during verification.
  for(const group of snapshot.groups){
    const r=tx.objectStore('groups').get(group.id);
    r.onsuccess=()=>{if(r.result?.name!==group.name)tx.abort();};
  }
  const equal=(a:Result|undefined,b:Result)=>a?.type===b.type&&a.html===b.html;
  for(const [key,result] of snapshot.translations){
    const r=tx.objectStore('translations').get(key);
    r.onsuccess=()=>{if(!equal(r.result,result))tx.abort();};
  }
  let i=0;
  function checkNext(){
    const paper=snapshot.papers[i++];if(!paper)return;
    const key=tx.objectStore('papers').getKey(paper.source),summary=tx.objectStore('summaries').get(paper.source),notes=tx.objectStore('notes').get(paper.source);
    notes.onsuccess=()=>{
      const found:Notes|undefined=notes.result;
      if(key.result!==paper.source||summary.result?.groupId!==paper.groupId||summary.result.workId!==paper.workId||!found||
        Object.entries(paper.results).some(([id,value])=>!equal(found.results[id],value))||
        Object.entries(paper.headings||{}).some(([id,h])=>found.headings?.[id]?.original!==h.original||found.headings?.[id]?.translated!==h.translated)){
        tx.abort();return;
      }
      checkNext();
    };
  }
  checkNext();
});}
