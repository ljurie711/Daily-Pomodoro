(() => {
  "use strict";

  const audio = window.PomodoroAudio;
  const IDEAS = window.BREAK_IDEAS;
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    focus: 25, short: 5, long: 15, longEvery: 4,
    autoStart: false, overlay: true, dailyGoal: 8,
    chime: "bell", chimeVolume: 70,
    noise: "off", noiseVolume: 40, noiseInBreaks: false,
    theme: "dark",
  };
  const MODE_NAMES = { focus: "Focus", short: "Short break", long: "Long break" };
  const KEYS = { settings: "pomo.settings", state: "pomo.state", stats: "pomo.stats" };
  const RING = 2 * Math.PI * 100;

  const load = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
  };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  let settings = { ...DEFAULTS, ...load(KEYS.settings, {}) };
  let stats = load(KEYS.stats, { days: {} });
  let state = {
    mode: "focus",
    remainingMs: settings.focus * 60000,
    endAt: null,          // timestamp when running; null when paused/idle
    completedInCycle: 0,  // focus sessions completed toward the next long break
    task: "",
    ...load(KEYS.state, {}),
  };

  const durationMs = (mode) => settings[mode] * 60000;
  const isRunning = () => state.endAt !== null;
  const remaining = () => (isRunning() ? Math.max(0, state.endAt - Date.now()) : state.remainingMs);
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const persistState = () => save(KEYS.state, state);

  // ---------- Ticking ----------
  // A worker-driven tick keeps the timer responsive when the window is in the
  // background (main-thread timers get heavily throttled by the browser).
  let worker = null;
  try {
    const src = "let t=null;onmessage=e=>{clearInterval(t);if(e.data==='start')t=setInterval(()=>postMessage(0),250)}";
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    worker.onmessage = tick;
  } catch { worker = null; }
  let fallbackInterval = null;

  function startTicker() {
    if (worker) worker.postMessage("start");
    else if (!fallbackInterval) fallbackInterval = setInterval(tick, 250);
  }
  function stopTicker() {
    if (worker) worker.postMessage("stop");
    clearInterval(fallbackInterval);
    fallbackInterval = null;
  }

  function tick() {
    if (!isRunning()) return;
    if (remaining() <= 0) complete();
    else render();
  }

  // ---------- Timer actions ----------
  function start() {
    audio.unlock();
    if (isRunning()) return;
    if (state.remainingMs <= 0) state.remainingMs = durationMs(state.mode);
    state.endAt = Date.now() + state.remainingMs;
    persistState();
    startTicker();
    syncNoise();
    render();
  }

  function pause() {
    if (!isRunning()) return;
    state.remainingMs = remaining();
    state.endAt = null;
    persistState();
    stopTicker();
    syncNoise();
    render();
  }

  function reset() {
    state.endAt = null;
    state.remainingMs = durationMs(state.mode);
    persistState();
    stopTicker();
    syncNoise();
    render();
  }

  function setMode(mode) {
    state.mode = mode;
    state.endAt = null;
    state.remainingMs = durationMs(mode);
    persistState();
    stopTicker();
    syncNoise();
    render();
  }

  function nextModeAfter(mode, countedFocus) {
    if (mode !== "focus") return "focus";
    const completed = state.completedInCycle + (countedFocus ? 1 : 0);
    return completed > 0 && completed % settings.longEvery === 0 ? "long" : "short";
  }

  function skip() {
    const next = nextModeAfter(state.mode, false);
    if (state.mode === "long") state.completedInCycle = 0;
    setMode(next);
  }

  function complete() {
    const finished = state.mode;
    stopTicker();

    if (finished === "focus") {
      const day = (stats.days[todayKey()] ||= { count: 0, minutes: 0 });
      day.count += 1;
      day.minutes += settings.focus;
      save(KEYS.stats, stats);
    }
    const next = nextModeAfter(finished, finished === "focus");
    if (finished === "focus") state.completedInCycle += 1;
    if (finished === "long") state.completedInCycle = 0;

    state.mode = next;
    state.endAt = null;
    state.remainingMs = durationMs(next);
    persistState();

    audio.playChime(settings.chime, settings.chimeVolume / 100);
    notify(finished, next);
    if (settings.autoStart) start();
    else { syncNoise(); render(); }
    if (settings.overlay) showOverlay(finished, next);
  }

  // ---------- Noise ----------
  function syncNoise() {
    const wantNoise = settings.noise !== "off" && isRunning() &&
      (state.mode === "focus" || settings.noiseInBreaks);
    audio.setNoiseVolume(settings.noiseVolume / 100);
    if (wantNoise) audio.startNoise(settings.noise);
    else audio.stopNoise();
  }

  // ---------- Notifications ----------
  function messageFor(finished, next) {
    if (finished === "focus") {
      const today = stats.days[todayKey()]?.count ?? 0;
      return {
        title: next === "long" ? "Great work! Time for a long break 🎉" : "Focus session done ☕",
        body: `${today} pomodoro${today === 1 ? "" : "s"} today. Take ${settings[next]} minutes to recharge, away from the screen.`,
      };
    }
    return {
      title: "Break's over. Ready to focus? 🎯",
      body: `Next up: ${settings.focus} minutes of focus${state.task ? ` on "${state.task}"` : ""}.`,
    };
  }

  async function notify(finished, next) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const { title, body } = messageFor(finished, next);
    const opts = { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "pomodoro", renotify: true, requireInteraction: true };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) return reg.showNotification(title, opts);
    } catch { /* fall through to page notification */ }
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); n.close(); };
  }

  function updateNotifyHint() {
    $("notifyHint").hidden = !("Notification" in window) || Notification.permission !== "default";
  }

  // ---------- Overlay & break ideas ----------
  let currentIdea = null;
  let breathTimer = null;

  function pickIdea(kind) {
    const list = IDEAS[kind === "long" ? "long" : "short"];
    let idea;
    do { idea = list[Math.floor(Math.random() * list.length)]; } while (list.length > 1 && idea === currentIdea);
    currentIdea = idea;
    $("breakIcon").textContent = idea.icon;
    $("breakTitle").textContent = idea.title;
    $("breakText").textContent = idea.text;
    $("breathing").hidden = !idea.breathing;
    stopBreathing();
    if (idea.breathing) startBreathing();
  }

  function startBreathing() {
    const phases = ["Breathe in", "Hold", "Breathe out", "Hold"];
    const circle = document.querySelector(".breath-circle");
    let i = 0;
    const step = () => {
      $("breathPhase").textContent = phases[i];
      if (i === 0) circle.classList.add("in");
      if (i === 2) circle.classList.remove("in");
      i = (i + 1) % 4;
    };
    step();
    breathTimer = setInterval(step, 4000);
  }
  function stopBreathing() {
    clearInterval(breathTimer);
    breathTimer = null;
    document.querySelector(".breath-circle")?.classList.remove("in");
  }

  let overlayNext = null;
  function showOverlay(finished, next) {
    overlayNext = next;
    const { title } = messageFor(finished, next);
    const isBreak = next !== "focus";
    $("overlayTitle").textContent = title.replace(/\s*\p{Extended_Pictographic}+$/u, "");
    $("overlayEmoji").textContent = next === "long" ? "🎉" : isBreak ? "☕" : "🎯";
    $("overlaySubtitle").textContent = isBreak
      ? `Here's a way to spend your ${settings[next]}-minute ${next === "long" ? "long " : ""}break so you come back refreshed:`
      : "Before you start, pick one small, concrete first step and let the rest wait.";
    $("breakIdea").hidden = !isBreak;
    document.querySelector(".break-tips").hidden = !isBreak;
    if (isBreak) pickIdea(next); else stopBreathing();

    const running = isRunning();
    $("overlayStartBtn").textContent = running ? "Got it" : isBreak ? "Start break" : "Start focus";
    $("overlayDismissBtn").hidden = running;
    $("overlay").hidden = false;
    $("overlayStartBtn").focus();
  }

  function hideOverlay() {
    $("overlay").hidden = true;
    stopBreathing();
  }

  // ---------- Rendering ----------
  const fmt = (ms) => {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  let lastFavicon = "";
  function renderFavicon(fraction) {
    const colors = { focus: "#ff6b6b", short: "#3ecf8e", long: "#5b9dff" };
    const c = colors[state.mode];
    const key = `${state.mode}-${Math.round(fraction * 40)}-${isRunning()}`;
    if (key === lastFavicon) return;
    lastFavicon = key;
    const a = fraction * 2 * Math.PI;
    const x = 32 + 26 * Math.sin(a);
    const y = 32 - 26 * Math.cos(a);
    const large = fraction > 0.5 ? 1 : 0;
    const arc = fraction >= 0.999
      ? `<circle cx="32" cy="32" r="26" fill="none" stroke="${c}" stroke-width="10"/>`
      : fraction <= 0 ? "" : `<path d="M32 6 A26 26 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)}" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="${c}" stroke-opacity=".25" stroke-width="10"/>${arc}</svg>`;
    $("favicon").href = "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function render() {
    const rem = remaining();
    const total = durationMs(state.mode);
    const fraction = Math.min(1, Math.max(0, rem / total));
    const running = isRunning();

    document.body.dataset.mode = state.mode;
    document.body.classList.toggle("running", running);
    document.body.classList.toggle("paused", !running && rem > 0 && rem < total);

    $("timeDisplay").textContent = fmt(rem);
    $("modeLabel").textContent = MODE_NAMES[state.mode];
    $("ringProgress").style.strokeDashoffset = String(RING * (1 - fraction));
    $("startBtn").textContent = running ? "Pause" : rem < total ? "Resume" : "Start";
    document.title = running || rem < total
      ? `${fmt(rem)} · ${MODE_NAMES[state.mode]}`
      : "Daily Pomodoro";
    renderFavicon(fraction);

    document.querySelectorAll(".mode-tab").forEach((b) =>
      b.setAttribute("aria-selected", String(b.dataset.mode === state.mode)));
    document.querySelectorAll(".noise-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.noise === settings.noise));

    const dots = $("sessionDots");
    if (dots.childElementCount !== settings.longEvery) {
      dots.innerHTML = "";
      for (let i = 0; i < settings.longEvery; i++) dots.appendChild(document.createElement("span")).className = "dot";
    }
    const done = state.completedInCycle % settings.longEvery || (state.mode === "long" ? settings.longEvery : 0);
    [...dots.children].forEach((d, i) => {
      d.classList.toggle("done", i < done);
      d.classList.toggle("current", i === done && state.mode === "focus");
    });
    dots.title = `${done} of ${settings.longEvery} sessions before a long break`;

    renderStats();
  }

  function renderStats() {
    const today = stats.days[todayKey()] ?? { count: 0, minutes: 0 };
    $("statToday").textContent = `${today.count}/${settings.dailyGoal}`;
    $("statMinutes").textContent = today.minutes;
    let streak = 0;
    const d = new Date();
    if (!today.count) d.setDate(d.getDate() - 1);
    for (;;) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!stats.days[k]?.count) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }
    $("statStreak").textContent = streak;
  }

  // ---------- Settings ----------
  const form = $("settingsForm");

  function fillForm() {
    for (const [k, v] of Object.entries(settings)) {
      const el = form.elements[k];
      if (!el) continue;
      if (el.type === "checkbox") el.checked = v; else el.value = v;
    }
    $("noiseVolumeQuick").value = settings.noiseVolume;
  }

  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    document.querySelector('meta[name="theme-color"]').content = settings.theme === "dark" ? "#1b1d2b" : "#f5f3ef";
  }

  function updateSetting(name, value) {
    const prevDuration = durationMs(state.mode);
    settings[name] = value;
    save(KEYS.settings, settings);
    // If the current section hasn't started, follow the new duration.
    if (!isRunning() && state.remainingMs === prevDuration) state.remainingMs = durationMs(state.mode);
    persistState();
    syncNoise();
    render();
  }

  form.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.name) return;
    let value = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "number" || el.type === "range") {
      value = Number(value);
      if (!Number.isFinite(value) || value < Number(el.min) || value > Number(el.max)) return;
      value = Math.round(value);
    }
    updateSetting(el.name, value);
    if (el.name === "noiseVolume") $("noiseVolumeQuick").value = value;
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  function openSettings() { fillForm(); $("settings").hidden = false; $("scrim").hidden = false; }
  function closeSettings() { $("settings").hidden = true; $("scrim").hidden = true; }

  // ---------- Events ----------
  $("startBtn").addEventListener("click", () => (isRunning() ? pause() : start()));
  $("resetBtn").addEventListener("click", reset);
  $("skipBtn").addEventListener("click", skip);
  document.querySelectorAll(".mode-tab").forEach((b) =>
    b.addEventListener("click", () => { if (b.dataset.mode !== state.mode || !isRunning()) setMode(b.dataset.mode); }));

  document.querySelectorAll(".noise-btn").forEach((b) =>
    b.addEventListener("click", () => { audio.unlock(); updateSetting("noise", b.dataset.noise); fillForm(); }));
  $("noiseVolumeQuick").addEventListener("input", (e) => {
    updateSetting("noiseVolume", Number(e.target.value));
    form.elements.noiseVolume.value = e.target.value;
  });

  $("taskInput").value = state.task;
  $("taskInput").addEventListener("input", (e) => { state.task = e.target.value.trim(); persistState(); });
  $("taskInput").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });

  $("overlayStartBtn").addEventListener("click", () => {
    hideOverlay();
    if (!isRunning() && overlayNext === state.mode) start();
  });
  $("overlayDismissBtn").addEventListener("click", hideOverlay);
  $("anotherIdeaBtn").addEventListener("click", () => pickIdea(overlayNext));

  $("settingsBtn").addEventListener("click", openSettings);
  $("closeSettingsBtn").addEventListener("click", closeSettings);
  $("scrim").addEventListener("click", closeSettings);
  $("themeBtn").addEventListener("click", () => {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    save(KEYS.settings, settings);
    applyTheme();
  });
  $("testChimeBtn").addEventListener("click", () => audio.playChime(settings.chime, settings.chimeVolume / 100));
  $("resetStatsBtn").addEventListener("click", () => {
    if (!confirm("Reset today's pomodoro count?")) return;
    delete stats.days[todayKey()];
    save(KEYS.stats, stats);
    state.completedInCycle = 0;
    persistState();
    render();
  });
  $("restoreDefaultsBtn").addEventListener("click", () => {
    settings = { ...DEFAULTS, theme: settings.theme };
    save(KEYS.settings, settings);
    fillForm();
    if (!isRunning()) state.remainingMs = durationMs(state.mode);
    persistState();
    syncNoise();
    render();
  });

  $("enableNotifyBtn").addEventListener("click", async () => {
    await Notification.requestPermission();
    updateNotifyHint();
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!$("overlay").hidden) {
      if (e.key === "Escape") hideOverlay();
      return;
    }
    if (e.key === "Escape") { closeSettings(); return; }
    if (e.code === "Space") { e.preventDefault(); isRunning() ? pause() : start(); }
    else if (e.key === "r" || e.key === "R") reset();
    else if (e.key === "s" || e.key === "S") skip();
    else if (e.key === "n" || e.key === "N") {
      audio.unlock();
      updateSetting("noise", settings.noise === "off" ? (settings.lastNoise || "brown") : "off");
      if (settings.noise !== "off") settings.lastNoise = settings.noise;
      fillForm();
    }
  });
  document.querySelectorAll(".noise-btn").forEach((b) =>
    b.addEventListener("click", () => { if (b.dataset.noise !== "off") { settings.lastNoise = b.dataset.noise; save(KEYS.settings, settings); } }));

  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });

  // ---------- Install / service worker ----------
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $("installBtn").hidden = false;
  });
  $("installBtn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("installBtn").hidden = true;
  });
  window.addEventListener("appinstalled", () => { $("installBtn").hidden = true; });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // ---------- Init ----------
  applyTheme();
  fillForm();
  updateNotifyHint();
  if (isRunning()) {
    // Restored after a reload: resume, or finish immediately if it ended while closed.
    if (remaining() <= 0) complete();
    else startTicker();
  }
  render();
})();
