import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {importLibrary,listLibrary,listLibrarySummaries,paperWorks,type PaperRecord} from './library';
import {untranslatedBlocks} from './paper';

test('摘要读取保留来源归并、分组和待译计数，不保留正文与译文副本',async()=>{
  const paper={source:'https://arxiv.org/html/9999.11001',id:'9999.11001',title:'A paper',authors:'Author',html:'正文'.repeat(100000),blocks:[
    {id:'a',kind:'paragraph',input:'A',html:'A',text:'A',level:0,tokens:{}},
    {id:'b',kind:'caption',input:'B',html:'B',text:'B',level:0,tokens:{}},
    {id:'blank',kind:'paragraph',input:' ',html:' ',text:'',level:0,tokens:{}}
  ]} as PaperRecord['paper'];
  const record:PaperRecord={source:paper.source,paper,workId:'work',groupId:'g',openedAt:2,results:{a:{html:'译文',type:'api'}}};
  await importLibrary({papers:[record,{...record,source:paper.source+'v2',paper:{...paper,source:paper.source+'v2'},openedAt:1,results:{}}],groups:[{id:'g',name:'分组'}],translations:[]});
  const full=await listLibrary(),summary=await listLibrarySummaries();
  assert.equal(summary.papers.length,2);assert.deepEqual(summary.groups,full.groups);
  assert.equal(summary.papers[0].translated,1);assert.equal(summary.papers[0].remaining,untranslatedBlocks(paper.blocks,record.results).length);
  assert.equal(summary.papers[1].remaining,2);assert.equal('html' in summary.papers[0].paper,false);assert.equal('results' in summary.papers[0],false);
  assert.equal(paperWorks(summary.papers)[0].versions.length,2);assert.ok(JSON.stringify(summary).length<JSON.stringify(full).length/100);
});
