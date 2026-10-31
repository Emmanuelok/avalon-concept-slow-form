# Slow Form film-controller API

`scroll-video.js` registers `window.SlowFormScrollVideo.mount` (`init` is an alias). It does not embed or fetch a media source before mounting and eligibility. Use a source-less video element: no `src` attribute or `<source>` child. Source and poster are validated as same-origin HTTP(S) URLs.

```js
const film = window.SlowFormScrollVideo.mount(document.querySelector('#pour-story'), {
  source: 'assets/ritual-scroll.mp4',
  poster: 'assets/ritual-poster.jpg',
  paused: state.motion === false
});
film.updateMotion(state.motion === false); // manual global pause, not device preference
film.destroy(); // BEFORE replacing the route DOM
```

The controller independently reads device reduced motion. Passing `media.matches` as manual `paused` would also prevent the explicit user-controlled Play alternative under reduced motion, so keep those concerns separate.

Return methods: `updateMotion(boolean)`, `refreshMotion()`, `enable()`, `play()`, `pause()`, `seekToFraction(number)`, `getState()` and `destroy()`. `getState()` is diagnostic, contains no personal data, and exposes current eligibility/loading/seek state.

## Markup hooks

Root: `#pour-story.pour-story`. First descendant `video` or `[data-scroll-video]` is the source-less video. The existing `data-film-video` element is supported through the `video` selector. Optional hooks:

- `[data-film-enable]`: explicit enable/resume native-scroll control. May occur on both overlay and a visible control-bar button.
- `[data-film-play]`: explicit silent playback. Works with reduced motion if manual page pause is off.
- `[data-film-pause]`: holds the film until an explicit chapter, enable, or play choice.
- `[data-film-chapter="0"]`, `"0.5"`, `"0.95"`: native keyboard buttons selecting normalized fractions of actual duration; route is unchanged. The chosen frame holds through subsequent or in-flight native/smooth scrolling until explicit Resume scroll, Play or another chapter. The visible desktop Resume scroll button must carry data-film-enable. Mobile/tablet normal-flow scenes use only explicit chapters and playback, without scroll-driven seeks.
- `[data-film-status]` / `.pour-status`: meaningful state messages. Use `role="status"`; no per-frame live announcement.
- `[data-film-time]` / `.pour-time`: elapsed/total timestamp; avoid `aria-live` here.
- `.pour-poster`: independent visible image fallback.

Root states: `data-film-ready`, `data-film-enabled`, `data-film-error`, `data-film-playing` are boolean strings. `data-film-mode` is `static` for mobile or system reduced motion and `scroll` otherwise. CSS custom property `--film-progress` reflects actual current time, not an unconfirmed intended seek. Caption text and ritual CTA must remain meaningful without the film.

## Behavior and cleanup

Desktop arms within a350px observer margin, never calls playback automatically. Mobile/coarse pointer, data-saver and reduced-motion devices require explicit activation. Global manual pause blocks source loading, seeking and playing until resumed. Reduced-motion defaults static/no source; the user may explicitly play or select a frame. Native scroll uses actual section geometry and actual finite media duration, seeks at most30fps with0.04s epsilon, and coalesces latest target until `seeked`. Targets end0.01s before duration to avoid spurious end resets. No custom wheel handling, sound, loop or autoplay.

Offscreen scenes cancel scheduled seek work and pause playback. Playback does not resume automatically on re-entry. Destroy disconnects observers, removes all owned listeners, cancels timers/RAF, pauses video and removes its source to abort loading. Source errors preserve the poster and explain retry; playback rejection explains the blocked state without claiming playback occurred.

## Evidence

`../evidence/scroll-video-contract-test.mjs` and `scroll-video-contract-results.json` cover ten deterministic cases using DOM/media API mocks: desktop arm/no autoplay, native-scroll timing, latest-target coalescing, epsilon, chapter route stability, manual pause, mobile/data-saver/reduced explicit activation, offscreen/route cleanup, playback rejection/load fallback, and invalid/remote source rejection. These tests do **not** prove media decoding or visual quality. Parent owns real local clip licence, actual frame verification and desktop/mobile scene review on the Range-enabled8768server.
