'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');

function fixture(promiseApi = false, shared = null) {
  const data = shared ? shared.data : { sync: {}, local: {} };
  let failSync = false;
  const api = { runtime: { id: 'test', lastError: null }, storage: {} };
  if (shared) {
    // Every page talks to the same background, as the extension's runtime messaging does.
    api.runtime.onMessage = { addListener: (fn) => shared.listeners.push(fn) };
    api.runtime.sendMessage = (msg, cb) => {
      let answered = false;
      const reply = (res) => { answered = true; setTimeout(() => cb(structuredClone(res))); };
      const pending = shared.listeners.map((fn) => fn(structuredClone(msg), { id: 'test' }, reply));
      if (!pending.includes(true) && !answered) setTimeout(() => cb(undefined));
    };
  }
  for (const area of ['sync', 'local']) {
    api.storage[area] = {
      get(keys, cb) {
        const result = keys == null ? data[area] : Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).filter((k) => k in data[area]).map((k) => [k, data[area][k]])
        );
        cb(structuredClone(result));
      },
      set(obj, cb) {
        if (area === 'sync' && failSync) api.runtime.lastError = { message: 'QUOTA_BYTES_PER_ITEM' };
        else Object.assign(data[area], structuredClone(obj));
        cb();
        api.runtime.lastError = null;
      },
      remove(keys, cb) { for (const k of [].concat(keys)) delete data[area][k]; cb(); }
    };
  }
  if (promiseApi) {
    for (const area of ['sync', 'local']) {
      const callbacks = api.storage[area];
      api.storage[area] = Object.fromEntries(Object.entries(callbacks).map(([method, fn]) => [method, (arg) => new Promise((resolve, reject) => {
        fn(arg, (result) => api.runtime.lastError ? reject(new Error(api.runtime.lastError.message)) : resolve(result));
      })]));
    }
  }
  const ctx = vm.createContext({ [promiseApi ? 'browser' : 'chrome']: api, URL, Date, crypto: webcrypto });
  vm.runInContext(fs.readFileSync('extension/shared/store.js', 'utf8'), ctx);
  return { F: ctx.VideoDrift, data, fail: (v) => { failSync = v; } };
}

function extension() {
  const shared = { data: { sync: {}, local: {} }, listeners: [] };
  const background = fixture(false, shared);
  background.F.serveRequests();
  return { shared, background, page: () => fixture(false, shared) };
}

for (const promiseApi of [false, true]) test('parallel changes in one page keep every update (' + (promiseApi ? 'promise' : 'callback') + ' API)', async () => {
  const { F } = fixture(promiseApi);
  const info = { url: 'https://example.com/video', title: 'Video' };
  await Promise.all([F.addBookmark('key', info, 10, 'a'), F.addBookmark('key', info, 20, 'b'), F.addBookmark('key', info, 30, 'c')]);
  assert.deepEqual((await F.getBookmarks('key')).items.map((b) => b.note), ['a', 'b', 'c']);
  await Promise.all([F.saveLater({ url: 'https://example.com/1', title: '1' }), F.saveLater({ url: 'https://example.com/2', title: '2' })]);
  assert.equal((await F.laterVideos()).length, 2);
  await Promise.all([F.saveSettings({ opacity: 60 }), F.saveSettings({ autoResume: false }), F.saveSettings({ buttons: { play: false } })]);
  const settings = await F.getSettings();
  assert.equal(settings.opacity, 60);
  assert.equal(settings.autoResume, false);
  assert.equal(settings.buttons.play, false);
  const rec = await F.getBookmarks('key');
  await Promise.all([F.changeBookmark('key', F.bookmarkId(rec.items[0]), null), F.changeBookmark('key', F.bookmarkId(rec.items[2]), 'edited')]);
  assert.deepEqual((await F.getBookmarks('key')).items.map((b) => b.note), ['b', 'edited']);
});

