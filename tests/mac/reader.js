// WKWebView.callAsyncJavaScript executes this file as an async function body.
async function until(message, check) {
  for (let i = 0; i < 100; i++) {
    const result = check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw Error(message);
}
function assert(condition, message) { if (!condition) throw Error(message); }

try {
  const doc = await until('sample did not load', () => {
    const content = document.querySelector('.native-reader')?.contentDocument;
    return content?.querySelector('[data-translate]') && content;
  });
  const frame = doc.defaultView;
  assert(doc.querySelector('h1')?.textContent.includes('fNIRS-EEG'), 'wrong paper');
  assert(frame.innerHeight > 200 && frame.innerHeight <= innerHeight &&
    doc.documentElement.scrollHeight > frame.innerHeight * 3, 'unbounded article viewport');

  // Check effective WebKit colors, including the cascade of dark body styles.
  // Temporary cards use real paragraph and caption containers, without API calls.
  const colorHosts = [doc.querySelector('.reader-addon:not(.reader-caption-addon)'),
    ...[...doc.querySelectorAll('.reader-caption-addon')].slice(0, 2)];
  assert(colorHosts.every(Boolean) && colorHosts.length === 3, 'translation color containers missing');
  const colorCards = colorHosts.map(host => {
    const card = doc.createElement('div');
    card.className = 'reader-translation';
    card.innerHTML = '<div class="reader-translation-label">译文</div><div>用于核对颜色的本地测试文字。</div>';
    host.prepend(card);
    return card;
  });
  function luminance(color) {
    const rgb = color.match(/[\d.]+/g).slice(0, 3).map(value => {
      const v = Number(value) / 255;
      return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    });
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  const initialTheme = doc.documentElement.dataset.theme;
  const themeToggle = document.querySelector('[aria-label="切换深色模式"]');
  try {
    for (const theme of ['light', 'dark']) {
      if (doc.documentElement.dataset.theme !== theme) themeToggle.click();
      await until('article theme did not update', () => doc.documentElement.dataset.theme === theme);
      for (const mode of ['bilingual', 'translated']) {
        document.querySelectorAll('.mode-switch button')[mode === 'bilingual' ? 1 : 2].click();
        await until('reading mode did not update', () => doc.body.dataset.mode === mode);
        const body = frame.getComputedStyle(colorCards[0]);
        for (const card of colorCards.slice(1)) {
          const caption = frame.getComputedStyle(card);
          for (const property of ['color', 'backgroundColor', 'borderLeftColor'])
            assert(caption[property] !== body[property], theme + ' caption ' + property + ' matches body');
          const label = frame.getComputedStyle(card.firstElementChild).color;
          assert(label !== frame.getComputedStyle(colorCards[0].firstElementChild).color,
            theme + ' caption label matches body');
          assert(contrast(caption.color, caption.backgroundColor) >= 4.5 &&
            contrast(label, caption.backgroundColor) >= 4.5, theme + ' caption text is hard to read');
        }
      }
    }
  } finally {
    colorCards.forEach(card => card.remove());
    if (doc.documentElement.dataset.theme !== initialTheme) themeToggle.click();
    document.querySelectorAll('.mode-switch button')[1].click();
    await until('reading preferences not restored', () =>
      doc.documentElement.dataset.theme === initialTheme && doc.body.dataset.mode === 'bilingual');
  }

  // The Mac app hides the web header. Both operations must still be reachable.
  document.documentElement.dataset.nativeShell = 'true';
  // The native + invokes the hidden web trigger; it must toggle rather than only focus.
  const importTrigger = document.querySelector('.open-import');
  importTrigger.click();
  const importInput = await until('import panel did not open', () => document.getElementById('arxiv-input'));
  assert(document.activeElement === importInput, 'opening import did not focus the input');
  const draft = 'https://arxiv.org/html/2602.04299v1';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(importInput, draft);
  importInput.dispatchEvent(new Event('input', {bubbles:true}));
  await until('input draft did not update', () => importInput.value === draft);
  importTrigger.click();
  await until('second + did not close import', () => !document.getElementById('paper-import'));
  importTrigger.click();
  await until('reopening lost the import draft', () => document.getElementById('arxiv-input')?.value === draft);
  document.querySelector('.import-close').click();
  await until('close button did not close import or restore visible focus', () =>
    !document.getElementById('paper-import') && document.activeElement?.matches('.mode-switch button'));
  importTrigger.click();
  await until('import did not reopen for Escape', () => document.getElementById('arxiv-input'));
  document.getElementById('arxiv-input').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  await until('Escape did not close import', () => !document.getElementById('paper-import'));
  assert(document.querySelector('.native-reader').contentDocument === doc, 'closing import reloaded the paper');
  const sidebar = document.querySelector('.sidebar');
  const sidebarControl = expanded => [...document.querySelectorAll('button[aria-controls][aria-expanded]')]
    .find(button => button.getAttribute('aria-controls') === sidebar.id &&
      button.getAttribute('aria-expanded') === String(expanded) && button.getClientRects().length);
  const originalWidth = frame.innerWidth;
  const close = sidebarControl(true);
  assert(close, 'visible Mac sidebar collapse button missing');
  close.click();
  const reopen = await until('sidebar did not release its space or cannot be reopened', () =>
    !sidebar.getClientRects().length && frame.innerWidth > originalWidth && sidebarControl(false));
  reopen.click();
  await until('sidebar did not restore the reading layout', () =>
    sidebar.getClientRects().length && frame.innerWidth === originalWidth && sidebarControl(true));
  assert(document.querySelector('.native-reader').contentDocument === doc, 'toggling reloaded the article');
  delete document.documentElement.dataset.nativeShell;

  // Use locally decoded images at publisher dimensions; the test blocks remote CDNs.
  async function useOfflineImage(image, width, height) {
    image.loading = 'eager';
    image.width = width;
    image.height = height;
    image.style.aspectRatio = width + '/' + height;
    image.src = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="100%" height="100%"/></svg>');
    await image.decode();
  }
  const landscape = doc.getElementById('Sx2.F2.g1');
  const portrait = doc.getElementById('Sx1.F1.g1');
  portrait.classList.replace('ltx_img_landscape', 'ltx_img_portrait');
  await Promise.all([useOfflineImage(landscape, 1401, 254), useOfflineImage(portrait, 800, 1200)]);
  const iframe = document.querySelector('.native-reader');
  iframe.style.width = '340px';
  await until('narrow reading viewport not applied', () => frame.innerWidth === 340);
  for (const image of [landscape, portrait]) {
    const bounds = image.getBoundingClientRect();
    const figure = image.closest('figure').getBoundingClientRect();
    assert(bounds.width > 0 && bounds.left >= figure.left - 1 && bounds.right <= figure.right + 1,
      'narrow reading column crops ' + image.id);
    assert(Math.abs(bounds.height - bounds.width * image.naturalHeight / image.naturalWidth) <= 1,
      'resizing distorted ' + image.id);
  }
  const composite = doc.getElementById('Sx4.F12');
  assert(composite.querySelectorAll('figure').length === 7, 'sample subfigures missing');
  assert(composite.scrollWidth <= composite.clientWidth + 1, 'Figure 12 crops its fixed-width panel group');
  portrait.focus();
  portrait.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
  const preview = await until('figure preview did not open from the keyboard', () =>
    doc.querySelector('dialog.reader-figure-preview:modal'));
  const fullImage = preview.querySelector('img');
  await fullImage.decode();
  const fullBounds = fullImage.getBoundingClientRect();
  assert(fullBounds.width > 0 && fullBounds.top >= -1 && fullBounds.left >= -1 &&
    fullBounds.right <= frame.innerWidth + 1 && fullBounds.bottom <= frame.innerHeight + 1,
    'figure preview does not fit the reading viewport');
  preview.querySelector('button').click();
  await until('closing preview retained the image or lost keyboard focus', () =>
    !doc.querySelector('.reader-figure-preview img') && doc.activeElement === portrait);
  iframe.style.removeProperty('width');
  await until('reading viewport was not restored', () => frame.innerWidth === originalWidth);

  const headings = document.querySelectorAll('.sidebar nav button');
  assert(headings.length > 5, 'sample outline missing');
  const middle = headings[Math.floor(headings.length / 2)];
  middle.click();
  await until('chapter did not scroll into view and become active', () =>
    middle.matches('[aria-current=location]') && frame.scrollY > frame.innerHeight);
  const heading = [...doc.querySelectorAll('h2,h3,h4')].find(h => h.textContent.trim() === middle.title);
  assert(heading && Math.abs(heading.getBoundingClientRect().top) < 80, 'wrong chapter on screen');

  const paragraph = doc.querySelector('p[data-reader-block]');
  const range = doc.createRange();
  range.selectNodeContents(paragraph);
  const selection = frame.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  paragraph.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
  await until('selection did not open translation panel', () =>
    document.querySelector('.selection-panel .selected-text')?.textContent === selection.toString().trim());

  const script = doc.createElement('script');
  script.textContent = 'window.inlineScriptRan=true';
  doc.body.append(script);
  const bad = doc.createElement('img');
  bad.setAttribute('onerror', 'window.errorHandlerRan=true');
  const failedImage = new Promise(resolve => bad.addEventListener('error', resolve, {once:true}));
  bad.src = 'data:image/png,invalid';
  doc.body.append(bad);
  await failedImage;
  assert(!frame.inlineScriptRan && !frame.errorHandlerRan, 'article executed inline JavaScript');

  const trigger = document.querySelector('.settings-button');
  trigger.focus();
  trigger.click();
  const modal = await until('settings did not open', () => document.querySelector('dialog:modal'));
  assert(modal.contains(document.activeElement), 'settings focus escaped modal');
  const footer = modal.querySelector('.profile-actions').getBoundingClientRect();
  assert(footer.top > 0 && footer.bottom <= innerHeight, 'settings actions are offscreen');
  modal.dispatchEvent(new Event('cancel', {cancelable:true}));
  await until('settings failed to release focus', () =>
    !document.querySelector('dialog') && document.activeElement === trigger);

  // Switching papers must preserve the user's sidebar tab, including when an
  // import completes asynchronously while the library is open.
  const shelfTab=[...document.querySelectorAll('.shelf-switch button')].find(button=>button.textContent==='我的藏书');
  const directoryTab=[...document.querySelectorAll('.shelf-switch button')].find(button=>button.textContent==='论文目录');
  shelfTab.click();
  await until('library did not open',()=>document.querySelector('.library-open:not(:disabled)'));
  const otherSource='https://www.nature.com/articles/sidebar-switch-test';
  const originalFetch=window.fetch;
  window.fetch=(input,options)=>String(input)==='/paper-nature/articles/sidebar-switch-test'
    ?Promise.resolve(new Response('<meta name="citation_title" content="Sidebar switch test"><div class="c-article-body"><section><h2>Methods</h2><p>A second paper for checking the library view.</p></section></div>'))
    :originalFetch(input,options);
  try{
    importTrigger.click();
    const field=await until('import did not open for second paper',()=>document.getElementById('arxiv-input'));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,otherSource);
    field.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,0));
    field.form.requestSubmit();
    await until('second paper did not open',()=>document.querySelector('.native-reader')?.contentDocument?.querySelector('h1')?.textContent==='Sidebar switch test');
    assert(shelfTab.getAttribute('aria-pressed')==='true'&&document.querySelector('.paper-library'), 'import jumped from library to directory');
    const sample=await until('saved sample not available',()=>document.querySelector('.library-open:not(:disabled)[title="https://arxiv.org/html/2602.04299v1"]'));
    sample.click();
    await until('cached sample did not reopen',()=>document.querySelector('.native-reader')?.contentDocument?.querySelector('h1')?.textContent?.includes('fNIRS-EEG'));
    assert(shelfTab.getAttribute('aria-pressed')==='true'&&document.querySelector('.paper-library'), 'switching a saved paper jumped to directory');
    directoryTab.click();
    await until('manual directory switch failed',()=>directoryTab.getAttribute('aria-pressed')==='true'&&!document.querySelector('.paper-library'));
  }finally{window.fetch=originalFetch;}
  // Exercise the real task queue and footer restore control with a gated,
  // entirely local model stub. This never reads a key or sends an API request.
  shelfTab.click();
  await until('library not ready for task test',()=>document.querySelector('.paper-library'));
  document.querySelector('.settings-button').click();
  const taskSettings=await until('task settings missing',()=>document.querySelector('.settings-dialog:modal'));
  const setInput=async(name,value)=>{
    const field=await until(name+' input missing',()=>taskSettings.querySelector('[name="'+name+'"]'));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);
    field.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,0));
  };
  await setInput('profileName','Offline task fixture');
  const provider=taskSettings.querySelector('[name="provider"]');
  provider.value='llm';provider.dispatchEvent(new Event('change',{bubbles:true}));
  await setInput('endpoint','https://fixture.invalid/v1');
  await setInput('model','fixture-model');await setInput('key','fixture-only');
  let autoReply=false;
  const requests=[];
  const taskFetch=window.fetch;
  window.fetch=(input,options)=>{
    if(String(input)!=='https://fixture.invalid/v1/chat/completions')return taskFetch(input,options);
    const payload=JSON.parse(options.body);
    if(payload.messages[0].content.startsWith('只将 items 数组')){
      const items=JSON.parse(payload.messages.at(-1).content).items;
      return Promise.resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(items.map(item=>({id:item.id,translation:'本地目录 '+item.text})))}}]}),{headers:{'Content-Type':'application/json'}}));
    }
    const reply=()=>new Response(JSON.stringify({choices:[{message:{content:'本地译文 '+payload.messages.at(-1).content}}]}),{headers:{'Content-Type':'application/json'}});
    return new Promise((resolve,reject)=>{
      const request={signal:options.signal,finish:()=>resolve(reply())};requests.push(request);
      options.signal?.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
      if(autoReply)request.finish();
    });
  };
  function taskButton(label){return [...document.querySelectorAll('.translation-taskbar button')].find(button=>button.getAttribute('aria-label')===label||button.textContent===label);}
  function beginCaptions(){const menu=document.querySelector('.translate-menu');menu.value='captions';menu.dispatchEvent(new Event('change',{bubbles:true}));}
  try{
    taskSettings.querySelector('form').requestSubmit();
    await until('fixture profile not saved',()=>!document.querySelector('.settings-dialog'));
    beginCaptions();await until('task did not start',()=>requests.length===1&&taskButton('最小化翻译任务面板'));
    taskButton('最小化翻译任务面板').click();
    await until('task did not minimize',()=>document.querySelector('.taskbar-minimized')&&!document.querySelector('.taskbar-list'));
    assert(!requests[0].signal.aborted,'minimizing aborted the request');
    document.querySelector('.task-status-trigger').click();await until('footer did not restore task',()=>document.querySelector('.taskbar-list'));
    taskButton('关闭翻译任务面板').click();await until('close choices missing',()=>taskButton('隐藏面板，保持后台翻译'));
    taskButton('隐藏面板，保持后台翻译').click();await until('task did not hide',()=>!document.querySelector('.translation-taskbar'));
    assert(!requests[0].signal.aborted,'hiding aborted background translation');
    requests[0].finish();await until('hidden task stopped making progress',()=>requests.length===2);
    document.querySelector('.task-status-trigger').click();await until('hidden task not restored',()=>taskButton('关闭翻译任务面板'));
    taskButton('关闭翻译任务面板').click();await until('pause-and-close missing',()=>taskButton('暂停任务并关闭面板'));
    taskButton('暂停任务并关闭面板').click();await until('pausing task panel not hidden',()=>!document.querySelector('.translation-taskbar'));
    requests[1].finish();await until('task did not pause after saving current item',()=>document.querySelector('.task-status-trigger')?.textContent.includes('已暂停'));
    assert(requests.length===2,'paused task sent another request');
    document.querySelector('.task-status-trigger').click();await until('paused task cannot resume',()=>taskButton('继续'));
    taskButton('继续').click();await until('task did not resume',()=>requests.length===3);
    taskButton('关闭翻译任务面板').click();await until('cancel-and-close missing',()=>taskButton('取消任务并关闭面板'));
    taskButton('取消任务并关闭面板').click();await until('cancellation did not abort in-flight request',()=>requests[2].signal.aborted&&!document.querySelector('.translation-taskbar'));
    document.querySelector('.task-status-trigger').click();await until('cancelled task not shown',()=>document.querySelector('.task-progress')?.textContent.includes('已取消'));
    const translatedCaptions=()=>document.querySelector('.native-reader').contentDocument.querySelectorAll('.reader-caption-addon .reader-translation').length;
    await until('cancelling lost saved caption translations',()=>translatedCaptions()===2);
    taskButton('关闭翻译任务面板').click();await until('cancelled record not dismissed',()=>!document.querySelector('.translation-taskbar')&&!document.querySelector('.task-status-trigger'));
    autoReply=true;beginCaptions();await until('new task did not reopen or finish',()=>document.querySelector('.task-progress')?.textContent.includes('已完成'));
    assert(translatedCaptions()>2,'restarted task did not fill missing captions');
    taskButton('关闭翻译任务面板').click();await until('finished task did not close',()=>!document.querySelector('.translation-taskbar')&&!document.querySelector('.task-status-trigger'));
    assert(translatedCaptions()>2,'closing completed task removed translations');
  }finally{window.fetch=taskFetch;}
  return 'PASS';
} catch (error) { return String(error); }
