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
  return 'PASS';
} catch (error) { return String(error); }
