import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {listLibrary,listLibrarySummaries,openSavedPaper,paperWorks,readNotes,saveMissingTranslations,savePaper,saveTranslation,readTranslation,type PaperGroup,type PaperRecord} from './library';
import {untranslatedBlocks} from './paper';

function seedLegacy(papers:PaperRecord[],groups:PaperGroup[]){
  return new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open('reader-library',1);
    request.onerror=()=>reject(request.error);
    request.onupgradeneeded=()=>{
      const db=request.result;
      const paperStore=db.createObjectStore('papers',{keyPath:'source'});
      const groupStore=db.createObjectStore('groups',{keyPath:'id'});
      db.createObjectStore('translations').put({html:'旧缓存',type:'api'},'old-key');
      for(const paper of papers)paperStore.put(paper);
      for(const group of groups)groupStore.put(group);
    };
    request.onsuccess=()=>{request.result.close();resolve();};
  });
}

test('v1 论文库升级后保留来源归并、分组、译文和目录，摘要不读取正文',async t=>{
  const paper={source:'https://arxiv.org/html/9999.11001',id:'9999.11001',title:'A paper',authors:'Author',html:'正文'.repeat(100000),blocks:[
    {id:'a',kind:'paragraph',input:'A',html:'A',text:'A',level:0,tokens:{}},
    {id:'b',kind:'caption',input:'B',html:'B',text:'B',level:0,tokens:{}},
    {id:'blank',kind:'paragraph',input:' ',html:' ',text:'',level:0,tokens:{}}
  ]} as PaperRecord['paper'];
  const record:PaperRecord={source:paper.source,paper,workId:'work',groupId:'g',openedAt:2,results:{a:{html:'译文',type:'api'}}};
  record.headings={a:{original:'A',translated:'甲'}};
  await seedLegacy([record,{...record,source:paper.source+'v2',paper:{...paper,source:paper.source+'v2'},openedAt:1,results:{}}],[{id:'g',name:'分组'}]);
  const full=await listLibrary();
  assert.deepEqual(full.papers[0],record);
  assert.deepEqual(await readTranslation('old-key'),{html:'旧缓存',type:'api'});
  assert.equal((await openSavedPaper(paper.source))?.needsParse,true);
  await savePaper(paper);
  assert.equal((await openSavedPaper(paper.source))?.needsParse,false);
  const transactions=t.mock.method(IDBDatabase.prototype,'transaction');
  const summary=await listLibrarySummaries();
  assert.deepEqual(transactions.mock.calls[0].arguments[0],['summaries','groups']);
  assert.equal(summary.papers.length,2);assert.deepEqual(summary.groups,full.groups);
  assert.equal(summary.papers[0].translated,1);assert.equal(summary.papers[0].remaining,untranslatedBlocks(paper.blocks,record.results).length);
  assert.equal(summary.papers[1].remaining,2);assert.equal('html' in summary.papers[0].paper,false);assert.equal('results' in summary.papers[0],false);
  assert.equal(paperWorks(summary.papers)[0].versions.length,2);assert.ok(JSON.stringify(summary).length<JSON.stringify(full).length/100);
  const reads=transactions.mock.callCount();
  const writes=await Promise.all([
    saveMissingTranslations(paper.source,[{id:'a',key:'stale-key',result:{html:'过期缓存',type:'sample'}}]),
    saveTranslation(paper.source,'b','new-key',{html:'图注',type:'api'})
  ]);
  assert.deepEqual(writes[0].saved,[]);
  assert.equal((await readNotes(paper.source))?.results.a.html,'译文');
  const updated=(await listLibrarySummaries()).papers.find(row=>row.source===paper.source)!;
  assert.equal(updated.translated,2);assert.equal(updated.remaining,0);
  for(const call of transactions.mock.calls.slice(reads))assert.ok(!Array.from(call.arguments[0]).includes('papers'));
});
