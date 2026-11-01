'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');

function fixture() {
  const data = { sync: {}, local: {} };
  let failSync = false;
  const api = { runtime: { id: 'test', lastError: null }, storage: {} };
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
  const ctx = vm.createContext({ chrome: api, URL, Date, crypto: webcrypto });
  vm.runInContext(fs.readFileSync('extension/shared/store.js', 'utf8'), ctx);
  return { F: ctx.VideoDrift, data, fail: (v) => { failSync = v; } };
}

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