test('changes from different tabs and the popup go through the background without losing updates', async () => {
  const { page } = extension();
  const tabA = page().F, tabB = page().F, popup = page().F;
  const info = { url: 'https://example.com/video', title: 'Video' };
  const results = await Promise.all([tabA.addBookmark('key', info, 10, 'tab a'), tabB.addBookmark('key', info, 20, 'tab b'), popup.saveLater(info), tabA.saveSettings({ opacity: 50 }), popup.saveSettings({ hoverButton: false })]);
  assert.equal(results[0].items[0].note, 'tab a');
  assert.deepEqual((await popup.getBookmarks('key')).items.map((b) => b.note), ['tab a', 'tab b']);
  assert.equal((await tabB.laterVideos()).length, 1);
  const settings = await tabB.getSettings();
  assert.equal(settings.opacity, 50);
  assert.equal(settings.hoverButton, false);
});

test('background errors reach the page, and pages still work when no background answers', async () => {
  const { background, page } = extension();
  background.fail(true);
  await assert.rejects(page().F.saveSettings({ opacity: 40 }), /QUOTA_BYTES_PER_ITEM/);
  background.fail(false);
  const lone = fixture(false, { data: { sync: {}, local: {} }, listeners: [] });
  await Promise.all([lone.F.addBookmark('key', { url: 'https://example.com/v' }, 1, 'x'), lone.F.addBookmark('key', { url: 'https://example.com/v' }, 2, 'y')]);
  assert.equal((await lone.F.getBookmarks('key')).items.length, 2);
});

test('Firefox promise APIs load settings and retain bookmarks through quota fallback and deletion', async () => {
  const { F, fail } = fixture(true);
  assert.equal(F.promiseApi, true);
  await F.saveSettings({ opacity: 75 });
  assert.equal((await F.getSettings()).opacity, 75);
  const info = { url: 'https://example.com/video', title: 'Video' };
  await F.addBookmark('key', info, 20, 'sync');
  fail(true);
  await F.addBookmark('key', info, 40, 'local');
  assert.equal((await F.getBookmarks('key')).items.length, 2);
  fail(false);
  const rec = await F.getBookmarks('key');
  await F.changeBookmark('key', F.bookmarkId(rec.items[0]), null);
  assert.equal((await F.getBookmarks('key')).items.length, 1);
  assert.equal((await F.allBookmarks())[0].items[0].note, 'local');
});

test('old history entries remain visible, sorted, and can be removed without affecting bookmarks', async () => {
  const { F, data } = fixture();
  const url = 'https://example.com/lesson';
  data.local['pos:' + F.hash(F.videoKey(url))] = { url, title: 'Legacy', t: 80, d: 300, at: 1 };
  data.local['pos:finished'] = { url, t: 295, d: 300 };
  data.local['pos:unsafe'] = { url: 'javascript:alert(1)', t: 20, d: 100 };
  await F.savePosition('youtube:abc', { url: 'https://www.youtube.com/watch?v=abc', title: 'New', t: 15, d: 600 });
  const items = await F.allPositions();
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'New');
  assert.equal(items[1].key, F.videoKey(url));
  await F.clearPosition(items[1].key);
  assert.equal((await F.allPositions()).length, 1);
  data.local['bm:test'] = { items: [] };
  await F.clearHistory();
  assert.equal((await F.allPositions()).length, 0);
  assert.ok(data.local['bm:test']);
});

test('editing and deleting use identity rather than a stale sorted index; legacy bookmarks work', async () => {
  const { F, data } = fixture();
  const key = 'youtube:abc';
  const k = 'bm:' + F.hash(key);
  data.sync[k] = { key, title: 'Video', url: 'https://youtube.com/watch?v=abc', site: 'youtube.com', items: [{ t: 50, note: 'old', at: 1 }] };
  const old = (await F.getBookmarks(key)).items[0];
  await F.addBookmark(key, { title: 'Video' }, 10, 'earlier');
  await F.changeBookmark(key, F.bookmarkId(old), ' edited ');
  let rec = await F.getBookmarks(key);
  assert.equal(rec.items[0].note, 'earlier');
  assert.equal(rec.items[1].note, 'edited');
  await F.changeBookmark(key, F.bookmarkId(rec.items[1]), null);
  rec = await F.getBookmarks(key);
  assert.equal(rec.items.length, 1);
  assert.equal(rec.items[0].t, 10);
});

