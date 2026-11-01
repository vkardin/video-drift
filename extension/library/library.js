(function () {
  'use strict';
  const F = globalThis.VideoDrift, api = F.api;
  const $ = (id) => document.getElementById(id), t = (id) => api.i18n.getMessage(id) || id;
  let kind = 'history', undo = null;
  document.querySelectorAll('[data-i18n]').forEach((e) => e.textContent = t(e.dataset.i18n));
  $('search').placeholder = t('searchBookmarks');
  $('search').setAttribute('aria-label', t('searchBookmarks'));
  $('site').setAttribute('aria-label', t('allSites'));
  document.documentElement.lang = api.i18n.getUILanguage().slice(0,2);
  function run(fn) { return async () => { try { $('notice').textContent = ''; await fn(); } catch { $('notice').textContent = t('actionFailed'); } }; }
  function btn(text, fn) { const b = document.createElement('button'); b.textContent = text; b.onclick = run(fn); return b; }
  function link(title, url, sec) {
    const a = document.createElement('a');
    const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Invalid URL');
    a.href = F.timeLink(url, sec || 0); a.textContent = title || u.hostname; a.target = '_blank'; a.rel = 'noopener'; return a;
  }
  function download(name, data) {
    const u = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  }
  async function remove(fn) { undo = await F.exportBackup(); await fn(); $('undo').hidden = false; await render(); }
  async function render() {
    const rows = kind === 'history' ? await F.allPositions() : kind === 'later' ? await F.laterVideos() : await F.allBookmarks();
    const chosen = $('site').value, sites = [...new Set(rows.map((r) => new URL(r.url).hostname))].sort();
    $('site').replaceChildren();
    for (const host of ['', ...sites]) { const o = document.createElement('option'); o.value = host; o.textContent = host || t('allSites'); $('site').append(o); }
    $('site').value = sites.includes(chosen) ? chosen : '';
    const q = $('search').value.trim().toLocaleLowerCase(); $('list').replaceChildren();
    document.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.kind === kind));
    for (const r of rows) {
      if ($('site').value && new URL(r.url).hostname !== $('site').value) continue;
      const match = (r.title + ' ' + r.url).toLocaleLowerCase().includes(q);
      const items = (r.items || []).filter((b) => match || b.note.toLocaleLowerCase().includes(q));
      if (!match && !items.length) continue;
      const card = document.createElement('article'); card.className = 'video-card';
      card.append(link(r.title, r.url, r.t));
      const meta = document.createElement('p'); meta.className = 'muted'; meta.textContent = new URL(r.url).hostname; card.append(meta);
      if (kind === 'history') {
        const p = document.createElement('progress'); p.max = r.d; p.value = r.t; card.append(p, link(F.fmtTime(r.t) + ' / ' + F.fmtTime(r.d), r.url, r.t));
      }
      for (const item of items) {
        const box = document.createElement('div'); box.className = 'bookmark';
        const note = document.createElement('textarea'); note.value = item.note; note.setAttribute('aria-label', t('editNote')); note.rows = 3;
        box.append(link(F.fmtTime(item.t), r.url, item.t), note,
          btn(t('save'), async () => { await F.changeBookmark(r.key, F.bookmarkId(item), note.value); await render(); }),
          btn(t('delete'), () => remove(() => F.changeBookmark(r.key, F.bookmarkId(item), null)))); card.append(box);
      }
      if (kind !== 'bookmarks') card.append(btn(t('delete'), () => remove(() => kind === 'history' ? F.clearPosition(r.key) : F.removeLater(r.url))));
      if (kind === 'bookmarks') card.append(btn(t('exportThis'), () => download('video-drift-notes.md', F.toMarkdown([r], r.title))));
      $('list').append(card);
    }
    $('empty').hidden = !!$('list').children.length;
  }
  document.querySelectorAll('[data-kind]').forEach((b) => b.onclick = run(async () => { kind = b.dataset.kind; $('site').value = ''; await render(); }));
  $('search').oninput = run(render); $('site').onchange = run(render);
  $('undo').onclick = run(async () => { if (undo) await F.importBackup(undo); undo = null; $('undo').hidden = true; await render(); });
  $('backup').onclick = run(async () => download('video-drift-backup.json', JSON.stringify(await F.exportBackup(), null, 2)));
  $('restore').onclick = () => $('file').click();
  $('file').onchange = run(async () => {
    const file = $('file').files[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new Error('File too large');
    if (!confirm(t('confirmRestore'))) return;
    await F.importBackup(JSON.parse(await file.text())); $('file').value = ''; await render();
  });
  run(render)();
})();
