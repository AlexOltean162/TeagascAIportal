/*
 * TeagAsk logo controller.
 *
 *   const logo = TeagAskLogo(document.getElementById('teag-ask-logo'));
 *   logo.intro();          // play the start-up animation
 *   logo.startLoading();   // thinking: morph into a round bubble with spinning arcs
 *   logo.startWriting();   // writing: arcs settle, the lime arc becomes a talking mouth
 *   logo.pulse();          // call per chunk of streamed text — the mouth "says" it
 *   logo.stopLoading(outcome);  // 'done' (happy hop), 'error' (oops shake) or 'stopped' (quiet settle) — returns a Promise
 *   logo.blink(), logo.squint(), logo.look(dx, dy), logo.puzzled()   // small expressions for UI feedback
 *
 * Needs the inline SVG from teag-ask-logo-animatable.svg and the rules in teag-ask-logo.css.
 */
(function (global) {
  const CY = 166.5, L0 = 85.26, R0 = 334.22;
  const MID = (L0 + R0) / 2, M_MAX = (R0 - L0) / 2;   // M_MAX turns the pill into a circle
  const BODY_R = 79.26, CLIP_R = 73.26, GROUND = 240;
  const END_X = 355;                                    // resting arc ends tuck under the front hill
  const EYE_SHIFT = { x: MID - 205.385, y: 11, pinch: 8 };
  const RINGS = {
    lime:  { r: 63.26, tip: 289.9, dir: -1, speed: 1.1,  len: [0.22, 0.5],  phase: 0 },
    green: { r: 69.76, tip: 332.3, dir: 1,  speed: 0.72, len: [0.42, 0.68], phase: Math.PI },
  };
  const LAND_TIME = 0.9, MORPH_TIME = 0.6;
  // writing phase: lime becomes a mouth at the bottom of the bubble, green drifts slowly
  // The mouth follows a smoothed "is text arriving" level, not individual chunks — real streams arrive
  // in fast bursts, and reacting to each one makes the mouth jitter.
  const MOUTH = { len: 0.11, open: 0.035, width: 6, widthOpen: 3.2, settle: 0.55, rate: 2.6, attack: 0.12, release: 0.45, hold: 0.3 };
  const WRITE = { speed: { lime: 0, green: 0.16 }, len: 0.3 };

  const clamp01 = t => Math.min(1, Math.max(0, t));
  const mod1 = x => ((x % 1) + 1) % 1;
  const inOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const f = n => (Math.round(n * 100) / 100).toString();

  const pill = (r, m) => {
    const l = L0 + m, rr = R0 - m;
    return `M${f(rr)},${f(CY - r)}H${f(l)}A${r},${r} 0 0 0 ${f(l)},${f(CY + r)}H${f(rr)}A${r},${r} 0 0 0 ${f(rr)},${f(CY - r)}`;
  };
  // the dash that exactly covers the resting ring: from the gap tip round to under the front hill
  const home = ring => {
    const straight = R0 - L0, P = 2 * straight + 2 * Math.PI * ring.r;
    const s0 = R0 - ring.tip;
    const s1 = 2 * straight + Math.PI * ring.r + ring.r * Math.asin((END_X - R0) / ring.r);
    return { off: -s0 / P, len: (s1 - s0) / P };
  };
  const HOP = [
    { transform: 'none', easing: 'ease-out' },
    { transform: 'scale(1.035, .95)', offset: 0.18, easing: 'cubic-bezier(.2,.7,.3,1)' },
    { transform: 'translateY(-12px) scale(.975, 1.04)', offset: 0.45, easing: 'cubic-bezier(.6,0,.9,.5)' },
    { transform: 'scale(1.03, .965)', offset: 0.68, easing: 'ease-out' },
    { transform: 'scale(.995, 1.01)', offset: 0.84 },
    { transform: 'none' },
  ];
  const SHAKE = [                                          // "oops": a small, quick head-shake
    { transform: 'none' }, { transform: 'translateX(-4px) rotate(-2deg)', offset: 0.2 }, { transform: 'translateX(4px) rotate(2deg)', offset: 0.4 },
    { transform: 'translateX(-3px) rotate(-1deg)', offset: 0.6 }, { transform: 'translateX(2px)', offset: 0.8 }, { transform: 'none' },
  ];

  function TeagAskLogo(svg) {
    const $ = id => svg.querySelector('#' + id);
    const el = {
      lime: $('ring-lime-flow'), green: $('ring-green-flow'), body: $('body-ring'), tail: $('tail'),
      clip: $('hill-clip-path'), hills: [...svg.querySelectorAll('.hill-pos')],
      eyesPos: $('eyes-pos'), eyes: $('eyes'), eyeL: $('eye-left'), eyeR: $('eye-right'), character: $('character'),
      ringLime: $('ring-lime'), ringGreen: $('ring-green'),
    };
    const rest = {
      lime: el.lime.getAttribute('d'), green: el.green.getAttribute('d'),
      body: el.body.getAttribute('d'), clip: el.clip.getAttribute('d'),
      eyeL: +el.eyeL.getAttribute('cx'), eyeR: +el.eyeR.getAttribute('cx'),
    };
    const reduced = () => global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    let state = 'idle', raf = 0, last = 0, clock = 0, blinkAt = 0, done = null, pendingStart = false, outcome = 'done', lookAnim = null;
    let m = 0, hillY = 1, eyeMix = 0, lookA = 0, lookX = 0, lookY = 0, phase = 'spin', talk = 0, lastTextAt = -1, mouthOpen = 0;
    const tweens = {};
    const rs = {};
    const resetRings = () => { for (const k in RINGS) rs[k] = { ...home(RINGS[k]), v: 0, landing: null, landed: false, mouth: false }; };
    resetRings();

    const tween = (name, to, dur, ease, delay = 0) => {
      const from = { m, hillY, eyeMix }[name];
      tweens[name] = { from, to, t0: clock + delay, dur, ease };
    };
    const runTweens = () => {
      for (const name in tweens) {
        const tw = tweens[name], t = clamp01((clock - tw.t0) / tw.dur);
        if (clock < tw.t0) continue;
        const v = tw.from + (tw.to - tw.from) * tw.ease(t);
        if (name === 'm') m = v; else if (name === 'hillY') hillY = v; else eyeMix = v;
        if (t === 1) delete tweens[name];
      }
    };

    const squint = () => [el.eyeL, el.eyeR].forEach(e => e.animate(      // happy ^^ eyes for "done"
      [{ transform: 'none' }, { transform: 'scale(1.12, .42)', offset: 0.25 }, { transform: 'scale(1.12, .42)', offset: 0.75 }, { transform: 'none' }],
      { duration: 700, easing: 'ease-in-out' }));
    const sad = () => [el.eyeL, el.eyeR].forEach(e => e.animate(          // eyes droop for "error"
      [{ transform: 'none' }, { transform: 'translateY(2px) scale(1, .72)', offset: 0.2 }, { transform: 'translateY(2px) scale(1, .72)', offset: 0.8 }, { transform: 'none' }],
      { duration: 1300, easing: 'ease-in-out' }));
    const blink = () => [el.eyeL, el.eyeR].forEach(e => e.animate(
      [{ transform: 'none' }, { transform: 'scaleY(.1)' }, { transform: 'none' }],
      { duration: 190, easing: 'ease-in-out' }));

    // where the bottom-centre of a ring sits along its (normalised) path at the current morph
    const bottomCentre = r => { const straight = R0 - L0 - 2 * m; return (1.5 * straight + Math.PI * r) / (2 * straight + 2 * Math.PI * r); };

    // Sweep a ring to a target dash (Hermite: leaves at its current speed, arrives at rest exactly on target)
    function land(k, off1, len1, isHome, dur) {
      const R = RINGS[k], s = rs[k];
      let sign, delta, v0 = 0;
      if (s.v > 0.05) {                                   // keep turning the way it spins
        sign = R.dir; v0 = s.v;
        const ahead = mod1(R.dir * (off1 - s.off));
        delta = ahead < (v0 * dur) / 3 ? ahead + 1 : ahead;
      } else {                                            // nearly still: take the short way
        const d = off1 - s.off, short = d - Math.round(d);
        sign = short >= 0 ? 1 : -1; delta = Math.abs(short);
      }
      s.landing = { t0: clock, dur, off0: s.off, off1, len0: s.len, len1, delta, v0, sign, home: isHome };
      s.mouth = false;
    }

    function updateRing(k, dt) {
      const R = RINGS[k], s = rs[k], h = home(R);
      if (s.landed) return;
      if (state === 'stopping' && !(s.landing && s.landing.home)) return land(k, h.off, h.len, true, LAND_TIME);
      if (s.landing) {
        const L = s.landing, u = clamp01((clock - L.t0) / L.dur);
        const travel = L.v0 * L.dur * (u - 2 * u * u + u * u * u) + L.delta * (3 * u * u - 2 * u * u * u);
        s.off = L.off0 + L.sign * travel;
        s.len = L.len0 + (L.len1 - L.len0) * inOut(u);
        if (u === 1) { s.off = L.off1; s.len = L.len1; s.landing = null; s.v = 0; if (L.home) s.landed = true; else s.mouth = true; }
        return;
      }
      if (s.mouth) {                                      // talking: a steady, smooth rhythm while text is arriving
        s.len = MOUTH.len + MOUTH.open * mouthOpen;
        s.off = -(bottomCentre(R.r) - s.len / 2);
        return;
      }
      const writing = phase === 'writing';
      const speed = writing ? WRITE.speed[k] : R.speed;
      s.v += (speed - s.v) * Math.min(1, dt / (writing ? 0.5 : 0.25));
      s.off += R.dir * s.v * dt;
      const target = writing ? WRITE.len : R.len[0] + (R.len[1] - R.len[0]) * (0.5 - 0.5 * Math.cos(clock * 2.6 + R.phase));
      s.len += (target - s.len) * Math.min(1, dt * 3.5);
    }

    function render() {
      for (const k in RINGS) {
        const s = rs[k];
        el[k].setAttribute('d', pill(RINGS[k].r, m));
        el[k].style.strokeDasharray = `${s.len} ${1 - s.len}`;
        el[k].style.strokeDashoffset = s.off;
      }
      el.lime.style.strokeWidth = rs.lime.mouth ? MOUTH.width + MOUTH.widthOpen * mouthOpen : '';
      el.body.setAttribute('d', pill(BODY_R, m));
      el.tail.setAttribute('transform', `translate(${f(m)} 0)`);
      el.clip.setAttribute('d', pill(CLIP_R, m) + 'Z');
      const sx = (R0 - L0 - 2 * m + 2 * CLIP_R) / (R0 - L0 + 2 * CLIP_R);
      const sy = Math.max(0.0001, hillY);
      const hm = `matrix(${f(sx * 1000) / 1000} 0 0 ${sy} ${f(MID * (1 - sx))} ${f(GROUND * (1 - sy))})`;
      el.hills.forEach(h => h.setAttribute('transform', hm));
      const lx = lookX * eyeMix, ly = lookY * eyeMix;
      el.eyesPos.setAttribute('transform', `translate(${f(EYE_SHIFT.x * eyeMix + lx)} ${f(EYE_SHIFT.y * eyeMix + ly)})`);
      el.eyeL.setAttribute('cx', f(rest.eyeL + EYE_SHIFT.pinch * eyeMix));
      el.eyeR.setAttribute('cx', f(rest.eyeR - EYE_SHIFT.pinch * eyeMix));
    }

    function finish() {
      state = 'idle';
      cancelAnimationFrame(raf);
      svg.classList.remove('logo--thinking');
      for (const k in RINGS) { el[k].setAttribute('d', rest[k]); el[k].style.strokeDasharray = ''; el[k].style.strokeDashoffset = ''; el[k].style.strokeWidth = ''; }
      el.body.setAttribute('d', rest.body);
      el.clip.setAttribute('d', rest.clip);
      el.tail.removeAttribute('transform');
      el.hills.forEach(h => h.removeAttribute('transform'));
      el.eyesPos.removeAttribute('transform');
      el.eyeL.setAttribute('cx', rest.eyeL); el.eyeR.setAttribute('cx', rest.eyeR);
      m = 0; hillY = 1; eyeMix = 0; lookX = 0; lookY = 0; phase = 'spin'; talk = 0; mouthOpen = 0; lastTextAt = -1; resetRings();
      if (done) { done.resolve(); done = null; }
      if (pendingStart) { pendingStart = false; startLoading(); }
    }

    function frame(now) {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now; clock += dt;
      runTweens();
      lookA += dt * 2.6;
      // talking level: eases in quickly when text is arriving, fades out gently when it pauses
      const talking = clock - lastTextAt < MOUTH.hold ? 1 : 0;
      talk += (talking - talk) * (1 - Math.exp(-dt / (talking > talk ? MOUTH.attack : MOUTH.release)));
      mouthOpen = talk * (0.5 - 0.5 * Math.cos(clock * 2 * Math.PI * MOUTH.rate));
      // eyes: roll around while thinking; look down at the answer and read along while writing
      const tx = phase === 'writing' ? -0.5 + 3.2 * Math.sin(clock * 1.7) : 4.5 * Math.cos(lookA);
      const ty = phase === 'writing' ? 3.8 : 3.5 * Math.sin(lookA);
      lookX += (tx - lookX) * Math.min(1, dt * 8); lookY += (ty - lookY) * Math.min(1, dt * 8);
      for (const k in RINGS) updateRing(k, dt);
      render();
      if (state === 'thinking' && clock > blinkAt) { blink(); blinkAt = clock + (phase === 'writing' ? 3.2 : 2.4) + Math.random() * 2.4; }
      if (state === 'stopping' && !tweens.m && rs.lime.landed && rs.green.landed) {
        if (hillY < 1 && !tweens.hillY) tweens.hillY = { from: hillY, to: 1, t0: clock, dur: 0.6,
          ease: t => (t < 0.7 ? 1.07 * inOut(t / 0.7) : 1.07 - 0.07 * inOut((t - 0.7) / 0.3)) };
        if (!tweens.hillY && !tweens.eyeMix) {
          state = 'celebrating';
          if (outcome === 'error') {                     // oops: head-shake, droopy eyes, rings dim and recover
            el.character.animate(SHAKE, { duration: 520, easing: 'ease-in-out' });
            sad();
            setTimeout(() => { finish(); [el.ringLime, el.ringGreen].forEach(r => r.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 1400, easing: 'ease-in' })); }, 540);
          } else if (outcome === 'stopped') {            // stopped: just settle back quietly
            setTimeout(blink, 60);
            setTimeout(finish, 260);
          } else {                                       // done: happy hop with ^^ eyes
            el.character.animate(HOP, { duration: 800 });
            setTimeout(squint, 120);
            setTimeout(finish, 820);
          }
          return render();
        }
      }
      if (state !== 'idle' && state !== 'celebrating') raf = requestAnimationFrame(frame);
    }

    function startLoading() {
      if (state === 'thinking') return;
      if (state === 'celebrating') { pendingStart = true; return; }
      if (reduced()) { svg.classList.add('logo--thinking-reduced'); state = 'thinking'; return; }
      svg.classList.remove('logo--intro');
      svg.classList.add('logo--thinking');
      if (lookAnim) { lookAnim.cancel(); lookAnim = null; }
      if (state === 'stopping') for (const k in RINGS) { rs[k].landing = null; rs[k].landed = false; rs[k].mouth = false; }
      phase = 'spin';
      if (state === 'idle') { render(); blinkAt = clock + 0.05; last = 0; raf = requestAnimationFrame(frame); }
      state = 'thinking';
      tween('hillY', 0, 0.4, inOut);
      tween('m', M_MAX, MORPH_TIME, inOut, 0.08);
      tween('eyeMix', 1, MORPH_TIME, inOut, 0.08);
    }

    function stopLoading(result = 'done') {
      if (state === 'stopping' || state === 'celebrating') return done ? done.promise : Promise.resolve();
      outcome = result;
      if (state !== 'thinking') return Promise.resolve();
      if (svg.classList.contains('logo--thinking-reduced')) {
        svg.classList.remove('logo--thinking-reduced'); state = 'idle'; return Promise.resolve();
      }
      state = 'stopping';
      tween('m', 0, MORPH_TIME, inOut);
      tween('eyeMix', 0, MORPH_TIME, inOut);
      done = {};
      done.promise = new Promise(resolve => { done.resolve = resolve; });
      return done.promise;
    }

    function startWriting() {
      if (state !== 'thinking' || phase === 'writing' || svg.classList.contains('logo--thinking-reduced')) return;
      phase = 'writing';
      land('lime', -(bottomCentre(RINGS.lime.r) - MOUTH.len / 2), MOUTH.len, false, MOUTH.settle);
    }
    function pulse() { lastTextAt = clock; }

    // Point the eyes somewhere (in SVG units) while resting; look(0, 0) returns them to centre.
    function look(dx, dy, duration = 260) {
      if (state !== 'idle' || reduced()) return;
      const from = getComputedStyle(el.eyes).transform;
      const a = el.eyes.animate([{ transform: from === 'none' ? 'none' : from }, { transform: `translate(${dx}px, ${dy}px)` }],
        { duration, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
      if (lookAnim) lookAnim.cancel();
      lookAnim = a;
      if (!dx && !dy) a.finished.then(() => { if (lookAnim === a) { a.cancel(); lookAnim = null; } }, () => {});
    }
    function puzzled() {                                 // head tilts, eyes glance up and aside
      if (state !== 'idle' || reduced()) return;
      el.character.animate([{ transform: 'none' }, { transform: 'rotate(-6deg)', offset: 0.3 }, { transform: 'rotate(-6deg)', offset: 0.75 }, { transform: 'none' }],
        { duration: 1100, easing: 'ease-in-out' });
      look(-5, -4, 220);
      setTimeout(() => look(0, 0, 320), 850);
    }

    function intro() {
      if (state !== 'idle') return;
      svg.classList.remove('logo--intro');
      void svg.getBoundingClientRect();
      svg.classList.add('logo--intro');
    }

    // testing aid: advance the thinking animation by `seconds` in fixed 1/60 s steps (no-op when idle)
    function step(seconds) {
      let t = last || performance.now();
      for (let i = 0; i < Math.round(seconds * 60) && state !== 'idle' && state !== 'celebrating'; i++) {
        cancelAnimationFrame(raf); last = t; t += 1000 / 60; frame(t);
      }
    }

    return { intro, startLoading, startWriting, pulse, stopLoading, step, blink, squint, look, puzzled,
      get state() { return state; }, get phase() { return phase; } };
  }

  if (typeof module === 'object' && module.exports) module.exports = TeagAskLogo;
  global.TeagAskLogo = TeagAskLogo;
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * Teag-Ask UI hookup and interaction polish.
 *
 * Character: on the access screen, above the tagline on the welcome screen, and in the top bar during a chat.
 * It glides between those spots, thinks while sources are searched, talks while the answer is written, and ends
 * with a happy hop (answer), an "oops" (error) or a quiet settle (stopped).
 *
 * Also: a scroll-to-latest button (follows the answer once tapped), copy + feedback on answers, "Try again" on errors, topic typing,
 * a circular dark-mode reveal, access-screen feedback and a gently idle character.
 * Everything that moves is skipped when the visitor prefers reduced motion.
 */
(function () {
  const SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 81.24 419.48 170.52\" id=\"teag-ask-logo\" role=\"img\" aria-label=\"TeagAsk logo\" overflow=\"visible\">\n  <defs>\n    <clipPath id=\"hill-clip\"><path id=\"hill-clip-path\" d=\"M85.26,93.24H334.22A73.26,73.26 0 0 1 334.22,239.76H85.26A73.26,73.26 0 0 1 85.26,93.24Z\"/></clipPath>\n    <mask id=\"body-mask\" maskUnits=\"userSpaceOnUse\" x=\"-10\" y=\"40\" width=\"440\" height=\"250\">\n      <path class=\"draw\" id=\"body-draw\" d=\"M346.22,94.24H85.26A72.26,72.26 0 0 0 85.26,238.76H334.22A72.26,72.26 0 0 0 334.22,94.24H322.22\" pathLength=\"1\" fill=\"none\" stroke=\"#fff\" stroke-width=\"100\"/>\n    </mask>\n  </defs>\n  <g id=\"character\">\n    <g clip-path=\"url(#hill-clip)\"><g class=\"hill-pos\"><path id=\"hill-lime\" class=\"hill\" fill=\"#c2cd23\" d=\"M202.03,183.42c41.38,0 75.64,19.86 97.71,36.11c3.66308,2.69511 6.8466,5.11161 9.57193,7.23l-222.70691,0c44.19875,-0.74915 52.54291,-43.34 115.42498,-43.34z\"/></g></g>\n    <path id=\"ring-lime\" class=\"ring\" fill=\"#c2cd23\" d=\"M85.26,106.24c-33.23,0 -60.26,27.03 -60.26,60.26c0,33.23 27.03,60.26 60.26,60.26h248.96c7.39576,0 14.48442,-1.33891 21.03631,-3.78709l4.29639,24.96095c-8.00302,2.48667 -16.51135,3.82615 -25.3327,3.82615h-248.96c-47.09,0 -85.26,-38.17 -85.26,-85.26c0,-47.09 38.17,-85.26 85.26,-85.26h248.96c13.98665,0 27.18637,3.36738 38.83272,9.33569l-38.60272,2.63431l0,0.01l0.08,0.04c2.86996,1.51373 3.12921,5.33959 0.89163,7.30412l-44.34163,0.66588l0.14,0.06c2.18,0.93 2.18,4.02 0,4.95z\"/>\n    <path id=\"ring-lime-flow\" class=\"flow\" display=\"none\" d=\"M289.9,103.24H85.26A63.26,63.26 0 0 0 85.26,229.76H380\" pathLength=\"1\" fill=\"none\" stroke=\"#c2cd23\" stroke-width=\"6\" stroke-linecap=\"round\"/>\n    <g clip-path=\"url(#hill-clip)\"><g class=\"hill-pos\"><path id=\"hill-green\" class=\"hill\" fill=\"#49aa42\" d=\"M110.98,231.7c46.88,0 86.37,-43.27 156.59,-43.27c47.72002,0 68.3128,13.03343 86.33292,26.68003l2.2177,12.88429c-6.84556,2.43816 -14.21806,3.76568 -21.90062,3.76568l-239.27498,0c1.27561,-0.02618 5.04936,-0.06 16.03498,-0.06z\"/></g></g>\n    <path id=\"ring-green\" class=\"ring\" fill=\"#49aa42\" d=\"M85.26,101.24c-35.98,0 -65.26,29.28 -65.26,65.26c0,35.98 29.28,65.26 65.26,65.26h248.96c7.67757,0 15.05007,-1.3332 21.89812,-3.78022l3.43458,19.95408c-8.00302,2.48667 -16.51135,3.82615 -25.3327,3.82615h-248.96c-47.09,0 -85.26,-38.17 -85.26,-85.26c0,-47.09 38.17,-85.26 85.26,-85.26h248.96c13.98665,0 27.18637,3.36738 38.83272,9.33569l-38.60272,2.63431l0,0.01l0.08,0.04c3.25225,1.71536 3.15196,6.39985 -0.13517,7.98023c-0.05826,-0.00015 -0.11654,-0.00023 -0.17483,-0.00023z\"/>\n    <path id=\"ring-green-flow\" class=\"flow\" display=\"none\" d=\"M332.3,96.74H85.26A69.76,69.76 0 0 0 85.26,236.26H368\" pathLength=\"1\" fill=\"none\" stroke=\"#49aa42\" stroke-width=\"9\" stroke-linecap=\"round\"/>\n    <path id=\"body\" fill=\"#008752\" mask=\"url(#body-mask)\" d=\"M85.26,93.24c-40.4,0 -73.26,32.86 -73.26,73.26c0,40.4 32.86,73.26 73.26,73.26h248.96c40.4,0 73.26,-32.86 73.26,-73.26c0,-40.4 -32.86,-73.26 -73.26,-73.26zM334.22,81.24c47.09,0 85.26,38.17 85.26,85.26c0,47.09 -38.17,85.26 -85.26,85.26h-248.96c-2.02777,0 -4.039,-0.07078 -6.03135,-0.21h-69.17865c-5.55,0 -10.05,-4.5 -10.05,-10.05c0,0 0,-75 0,-75c0,-47.09 38.17,-85.26 85.26,-85.26zM0,166.5c0,0 0,0 0,0z\"/>\n    <path id=\"body-ring\" class=\"thinking-part\" display=\"none\" d=\"M334.22,87.24H85.26A79.26,79.26 0 0 0 85.26,245.76H334.22A79.26,79.26 0 0 0 334.22,87.24\" fill=\"none\" stroke=\"#008752\" stroke-width=\"12\"/>\n    <path id=\"tail\" class=\"thinking-part\" display=\"none\" fill=\"#008752\" d=\"M0,166.5c0,0 0,0 0,0zM0,166.5c0,45.16 35.12,82.1 79.53,85.05l-0.30092,0c-44.27351,-3.09395 -79.22908,-39.98982 -79.22908,-85.05h8.26c0,42.52593 34.47407,77 77,77v8.26c-2.02762,0 -4.0387,-0.07078 -6.03092,-0.21h-69.17908c-5.55,0 -10.05,-4.5 -10.05,-10.05z\"/>\n    <g clip-path=\"url(#hill-clip)\"><g class=\"hill-pos\"><path id=\"hill-dark\" class=\"hill\" fill=\"#008752\" d=\"M339.29,251.6l-221.58,-0.44l-0.38,-11.1c0,0 -4.24,-0.23 26.52,-0.23c58.33,0 79.35,-36.89 156.99,-36.89c37.24,0 69.09,11.98 91.18,26.22l0.00924,0.00924c-0.94389,0.87113 -1.9075,1.7212 -2.8901,2.54947c-13.63129,11.48419 -30.90499,18.77132 -49.84914,19.8813z\"/></g></g>\n    <g id=\"eyes-pos\"><g id=\"eyes\">\n      <circle id=\"eye-left\" class=\"eye\" fill=\"#008752\" cx=\"164.11\" cy=\"146.8\" r=\"12.88\"/>\n      <circle id=\"eye-right\" class=\"eye\" fill=\"#008752\" cx=\"246.66\" cy=\"146.8\" r=\"12.88\"/>\n    </g></g>\n  </g>\n</svg>\n";
  const GLIDE = { duration: 700, easing: 'cubic-bezier(.33,.9,.25,1)' };
  const ACCESS_KEY_STORE = 'teagask-preprod-access-key';
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = sel => document.querySelector(sel);
  const live = sel => [...document.querySelectorAll(sel)].find(e => !e.closest('.teagask-ghost'));
  let logo = null, svgEl = null, active = 0, introPlayed = false, lastRect = null;
  let lastQuestion = '', retryFor = null, lastActivity = Date.now();

  // ---------------------------------------------------------------- character placement + glide
  function ensureLogo() {
    if (svgEl) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = SVG.trim();
    svgEl = tpl.content.firstElementChild;
    svgEl.setAttribute('aria-label', 'Teag-Ask');
    svgEl.style.transformOrigin = '0 0';
    logo = window.TeagAskLogo(svgEl);
  }

  // Where the character appears on screen (mid-glide included), so it can glide on after React removes its view.
  function cacheRect() {
    if (!svgEl || !svgEl.isConnected) return;
    const r = svgEl.getBoundingClientRect();
    if (r.width) lastRect = r;
  }

  function glide(from) {
    svgEl.getAnimations().forEach(a => a.cancel());
    const to = svgEl.getBoundingClientRect();
    if (!from || !to.width || reduced()) return;
    const dx = from.left - to.left, dy = from.top - to.top, s = from.width / to.width;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) return;
    svgEl.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], GLIDE).finished.then(cacheRect, () => {});
  }

  function place() {
    const hero = live('.teagask-logo-slot--hero'), bar = live('.teagask-logo-slot--bar'), gate = live('.teagask-logo-slot--gate');
    const target = hero || bar || gate;
    if (!target) return;
    ensureLogo();
    document.documentElement.classList.toggle('teagask-chat', !!bar && !hero);
    if (target.contains(svgEl)) return;
    cacheRect();
    const from = lastRect;
    target.appendChild(svgEl);
    if (!introPlayed) { introPlayed = true; logo.intro(); } else glide(from);
    if (active > 0) logo.startLoading();
    requestAnimationFrame(cacheRect);
  }

  // A view the app removes instantly slides/fades away as a copy, for a smooth hand-over.
  function ghostAway(el, keyframes, duration = 480) {
    const host = $('.app-shell') || document.body;
    if (!el || !host || reduced()) return;
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.querySelectorAll('svg#teag-ask-logo').forEach(e => e.remove());
    ghost.querySelectorAll('.teagask-logo-slot').forEach(e => {
      const kind = [...e.classList].find(c => c.startsWith('teagask-logo-slot--'));
      e.className = 'teagask-ghost-slot' + (kind ? ' ' + kind.replace('logo-slot', 'ghost-slot') : '');
    });
    ghost.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('teagask-ghost');
    Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    host.appendChild(ghost);
    ghost.animate(keyframes, { duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished.then(() => ghost.remove(), () => ghost.remove());
    setTimeout(() => ghost.remove(), duration + 300);   // safety net if animations are paused (e.g. a background tab)
  }
  const slideAwayWelcome = () => ghostAway(live('.welcome-view'), [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-64px)', opacity: 0 }]);
  const dissolveGate = () => ghostAway(live('.access-card'), [{ transform: 'none', opacity: 1, filter: 'blur(0)' }, { transform: 'scale(.96)', opacity: 0, filter: 'blur(4px)' }], 520);

  // ---------------------------------------------------------------- scroll-to-latest button
  // No automatic scrolling while an answer is written. When there is more below, a round arrow appears above
  // the question box; tapping it glides to the bottom and keeps following the answer until the reader scrolls up.
  const stream = { active: false, following: false };
  ['wheel', 'touchmove', 'keydown'].forEach(t => addEventListener(t, e => {
    if (t === 'keydown' && !['ArrowUp', 'PageUp', 'Home'].includes(e.key)) return;
    if (t === 'wheel' && e.deltaY > 0) return;
    stream.following = false;
  }, { passive: true }));
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'teagask-jump';
  jump.setAttribute('aria-label', 'Scroll to the latest message');
  jump.title = 'Scroll to the latest';
  jump.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';
  jump.addEventListener('click', () => {
    if (stream.active && live('.streaming-message')) stream.following = true;   // the follow loop glides down
    else scrollTo({ top: document.documentElement.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
  });
  const mountJump = () => document.body && !jump.isConnected && document.body.appendChild(jump);
  (function tick() {
    mountJump();
    const inChat = document.documentElement.classList.contains('teagask-chat');
    const dock = inChat && live('.composer-dock');
    const msg = stream.active && stream.following && live('.streaming-message');
    const dockH = dock ? dock.getBoundingClientRect().height : 0;
    if (msg) {
      const over = msg.getBoundingClientRect().bottom - (innerHeight - dockH - 24);
      if (over > 1) scrollBy(0, reduced() ? over : Math.max(1, over * 0.18));
    }
    const convo = dock && live('.conversation');
    const lastBit = convo && convo.lastElementChild;               // newest message, note or status line
    const hidden = lastBit ? lastBit.getBoundingClientRect().bottom - (innerHeight - dockH) : 0;
    const show = !!dock && !msg && hidden > 12;
    jump.classList.toggle('is-shown', show);
    jump.classList.toggle('is-live', show && stream.active);   // a new answer is still arriving below
    jump.tabIndex = show ? 0 : -1;
    jump.style.bottom = `${dockH + 14}px`;
    requestAnimationFrame(tick);
  })();

  // ---------------------------------------------------------------- chat lifecycle (fetch watcher)
  const start = () => {
    cacheRect();
    if (active === 0) slideAwayWelcome();
    active++;
    stream.following = false;
    if (logo) logo.startLoading();
  };

  // The app asks to scroll whenever the conversation changes. A new question is brought up to just below the
  // pinned top bar; after that the page only moves when the reader asks it to (the scroll-to-latest button).
  let lastScrolledUser = null;
  window.__teagaskScroll = smooth => {
    const rows = document.querySelectorAll('.conversation > .message-row');
    const last = rows[rows.length - 1];
    if (!last || !last.classList.contains('user') || last === lastScrolledUser) return;
    lastScrolledUser = last;
    last.scrollIntoView({ block: 'start', behavior: smooth && !reduced() ? 'smooth' : 'auto' });
  };
  const stop = outcome => {
    active = Math.max(0, active - 1);
    if (active === 0) stream.active = false;
    if (outcome === 'error' || outcome === 'stopped') {
      retryFor = { question: lastQuestion, at: Date.now() };
      setTimeout(retryOnNewestNote, 0);          // the app may have added its note just before we heard
    }
    if (logo && active === 0) logo.stopLoading(outcome);
  };

  const pathOf = input => new URL(typeof input === 'string' ? input : (input && input.url) || '', location.href).pathname;
  const methodOf = (input, init) => ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
  const origFetch = window.fetch.bind(window);
  const inFlight = new Set();   // answers being generated: { finish, cancel }

  // The app's stop button and "New chat" only stop listening; close the stream too, and end the character quietly.
  document.addEventListener('click', e => {
    if (!inFlight.size || !e.target.closest('.processing-status, .new-chat-button')) return;
    setTimeout(() => inFlight.forEach(f => { f.finish('stopped'); f.cancel(); }), 0);
  }, true);

  window.fetch = async function (input, init) {
    const path = pathOf(input), method = methodOf(input, init);
    if (path.endsWith('/api/access')) return watchAccess(origFetch(input, init));
    if (method !== 'POST' || !/\/api\/chat(\/stream)?$/.test(path)) return origFetch(input, init);

    try { lastQuestion = JSON.parse((init && init.body) || '{}').question || ''; } catch (_) { lastQuestion = ''; }
    start();
    let finished = false, reader = null, userStopped = false;
    // On stop: close the connection to the server, but leave the app's side of the stream quiet — the app has
    // already stopped listening, and ending it would make the app report an incomplete answer.
    const entry = { finish: null, cancel: () => { userStopped = true; try { reader && reader.cancel(); } catch (_) {} } };
    const silence = () => new Promise(() => {});
    const finish = outcome => { if (!finished) { finished = true; inFlight.delete(entry); stop(outcome); } };
    entry.finish = finish;
    inFlight.add(entry);
    let res;
    try { res = await origFetch(input, init); } catch (err) { finish(err && err.name === 'AbortError' ? 'stopped' : 'error'); throw err; }
    if (!res.body || [101, 204, 205, 304].includes(res.status)) { finish(res.ok ? 'done' : 'error'); return res; }
    reader = res.body.getReader();
    // The app stops reading at the "complete" event, so the NDJSON events are watched as they pass through.
    const decoder = new TextDecoder();
    let pending = '';
    const watch = chunk => {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) {
        let ev = null;
        try { ev = JSON.parse(line); } catch (_) { continue; }
        if (!ev) continue;
        if (ev.type === 'token' && logo) { logo.startWriting(); logo.pulse(); stream.active = true; }
        else if (ev.type === 'complete') finish('done');
        else if (ev.type === 'error') finish('error');
      }
    };
    const body = new ReadableStream({
      async pull(ctrl) {
        if (userStopped) return silence();
        try {
          const { done, value } = await reader.read();
          if (userStopped) return silence();
          if (done) { ctrl.close(); finish(res.ok ? 'done' : 'error'); } else { if (!finished) watch(value); ctrl.enqueue(value); }
        } catch (err) {
          if (userStopped) return silence();
          finish(err && err.name === 'AbortError' ? 'stopped' : 'error'); ctrl.error(err);
        }
      },
      cancel(reason) { finish('stopped'); return reader.cancel(reason); },
    });
    const wrapped = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    Object.defineProperty(wrapped, 'url', { value: res.url });
    return wrapped;
  };

  // ---------------------------------------------------------------- access screen feedback
  async function watchAccess(promise) {
    const res = await promise;
    const card = live('.access-card');
    if (!res.ok) {                                   // wrong key: the card shakes and the character looks puzzled
      if (card && !reduced()) card.animate([{ transform: 'none' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 420, easing: 'ease-in-out' });
      if (logo) setTimeout(() => logo.puzzled(), 120);
    } else if (card) {                               // right key: the card dissolves; the character glides on to the welcome screen
      cacheRect();
      dissolveGate();
    }
    return res;
  }

  // ---------------------------------------------------------------- answer actions: copy + feedback
  const ICON = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="teagask-check" d="M5 12.5l4.2 4.2L19 7"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4.5A1.5 1.5 0 0 1 3 18.5v-6A1.5 1.5 0 0 1 4.5 11H7zm0 0l4-7a2 2 0 0 1 3.7 1.3L14 10h5a2 2 0 0 1 2 2.3l-1.2 6.5A2 2 0 0 1 17.8 20H7"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 13V4h2.5A1.5 1.5 0 0 1 21 5.5v6a1.5 1.5 0 0 1-1.5 1.5H17zm0 0l-4 7a2 2 0 0 1-3.7-1.3L10 14H5a2 2 0 0 1-2-2.3l1.2-6.5A2 2 0 0 1 6.2 4H17"/></svg>',
  };
  function answerText(row) {
    const content = row.querySelector('.answer-content');
    if (!content) return '';
    const copy = content.cloneNode(true);
    copy.querySelectorAll('.citation').forEach(c => c.replaceWith(`[${(c.querySelector('.citation-mark') || c).textContent.trim()}]`));
    copy.querySelectorAll('li').forEach(li => li.prepend('• '));
    copy.querySelectorAll('tr').forEach(tr => { [...tr.children].forEach((c, i) => i && c.prepend(' | ')); tr.append('\n'); });
    copy.querySelectorAll('.answer-table-wrap').forEach(t => t.append('\n'));
    copy.querySelectorAll('h3, p, li').forEach(b => b.append('\n'));
    return copy.textContent.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function pop(el) { if (!reduced()) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.3,1.6,.5,1)' }); }
  function addActions(row) {
    const body = row.querySelector('.message-body');
    if (!body || body.querySelector('.teagask-actions')) return;
    const bar = document.createElement('div');
    bar.className = 'teagask-actions';
    bar.innerHTML = `<button type="button" class="teagask-action" data-act="copy" aria-label="Copy answer" title="Copy answer">${ICON.copy}<span class="teagask-action-label">Copy</span></button>
      <button type="button" class="teagask-action" data-act="up" aria-label="Helpful" aria-pressed="false" title="Helpful">${ICON.up}</button>
      <button type="button" class="teagask-action" data-act="down" aria-label="Not helpful" aria-pressed="false" title="Not helpful">${ICON.down}</button>
      <span class="teagask-thanks" aria-live="polite"></span>`;
    bar.addEventListener('click', async e => {
      const btn = e.target.closest('.teagask-action');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'copy') {
        try { await navigator.clipboard.writeText(answerText(row)); } catch (_) { return; }
        btn.classList.add('is-done'); btn.innerHTML = `${ICON.check}<span class="teagask-action-label">Copied</span>`; pop(btn);
        if (logo) logo.blink();
        setTimeout(() => { btn.classList.remove('is-done'); btn.innerHTML = `${ICON.copy}<span class="teagask-action-label">Copy</span>`; }, 1800);
        return;
      }
      if (btn.getAttribute('aria-pressed') === 'true') return;      // one rating per answer
      bar.querySelectorAll('[data-act="up"],[data-act="down"]').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.disabled = true; });
      btn.setAttribute('aria-pressed', 'true'); pop(btn);
      if (logo) (act === 'up' ? logo.squint : logo.blink)();
      const thanks = bar.querySelector('.teagask-thanks');
      let ok = false;
      try {
        const r = await origFetch('api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-app-key': localStorage.getItem(ACCESS_KEY_STORE) || '' },
          body: JSON.stringify({ rating: act, answer_length: answerText(row).length }),
        });
        ok = r.ok;
      } catch (_) { ok = false; }
      if (!ok) {                                      // not recorded: let them try again rather than pretend
        bar.querySelectorAll('[data-act="up"],[data-act="down"]').forEach(b => { b.disabled = false; b.setAttribute('aria-pressed', 'false'); });
        thanks.textContent = 'Couldn’t send feedback — try again';
      } else thanks.textContent = 'Thanks for the feedback';
      thanks.classList.remove('show'); void thanks.offsetWidth; thanks.classList.add('show');
    });
    body.appendChild(bar);
  }

  // ---------------------------------------------------------------- error recovery: "Try again"
  function setQuestion(text) {
    const ta = $('#question');
    if (!ta) return null;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta;
  }
  function addRetry(note) {
    if (!retryFor || Date.now() - retryFor.at > 4000 || note.querySelector('.teagask-retry') || note.dataset.teagaskSeen || !retryFor.question) return;
    note.dataset.teagaskSeen = '1';
    const question = retryFor.question;
    retryFor = null;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'teagask-retry'; btn.textContent = 'Try again';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      const ta = setQuestion(question);
      if (!ta) return;
      ta.focus();
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      btn.remove();
    });
    note.appendChild(btn);
  }

  // ---------------------------------------------------------------- topic buttons: the question types itself in
  let typing = null;
  document.addEventListener('click', e => {
    if (!e.target.closest('.topic-button')) return;
    setTimeout(() => {
      const ta = $('#question');
      if (!ta || reduced()) return;
      const text = ta.value;
      const form = ta.closest('form');
      if (form) { form.removeAttribute('data-teagask-glow'); void form.offsetWidth; form.setAttribute('data-teagask-glow', ''); setTimeout(() => form.removeAttribute('data-teagask-glow'), 1000); }
      if (logo) { logo.look(0, 6); setTimeout(() => logo.look(0, 0), 900); }
      clearInterval(typing);
      let i = 0;
      const stepChars = Math.max(1, Math.ceil(text.length / 28));   // about half a second whatever the length
      setQuestion('');
      typing = setInterval(() => {
        i = Math.min(text.length, i + stepChars);
        setQuestion(text.slice(0, i));
        if (i >= text.length) { clearInterval(typing); typing = null; }
      }, 16);
    }, 0);
  }, true);

  // ---------------------------------------------------------------- dark mode: circular reveal from the toggle
  let themeBusy = false, themeReplay = false;
  document.addEventListener('click', e => {
    const toggle = e.target.closest('.theme-toggle');
    if (!toggle || themeReplay || themeBusy || !document.startViewTransition || reduced()) return;
    e.stopPropagation(); e.preventDefault();
    const r = toggle.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    themeBusy = true;
    if (logo) logo.blink();
    const root = document.documentElement;
    // The new view starts fully clipped (CSS), so it can't flash in before the circle begins, and colour
    // transitions are paused so nothing fades inside the circle.
    root.style.setProperty('--tg-vt-x', `${x}px`);
    root.style.setProperty('--tg-vt-y', `${y}px`);
    root.classList.add('teagask-theme-switching');
    const before = toggle.getAttribute('aria-pressed');
    const vt = document.startViewTransition(() => {
      themeReplay = true; toggle.click(); themeReplay = false;
      // wait until React has actually applied the new theme before the new view is captured
      return new Promise(done => {
        const t0 = performance.now();
        (function check() { toggle.getAttribute('aria-pressed') !== before || performance.now() - t0 > 200 ? done() : setTimeout(check, 0); })();
      });
    });
    vt.ready.then(() => root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 560, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
    vt.finished.finally(() => {
      themeBusy = false;
      requestAnimationFrame(() => root.classList.remove('teagask-theme-switching'));
    });
  }, true);

  // ---------------------------------------------------------------- idle character + attention while typing
  let typingLook = null;
  document.addEventListener('input', e => {
    lastActivity = Date.now();
    if (e.target.id !== 'question' || !logo || logo.state !== 'idle' || typing) return;
    logo.look(0, 5, 200);                             // attentive: looks down at what you're typing
    clearTimeout(typingLook);
    typingLook = setTimeout(() => logo.look(0, 0), 1400);
  }, true);
  ['pointerdown', 'keydown', 'scroll'].forEach(t => addEventListener(t, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));
  (function idle() {
    setTimeout(() => {
      if (logo && logo.state === 'idle' && !document.hidden && Date.now() - lastActivity > 20000) {
        if (Math.random() < 0.55) logo.blink();
        else { const dx = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 3); logo.look(dx, Math.random() * 3 - 1); setTimeout(() => logo.look(0, 0, 400), 1100); }
      }
      idle();
    }, 5000 + Math.random() * 6000);
  })();

  // ---------------------------------------------------------------- watch the app's DOM
  function scan() {
    place();
    document.querySelectorAll('.message-row.assistant:not(.streaming-message)').forEach(row => { if (row.querySelector('.answer-content')) addActions(row); });
    retryOnNewestNote();
  }
  function retryOnNewestNote() {
    const notes = document.querySelectorAll('.system-note');
    if (notes.length) addRetry(notes[notes.length - 1]);
  }
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('resize', cacheRect);
  addEventListener('scroll', cacheRect, true);
  setInterval(cacheRect, 500);
  if (document.readyState !== 'loading') scan(); else document.addEventListener('DOMContentLoaded', scan);
})();
