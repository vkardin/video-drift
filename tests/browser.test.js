'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');

async function setup(t, lang = 'en', active = false) {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (req.url.startsWith('/fixture')) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Test lesson</title><body><div class="player" style="position:relative;width:640px;height:360px"><video style="width:640px;height:360px"></video><div class="ytp-caption-window-container" style="position:absolute;bottom:20px;left:100px">Hello subtitles</div></div></body>'); return; }
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const messages = JSON.parse(fs.readFileSync(path.join(root, 'extension/_locales', lang, 'messages.json')));
  await page.addInitScript(({ messages, lang, active }) => {
    const data = { local: {}, sync: {} };
    const listeners = [];
    window.opened = [];
    window.testData = data;
    const api = {
      runtime: { id: 'test', lastError: null, getManifest: () => ({ version: '1.4.0' }), onMessage: { addListener: (fn) => { window.contentListener = fn; } } },
      i18n: { getUILanguage: () => lang, getMessage: (id, subs) => {
        let s = messages[id]?.message || '';
        [].concat(subs || []).forEach((x, i) => { s = s.replace('$' + (i + 1), x); });
        return s;
      } },
      storage: { onChanged: { addListener: (fn) => listeners.push(fn) } },
      tabs: {
        query: async () => [{ id: 1 }],
        create: async ({ url }) => { window.opened.push(url); },
        sendMessage: (id, msg, cb) => {
          if (!active) return cb(null);
          const F = window.VideoDrift;
          F.getBookmarks('youtube:test').then((rec) => cb({ ok: true, key: 'youtube:test', info: { title: 'Current lesson', url: 'https://youtube.com/watch?v=test' }, time: msg.t || 90, duration: 600, rate: 1, volume: 1, floating: null, bookmarks: rec?.items || [] }));
        }
      }
    };
    for (const area of ['local', 'sync']) api.storage[area] = {
      get: (keys, cb) => cb(structuredClone(keys == null ? data[area] : Object.fromEntries([].concat(keys).filter((k) => k in data[area]).map((k) => [k, data[area][k]])))),
      set: (obj, cb) => { const changes = {}; for (const k in obj) changes[k] = { newValue: obj[k], oldValue: data[area][k] }; Object.assign(data[area], structuredClone(obj)); cb(); listeners.forEach((fn) => fn(changes, area)); },
      remove: (keys, cb) => { [].concat(keys).forEach((k) => delete data[area][k]); cb(); }
    };
    window.chrome = api;
  }, { messages, lang, active });
  const base = 'http://127.0.0.1:' + server.address().port;
  return { page, base, errors };
}

async function seed(page) {
  await page.evaluate(async () => {
    const F = window.VideoDrift;
    await F.savePosition('youtube:test', { url: 'https://youtube.com/watch?v=test', title: 'Learning JavaScript', t: 95, d: 600 });
    await F.addBookmark('youtube:test', { title: 'Learning JavaScript', url: 'https://youtube.com/watch?v=test', site: 'youtube.com' }, 95, 'Promises and async');
    await F.addBookmark('other', { title: 'A second lesson', url: 'https://example.com/lesson', site: 'example.com' }, 50, 'Useful example');
  });
}

