export function enableFigurePreview(doc:Document) {
  const sources=new WeakSet<Element>();
  for(const image of doc.querySelectorAll<HTMLImageElement>('figure img[src]:not([usemap])')){
    if(image.closest('a[href],button,figcaption,caption,.ltx_caption,math,.ltx_equation,.disp-formula,[aria-hidden="true"],[hidden]'))continue;
    const caption=image.closest('figure')?.querySelector(':scope > figcaption');
    const name=(caption?.textContent?.trim()||image.alt).replace(/\s+/g,' ').slice(0,120);
    image.setAttribute('role','button');
    image.tabIndex=0;
    image.setAttribute('aria-haspopup','dialog');
    image.setAttribute('aria-label',name?'查看全图 · '+name:'查看全图');
    image.title='查看全图';
    image.classList.add('reader-preview-source');
    sources.add(image);
  }

  let preview:HTMLDialogElement|undefined;
  function open(target:Element){
    if(!sources.has(target)||preview)return false;
    const source=target as HTMLImageElement;
    const dialog=doc.createElement('dialog');
    dialog.className='reader-figure-preview';
    dialog.setAttribute('aria-label','查看全图');

    const header=doc.createElement('header');
    const title=doc.createElement('span');
    title.textContent=source.getAttribute('aria-label');
    const close=doc.createElement('button');
    close.type='button';
    close.textContent='关闭';
    close.addEventListener('click',()=>dialog.close());
    header.append(title,close);
    const image=doc.createElement('img');
    image.alt=source.alt;
    image.src=source.currentSrc||source.src;
    dialog.append(header,image);
    doc.body.append(dialog);
    preview=dialog;
    dialog.addEventListener('close',()=>{
      preview=undefined;
      dialog.remove();
      source.focus({preventScroll:true});
    },{once:true});
    dialog.showModal();
    close.focus({preventScroll:true});
    return true;
  }
  return {open,dispose(){preview?.remove();preview=undefined;}};
}
