/*
 * Teag-Ask voice input (speech to text), in the style of ChatGPT / Claude dictation.
 *
 *   mic button → recording: live waveform, timer, ✕ cancel, ✓ done (Enter / Esc work too)
 *             → transcribing: the waveform shimmers while /api/transcribe (Azure OpenAI) runs
 *             → the text is written into the question box for the user to check and send.
 *
 * Works alongside the React bundle without touching it: the button is added to every
 * .composer-main, and text goes into the controlled #question textarea through its native
 * value setter plus an input event, so React's state stays in step.
 */
(function () {
  'use strict';
  if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) return;

  const ACCESS_KEY_STORAGE = 'teagask-preprod-access-key';
  const MAX_SECONDS = 120;
  const SAMPLE_MS = 45;          // one waveform bar per sample
  const BAR = 3, GAP = 2;        // bar width / gap in CSS px
  const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ICON = {
    mic: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="8.5" y="3" width="7" height="12" rx="3.5" fill="currentColor"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cancel: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  // ---------------------------------------------------------------- one session at a time
  let s = null;   // { main, overlay, canvas, timer, stream, recorder, chunks, ctx, analyser, levels, t0, raf, sampler, phase, abort }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;
    return n;
  }

  function announce(main, text) {
    let live = main.querySelector('.tav-live');
    if (!live) { live = el('span', 'tav-live'); live.setAttribute('aria-live', 'polite'); main.appendChild(live); }
    live.textContent = text;
  }

  function toast(main, text) {
    main.querySelectorAll('.tav-toast').forEach(t => t.remove());
    const t = el('div', 'tav-toast');
    t.setAttribute('role', 'status');
    t.textContent = text;
    main.appendChild(t);
    setTimeout(() => t.classList.add('tav-toast--out'), 3800);
    setTimeout(() => t.remove(), 4200);
  }

  // ---------------------------------------------------------------- recording
  async function start(main, button) {
    if (s) return;
    main.querySelectorAll('.tav-toast').forEach(t => t.remove());
    button.classList.add('tav-mic--asking');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      button.classList.remove('tav-mic--asking');
      const name = err && err.name;
      toast(main, name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Microphone access is blocked. Allow it in your browser’s site settings to use voice input.'
        : name === 'NotFoundError' ? 'No microphone was found.' : 'The microphone could not be started.');
      return;
    }
    button.classList.remove('tav-mic--asking');
    if (!main.isConnected) { stream.getTracks().forEach(t => t.stop()); return; }

    const overlay = el('div', 'tav-overlay');
    overlay.innerHTML =
      '<span class="tav-rec" aria-hidden="true"></span><span class="tav-time">0:00</span>' +
      '<canvas class="tav-wave" aria-hidden="true"></canvas>' +
      `<button type="button" class="tav-btn tav-cancel" aria-label="Cancel voice input" title="Cancel (Esc)">${ICON.cancel}</button>` +
      `<button type="button" class="tav-btn tav-done" aria-label="Stop and transcribe" title="Done (Enter)">${ICON.stop}<span class="tav-spin" aria-hidden="true"></span></button>`;
    main.appendChild(overlay);
    main.setAttribute('data-tav', 'recording');

    const recorder = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined);
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    ctx.createMediaStreamSource(stream).connect(analyser);

    s = {
      main, button, overlay, stream, recorder, ctx, analyser, chunks: [], levels: [], phase: 'recording',
      canvas: overlay.querySelector('.tav-wave'), timer: overlay.querySelector('.tav-time'),
      t0: performance.now(), lastAt: performance.now(), smooth: 0, raf: 0, sampler: 0, abort: null, peak: 0.04,
    };
    recorder.ondataavailable = e => { if (e.data && e.data.size) s && s.chunks.push(e.data); };
    recorder.start(250);

    overlay.querySelector('.tav-cancel').addEventListener('click', cancel);
    overlay.querySelector('.tav-done').addEventListener('click', finish);
    overlay.querySelector('.tav-done').focus({ preventScroll: true });
    document.addEventListener('keydown', onKey, true);

    const buf = new Float32Array(analyser.fftSize);
    s.sampler = setInterval(() => {
      if (!s || s.phase !== 'recording') return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      s.peak = Math.max(rms, s.peak * 0.995, 0.04);        // slow auto-gain so quiet voices still move the bars
      // light smoothing so neighbouring bars flow into each other instead of flickering
      const level = Math.min(1, Math.pow(rms / s.peak, 0.8));
      s.smooth = s.smooth * 0.35 + level * 0.65;
      s.levels.push(s.smooth);
      s.lastAt = performance.now();
      if (s.levels.length > 600) s.levels.splice(0, s.levels.length - 600);
      const secs = (performance.now() - s.t0) / 1000;
      s.timer.textContent = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
      if (secs >= MAX_SECONDS) finish();
    }, SAMPLE_MS);
    draw();
    announce(main, 'Recording. Press Enter when you are done, or Escape to cancel.');
  }

  function draw() {
    if (!s) return;
    const { canvas, levels, phase } = s;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = getComputedStyle(canvas).color;

    const STEP = BAR + GAP;
    const slots = Math.ceil(w / STEP) + 1;
    const now = performance.now();
    // Bars glide left continuously: between samples the whole strip shifts by the fraction of a
    // slot that has elapsed, so it moves every frame instead of jumping one slot per sample.
    const live = phase === 'recording' && !reduced();
    const sinceSample = live ? Math.min(1, (now - s.lastAt) / SAMPLE_MS) : 1;
    const shift = live ? (1 - sinceSample) * STEP : 0;
    const shimmerX = ((now / 1100) % 1.6 - 0.3) * w;
    for (let i = 0; i < slots; i++) {
      const li = levels.length - slots + i;
      let v = li >= 0 ? levels[li] : 0;
      if (li === levels.length - 1 && live) v *= sinceSample;          // newest bar grows in as it enters
      const x = w - (slots - i) * STEP + shift;
      let alpha = li >= 0 ? 0.9 : 0.22;
      if (phase === 'transcribing') {
        // a soft highlight sweeps across the frozen waveform while the text is on its way
        const d = Math.abs(x - shimmerX) / (w * 0.18);
        alpha = 0.22 + 0.7 * Math.max(0, 1 - d * d);
      }
      const bh = Math.max(2, v * (h - 4));
      g.globalAlpha = alpha;
      roundRect(g, x, (h - bh) / 2, BAR, bh, BAR / 2);
    }
    g.globalAlpha = 1;
    s.raf = requestAnimationFrame(draw);
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
    g.fill();
  }

  function onKey(e) {
    if (!s) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    else if (e.key === 'Enter' && s.phase === 'recording') { e.preventDefault(); e.stopPropagation(); finish(); }
  }

  function stopCapture() {
    clearInterval(s.sampler);
    s.stream.getTracks().forEach(t => t.stop());
    s.ctx.close().catch(() => {});
  }

  function teardown(focus = true) {
    if (!s) return;
    const { main, overlay, raf, button } = s;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    s = null;
    overlay.classList.add('tav-overlay--out');
    main.setAttribute('data-tav', 'leaving');
    setTimeout(() => {
      overlay.remove();
      if (main.getAttribute('data-tav') === 'leaving') main.removeAttribute('data-tav');
    }, reduced() ? 0 : 180);
    if (focus) {
      const q = main.querySelector('#question');
      if (q) q.focus({ preventScroll: true }); else button.focus({ preventScroll: true });
    }
  }

  function cancel() {
    if (!s) return;
    if (s.abort) s.abort.abort();
    if (s.phase === 'recording') {
      s.recorder.onstop = null;
      try { s.recorder.stop(); } catch (_) { /* already stopped */ }
      stopCapture();
    }
    announce(s.main, 'Voice input cancelled.');
    teardown();
  }

  function finish() {
    if (!s || s.phase !== 'recording') return;
    const session = s;
    session.phase = 'transcribing';
    session.main.setAttribute('data-tav', 'transcribing');
    session.overlay.querySelector('.tav-done').setAttribute('aria-label', 'Transcribing');
    announce(session.main, 'Transcribing.');
    session.recorder.onstop = () => upload(session);
    try { session.recorder.stop(); } catch (_) { upload(session); }
    stopCapture();
  }

  async function upload(session) {
    if (s !== session) return;   // cancelled meanwhile
    const type = (session.recorder.mimeType || MIME || 'audio/webm').split(';')[0];
    const blob = new Blob(session.chunks, { type });
    session.abort = new AbortController();
    let key = '';
    try { key = localStorage.getItem(ACCESS_KEY_STORAGE) || ''; } catch (_) { /* storage blocked */ }
    try {
      const res = await fetch('api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': type, 'x-app-key': key },
        body: blob,
        signal: session.abort.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (s !== session) return;
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Voice input is unavailable right now.');
      const text = String(data.text || '').trim();
      const main = session.main;
      teardown(false);
      if (!text) { toast(main, 'Didn’t catch that. Try again a little closer to the microphone.'); main.querySelector('#question')?.focus(); return; }
      insert(main, text);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (s !== session) return;
      const main = session.main;
      teardown();
      toast(main, err && err.message ? err.message : 'Voice input is unavailable right now.');
    }
  }

  // ---------------------------------------------------------------- write into the React-controlled textarea
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;

  function insert(main, text) {
    const q = main.querySelector('#question') || document.getElementById('question');
    if (!q) return;
    const before = q.value;
    const lead = before && !/\s$/.test(before) ? before + ' ' : before;
    const words = text.split(/(\s+)/);
    const put = v => { setValue.call(q, v); q.dispatchEvent(new Event('input', { bubbles: true })); };
    const done = () => {
      q.focus({ preventScroll: true });
      q.setSelectionRange(q.value.length, q.value.length);
      q.scrollTop = q.scrollHeight;
      main.classList.add('tav-inserted');
      setTimeout(() => main.classList.remove('tav-inserted'), 900);
      announce(main, 'Transcribed. Check the text, then send.');
    };
    if (reduced() || words.length < 3) { put(lead + text); done(); return; }
    // Write the words in quickly, like they are being typed, over at most ~0.6 s.
    const step = Math.max(1, Math.ceil(words.length / 24));
    let i = 0;
    (function tick() {
      i = Math.min(words.length, i + step);
      put(lead + words.slice(0, i).join(''));
      q.scrollTop = q.scrollHeight;
      if (i < words.length) setTimeout(tick, 24); else done();
    })();
  }

  // ---------------------------------------------------------------- add the mic button to each composer
  function attach(main) {
    if (main.querySelector(':scope > .tav-mic')) return;
    const send = main.querySelector(':scope > .ask-button');
    if (!send) return;
    const button = el('button', 'tav-mic', ICON.mic);
    button.type = 'button';
    button.setAttribute('aria-label', 'Voice input');
    button.title = 'Voice input';
    button.addEventListener('click', e => { e.preventDefault(); start(main, button); });
    main.insertBefore(button, send);
  }

  function scan() {
    document.querySelectorAll('.composer-main').forEach(attach);
    // React swapped the composer (welcome → chat) while recording: stop cleanly.
    if (s && !s.main.isConnected) cancel();
  }
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState !== 'loading') scan(); else document.addEventListener('DOMContentLoaded', scan);
})();
