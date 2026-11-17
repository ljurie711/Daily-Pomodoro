// All sounds are synthesized with the Web Audio API, so no audio files are needed.
window.PomodoroAudio = (() => {
  let ctx = null;
  let noiseNodes = null;
  let noiseGain = null;
  let currentNoise = "off";
  let noiseVolume = 0.4;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Browsers only allow audio after a user gesture; call this from click handlers.
  function unlock() { getCtx(); }

  function tone(c, dest, { freq, start, dur, type = "sine", peak = 0.6, attack = 0.01 }) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  function playChime(kind = "bell", volume = 0.7) {
    if (kind === "none" || volume <= 0) return;
    const c = getCtx();
    const out = c.createGain();
    out.gain.value = volume;
    out.connect(c.destination);
    const t = c.currentTime + 0.05;

    if (kind === "bell") {
      // Two rounds of a soft three-note bell with inharmonic partials.
      [0, 1.6].forEach((offset) => {
        [[659.25, 0], [783.99, 0.28], [1046.5, 0.56]].forEach(([f, d]) => {
          tone(c, out, { freq: f, start: t + offset + d, dur: 2.2, peak: 0.35 });
          tone(c, out, { freq: f * 2.76, start: t + offset + d, dur: 0.9, peak: 0.06 });
        });
      });
    } else if (kind === "digital") {
      for (let i = 0; i < 3; i++) {
        tone(c, out, { freq: 880, start: t + i * 0.5, dur: 0.12, type: "square", peak: 0.12 });
        tone(c, out, { freq: 880, start: t + i * 0.5 + 0.16, dur: 0.12, type: "square", peak: 0.12 });
      }
    } else if (kind === "marimba") {
      [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => {
        tone(c, out, { freq: f, start: t + i * 0.16, dur: 0.6, type: "triangle", peak: 0.4, attack: 0.005 });
        tone(c, out, { freq: f * 4, start: t + i * 0.16, dur: 0.15, peak: 0.05, attack: 0.002 });
      });
    }
  }

  function makeNoiseBuffer(c, type) {
    const seconds = 4;
    const len = c.sampleRate * seconds;
    const buffer = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        if (type === "brown") {
          last = (last + 0.02 * white) / 1.02;
          data[i] = last * 3.5;
        } else {
          data[i] = white;
        }
      }
    }
    return buffer;
  }

  function buildNoise(c, type, dest) {
    const src = c.createBufferSource();
    src.loop = true;
    const nodes = [src];

    if (type === "white") {
      src.buffer = makeNoiseBuffer(c, "white");
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 9000;
      const g = c.createGain();
      g.gain.value = 0.25;
      src.connect(lp).connect(g).connect(dest);
      nodes.push(lp, g);
    } else if (type === "brown") {
      src.buffer = makeNoiseBuffer(c, "brown");
      const g = c.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(dest);
      nodes.push(g);
    } else if (type === "rain") {
      // Filtered noise for the steady wash, plus slow volume swells for gusts.
      src.buffer = makeNoiseBuffer(c, "white");
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 400;
      const bp = c.createBiquadFilter();
      bp.type = "lowpass";
      bp.frequency.value = 3500;
      const g = c.createGain();
      g.gain.value = 0.22;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.12;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 0.06;
      lfo.connect(lfoGain).connect(g.gain);
      lfo.start();
      src.connect(hp).connect(bp).connect(g).connect(dest);

      // Brown rumble underneath for depth.
      const rumble = c.createBufferSource();
      rumble.buffer = makeNoiseBuffer(c, "brown");
      rumble.loop = true;
      const rg = c.createGain();
      rg.gain.value = 0.35;
      rumble.connect(rg).connect(dest);
      rumble.start();
      nodes.push(hp, bp, g, lfo, lfoGain, rumble, rg);
    }
    src.start();
    return nodes;
  }

  function stopNoise(fade = 0.6) {
    if (!noiseNodes || !ctx) return;
    const nodes = noiseNodes;
    const g = noiseGain;
    noiseNodes = null;
    noiseGain = null;
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => {
      nodes.forEach((n) => { try { n.stop && n.stop(); } catch (_) {} try { n.disconnect(); } catch (_) {} });
      try { g.disconnect(); } catch (_) {}
    }, fade * 1000 + 100);
  }

  function startNoise(type) {
    if (type === "off") { stopNoise(); currentNoise = "off"; return; }
    if (noiseNodes && currentNoise === type) return;
    stopNoise(0.3);
    const c = getCtx();
    noiseGain = c.createGain();
    noiseGain.gain.setValueAtTime(0, c.currentTime);
    noiseGain.gain.linearRampToValueAtTime(noiseVolume, c.currentTime + 1.2);
    noiseGain.connect(c.destination);
    noiseNodes = buildNoise(c, type, noiseGain);
    currentNoise = type;
  }

  function setNoiseVolume(v) {
    noiseVolume = Math.max(0, Math.min(1, v));
    if (noiseGain && ctx) noiseGain.gain.setTargetAtTime(noiseVolume, ctx.currentTime, 0.1);
  }

  function isNoisePlaying() { return !!noiseNodes; }

  return { unlock, playChime, startNoise, stopNoise, setNoiseVolume, isNoisePlaying };
})();
