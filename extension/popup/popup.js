// Video Drift popup.
(function () {
  'use strict';
  const F = globalThis.VideoDrift;
  const api = F.api;
  const t = (id, subs) => api.i18n.getMessage(id, subs) || id;
  const $ = (id) => document.getElementById(id);

  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const BUTTONS = ['play', 'seek', 'speed', 'volume', 'bookmark', 'link', 'opacity'];
  let tabId = null;
  let st = null;
  let settings = null;
  let library = [];

  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
  document.documentElement.lang = api.i18n.getUILanguage().slice(0, 2);
  $('ver').textContent = 'v' + api.runtime.getManifest().version;

  function send(msg) {
    return new Promise((resolve) => {
      if (tabId == null) return resolve(null);
      api.tabs.sendMessage(tabId, msg, (res) => {
        void api.runtime.lastError;
        resolve(res || null);
      });
    });
  }

  function chips(container, values, fmt, onPick) {
    container.innerHTML = '';
    values.forEach((val) => {
      const b = document.createElement('button');
      b.textContent = fmt(val);
      b.dataset.val = val;
      b.addEventListener('click', () => onPick(val));
      container.appendChild(b);
    });
  }
  function mark(container, val) {
    container.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.val - val) < 0.001));
  }

  function render(s) {
    if (!s || !s.ok) { st = null; $('main').hidden = true; $('empty').hidden = false; $('exportThis').disabled = true; return; }
    st = s;
    $('main').hidden = false;
    $('empty').hidden = true;
    $('exportThis').disabled = !s.bookmarks.length;
    $('title').textContent = s.info.title;
    $('title').title = s.info.title;
    $('time').textContent = F.fmtTime(s.time) + (s.duration ? ' / ' + F.fmtTime(s.duration) : '');
    $('pip').textContent = s.floating ? t('btnUnfloat') : t('btnFloat');
    $('playerMode').textContent = t(s.floating === 'float' ? 'modePage' : s.floating === 'native' ? 'modeNative' : s.floating === 'docpip' ? 'modeWindow' : 'modeReady');
    $('speedOut').textContent = s.rate + '×';
    $('volOut').textContent = Math.round(s.volume * 100) + '%';
    mark($('speeds'), s.rate);
    mark($('volumes'), s.volume);

    const list = $('bms');
    list.innerHTML = '';
    s.bookmarks.forEach((b) => list.appendChild(bookmarkRow({ key: s.key, url: s.info.url }, b, true)));
    $('bmCount').textContent = s.bookmarks.length || '';
    $('bmEmpty').hidden = !!s.bookmarks.length;
  }

  function notice() {
    $('notice').textContent = t('actionFailed');
    $('notice').hidden = false;
  }
  function action(fn) {
    return async (...args) => {
      $('notice').hidden = true;
      try { await fn(...args); } catch (e) { notice(); }
    };
  }
  function button(text, title, fn, cls) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    el.title = title;
    el.setAttribute('aria-label', title);
    if (cls) el.className = cls;
    el.onclick = action(fn);
    return el;
  }
  function openAt(url, time) {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Invalid video URL');
    return api.tabs.create({ url: F.timeLink(u.href, time) });
  }
  async function refresh() {
    await loadLibrary();
    render(await send({ type: 'status' }));
  }
  function bookmarkRow(rec, item, current) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'bookmark-row';
    const id = F.bookmarkId(item);
    const jump = button(F.fmtTime(item.t), t('jumpTo'), async () => {
      if (current) render(await send({ type: 'seek', t: item.t }));
      else await openAt(rec.url, item.t);
    }, 't');
    const note = document.createElement('span');
    note.className = 'n';
    note.textContent = item.note || t('noNote');
    note.title = item.note || '';
    const edit = button('✎', t('editNote'), () => {
      if (li.querySelector('form')) return;
      const form = document.createElement('form');
      form.className = 'note-editor';
      const input = document.createElement('textarea');
      input.value = item.note || '';
      input.rows = 3;
      input.setAttribute('aria-label', t('editNote'));
      const actions = document.createElement('div');
      actions.className = 'row';
      const save = button(t('save'), t('save'), () => {});
      save.type = 'submit';
      save.onclick = null;
      const cancel = button(t('cancel'), t('cancel'), () => { form.remove(); edit.focus(); });
      actions.append(save, cancel);
      form.append(input, actions);
      form.onsubmit = (e) => {
        e.preventDefault();
        save.disabled = true;
        action(async () => {
          try { await F.changeBookmark(rec.key, id, input.value); await refresh(); }
          finally { save.disabled = false; }
        })();
      };
      input.onkeydown = (e) => { if (e.key === 'Escape') { form.remove(); edit.focus(); } };
      li.appendChild(form);
      input.focus();
    }, 'icon');
    const del = button('✕', t('delete'), async () => { await F.changeBookmark(rec.key, id, null); await refresh(); }, 'icon delete');
    row.append(jump, note, edit, del);
    li.appendChild(row);
    return li;
  }
  function site(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }
  async function loadHistory() {
    const positions = await F.allPositions();
    $('historyList').replaceChildren();
    $('historyEmpty').hidden = !!positions.length;
    $('clearHistory').disabled = !positions.length;
    for (const p of positions) {
      const card = document.createElement('article');
      card.className = 'video-card';
      const title = button(p.title || site(p.url), t('continueVideo'), () => openAt(p.url, p.t), 'video-title');
      const meta = document.createElement('p');
      meta.className = 'muted';
      meta.textContent = site(p.url) + ' · ' + F.fmtTime(p.t) + ' / ' + F.fmtTime(p.d);
      const progress = document.createElement('progress');
      progress.max = p.d;
      progress.value = p.t;
      progress.setAttribute('aria-label', t('watchProgress'));
      const actions = document.createElement('div');
      actions.className = 'row';
      actions.append(
        button(t('continueFrom', [F.fmtTime(p.t)]), t('continueVideo'), () => openAt(p.url, p.t), 'continue'),
        button('✕', t('removeHistory'), async () => { await F.clearPosition(p.key); await loadHistory(); }, 'icon delete')
      );
      card.append(title, meta, progress, actions);
      $('historyList').appendChild(card);
    }
  }
  function renderLibrary() {
    const query = $('search').value.trim().toLocaleLowerCase();
    $('libraryList').replaceChildren();
    let count = 0;
    for (const rec of library) {
      const matchesVideo = [rec.title, rec.site, rec.url].some((v) => (v || '').toLocaleLowerCase().includes(query));
      const items = rec.items.filter((b) => matchesVideo || (b.note || '').toLocaleLowerCase().includes(query));
      if (!items.length) continue;
      count++;
      const card = document.createElement('article');
      card.className = 'video-card';
      const title = document.createElement('h2');
      title.textContent = rec.title || site(rec.url);
      const meta = document.createElement('p');
      meta.className = 'muted';
      meta.textContent = site(rec.url) + ' · ' + items.length;
      const list = document.createElement('ul');
      list.className = 'bms library-bms';
      items.forEach((b) => list.appendChild(bookmarkRow(rec, b, false)));
      const exp = button(t('exportThis'), t('exportThis'), () => download('video-drift-' + slug(rec.title) + '.md', F.toMarkdown([rec], rec.title)), 'subtle');
      card.append(title, meta, list, exp);
      $('libraryList').appendChild(card);
    }
    $('libraryEmpty').hidden = !!count;
    $('libraryEmpty').textContent = t(query && library.length ? 'searchEmpty' : 'libraryEmpty');
    $('exportAll').disabled = !library.length;
  }
  async function loadLibrary() {
    library = await F.allBookmarks();
    renderLibrary();
  }
  async function selectView(next) {
    document.querySelectorAll('[data-view]').forEach((tab) => {
      const selected = tab.dataset.view === next;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $('view-' + tab.dataset.view).hidden = !selected;
    });
    if (next === 'history') await loadHistory();
    if (next === 'library') await loadLibrary();
    if (next === 'current') render(await send({ type: 'status' }));
  }
  document.querySelectorAll('[data-view]').forEach((tab, i, tabs) => {
    tab.onclick = action(() => selectView(tab.dataset.view));
    tab.onkeydown = (e) => {
      let index;
      if (e.key === 'ArrowRight') index = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') index = (i + tabs.length - 1) % tabs.length;
      else if (e.key === 'Home') index = 0;
      else if (e.key === 'End') index = tabs.length - 1;
      else return;
      e.preventDefault();
      tabs[index].focus();
      action(() => selectView(tabs[index].dataset.view))();
    };
  });
  $('search').oninput = renderLibrary;
  $('clearHistory').onclick = action(async () => {
    if (!window.confirm(t('confirmClearHistory'))) return;
    await F.clearHistory();
    await loadHistory();
  });

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function slug(s) {
    return (s || 'video').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || 'video';
  }

  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1300);
  }

  chips($('speeds'), SPEEDS, (v) => v + '×', (v) => send({ type: 'speed', value: v }).then(render));
  chips($('volumes'), F.VOLUME_PRESETS, (v) => Math.round(v * 100) + '%', (v) => send({ type: 'volume', value: v }).then(render));

  $('pip').addEventListener('click', action(async () => {
    const r = await send({ type: 'pip' });
    if (r && r.ok) { window.close(); return; }
    $('pipHint').hidden = false;
  }));

  $('copy').addEventListener('click', action(async () => {
    const s = await send({ type: 'status' });
    if (!s || !s.ok) return;
    await navigator.clipboard.writeText(s.link);
    flash($('copy'), t('linkCopied'));
  }));

  $('markBtn').addEventListener('click', action(async () => {
    const note = $('note').value;
    const s = await send({ type: 'bookmark', note });
    if (!s || !s.ok) return;
    $('note').value = '';
    render(s);
    flash($('markBtn'), t('bookmarkSaved', [F.fmtTime(s.time)]));
  }));

  $('exportThis').addEventListener('click', action(async () => {
    if (!st) return;
    const rec = await F.getBookmarks(st.key);
    if (!rec) return;
    download('video-drift-' + slug(rec.title) + '.md', F.toMarkdown([rec], rec.title));
  }));

  $('exportAll').addEventListener('click', action(async () => {
    const all = await F.allBookmarks();
    if (!all.length) { flash($('exportAll'), t('bookmarksEmpty')); return; }
    download('video-drift-bookmarks-' + new Date().toISOString().slice(0, 10) + '.md', F.toMarkdown(all, t('mdHeading')));
  }));

  $('opacity').addEventListener('input', (e) => {
    $('opOut').textContent = e.target.value + '%';
    F.saveSettings({ opacity: +e.target.value }).catch(notice);
  });
  $('autoResume').addEventListener('change', (e) => F.saveSettings({ autoResume: e.target.checked }).catch(notice));
  $('rememberHistory').addEventListener('change', (e) => F.saveSettings({ rememberHistory: e.target.checked }).catch(notice));
  $('hoverButton').addEventListener('change', (e) => F.saveSettings({ hoverButton: e.target.checked }).catch(notice));
  $('pageMode').addEventListener('change', (e) => F.saveSettings({ floatMode: e.target.checked ? 'page' : 'window' }).catch(notice));

  async function init() {
    settings = await F.getSettings();
    $('opacity').value = settings.opacity;
    $('opOut').textContent = settings.opacity + '%';
    $('autoResume').checked = settings.autoResume;
    $('rememberHistory').checked = settings.rememberHistory;
    $('hoverButton').checked = settings.hoverButton;
    $('pageMode').checked = settings.floatMode === 'page';
    const box = $('btnToggles');
    BUTTONS.forEach((k) => {
      const l = document.createElement('label');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = settings.buttons[k] !== false;
      c.addEventListener('change', () => {
        settings.buttons[k] = c.checked;
        F.saveSettings({ buttons: settings.buttons }).catch(notice);
      });
      const s = document.createElement('span');
      s.textContent = t('btnGroup_' + k);
      l.append(c, s);
      box.appendChild(l);
    });

    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    tabId = tab ? tab.id : null;
    render(await send({ type: 'status' }));
    await loadLibrary();
    if (!st && (await F.allPositions()).length) await selectView('history');
    else if (!st && library.length) await selectView('library');
  }
  init().catch(notice);
})();