test('library works without a video: history, search, editing, safe notes, export, deletion and keyboard tabs', async (t) => {
  const { page, base, errors } = await setup(t);
  await page.goto(base + '/extension/popup/popup.html');
  await page.waitForFunction(() => window.VideoDrift);
  await seed(page);
  await page.getByRole('tab', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue watching' }).first().waitFor();
  assert.match(await page.locator('#historyList').innerText(), /01:35/);
  await page.locator('#historyList .continue').click();
  assert.match(await page.evaluate(() => window.opened[0]), /t=95s/);
  await page.getByRole('tab', { name: 'Bookmarks', exact: true }).click();
  assert.equal(await page.locator('#libraryList article').count(), 2);
  await page.getByRole('searchbox').fill('Promises');
  assert.equal(await page.locator('#libraryList article').count(), 1);
  await page.getByRole('button', { name: 'Edit note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit note' }).fill('<img src=x onerror=alert(1)> updated');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('searchbox').fill('updated');
  await page.locator('.library-bms .n').filter({ hasText: 'updated' }).waitFor();
  assert.equal(await page.locator('.library-bms img').count(), 0);
  const download = page.waitForEvent('download');
  await page.locator('#exportAll').click();
  assert.match((await download).suggestedFilename(), /video-drift-bookmarks.*\.md/);
  await page.getByRole('button', { name: 'Jump to this moment', exact: true }).click();
  assert.match(await page.evaluate(() => window.opened.at(-1)), /t=95s/);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.locator('#libraryEmpty').waitFor();
  await page.getByRole('searchbox').fill('');
  assert.equal(await page.locator('#libraryList article').count(), 1);
  await page.getByRole('tab', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from history', exact: true }).click();
  await page.locator('#historyEmpty').waitFor();
  assert.equal(await page.evaluate(async () => (await VideoDrift.allBookmarks()).length), 1);
  await page.getByRole('tab', { name: 'Continue', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-library').getAttribute('aria-selected'), 'true');
  assert.deepEqual(errors, []);
});

for (const lang of ['en', 'ru', 'uk']) test('popup layout and translations: ' + lang, async (t) => {
  const { page, base, errors } = await setup(t, lang, true);
  await page.goto(base + '/extension/popup/popup.html');
  await page.locator('#main').waitFor();
  await seed(page);
  await page.locator('#tab-history').click();
  await page.locator('#historyList article').waitFor();
  await page.locator('body').screenshot({ animations: 'disabled', path: '/tmp/video-drift-history-' + lang + '.png' });
  await page.locator('#tab-library').click();
  await page.locator('#libraryList article').first().waitFor();
  await page.locator('body').screenshot({ animations: 'disabled', path: '/tmp/video-drift-library-' + lang + '.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('body').screenshot({ animations: 'disabled', path: '/tmp/video-drift-library-' + lang + '-dark.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.evaluate(() => document.querySelector('.tabs').scrollWidth > document.body.clientWidth), false);
  const untranslated = await page.locator('[data-i18n]').evaluateAll((els) => els.filter((el) => !el.textContent || el.textContent === el.dataset.i18n).map((el) => el.dataset.i18n));
  assert.deepEqual(untranslated, []);
  await page.locator('#tab-current').click();
  await page.locator('#bms .icon').first().click();
  await page.getByRole('textbox', { name: lang === 'en' ? 'Edit note' : lang === 'ru' ? 'Редактировать заметку' : 'Редагувати нотатку' }).fill('Edited from current player');
  await page.locator('#bms button[type=submit]').click();
  await page.locator('#bms .n').filter({ hasText: 'Edited from current player' }).waitFor();
  assert.deepEqual(errors, []);
});

test('content: delayed metadata seeks saved link; mini player returns the original video and mirrors subtitles', async (t) => {
  const { page, base, errors } = await setup(t);
  await page.goto(base + '/fixture#t=90');
  await page.addScriptTag({ path: path.join(root, 'extension/shared/store.js') });
  await page.evaluate(async () => {
    await VideoDrift.saveSettings({ floatMode: 'page' });
    const v = document.querySelector('video');
    Object.defineProperties(v, { duration: { configurable: true, value: 600 }, readyState: { configurable: true, value: 0 } });
    v.play = async () => {};
  });
  await page.addScriptTag({ path: path.join(root, 'extension/content/content.js') });
  // Wait past the old fixed 1.5 second timer before providing metadata.
  await page.waitForTimeout(1700);
  await page.evaluate(() => {
    const v = document.querySelector('video');
    Object.defineProperty(v, 'readyState', { value: 1 });
    v.dispatchEvent(new Event('loadedmetadata'));
  });
  assert.equal(await page.locator('video').evaluate((v) => v.currentTime), 90);
  await page.keyboard.press('Alt+Shift+p');
  await page.locator('video-drift-player').waitFor();
  assert.equal(await page.locator('video-drift-player video').count(), 1);
  assert.match(await page.locator('video-drift-player .fl-subs').innerText(), /Hello subtitles/);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.locator('.player > video').count(), 1);
  assert.equal(await page.locator('video-drift-player').count(), 0);
  assert.equal(await page.locator('video').getAttribute('data-video-drift'), null);
  await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('pause')));
  await page.waitForFunction(async () => (await VideoDrift.allPositions()).length === 1);
  await page.evaluate(async () => { await VideoDrift.saveSettings({ rememberHistory: false }); await VideoDrift.clearHistory(); });
  await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('pause')));
  assert.equal(await page.evaluate(async () => (await VideoDrift.allPositions()).length), 0);
  assert.deepEqual(errors, []);
});
