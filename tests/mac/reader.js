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
  return 'PASS';
} catch (error) { return String(error); }