test('quota fallback takes precedence over stale sync data, including deletion, then recovers', async () => {
  const { F, fail } = fixture();
  const info = { title: 'Test', url: 'https://example.com/video', site: 'example.com' };
  await F.addBookmark('key', info, 20, 'sync');
  fail(true);
  await F.addBookmark('key', info, 40, 'local');
  let rec = await F.getBookmarks('key');
  assert.equal(rec.items.length, 2);
  assert.equal((await F.allBookmarks())[0].items.length, 2);
  for (const item of rec.items) await F.changeBookmark('key', F.bookmarkId(item), null);
  assert.equal((await F.getBookmarks('key')).items.length, 0);
  assert.equal((await F.allBookmarks()).length, 0);
  fail(false);
  await F.addBookmark('key', info, 60, 'recovered');
  rec = await F.getBookmarks('key');
  assert.equal(rec.items.length, 1);
  assert.equal(rec.items[0].note, 'recovered');
});

test('links keep site time formats and export keeps notes', async () => {
  const { F } = fixture();
  assert.match(F.timeLink('https://youtube.com/watch?v=x', 90), /t=90s/);
  assert.match(F.timeLink('https://vimeo.com/123', 90), /#t=90s/);
  assert.match(F.timeLink('https://twitch.tv/videos/123', 90), /t=1m30s/);
  assert.match(F.timeLink('https://example.com/lesson', 90), /#t=90/);
  const md = F.toMarkdown([{ title: 'Lesson', url: 'https://example.com/lesson', items: [{ t: 90, note: 'Important' }] }], 'Notes');
  assert.match(md, /01:30/);
  assert.match(md, /Important/);
});

test('backup merges collections, preserves existing notes and rejects unsafe files before writing', async () => {
  const { F, data } = fixture();
  await F.saveLater({ url: 'https://example.com/later', title: 'Later' });
  await F.addBookmark('https://example.com/video', { url: 'https://example.com/video', title: 'Video' }, 30, 'Note');
  const backup = await F.exportBackup();
  await F.importBackup(backup);
  assert.equal((await F.laterVideos()).length, 1);
  assert.equal((await F.allBookmarks())[0].items.length, 1);
  const bad = JSON.parse(JSON.stringify(backup)); bad.later.push({ url: 'javascript:alert(1)' });
  const before = JSON.stringify(data);
  await assert.rejects(F.importBackup(bad));
  assert.equal(JSON.stringify(data), before);
  await F.removeLater('https://example.com/later');
  assert.equal((await F.laterVideos()).length, 0);
  await F.importBackup(backup);
  assert.equal((await F.laterVideos()).length, 1);
});

test('partial button settings preserve other choices, including backup imports', async () => {
  const { F } = fixture();
  await F.saveSettings({ buttons: { play: false, volume: false } });
  await F.saveSettings({ buttons: { bookmark: false } });
  const backup = await F.exportBackup();
  backup.settings.buttons = { seek: false };
  await F.importBackup(backup);
  const { buttons } = await F.getSettings();
  for (const key of ['play', 'volume', 'bookmark', 'seek']) assert.equal(buttons[key], false);
  assert.equal(buttons.speed, true);
});

test('malformed backup metadata and playback positions are rejected before any write', async () => {
  const { F, data } = fixture();
  const backup = await F.exportBackup();
  backup.settings.opacity = 50;
  const before = JSON.stringify(data);
  for (const entry of [
    { collection: 'later', value: { url: 'https://example.com/', title: {} } },
    { collection: 'history', value: { url: 'https://example.com/', t: -1, d: 60 } },
    { collection: 'bookmarks', value: { key: 'key', url: 'https://example.com/', items: [{ t: 1, note: '', id: {} }] } }
  ]) {
    const bad = JSON.parse(JSON.stringify(backup));
    bad[entry.collection].push(entry.value);
    await assert.rejects(F.importBackup(bad));
    assert.equal(JSON.stringify(data), before);
  }
});
