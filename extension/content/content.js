// Video Drift content script: floating player, timecode memory, bookmarks, quick controls.
(function () {
  'use strict';
  if (window.__videoDriftLoaded) return;
  window.__videoDriftLoaded = true;

  const F = globalThis.VideoDrift;
  const api = F.api;
  // Once the extension is updated, this copy of the script is cut off from the extension APIs
  // until the tab is reloaded. Text falls back to the message id instead of throwing.
  const t = (id, subs) => { try { return api.i18n.getMessage(id, subs) || id; } catch (e) { return id; } };

  const state = {
    settings: F.DEFAULTS,
    mode: null,          // 'docpip' | 'float' | 'native'
    video: null,         // video currently in the floating player
    placeholder: null,
    pipWindow: null,
    ui: null,
    subsObserver: null,
    lastSave: 0,
    resumeOffered: new Set(),
    lastKey: null,
    linkSeeked: new Set(),
    selected: null,
    cleanup: []
  };

  F.getSettings().then((s) => { state.settings = s; });
  if (api.storage) api.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      F.getSettings().then((s) => { state.settings = s; applyOpacity(); });
    }
  });

  /* ---------- video discovery ---------- */

  function videos() {
    const list = Array.from(document.querySelectorAll('video'));
    if (state.video && !list.includes(state.video)) list.push(state.video);
    return list;
  }

  function pickVideo() {
    if (state.video) return state.video;
    if (state.selected && state.selected.isConnected) return state.selected;
    let best = null, bestScore = 0;
    for (const v of videos()) {
      const r = v.getBoundingClientRect();
      let score = r.width * r.height;
      if (!score) continue;
      if (!v.paused) score *= 4;
      if (v.readyState > 0) score *= 2;
      if (score > bestScore) { best = v; bestScore = score; }
    }
    return best;
  }

  function isAd() {
    return !!document.querySelector('.ad-showing, .ad-interrupting');
  }

  function pageInfo() {
    const url = location.href;
    const title = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s+-\s+YouTube$/, '').trim();
    return { url, title: title || location.hostname, site: location.hostname.replace(/^www\./, '') };
  }

  function currentKey() { return F.videoKey(location.href); }

  /* ---------- timecode memory ---------- */

  function savePos(v, force) {
    if (!v || isAd() || !state.settings.rememberHistory) return;
    const d = v.duration;
    if (!isFinite(d) || d < 30) return;
    const now = Date.now();
    if (!force && now - state.lastSave < 5000) return;
    state.lastSave = now;
    const key = currentKey();
    if (v.currentTime > d - 10) { F.clearPosition(key); return; }
    if (v.currentTime < 5) return;
    const info = pageInfo();
    F.savePosition(key, { t: Math.floor(v.currentTime), d: Math.floor(d), title: info.title, url: info.url });
  }

  async function offerResume(v) {
    const key = currentKey();
    if (!state.settings.autoResume || state.resumeOffered.has(key) || isAd() || hasExplicitTime()) return;
    const pos = await F.getPosition(key);
    if (!pos || pos.t < 5) return;
    if (pos.d && pos.t > pos.d - 10) return;
    if (Math.abs(v.currentTime - pos.t) < 5) return;
    state.resumeOffered.add(key);
    showResume(v, pos.t);
  }

  function hookVideo(v) {
    if (v.__videoDriftHooked) return;
    v.__videoDriftHooked = true;
    v.addEventListener('timeupdate', () => savePos(v, false));
    v.addEventListener('pause', () => savePos(v, true));
    v.addEventListener('loadedmetadata', () => { seekFromHash(v); setTimeout(() => offerResume(v), 800); });
    v.addEventListener('mouseenter', () => showHoverButton(v));
    v.addEventListener('mousemove', () => showHoverButton(v));
    if (v.readyState > 0) setTimeout(() => { seekFromHash(v); offerResume(v); }, 800);
  }

  function scan() {
    videos().forEach(hookVideo);
    const key = currentKey();
    if (key !== state.lastKey) {
      state.lastKey = key;
      const v = pickVideo();
      if (v && v.readyState > 0) setTimeout(() => { seekFromHash(v); offerResume(v); }, 1200);
    }
  }
  scan();
  new MutationObserver(() => { clearTimeout(scan._t); scan._t = setTimeout(scan, 500); })
    .observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => { const v = pickVideo(); if (v) savePos(v, true); });

  // Apply generic time links when media metadata actually arrives, even on slow pages.
  function hasExplicitTime() {
    const u = new URL(location.href);
    return /(?:^#|&)t=\d+/.test(u.hash) || ['t', 'start', 'time_continue'].some((k) => u.searchParams.has(k));
  }
  function seekFromHash(v) {
    const m = /(?:^#|&)t=(\d+)(?:s)?(?:&|$)/.exec(location.hash);
    const key = location.href;
    if (!m || state.linkSeeked.has(key) || !v || !v.readyState || isAd()) return;
    const seconds = Number(m[1]);
    if (!Number.isFinite(v.duration) || seconds > v.duration) return;
    try {
      v.currentTime = seconds;
      state.linkSeeked.add(key);
      state.resumeOffered.add(currentKey());
    } catch (e) { /* retry after the next metadata event */ }
  }
  window.addEventListener('hashchange', () => seekFromHash(pickVideo()));

  /* ---------- in-page overlay (toast, resume bar, hover button) ---------- */

  let overlay = null;
  function getOverlay() {
    if (overlay && overlay.host.isConnected) return overlay;
    const host = document.createElement('video-drift-overlay');
    host.style.cssText = 'all:initial;position:fixed;inset:0 auto auto 0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + OVERLAY_CSS + '</style><div class="toasts"></div>' +
      '<button class="hover" type="button" title="' + t('btnFloat') + '">' + ICONS.float + '</button>';
    document.documentElement.appendChild(host);
    const hover = root.querySelector('.hover');
    hover.addEventListener('click', (e) => { e.stopPropagation(); hover.classList.remove('on'); openPlayer(hover._video); });
    overlay = { host, root, toasts: root.querySelector('.toasts'), hover };
    return overlay;
  }

  function toast(text, ms) {
    if (state.ui && state.mode !== 'native') { state.ui.toast(text); return; }
    const o = getOverlay();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    o.toasts.appendChild(el);
    setTimeout(() => el.remove(), ms || 2200);
  }

  function showResume(v, sec) {
    const o = getOverlay();
    const el = document.createElement('div');
    el.className = 'toast resume';
    const label = document.createElement('span');
    label.textContent = t('resumeAsk', [F.fmtTime(sec)]);
    const yes = document.createElement('button');
    yes.textContent = t('resumeYes');
    const no = document.createElement('button');
    no.className = 'ghost';
    no.textContent = '✕';
    no.title = t('resumeNo');
    el.append(label, yes, no);
    yes.onclick = () => { v.currentTime = sec; v.play().catch(() => {}); el.remove(); };
    no.onclick = () => el.remove();
    o.toasts.appendChild(el);
    setTimeout(() => el.remove(), 15000);
  }

  function showHoverButton(v) {
    if (!state.settings.hoverButton || state.mode || document.fullscreenElement) return;
    const r = v.getBoundingClientRect();
    if (r.width < 200 || r.height < 120) return;
    const o = getOverlay();
    o.hover._video = v;
    o.hover.style.left = Math.max(4, r.right - 46) + 'px';
    o.hover.style.top = Math.max(4, r.top + 10) + 'px';
    o.hover.classList.add('on');
    clearTimeout(o.hover._t);
    o.hover._t = setTimeout(() => o.hover.classList.remove('on'), 2500);
  }

  /* ---------- quick controls ---------- */

  function setSpeed(v, rate) {
    rate = Math.min(F.SPEED_MAX, Math.max(F.SPEED_MIN, Math.round(rate * 100) / 100));
    v.playbackRate = rate;
    toast(t('speedIs', [rate + '×']));
    state.ui && state.ui.refresh();
    return rate;
  }
  function stepSpeed(v, dir) {
    return setSpeed(v, v.playbackRate + dir * 0.25);
  }
  function setVolume(v, vol) {
    v.volume = vol;
    v.muted = vol === 0;
    toast(t('volumeIs', [Math.round(vol * 100) + '%']));
    state.ui && state.ui.refresh();
  }
  function cycleVolume(v) {
    const cur = v.muted ? 0 : v.volume;
    const p = F.VOLUME_PRESETS;
    const next = p.find((x) => x > cur + 0.01);
    setVolume(v, next === undefined ? p[0] : next);
  }

  async function bookmark(v, note) {
    const info = pageInfo();
    await F.addBookmark(currentKey(), info, v.currentTime, note);
    toast(t('bookmarkSaved', [F.fmtTime(v.currentTime)]));
  }

  function linkAt(v) {
    return F.timeLink(location.href, v.currentTime);
  }

  /* ---------- floating player ---------- */

  async function openPlayer(v) {
    v = v || pickVideo();
    if (!v) { toast(t('noVideo')); return { ok: false, error: 'noVideo' }; }
    if (state.mode) { closePlayer(); return { ok: true, mode: null }; }
    if (state.settings.floatMode === 'page') { openFloat(v); return { ok: true, mode: 'float' }; }
    if (window.documentPictureInPicture && top === window) {
      try { await openDocPip(v); return { ok: true, mode: 'docpip' }; } catch (e) { /* fall through */ }
    }
    if (document.pictureInPictureEnabled && !v.disablePictureInPicture && !window.documentPictureInPicture) {
      try {
        await v.requestPictureInPicture();
        state.mode = 'native';
        state.video = v;
        v.addEventListener('leavepictureinpicture', () => { state.mode = null; state.video = null; }, { once: true });
        return { ok: true, mode: 'native' };
      } catch (e) { /* fall through */ }
    }
    openFloat(v);
    return { ok: true, mode: 'float' };
  }

  function detachVideo(v) {
    state.video = v;
    state.origControls = v.controls;
    v.controls = false;
    if (overlay) overlay.hover.classList.remove('on');
    // Marks the video as taken, so ambient-light extensions such as Video Glow leave it alone.
    v.setAttribute('data-video-drift', 'floating');
    state.placeholder = document.createElement('div');
    const r = v.getBoundingClientRect();
    state.placeholder.style.cssText = 'width:' + r.width + 'px;height:' + r.height + 'px;background:#000;';
    v.parentNode.insertBefore(state.placeholder, v);
    // Sizing is done by the player stylesheet; the element's own inline style is left untouched
    // so the site and other extensions find it exactly as they left it.
  }

  function reattachVideo() {
    const v = state.video;
    if (!v || !state.placeholder) return;
    const wasPlaying = !v.paused;
    state.placeholder.replaceWith(v);
    v.removeAttribute('data-video-drift');
    v.controls = state.origControls;
    if (wasPlaying) v.play().catch(() => {});
    state.placeholder = null;
  }

  async function openDocPip(v) {
    const r = v.getBoundingClientRect();
    const ratio = (v.videoWidth && v.videoHeight) ? v.videoHeight / v.videoWidth : (r.height / r.width || 9 / 16);
    // Size from the video's own aspect ratio in CSS pixels, so screen scaling does not change the shape.
    const avail = Math.max(320, (screen.availWidth || 1280));
    const width = Math.round(Math.min(640, avail * 0.42));
    const height = Math.round(Math.min(width * ratio, (screen.availHeight || 800) * 0.7));
    const pw = await window.documentPictureInPicture.requestWindow({ width, height, preferInitialWindowPlacement: true });
    try { fillDocPip(v, pw, ratio); } catch (e) {
      // Never leave an empty black window behind; the caller falls back to the page player.
      try { reattachVideo(); } catch (e2) { /* ignore */ }
      state.mode = null; state.pipWindow = null; state.fitWindow = null; state.ui = null;
      try { pw.close(); } catch (e2) { /* ignore */ }
      throw e;
    }
  }

  function fillDocPip(v, pw, ratio) {
    const wasPlaying = !v.paused;
    detachVideo(v);
    state.mode = 'docpip';
    state.pipWindow = pw;
    const style = pw.document.createElement('style');
    style.textContent = PLAYER_CSS + 'html,body{margin:0;height:100%;background:#000;overflow:hidden}';
    pw.document.head.appendChild(style);
    pw.document.title = 'Video Drift';
    state.ui = buildPlayer(pw.document, pw.document.body, v, pw);
    if (wasPlaying) v.play().catch(() => {});
    pw.addEventListener('pagehide', () => teardown());
    // Chrome caps a Document PiP window at about 80% of the screen and reopens it at the size it
    // remembers for the site, so the window can come out with a different shape than the video.
    // fit() trims whichever side is too long; it only shrinks, so it never runs into that cap.
    // Resizing is allowed only during a user gesture, so it also runs on every click or key press.
    const gap = () => {
      const vr = (v.videoWidth && v.videoHeight) ? v.videoHeight / v.videoWidth : ratio;
      const iw = pw.innerWidth, ih = pw.innerHeight;
      if (!iw || !ih) return null;
      let w = iw, h = Math.round(iw * vr);
      if (h > ih) { h = ih; w = Math.round(ih / vr); }
      const dw = w - iw, dh = h - ih;
      return (Math.abs(dw) <= 4 && Math.abs(dh) <= 4) ? null : [dw, dh];
    };
    const fit = () => {
      const d = gap();
      if (!d) return;
      try { pw.resizeTo(pw.outerWidth + d[0], pw.outerHeight + d[1]); } catch (e) { /* needs a click */ }
    };
    // The fit button also says so when the browser refused to change the window.
    state.fitWindow = () => {
      fit();
      setTimeout(() => { if (state.pipWindow === pw && gap() && state.ui) state.ui.toast(t('fitBlocked')); }, 400);
    };
    fit();
    pw.addEventListener('pointerdown', fit, true);
    pw.addEventListener('keydown', fit, true);
    v.addEventListener('loadedmetadata', () => state.pipWindow === pw && fit(), { once: true });
    applyOpacity();
  }

  function openFloat(v) {
    const wasPlaying = !v.paused;
    detachVideo(v);
    state.mode = 'float';
    const host = document.createElement('video-drift-player');
    host.style.cssText = 'all:initial;position:fixed;right:24px;bottom:24px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PLAYER_CSS +
      ':host{display:block}.frame{width:420px;height:236px;min-width:220px;min-height:124px;resize:both;overflow:hidden;' +
      'border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.45);background:#000;position:relative}';
    root.appendChild(style);
    const frame = document.createElement('div');
    frame.className = 'frame';
    root.appendChild(frame);
    document.documentElement.appendChild(host);
    state.floatHost = host;
    F.api.storage.local.get('playerRect', (r) => {
      if (state.floatHost !== host) return;
      const rect = r.playerRect;
      if (rect) {
        frame.style.width = Math.min(Math.max(220, rect.width), innerWidth - 16) + 'px';
        frame.style.height = Math.min(Math.max(124, rect.height), innerHeight - 16) + 'px';
        host.style.left = Math.max(0, Math.min(rect.left, innerWidth - frame.offsetWidth)) + 'px';
        host.style.top = Math.max(0, Math.min(rect.top, innerHeight - frame.offsetHeight)) + 'px';
        host.style.right = host.style.bottom = 'auto';
      }
    });
    const saveRect = () => {
      const r = host.getBoundingClientRect();
      F.api.storage.local.set({ playerRect: { width: r.width, height: r.height, left: r.left, top: r.top } });
    };
    host.addEventListener('pointerup', saveRect);
    const resize = () => {
      frame.style.maxWidth = Math.max(220, innerWidth - 16) + 'px';
      frame.style.maxHeight = Math.max(124, innerHeight - 16) + 'px';
      const r = host.getBoundingClientRect();
      host.style.left = Math.max(0, Math.min(r.left, innerWidth - r.width)) + 'px';
      host.style.top = Math.max(0, Math.min(r.top, innerHeight - r.height)) + 'px';
      host.style.right = host.style.bottom = 'auto';
    };
    window.addEventListener('resize', resize);
    state.cleanup.push(() => window.removeEventListener('resize', resize));
    state.ui = buildPlayer(document, frame, v, window, true);
    makeDraggable(host, state.ui.dragHandle);
    if (wasPlaying) v.play().catch(() => {});
    applyOpacity();
  }

  function makeDraggable(host, handle) {
    let sx, sy, ox, oy;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button,input')) return;
      const r = host.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        host.style.left = Math.max(0, Math.min(innerWidth - 80, ox + ev.clientX - sx)) + 'px';
        host.style.top = Math.max(0, Math.min(innerHeight - 40, oy + ev.clientY - sy)) + 'px';
        host.style.right = 'auto';
        host.style.bottom = 'auto';
      };
      const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  function closePlayer() {
    if (state.mode === 'native') { document.exitPictureInPicture().catch(() => {}); return; }
    if (state.mode === 'docpip' && state.pipWindow) { state.pipWindow.close(); return; }
    teardown();
  }

  function teardown() {
    if (!state.mode) return;
    state.cleanup.splice(0).forEach((fn) => fn());
    if (state.subsObserver) state.subsObserver.disconnect();
    state.subsObserver = null;
    reattachVideo();
    if (state.floatHost) state.floatHost.remove();
    state.floatHost = null;
    state.pipWindow = null;
    state.fitWindow = null;
    state.ui = null;
    state.mode = null;
    state.video = null;
  }

  function applyOpacity() {
    const o = Math.min(100, Math.max(30, state.settings.opacity)) / 100;
    if (state.mode === 'float' && state.floatHost) state.floatHost.style.opacity = o;
    state.ui && state.ui.refresh();
  }

  // Site subtitle containers that live outside the <video> element.
  const SUB_SELECTORS = [
    '[id^="pjs_"][id$="_subtitle"]',
    '#oframecdnplayer > pjsdiv[style*="bottom: 50px"]',
    '#oframecdnplayer > pjsdiv[style*="bottom: 40px"]',
    '.pjsdiv.subtitles', '.b-simple_text_decor__subtitle', '.text-subtitle',
    '.ytp-caption-window-container', '.player-timedtext', '.vjs-text-track-display',
    '.plyr__captions', '.jw-captions', '.shaka-text-container', '[data-testid="cueBoxRowTextCue"]',
    '.dv-player-fullscreen [class*="captions"]', '[class*="subtitle"]', '[class*="caption"]'
  ];

  function overlaps(el) {
    const a = el.getBoundingClientRect(), b = state.placeholder.getBoundingClientRect();
    if (!a.width && !a.height) return el.closest('.html5-video-player, [class*="player"]') !== null;
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function findSubtitleSource() {
    let node = state.placeholder && state.placeholder.parentElement;
    for (let i = 0; node && i < 6; i++, node = node.parentElement) {
      for (const sel of SUB_SELECTORS) {
        for (const el of node.querySelectorAll(sel)) {
          if (el === state.placeholder || el.contains(state.placeholder) || el.closest('video-drift-player')) continue;
          const css = getComputedStyle(el);
          if (el.closest('select, [role=menu], [role=listbox], .cdnplayer-subtitles-menu') || css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') continue;
          const player = el.closest('[id^="oframe"]');
          const playerJsCue = el.matches('[id^="pjs_"][id$="_subtitle"]') && player && player.contains(state.placeholder);
          if (playerJsCue || overlaps(el)) return el;
        }
      }
    }
    return null;
  }

  function mirrorSubtitles(target) {
    let src = findSubtitleSource();
    const render = () => {
      if (!state.video) return;
      if (!src || !src.isConnected || getComputedStyle(src).display === 'none' || getComputedStyle(src).visibility === 'hidden') src = findSubtitleSource();
      const native = Array.from(state.video.textTracks || []).filter((track) => track.mode === 'showing').flatMap((track) => Array.from(track.activeCues || []).map((cue) => cue.text)).join('\n');
      const text = native || (src ? src.innerText.trim() : '');
      if (target.textContent !== text) {
        target.textContent = text;
        target.style.display = text ? '' : 'none';
      }
    };
    for (const track of Array.from(state.video.textTracks || [])) { track.addEventListener('cuechange', render); state.cleanup.push(() => track.removeEventListener('cuechange', render)); }
    let queued = false;
    state.subsObserver = new MutationObserver((mutations) => {
      if (!mutations.some((m) => m.type !== 'attributes' || (src && (m.target === src || m.target.contains(src))) || m.target.matches(SUB_SELECTORS.join(',')))) return;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; render(); });
    });
    state.subsObserver.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    render();
  }

  function buildPlayer(doc, mount, v, win, inPage) {
    const b = state.settings.buttons;
    let ui = null; // assigned at the end; video events can fire while the player is being built
    const wrap = doc.createElement('div');
    wrap.className = 'fl-root';
    wrap.appendChild(v);
    const subs = doc.createElement('div');
    subs.className = 'fl-subs';
    subs.style.display = 'none';
    const toastEl = doc.createElement('div');
    toastEl.className = 'fl-toast';
    const panel = doc.createElement('div');
    panel.className = 'fl-panel';
    const prog = doc.createElement('div');
    prog.className = 'fl-prog';
    const seek = doc.createElement('input');
    seek.type = 'range'; seek.min = 0; seek.max = 1000; seek.value = 0;
    seek.className = 'fl-seek';
    const timeEl = doc.createElement('span');
    timeEl.className = 'fl-time';
    prog.append(seek, timeEl);
    seek.addEventListener('pointerdown', (e) => e.stopPropagation());
    seek.addEventListener('input', () => { if (isFinite(v.duration)) v.currentTime = seek.value / 1000 * v.duration; });
    const bar = doc.createElement('div');
    bar.className = 'fl-bar';
    panel.append(prog, bar);
    wrap.append(subs, toastEl, panel);
    const tick = () => {
      const d = v.duration;
      const p = isFinite(d) && d > 0 ? v.currentTime / d : 0;
      seek.value = Math.round(p * 1000);
      seek.style.setProperty('--p', (p * 100) + '%');
      timeEl.textContent = F.fmtTime(v.currentTime) + (isFinite(d) ? ' / ' + F.fmtTime(d) : '');
    };
    const updateTime = () => { if (ui && state.ui === ui) tick(); };
    v.addEventListener('timeupdate', updateTime);
    state.cleanup.push(() => v.removeEventListener('timeupdate', updateTime));
    mount.appendChild(wrap);

    const btn = (icon, title, fn, show) => {
      if (show === false) return null;
      const el = doc.createElement('button');
      el.type = 'button';
      el.title = title;
      el.setAttribute('aria-label', title);
      el.innerHTML = icon;
      el.addEventListener('click', (e) => { e.stopPropagation(); fn(el); });
      bar.appendChild(el);
      return el;
    };
    const label = (cls, title, fn, show) => {
      if (show === false) return null;
      const el = doc.createElement('button');
      el.type = 'button';
      el.className = 'fl-label ' + cls;
      el.title = title;
      el.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      bar.appendChild(el);
      return el;
    };

    const playBtn = btn(ICONS.play, t('btnPlay'), () => { v.paused ? v.play() : v.pause(); }, b.play);
    btn(ICONS.back, t('btnBack'), () => { v.currentTime = Math.max(0, v.currentTime - 10); }, b.seek);
    btn(ICONS.fwd, t('btnForward'), () => { v.currentTime += 10; }, b.seek);
    const more = doc.createElement('div'); more.className = 'fl-more';
    const volume = doc.createElement('input'); volume.type = 'range'; volume.min = 0; volume.max = 1; volume.step = .05; volume.value = v.muted ? 0 : v.volume; volume.className = 'fl-range'; volume.title = t('volume'); volume.setAttribute('aria-label', t('volume')); volume.oninput = () => setVolume(v, +volume.value); if (b.volume !== false) bar.append(volume);
    const toggle = btn('⋯', t('moreControls'), () => { more.hidden = !more.hidden; if (ui) ui.refresh(); });
    more.hidden = true;
    const before = [...bar.children];
    btn(ICONS.slower, t('btnSlower'), () => stepSpeed(v, -1), b.speed);
    const speedLbl = label('speed', t('btnSpeedReset'), () => setSpeed(v, 1), b.speed);
    btn(ICONS.faster, t('btnFaster'), () => stepSpeed(v, 1), b.speed);
    const volLbl = label('vol', t('btnVolume'), () => cycleVolume(v), b.volume);
    const spacer = doc.createElement('span');
    spacer.className = 'fl-spacer';
    bar.appendChild(spacer);
    btn(ICONS.bookmark, t('btnBookmark'), () => {
      const note = win.prompt(t('notePrompt', [F.fmtTime(v.currentTime)]), '');
      if (note !== null) bookmark(v, note);
    }, b.bookmark);
    btn(ICONS.link, t('btnCopyLink'), () => {
      win.navigator.clipboard.writeText(linkAt(v)).then(() => ui.toast(t('linkCopied')), () => ui.toast(linkAt(v)));
    }, b.link);
    let range = null;
    // A separate window is always opaque to the desktop, so opacity is offered only in the page player.
    if (b.opacity && inPage) {
      range = doc.createElement('input');
      range.type = 'range';
      range.min = 30; range.max = 100; range.step = 5;
      range.title = t('opacity');
      range.className = 'fl-range';
      range.addEventListener('input', () => {
        state.settings.opacity = +range.value;
        applyOpacity();
      });
      range.addEventListener('change', () => F.saveSettings({ opacity: +range.value }));
      range.addEventListener('pointerdown', (e) => e.stopPropagation());
      bar.appendChild(range);
    }
    [...bar.children].filter((el) => !before.includes(el)).forEach((el) => more.append(el));
    panel.append(more);
    if (!inPage) btn(ICONS.fit, t('btnFit'), () => { if (state.fitWindow) state.fitWindow(); });
    btn(ICONS.close, t('btnClose'), () => closePlayer());

    let loopStart = null, loopEnd = null;
    const loopButton = doc.createElement('button'); loopButton.textContent = 'A–B'; loopButton.title = 'A–B';
    loopButton.onclick = () => {
      if (loopStart === null) { loopStart = v.currentTime; loopButton.textContent = 'B'; }
      else if (loopEnd === null && v.currentTime > loopStart) { loopEnd = v.currentTime; loopButton.textContent = 'A–B ✓'; }
      else { loopStart = loopEnd = null; loopButton.textContent = 'A–B'; }
    };
    more.append(loopButton);
    const repeat = () => { if (loopEnd !== null && v.currentTime >= loopEnd) v.currentTime = loopStart; };
    v.addEventListener('timeupdate', repeat); state.cleanup.push(() => v.removeEventListener('timeupdate', repeat));
    let toastTimer;
    ui = {
      dragHandle: wrap,
      toast(text) {
        toastEl.textContent = text;
        toastEl.classList.add('on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('on'), 1600);
      },
      refresh() {
        subs.style.fontSize = state.settings.subtitleSize + 'px';
        subs.style.bottom = Math.max(state.settings.subtitleOffset, panel.offsetHeight + 16) + 'px';
        subs.style.background = 'rgba(0,0,0,' + state.settings.subtitleBackground / 100 + ')';
        if (playBtn) playBtn.innerHTML = v.paused ? ICONS.play : ICONS.pause;
        if (speedLbl) speedLbl.textContent = v.playbackRate + '×';
        volume.value = v.muted ? 0 : v.volume;
        if (volLbl) volLbl.textContent = (v.muted ? 0 : Math.round(v.volume * 100)) + '%';
        if (range) range.value = state.settings.opacity;
        tick();
      }
    };
    const update = () => { if (ui && state.ui === ui) ui.refresh(); };
    ['play', 'pause', 'ratechange', 'volumechange'].forEach((ev) => { v.addEventListener(ev, update); state.cleanup.push(() => v.removeEventListener(ev, update)); });
    wrap.addEventListener('dblclick', (e) => { if (!e.target.closest('.fl-bar')) { v.paused ? v.play() : v.pause(); } });
    if (inPage) wrap.tabIndex = 0;
    (inPage ? wrap : win).addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
      else if (e.key === 'ArrowLeft') v.currentTime -= 5;
      else if (e.key === 'ArrowRight') v.currentTime += 5;
      else if (e.key === '>' || (e.shiftKey && e.key === '.')) stepSpeed(v, 1);
      else if (e.key === '<' || (e.shiftKey && e.key === ',')) stepSpeed(v, -1);
    });
    if (!inPage) wrap.style.height = '100%';
    mirrorSubtitles(subs);
    const panelResize = new ResizeObserver(() => { if (ui && state.ui === ui) ui.refresh(); });
    panelResize.observe(panel); state.cleanup.push(() => panelResize.disconnect());
    ui.refresh();
    return ui;
  }

  /* ---------- keyboard + messages ---------- */

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyP') {
      const v = pickVideo();
      if (v) { e.preventDefault(); openPlayer(v); }
    }
  }, true);

  function status(v) {
    const key = currentKey();
    return F.getBookmarks(key).then((bm) => ({
      ok: true,
      key,
      info: pageInfo(),
      time: v.currentTime,
      duration: isFinite(v.duration) ? v.duration : 0,
      rate: v.playbackRate,
      volume: v.muted ? 0 : v.volume,
      paused: v.paused,
      floating: state.mode,
      bookmarks: bm ? bm.items : [],
      link: linkAt(v),
      videos: videos().map((video, index) => ({ index, selected: video === v, label: (index + 1) + ' · ' + (video.getAttribute('aria-label') || video.title || pageInfo().title) })),
      docPip: !!window.documentPictureInPicture
    }));
  }

  function handle(msg) {
    const v = pickVideo();
    if (!v) return null;
    switch (msg.type) {
      case 'selectVideo': { const selected = videos()[msg.index]; if (!selected || state.mode) return status(v); state.selected = selected; return status(selected); }
      case 'status': return status(v);
      case 'pip': return openPlayer(v);
      case 'bookmark': return bookmark(v, msg.note).then(() => status(v));
      case 'speed': setSpeed(v, msg.value != null ? msg.value : v.playbackRate + msg.delta); return status(v);
      case 'volume': setVolume(v, msg.value); return status(v);
      case 'seek': v.currentTime = msg.t; return status(v);
      case 'unbookmark': return F.removeBookmark(currentKey(), msg.index).then(() => status(v));
      case 'command':
        if (msg.command === 'speed-up') stepSpeed(v, 1);
        else if (msg.command === 'speed-down') stepSpeed(v, -1);
        else if (msg.command === 'add-bookmark') bookmark(v, '');
        return Promise.resolve({ ok: true });
    }
    return null;
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const p = handle(msg);
    if (!p) return false;
    Promise.resolve(p).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  });

  /* ---------- assets ---------- */

  const svg = (d) => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const ICONS = {
    float: svg('<rect x="2" y="4" width="20" height="16" rx="3"/><rect x="12" y="11" width="8" height="7" rx="1.5" fill="currentColor"/>'),
    play: svg('<path d="M7 5l12 7-12 7z" fill="currentColor"/>'),
    pause: svg('<path d="M8 5v14M16 5v14"/>'),
    back: svg('<path d="M11 7l-5 5 5 5M18 7l-5 5 5 5"/>'),
    fwd: svg('<path d="M13 7l5 5-5 5M6 7l5 5-5 5"/>'),
    slower: svg('<path d="M5 12h14"/>'),
    faster: svg('<path d="M12 5v14M5 12h14"/>'),
    bookmark: svg('<path d="M6 3h12v18l-6-4-6 4z"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    fit: svg('<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><rect x="8" y="9" width="8" height="6" rx="1"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>')
  };

  const OVERLAY_CSS = `
    .toasts{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;font:500 14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
    .toast{background:rgba(13,16,23,.86);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.08);color:#fff;padding:9px 10px 9px 16px;border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;animation:in .18s ease-out}
    .toast button{font:inherit;border:0;border-radius:9px;padding:6px 14px;background:linear-gradient(90deg,#14b8a6,#5eead4);color:#06201d;cursor:pointer;font-weight:600}
    .toast button.ghost{background:transparent;color:#cbd5e1;padding:6px 8px}
    .hover{position:fixed;width:36px;height:36px;border:0;border-radius:10px;background:rgba(17,20,28,.8);color:#2dd4bf;cursor:pointer;display:grid;place-items:center;opacity:0;pointer-events:none;transition:opacity .15s}
    .hover.on{opacity:1;pointer-events:auto}
    .hover:hover{background:rgba(17,20,28,.95)}
    @keyframes in{from{opacity:0;transform:translateY(6px)}}`;

  const PLAYER_CSS = `
    .fl-root{position:relative;width:100%;height:100%;background:#000;overflow:hidden;font:500 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;cursor:grab}
    .fl-root video{position:absolute!important;inset:0!important;left:0!important;top:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;transform:none!important;object-fit:contain!important;opacity:1!important;visibility:visible!important;display:block!important;filter:none!important;clip-path:none!important}
    .fl-subs{position:absolute;left:50%;bottom:88px;transform:translateX(-50%);max-width:90%;text-align:center;white-space:pre-line;background:rgba(0,0,0,.72);padding:4px 10px;border-radius:6px;font-size:clamp(13px,3.4vw,22px);pointer-events:none;z-index:2}
    .fl-toast{position:absolute;top:12px;left:50%;transform:translateX(-50%) translateY(-4px);background:rgba(13,16,23,.82);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);padding:7px 14px;border-radius:99px;opacity:0;transition:opacity .18s,transform .18s;pointer-events:none;z-index:4;white-space:nowrap}
    .fl-toast.on{opacity:1;transform:translateX(-50%)}
    .fl-panel{position:absolute;left:8px;right:8px;bottom:8px;padding:6px 8px 4px;border-radius:14px;background:rgba(13,16,23,.72);backdrop-filter:blur(14px) saturate(1.4);border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 30px rgba(0,0,0,.35);opacity:0;transform:translateY(6px);transition:opacity .2s,transform .2s;z-index:3}
    .fl-root:hover .fl-panel,.fl-root:focus-within .fl-panel{opacity:1;transform:none}
    .fl-prog{display:flex;align-items:center;gap:8px;padding:0 4px}
    .fl-seek{flex:1;-webkit-appearance:none;appearance:none;height:4px;border-radius:99px;margin:6px 0;background:linear-gradient(90deg,#2dd4bf var(--p,0%),rgba(255,255,255,.22) var(--p,0%));cursor:pointer;outline:none}
    .fl-seek::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(45,212,191,.35);transform:scale(0);transition:transform .15s}
    .fl-prog:hover .fl-seek::-webkit-slider-thumb{transform:scale(1)}
    .fl-seek::-moz-range-thumb{width:10px;height:10px;border:0;border-radius:50%;background:#fff}
    .fl-time{font-size:11px;color:rgba(255,255,255,.75);font-variant-numeric:tabular-nums;white-space:nowrap}
    .fl-more{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding-top:5px}.fl-more[hidden]{display:none}.fl-more button{background:rgba(255,255,255,.1);color:white;border:0;border-radius:6px;padding:6px;cursor:pointer}.fl-bar{display:flex;align-items:center;gap:1px}
    .fl-bar button{border:0;background:transparent;color:rgba(255,255,255,.9);width:30px;height:30px;border-radius:9px;cursor:pointer;display:grid;place-items:center;padding:0;font:inherit;transition:background .12s,color .12s}
    .fl-bar button:hover{background:rgba(255,255,255,.12);color:#2dd4bf}
    .fl-bar .fl-label{width:auto;min-width:40px;padding:0 7px;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;background:rgba(255,255,255,.08)}
    .fl-spacer{flex:1}
    .fl-range{width:64px;-webkit-appearance:none;appearance:none;height:4px;border-radius:99px;background:rgba(255,255,255,.22);cursor:pointer;outline:none;margin:0 4px}
    .fl-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#2dd4bf}
    @media (max-width:360px){.fl-bar .fl-label,.fl-range{display:none}}`;
})();
