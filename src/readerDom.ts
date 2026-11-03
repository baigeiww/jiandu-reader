import {isTranslatable} from './paper';
type Block={id:string;kind:string;input?:string};
type Result={html:string;type:string};
type Entry={addon:HTMLElement;source:HTMLElement;html?:string;type?:string;busy?:boolean;error?:string;importing?:boolean};
export function enableFormulaActions(root:ParentNode){
  root.querySelectorAll('math:not(.technical-literal)').forEach(math=>{
    math.setAttribute('tabindex','0');math.setAttribute('role','button');math.setAttribute('title','点击解释公式');
    math.setAttribute('aria-label','解释公式：'+(math.getAttribute('alttext')||math.textContent||'').slice(0,100));
  });
}
export function createReaderUpdates(doc:Document,blocks:Block[]){
  const authors=doc.querySelector<HTMLElement>('.ltx_authors');
  if(authors&&!authors.closest('.reader-authors')){
    const names=[...authors.querySelectorAll('.ltx_personname')].map(node=>node.textContent?.trim()).filter(Boolean);
    const disclosure=doc.createElement('details');disclosure.className='reader-authors';
    const summary=doc.createElement('summary');summary.textContent=names.length?names.slice(0,3).join(' · ')+(names.length>3?` 等 ${names.length} 位作者`:'')+' · 作者与机构':'作者与机构';
    authors.before(disclosure);disclosure.append(summary,authors);
  }
  const entries=new Map<string,Entry>();
  const existing=new Map([...doc.querySelectorAll<HTMLElement>('[data-reader-addon]')].map(node=>[node.dataset.readerAddon,node]));
  for(const block of blocks){
    const source=doc.getElementById(block.id);if(!source||block.kind==='heading')continue;
    source.setAttribute('data-reader-block',block.id);
    if(!isTranslatable(block))continue;
    const addon=existing.get(block.id)||doc.createElement('div');addon.className='reader-addon'+(block.kind==='caption'?' reader-caption-addon':'');addon.dataset.readerAddon=block.id;
    if(!addon.isConnected)(source.tagName==='CAPTION'?source.closest('table')||source:source).after(addon);
    entries.set(block.id,{addon,source});
  }
  enableFormulaActions(doc);
  return (results:Record<string,Result>,busy:Record<string,boolean>,errors:Record<string,string>,importing:boolean)=>{
    for(const block of blocks){
      const entry=entries.get(block.id);if(!entry)continue;
      const result=results[block.id],html=result?.html,type=result?.type,pending=!!busy[block.id],error=errors[block.id]||'';
      if(entry.html===html&&entry.type===type&&entry.busy===pending&&entry.error===error&&entry.importing===importing)continue;
      const {addon,source}=entry;source.classList.toggle('reader-has-translation',!!result);
      // Busy/error changes update controls without rebuilding the translated MathML.
      if(entry.html!==html||entry.type!==type){
        addon.querySelector('.reader-translation')?.remove();
        if(result){
          const translation=doc.createElement('div');translation.className='reader-translation';
          const label=doc.createElement('div');label.className='reader-translation-label';label.textContent=type==='sample'?'示例译文':type==='google'?'Google 译文':'译文';
          const content=doc.createElement('div');content.innerHTML=result.html;translation.append(label,content);addon.prepend(translation);enableFormulaActions(content);
        }
      }
      let controls=addon.querySelector<HTMLElement>('.reader-controls');
      if(!controls){controls=doc.createElement('div');controls.className='reader-controls';const button=doc.createElement('button');button.dataset.translate=block.id;button.type='button';controls.append(button);addon.append(controls);}
      const button=controls.querySelector('button')!;
      button.textContent=pending?'翻译中…':block.kind==='caption'?(result?'重新翻译说明':'翻译图表说明'):(result?'重新翻译':'翻译此段');button.disabled=pending||importing;
      if(entry.error!==error){addon.querySelector('.reader-error')?.remove();if(error){const node=doc.createElement('div');node.className='reader-error';node.setAttribute('role','alert');node.textContent=error;addon.append(node);}}
      Object.assign(entry,{html,type,busy:pending,error,importing});
    }
  };
}
