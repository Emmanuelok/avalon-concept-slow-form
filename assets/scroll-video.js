/* Slow Form: native-scroll control for a licensed, same-origin film.
 * No media URL is embedded here. See scroll-video-contract.md. */
(function (global) {
  'use strict';
  const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
  const EPSILON = 0.04;
  const FRAME_MS = 1000 / 30;

  function mount(root, options = {}) {
    if (!root || !root.querySelector) throw new TypeError('A film scene element is required.');
    const video = root.querySelector('[data-scroll-video], video');
    if (!video) throw new TypeError('The film scene needs a video element.');
    const status = root.querySelector('[data-film-status], .pour-status');
    const time = root.querySelector('[data-film-time], .pour-time');
    const chapters = [...root.querySelectorAll('[data-film-chapter]')];
    const enableButtons = [...root.querySelectorAll('[data-film-enable]')];
    const playButtons = [...root.querySelectorAll('[data-film-play]')];
    const pauseButtons = [...root.querySelectorAll('[data-film-pause]')];
    const reducedQuery = global.matchMedia('(prefers-reduced-motion: reduce)');
    const mobileQuery = global.matchMedia('(max-width: 1050px), (pointer: coarse)');
    const connection = global.navigator.connection;
    const cleanups = [];
    let destroyed = false, enabled = false, ready = false, failed = false;
    let paused = Boolean(options.paused), near = false, visible = false;
    let playing = false, localPause = false, seeking = false, duration = 0;
    let target = null, pendingFraction = null, frame = 0, delay = 0, watchdog = 0;
    let lastSeek = -Infinity, playAttempt = 0;
    let nearObserver, visibleObserver;

    function localURL(value) {
      if (typeof value !== 'string' || !value.trim()) return null;
      try {
        const url = new URL(value, document.baseURI);
        return /^(http:|https:)$/.test(url.protocol) && url.origin === location.origin ? url.href : null;
      } catch (_) { return null; }
    }
    const source = localURL(options.source);
    const poster = localURL(options.poster);
    video.autoplay = false;
    video.loop = false;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'none';
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.removeAttribute('autoplay');
    video.removeAttribute('loop');
    if (poster) {
      video.poster = poster;
      const image = root.querySelector('.pour-poster');
      if (image) image.src = poster;
    }
    // The integrator supplies a source-less element; never request an empty URL.
    if (video.hasAttribute('src') || video.querySelector('source')) {
      throw new TypeError('Mount with a source-less video; pass the approved URL through options.source.');
    }

    function listen(targetNode, event, callback, settings) {
      targetNode.addEventListener(event, callback, settings);
      cleanups.push(() => targetNode.removeEventListener(event, callback, settings));
    }
    function say(message) { if (status && !destroyed && status.textContent !== message) status.textContent = message; }
    function explicitRequired() { return reducedQuery.matches || mobileQuery.matches || Boolean(connection?.saveData); }
    function setMode() {
      root.dataset.filmMode = reducedQuery.matches || mobileQuery.matches ? 'static' : 'scroll';
      root.dataset.filmEnabled = String(enabled);
      root.dataset.filmReady = String(ready);
      root.dataset.filmError = String(failed);
      root.dataset.filmPlaying = String(playing);
      for (const b of playButtons) b.setAttribute('aria-pressed', String(playing));
      for (const b of pauseButtons) b.setAttribute('aria-pressed', String(localPause || paused));
      for (const b of chapters) b.setAttribute('aria-disabled', String(paused));
    }
    function cancelWork() {
      if (frame) global.cancelAnimationFrame(frame);
      global.clearTimeout(delay);
      global.clearTimeout(watchdog);
      frame = delay = watchdog = 0;
    }
    function stopPlayback() {
      playAttempt++;
      playing = false;
      video.pause();
      setMode();
    }
    function timestamp(seconds) {
      const n = Math.max(0, Math.floor(Number(seconds) || 0));
      return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    }
    function display() {
      if (destroyed) return;
      const current = Number(video.currentTime) || 0;
      const progress = duration ? clamp(current / duration) : 0;
      root.style.setProperty('--film-progress', String(progress));
      if (time) time.textContent = `${timestamp(current)} / ${duration ? timestamp(duration) : '—:—'}`;
      let selected = chapters[0];
      for (const chapter of chapters) {
        const fraction = Number(chapter.dataset.filmChapter);
        if (Number.isFinite(fraction) && fraction <= progress + 0.025) selected = chapter;
      }
      for (const chapter of chapters) chapter.setAttribute('aria-pressed', String(chapter === selected));
    }
    function measure() {
      const bounds = root.getBoundingClientRect();
      visible = bounds.bottom > 0 && bounds.top < global.innerHeight && !document.hidden;
      const travel = Math.max(1, bounds.height - global.innerHeight);
      return clamp(-bounds.top / travel);
    }
    function usable() { return !destroyed && enabled && !failed && duration > 0 && visible && !document.hidden && !paused; }
    function targetFor(fraction) { return clamp(fraction) * Math.max(0, duration - 0.01); }
    function schedule() {
      if (frame || delay || !usable() || playing || target === null || seeking || video.seeking) return;
      const wait = FRAME_MS - (performance.now() - lastSeek);
      if (wait > 0) {
        delay = global.setTimeout(() => { delay = 0; schedule(); }, wait);
        return;
      }
      frame = global.requestAnimationFrame(flush);
    }
    function flush() {
      frame = 0;
      if (!usable() || playing || seeking || video.seeking || target === null) return;
      const next = target;
      if (Math.abs((Number(video.currentTime) || 0) - next) < EPSILON) { target = null; display(); return; }
      try {
        seeking = true;
        lastSeek = performance.now();
        video.currentTime = next;
        // Some engines omit seeked when an already-available target is selected.
        watchdog = global.setTimeout(() => {
          watchdog = 0;
          if (destroyed || !visible) return;
          if (!video.seeking) { seeking = false; schedule(); }
          else say('Finding this moment in the film. You can keep exploring the page.');
        }, 1600);
      } catch (_) {
        seeking = false;
        fail('This film could not reach that moment. The still image and story remain available.');
      }
    }
    function requestFraction(fraction) {
      pendingFraction = clamp(fraction);
      if (!duration) return;
      target = targetFor(pendingFraction);
      schedule();
    }
    function fail(message) {
      if (destroyed) return;
      failed = true;
      ready = false;
      enabled = false;
      target = null;
      cancelWork();
      stopPlayback();
      setMode();
      say(message);
      for (const button of enableButtons) button.textContent = source ? 'Try film again' : 'Film unavailable';
    }
    function arm(explicit = false) {
      if (destroyed || paused) {
        say('Page motion is paused. Resume motion in the header to enable the film.');
        return false;
      }
      if (!source) { fail('The film is not available. Enjoy the still image and the story below.'); return false; }
      if (!explicit && (explicitRequired() || !near)) return false;
      if (enabled && !failed) return true;
      failed = false;
      enabled = true;
      ready = false;
      duration = 0;
      seeking = false;
      video.preload = 'auto';
      video.src = source;
      setMode();
      say('Loading the film. The story remains available while it arrives.');
      video.load();
      return true;
    }
    function enable() {
      localPause = false;
      if (!arm(true)) return false;
      measure();
      if (!reducedQuery.matches && !mobileQuery.matches) requestFraction(measure());
      else say('Film enabled. Choose a chapter or Play film when you are ready.');
      setMode();
      return true;
    }
    function play() {
      if (destroyed || paused) { say('Page motion is paused. Resume motion in the header to play the film.'); return; }
      measure();
      if (!visible) { say('The film is off screen. Return to the scene to play it.'); return; }
      if (!arm(true)) return;
      localPause = false;
      cancelWork();
      target = null;
      pendingFraction = null;
      const attempt = ++playAttempt;
      // Keep play() in the initiating click/keyboard event for mobile activation.
      let promise;
      playing = true;
      setMode();
      try {
        if (duration && video.currentTime >= duration - 0.08) video.currentTime = 0;
        promise = video.play();
      } catch (_) { playing = false; setMode(); say('Playback was blocked. Try Play film again; the still image remains available.'); return; }
      Promise.resolve(promise).then(() => {
        if (destroyed || attempt !== playAttempt || paused || !visible || document.hidden) {
          video.pause();
          return;
        }
        playing = true;
        setMode();
        say('Film playing silently. Pause at any time.');
      }).catch(() => {
        if (destroyed || attempt !== playAttempt) return;
        playing = false;
        setMode();
        say('Playback was blocked. Try Play film again, or choose a chapter.');
      });
    }
    function pause() {
      localPause = true;
      target = null;
      cancelWork();
      stopPlayback();
      say('Film paused. Choose a chapter or Play film to continue.');
    }
    function seekToFraction(value) {
      const fraction = Number(value);
      if (!Number.isFinite(fraction) || destroyed) return false;
      if (paused) { say('Page motion is paused. Resume motion in the header to explore film chapters.'); return false; }
      if (!arm(true)) return false;
      measure();
      localPause = true; // Hold a chosen chapter through any in-flight native/smooth scroll.
      stopPlayback();
      requestFraction(fraction);
      say(reducedQuery.matches || mobileQuery.matches ? 'Chapter selected. Choose another moment or play the film when you are ready.' : 'Chapter selected. Choose Resume scroll or Play film when you are ready.');
      return true;
    }
    function onScroll() {
      if (destroyed) return;
      const wasVisible = visible;
      const fraction = measure();
      if (!visible) {
        cancelWork();
        if (playing) { localPause = true; stopPlayback(); say('Film paused while off screen. Choose Play film to continue.'); }
        return;
      }
      if (!wasVisible && target !== null) schedule();
      if (!enabled || paused || reducedQuery.matches || mobileQuery.matches || localPause || playing || failed) return;
      requestFraction(fraction);
    }
    function refreshMotion() {
      if (destroyed) return;
      if (reducedQuery.matches || paused) {
        cancelWork();
        target = null;
        stopPlayback();
        say(paused ? 'Page motion is paused. The film remains still.' : 'Reduced motion is on. Choose Play film or a chapter for an optional film view.');
      } else if (!enabled && near && !explicitRequired()) arm(false);
      setMode();
      if (!reducedQuery.matches && !paused) onScroll();
    }
    function updateMotion(value) { paused = Boolean(value); refreshMotion(); }

    listen(video, 'loadedmetadata', () => {
      if (destroyed || failed) return;
      duration = Number(video.duration);
      if (!Number.isFinite(duration) || duration <= 0) { duration = 0; fail('Film timing is unavailable. The still image and story remain available.'); return; }
      display();
      if (!playing) {
        if (pendingFraction !== null) requestFraction(pendingFraction);
        else if (!reducedQuery.matches && !mobileQuery.matches && !localPause) requestFraction(measure());
      }
      say(reducedQuery.matches || mobileQuery.matches ? 'Film ready. Choose Play film or a chapter when you are ready.' : 'Film ready. Scroll through the scene, choose a chapter, or play the silent film.');
    });
    listen(video, 'loadeddata', () => { if (!destroyed && !failed && video.readyState >= 2) { ready = true; setMode(); display(); } });
    listen(video, 'seeked', () => {
      seeking = false;
      global.clearTimeout(watchdog);
      watchdog = 0;
      if (destroyed) return;
      if (!failed && video.readyState >= 2) { ready = true; setMode(); }
      display();
      if (target !== null && Math.abs(video.currentTime - target) < EPSILON) target = null;
      schedule();
    });
    listen(video, 'timeupdate', display);
    listen(video, 'ended', () => { if (!destroyed) { playing = false; localPause = true; setMode(); display(); say('The film has finished. Choose a chapter or Play film to watch again.'); } });
    listen(video, 'error', () => fail('The film could not load. The still image and story are still here. You may try again.'));
    listen(video, 'waiting', () => { if (playing) say('The film is buffering. You can pause or continue exploring the page.'); });
    listen(global, 'scroll', onScroll, { passive: true });
    listen(global, 'resize', onScroll, { passive: true });
    listen(document, 'visibilitychange', onScroll);
    for (const button of enableButtons) listen(button, 'click', event => { event.preventDefault(); enable(); });
    for (const button of playButtons) listen(button, 'click', event => { event.preventDefault(); play(); });
    for (const button of pauseButtons) listen(button, 'click', event => { event.preventDefault(); pause(); });
    for (const button of chapters) listen(button, 'click', event => { event.preventDefault(); seekToFraction(button.dataset.filmChapter); });
    for (const query of [reducedQuery, mobileQuery]) {
      if (query.addEventListener) listen(query, 'change', refreshMotion);
      else { query.addListener(refreshMotion); cleanups.push(() => query.removeListener(refreshMotion)); }
    }
    if (connection?.addEventListener) listen(connection, 'change', refreshMotion);
    if ('IntersectionObserver' in global) {
      nearObserver = new IntersectionObserver(entries => {
        if (destroyed) return;
        near = entries.some(entry => entry.isIntersecting);
        if (near && !explicitRequired() && !paused) arm(false);
      }, { rootMargin: '350px 0px' });
      visibleObserver = new IntersectionObserver(() => { if (!destroyed) onScroll(); }, { threshold: 0 });
      nearObserver.observe(root);
      visibleObserver.observe(root);
    } else {
      const fallback = () => { const r = root.getBoundingClientRect(); near = r.bottom > -350 && r.top < innerHeight + 350; if (near && !explicitRequired() && !paused) arm(false); onScroll(); };
      listen(global, 'scroll', fallback, { passive: true });
      fallback();
    }
    setMode();
    display();
    if (!source) say('The film is not available. Enjoy the still image and story.');
    else if (paused) say('Page motion is paused. The film remains still.');
    else if (reducedQuery.matches) say('Reduced motion is on. Choose Play film or a chapter for an optional film view.');
    else if (explicitRequired()) say('Enable the film when you are ready, or play it silently at your own pace.');
    else say('Scroll through an ordinary gesture. The silent film loads as you approach.');

    return Object.freeze({
      updateMotion, refreshMotion, enable, play, pause, seekToFraction,
      getState: () => ({ enabled, ready, failed, paused, playing, localPause, visible, near, duration, target, seeking, destroyed, reducedMotion: reducedQuery.matches, explicitRequired: explicitRequired() }),
      destroy() {
        if (destroyed) return;
        destroyed = true;
        playAttempt++;
        cancelWork();
        cleanups.forEach(remove => remove());
        nearObserver?.disconnect();
        visibleObserver?.disconnect();
        video.pause();
        video.removeAttribute('src');
        video.preload = 'none';
        video.load(); // Abort an in-flight media request when the SPA route is discarded.
        target = null;
        playing = false;
      }
    });
  }
  global.SlowFormScrollVideo = Object.freeze({ mount, init: mount });
})(window);
