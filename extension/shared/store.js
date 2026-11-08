// Video Drift shared helpers: storage, keys, time formatting, Markdown export.
// Loaded as a classic script in content scripts and in the popup.
(function (root) {
  'use strict';

  const api = typeof browser !== 'undefined' && browser.storage ? browser : chrome;
  const promiseApi = typeof browser !== 'undefined' && api === browser;

  const DEFAULTS = {
    opacity: 100,
    autoResume: true,
    rememberHistory: true,
    subtitleSize: 20,
    subtitleBackground: 72,
    subtitleOffset: 80,
    hoverButton: true,
    floatMode: 'window', // 'window' (separate always-on-top window) or 'page' (mini player over the page)
    buttons: {
      play: true,
      seek: true,
      speed: true,
      volume: true,
      bookmark: true,
      link: true,
      opacity: true
    }
  };

  const SPEED_MIN = 0.25;
  const SPEED_MAX = 4;
  const VOLUME_PRESETS = [0, 0.25, 0.5, 0.75, 1];

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Stable identifier of a video page, ignoring timecode and tracking params.
  function videoKey(href) {
    let u;
    try { u = new URL(href); } catch (e) { return href; }
    u.hash = '';
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get('v')) {
      return 'youtube:' + u.searchParams.get('v');
    }
    if (u.hostname === 'youtu.be') return 'youtube:' + u.pathname.slice(1);
    ['t', 'time_continue', 'start', 'si', 'feature', 'pp', 'utm_source', 'utm_medium', 'utm_campaign']
      .forEach((p) => u.searchParams.delete(p));
    return u.origin + u.pathname + u.search;
  }

  // Link that opens the same video at the given second.
  function timeLink(href, seconds) {
    const t = Math.floor(seconds);
    let u;
    try { u = new URL(href); } catch (e) { return href; }
    const host = u.hostname;
    if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') {
      u.searchParams.delete('time_continue');
      u.searchParams.set('t', t + 's');
      u.hash = '';
    } else if (/(^|\.)vimeo\.com$/.test(host)) {
      u.hash = 't=' + t + 's';
    } else if (/(^|\.)twitch\.tv$/.test(host)) {
      u.searchParams.set('t', fmtTwitch(t));
    } else {
      u.hash = 't=' + t;
    }
    return u.toString();
  }

  function fmtTwitch(t) {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + 'h' : '') + (h || m ? m + 'm' : '') + s + 's';
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  // After the extension is updated or reloaded, scripts already running in open tabs lose
  // access to the extension APIs until the tab is reloaded. Storage calls then quietly do nothing.
  function store(area) {
    try { return api.runtime && api.runtime.id && api.storage ? api.storage[area] : null; } catch (e) { return null; }
  }
  function get(area, keys) {
    return new Promise((resolve) => {
      const st = store(area);
      if (!st) return resolve({});
      if (promiseApi) return Promise.resolve().then(() => st.get(keys)).then((r) => resolve(r || {}), () => resolve({}));
      try { st.get(keys, (r) => resolve(r || {})); } catch (e) { resolve({}); }
    });
  }
  function set(area, obj) {
    return new Promise((resolve, reject) => {
      const st = store(area);
      if (!st) return resolve();
      if (promiseApi) return Promise.resolve().then(() => st.set(obj)).then(resolve, reject);
      try {
        st.set(obj, () => {
          const err = api.runtime.lastError;
          err ? reject(err) : resolve();
        });
      } catch (e) { reject(e); }
    });
  }
  function remove(area, keys) {
    return new Promise((resolve) => {
      const st = store(area);
      if (!st) return resolve();
      if (promiseApi) return Promise.resolve().then(() => st.remove(keys)).then(resolve, resolve);
      try { st.remove(keys, () => resolve()); } catch (e) { resolve(); }
    });
  }

  // Changes that read a record, modify it and write it back run one at a time, so two of them
  // can never overwrite each other. Within one page a queue keeps them in order. Pages, tabs
  // and the popup send them to the background, which runs every change through its own queue.
  const MESSAGE = 'video-drift-store';
  const NO_ANSWER = {};
  const changes = {};
  let queue = Promise.resolve();
  let serving = false;
  function serial(fn) {
    const run = queue.then(() => fn());
    queue = run.catch(() => {});
    return run;
  }
  function viaBackground(op, args) {
    const rt = api.runtime;
    if (serving || !rt || typeof rt.sendMessage !== 'function' || !store('local')) return Promise.resolve(NO_ANSWER);
    const msg = { type: MESSAGE, op, args };
    const answer = (res) => {
      if (!res || typeof res !== 'object') return NO_ANSWER;
      if (res.error !== undefined) throw new Error(res.error);
      return res.result;
    };
    if (promiseApi) return Promise.resolve().then(() => rt.sendMessage(msg)).then(answer, () => NO_ANSWER);
    return new Promise((resolve, reject) => {
      try {
        rt.sendMessage(msg, (res) => {
          if (rt.lastError) return resolve(NO_ANSWER);
          try { resolve(answer(res)); } catch (e) { reject(e); }
        });
      } catch (e) { resolve(NO_ANSWER); }
    });
  }
  function change(op, fn) {
    changes[op] = (...args) => serial(() => fn(...args));
    // Without a background (or before it answers) the change still runs here, in this page's queue.
    return (...args) => viaBackground(op, args).then((r) => r === NO_ANSWER ? changes[op](...args) : r);
  }
  // Called once by the background script.
  function serveRequests() {
    serving = true;
    api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== MESSAGE || !Object.prototype.hasOwnProperty.call(changes, msg.op)) return;
      changes[msg.op](...(Array.isArray(msg.args) ? msg.args : [])).then(
        (result) => sendResponse({ result }),
        (e) => sendResponse({ error: String((e && e.message) || e) }));
      return true;
    });
  }

  async function getSettings() {
    const r = await get('sync', 'settings');
    const s = r.settings || {};
    return Object.assign({}, DEFAULTS, s, { buttons: Object.assign({}, DEFAULTS.buttons, s.buttons) });
  }
  async function writeSettings(patch) {
    patch = patch || {};
    const cur = await getSettings();
    const next = Object.assign({}, cur, patch, { buttons: Object.assign({}, cur.buttons, patch.buttons) });
    await set('sync', { settings: next });
    return next;
  }

  // Playback positions live in storage.local: pos:<hash> -> { t, d, title, url, at }
  async function getPosition(key) {
    const k = 'pos:' + hash(key);
    return (await get('local', k))[k] || null;
  }
  function savePosition(key, data) {
    return set('local', { ['pos:' + hash(key)]: Object.assign({ at: Date.now() }, data, { key }) });
  }
  function clearPosition(key) {
    return remove('local', 'pos:' + hash(key));
  }

  async function allPositions() {
    const data = await get('local', null);
    return Object.entries(data)
      .filter(([k, p]) => k.startsWith('pos:') && p && /^https?:\/\//i.test(p.url || '') &&
        Number.isFinite(p.t) && Number.isFinite(p.d) && p.t >= 5 && p.d >= 30 && p.t <= p.d - 10)
      .map(([, p]) => Object.assign({}, p, { key: p.key || videoKey(p.url) }))
      .sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  async function clearHistory() {
    const data = await get('local', null);
    await remove('local', Object.keys(data).filter((k) => k.startsWith('pos:')));
  }

  // Bookmarks and frame notes live in storage.sync (falls back to local when quota is hit):
  // bm:<hash> -> { key, url, title, site, items: [{ t, note, at }] }
  async function getBookmarks(key) {
    const k = 'bm:' + hash(key);
    // A local copy exists only after a failed sync write and is the newer version.
    const local = (await get('local', k))[k];
    if (local) return local;
    return (await get('sync', k))[k] || null;
  }
  async function putBookmarks(key, rec) {
    const k = 'bm:' + hash(key);
    // Keep an empty local record on sync failure so deleted items cannot reappear.
    try {
      await set('sync', { [k]: rec });
      await remove('local', k);
    } catch (e) {
      await set('local', { [k]: rec });
    }
  }
  async function writeBookmark(key, info, t, note) {
    const rec = (await getBookmarks(key)) || { key, url: info.url, title: info.title, site: info.site, items: [] };
    rec.url = info.url || rec.url;
    rec.title = info.title || rec.title;
    rec.items.push({ id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16)).join('-'), t: Math.floor(t), note: (note || '').trim(), at: Date.now() });
    rec.items.sort((a, b) => a.t - b.t);
    await putBookmarks(key, rec);
    return rec;
  }
  async function deleteBookmark(key, index) {
    const rec = await getBookmarks(key);
    if (!rec) return null;
    rec.items.splice(index, 1);
    await putBookmarks(key, rec);
    return rec;
  }
  function bookmarkId(item) {
    return item.id || JSON.stringify([item.at, item.t, item.note]);
  }
  async function editBookmark(key, id, note) {
    const rec = await getBookmarks(key);
    if (!rec) return;
    const index = rec.items.findIndex((item) => bookmarkId(item) === id);
    if (index < 0) return;
    if (note === null) rec.items.splice(index, 1);
    else rec.items[index].note = note.trim();
    await putBookmarks(key, rec);
  }
  async function allBookmarks() {
    const [s, l] = await Promise.all([get('sync', null), get('local', null)]);
    const out = {};
    for (const src of [s, l]) {
      for (const k of Object.keys(src)) if (k.startsWith('bm:')) out[k] = src[k];
    }
    return Object.values(out).filter((rec) => rec && Array.isArray(rec.items) && rec.items.length)
      .sort((a, b) => ((a.site || '') + a.title).localeCompare((b.site || '') + b.title));
  }

  async function laterVideos() {
    return (await get('local', 'later')).later || [];
  }
  async function writeLater(info) {
    const list = await laterVideos();
    const key = videoKey(info.url);
    if (!list.some((v) => videoKey(v.url) === key)) list.unshift({ url: info.url, title: info.title, at: Date.now() });
    await set('local', { later: list });
  }
  async function deleteLater(url) {
    await set('local', { later: (await laterVideos()).filter((v) => v.url !== url) });
  }
  async function exportBackup() {
    return { format: 'video-drift', version: 1, settings: await getSettings(), history: await allPositions(), bookmarks: await allBookmarks(), later: await laterVideos() };
  }
  async function restoreBackup(data) {
    const validUrl = (u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } };
    const validRecord = (r) => r && typeof r === 'object' && validUrl(r.url) &&
      ['title', 'site'].every((k) => r[k] === undefined || typeof r[k] === 'string') &&
      (r.at === undefined || Number.isFinite(r.at));
    if (!data || data.format !== 'video-drift' || data.version !== 1 ||
        !['history', 'bookmarks', 'later'].every((k) => Array.isArray(data[k]) && data[k].length <= 10000)) throw new Error('Invalid backup');
    for (const p of data.history) if (!validRecord(p) || !Number.isFinite(p.t) || !Number.isFinite(p.d) || p.t < 0 || p.d <= 0 || p.t > p.d) throw new Error('Invalid history');
    for (const r of data.bookmarks) if (!validRecord(r) || typeof r.key !== 'string' || !Array.isArray(r.items) || r.items.length > 10000 || r.items.some((b) => !b || !Number.isFinite(b.t) || b.t < 0 || typeof b.note !== 'string' || (b.id !== undefined && typeof b.id !== 'string') || (b.at !== undefined && !Number.isFinite(b.at)))) throw new Error('Invalid bookmarks');
    for (const v of data.later) if (!validRecord(v)) throw new Error('Invalid saved video');
    // Validate the entire file before writing. Restore merges into existing collections.
    if (data.settings && typeof data.settings === 'object') {
      const patch = {};
      for (const k of ['autoResume', 'rememberHistory', 'hoverButton']) if (typeof data.settings[k] === 'boolean') patch[k] = data.settings[k];
      for (const [k, lo, hi] of [['opacity',30,100],['subtitleSize',12,36],['subtitleBackground',0,100],['subtitleOffset',16,160]]) if (Number.isFinite(data.settings[k])) patch[k] = Math.max(lo, Math.min(hi, data.settings[k]));
      if (['page','window'].includes(data.settings.floatMode)) patch.floatMode = data.settings.floatMode;
      if (data.settings.buttons && typeof data.settings.buttons === 'object') { patch.buttons = {}; for (const k of Object.keys(DEFAULTS.buttons)) if (typeof data.settings.buttons[k] === 'boolean') patch.buttons[k] = data.settings.buttons[k]; }
      await writeSettings(patch);
    }
    for (const p of data.history) {
      const key = videoKey(p.url), old = await getPosition(key);
      if (!old || (p.at || 0) > (old.at || 0)) await savePosition(key, p);
    }
    for (const r of data.bookmarks) {
      const key = r.key, old = await getBookmarks(key);
      const rec = old || Object.assign({}, r, { key, items: [] });
      for (const item of r.items) if (!rec.items.some((b) => b.t === item.t && b.note === item.note)) rec.items.push(item);
      rec.items.sort((a,b) => a.t-b.t);
      await putBookmarks(key, rec);
    }
    for (const v of data.later.slice().reverse()) await writeLater(v);
  }

  const saveSettings = change('saveSettings', writeSettings);
  const addBookmark = change('addBookmark', writeBookmark);
  const removeBookmark = change('removeBookmark', deleteBookmark);
  const changeBookmark = change('changeBookmark', editBookmark);
  const saveLater = change('saveLater', writeLater);
  const removeLater = change('removeLater', deleteLater);
  const importBackup = change('importBackup', restoreBackup);

  function toMarkdown(records, heading) {
    const date = new Date().toISOString().slice(0, 10);
    const lines = ['# ' + heading, '', '_' + date + '_', ''];
    for (const r of records) {
      const title = (r.title || r.url).replace(/[\[\]]/g, '');
      lines.push('## [' + title + '](' + r.url + ')', '');
      if (r.site) lines.push('Source: ' + r.site, '');
      for (const it of r.items) {
        const link = '[' + fmtTime(it.t) + '](' + timeLink(r.url, it.t) + ')';
        lines.push('- ' + link + (it.note ? ' — ' + it.note.replace(/\n+/g, ' ') : ''));
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  root.VideoDrift = {
    api, promiseApi, getStorage: get, DEFAULTS, SPEED_MIN, SPEED_MAX, VOLUME_PRESETS,
    hash, videoKey, timeLink, fmtTime,
    getSettings, saveSettings, laterVideos, saveLater, removeLater, exportBackup, importBackup,
    getPosition, savePosition, clearPosition, allPositions, clearHistory,
    getBookmarks, addBookmark, removeBookmark, changeBookmark, bookmarkId, allBookmarks, toMarkdown, serveRequests
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
