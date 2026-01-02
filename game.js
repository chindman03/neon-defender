(() => {
  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  const fmtPct = (x) => (x >= 0 ? "+" : "") + Math.round(x) + "%";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const ui = {
    wave: document.getElementById("wave"),
    score: document.getElementById("score"),
    hp: document.getElementById("hp"),
    overlay: document.getElementById("overlay"),
    startBtn: document.getElementById("startBtn"),
    howBtn: document.getElementById("howBtn"),
    how: document.getElementById("how"),
    controlHint: document.getElementById("controlHint"),
    upgrade: document.getElementById("upgrade"),
    upgradeGrid: document.getElementById("upgradeGrid"),
    statLine: document.getElementById("statLine"),
    gameover: document.getElementById("gameover"),
    finalLine: document.getElementById("finalLine"),
    restartBtn: document.getElementById("restartBtn"),
    shareBtn: document.getElementById("shareBtn"),
    muteBtn: document.getElementById("muteBtn"),
    touchUI: document.getElementById("touchUI"),
    stickBase: document.getElementById("stickBase"),
    stickKnob: document.getElementById("stickKnob"),
    shootBtn: document.getElementById("shootBtn"),
  };

  // Touch detection (simple + reliable for control adaptation)
  const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
  ui.controlHint.textContent = isTouch
    ? "Mobile: Drag joystick to move • Tap SHOOT"
    : "PC: WASD / Arrows to move • Space to shoot";

  if (isTouch) ui.touchUI.classList.remove("hidden");

  // Extra iOS gesture prevention (belt + suspenders)
  if (isTouch) {
    document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("gestureend", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }

  // ---------- Audio: multiple 8-bit-ish loops (WebAudio synth) ----------
  let audio = {
    ctx: null,
    master: null,
    muted: false,
    started: false,
    nextNoteTime: 0,
    step: 0,
    scheduleAhead: 0.20, // seconds
    preset: null,
    deathUntil: 0,
    savedPreset: null
  };

  const musicPresets = [
    // Modern / intense synthwave-ish (more driving than the old opener)
    {
      name: "NEONRUSH",
      tempo: 156,
      bass: [55,55,82.41,73.42, 55,98,82.41,110],
      arp:  [783.99,880,987.77,1174.66, 987.77,880,783.99,659.25],
      hat:  [1,0,1,1, 1,1,0,1, 1,0,1,1, 1,1,0,1],
      lead: [0,1,1,0, 1,0,1,0, 1,1,0,1, 0,1,1,0],
    },
    // faster, more intense
    {
      name: "CHASE",
      tempo: 160,
      bass: [55,82.41,55,98, 55,82.41,73.42,110],
      arp:  [659.25,880,987.77,880, 659.25,739.99,880,987.77],
      hat:  [0,1,0,1, 1,0,1,0, 0,1,0,1, 1,0,1,0],
      lead: [0,0,1,0, 0,1,0,0, 1,0,0,1, 0,0,1,0],
    },
    // darker drive
    {
      name: "GRIDRUN",
      tempo: 148,
      bass: [49,49,65.41,73.42,49,49,87.31,73.42],
      arp:  [392,493.88,587.33,784,587.33,493.88,440,587.33],
      hat:  [0,0,1,0, 1,0,0,1, 0,0,1,0, 1,0,0,1],
      lead: [0,1,0,0, 0,0,1,0, 0,1,0,0, 1,0,0,1],
    },
    // high energy
    {
      name: "OVERDRIVE",
      tempo: 166,
      bass: [55,55,110,98, 55,82.41,73.42,98],
      arp:  [880,987.77,1174.66,987.77, 880,783.99,659.25,783.99],
      hat:  [1,0,1,0, 1,1,0,1, 1,0,1,0, 1,1,0,1],
      lead: [0,0,1,1, 0,1,0,1, 1,0,1,0, 1,0,1,1],
    },
  ];

  const deathPresets = [
    { name: "DEATH_1", tempo: 160,
      bass: [110,98,82.41,73.42, 65.41,55,49,41.2],
      arp:  [1174.66,987.77,880,783.99, 659.25,587.33,493.88,440],
      hat:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      lead: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    },
    { name: "DEATH_2", tempo: 170,
      bass: [98,98,82.41,82.41, 73.42,73.42,65.41,65.41],
      arp:  [987.77,880,783.99,659.25, 587.33,659.25,783.99,880],
      hat:  [1,1,0,1, 1,0,1,1, 1,1,0,1, 1,0,1,1],
      lead: [1,1,0,0, 1,0,1,0, 1,1,0,0, 1,0,1,1],
    },
  ];

  function initAudio() {
    if (audio.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    audio.ctx = new AC();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.22;
    audio.master.connect(audio.ctx.destination);
  }

  function playBeep(freq, time, dur, type, gainVal) {
    const a = audio.ctx;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gainVal, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    g.connect(audio.master);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  function scheduleMusic() {
    if (!audio.started || audio.muted || !audio.preset) return;
    const a = audio.ctx;
    const p = audio.preset;
    const secondsPerBeat = 60 / p.tempo;
    const stepDur = secondsPerBeat / 2; // 8th notes

    while (audio.nextNoteTime < a.currentTime + audio.scheduleAhead) {
      const t = audio.nextNoteTime;
      const s = audio.step % 16;

      if (s % 2 === 0) {
        const bf = p.bass[(audio.step / 2) % p.bass.length | 0];
        playBeep(bf, t, stepDur * 0.95, "square", 0.12);
      }

      const af = p.arp[s % p.arp.length];
      playBeep(af, t, stepDur * 0.62, "square", 0.06);

      if (p.hat[s]) playBeep(5200, t, 0.028, "square", 0.02);
      if (p.lead[s]) playBeep(af * 1.5, t, stepDur * 0.28, "square", 0.03);

      audio.nextNoteTime += stepDur;
      audio.step++;
    }
  }

  function chooseInitialMusic() {
    if (audio.preset) return;
    audio.preset = pick(musicPresets);
  }

  function startMusic() {
    initAudio();
    if (!audio.preset) chooseInitialMusic();
    if (audio.started) return;
    audio.started = true;
    audio.nextNoteTime = audio.ctx.currentTime + 0.05;
  }

  function playDeathMusic() {
    if (!audio.ctx || !audio.started) return;
    const a = audio.ctx;
    audio.savedPreset = audio.preset;
    audio.preset = pick(deathPresets);
    audio.step = 0;
    audio.nextNoteTime = a.currentTime + 0.03;
    audio.deathUntil = 0; // keep death track until restart


    const t = a.currentTime + 0.02;
    const freqs = [880, 740, 659, 587, 493, 440];
    for (let i = 0; i < freqs.length; i++) {
      playBeep(freqs[i], t + i * 0.07, 0.10, "square", 0.05);
    }
  }

  function setMuted(m) {
    audio.muted = m;
    if (audio.master) audio.master.gain.value = m ? 0.0 : 0.22;
    ui.muteBtn.textContent = m ? "🔇" : "🔊";
  }

  ui.muteBtn.addEventListener("click", () => {
    startMusic();
    setMuted(!audio.muted);
  });

  window.addEventListener("pointerdown", () => startMusic(), { once: true });

  // ---------- Game State ----------
  let W = 0, H = 0, dpr = 1;

  const state = {
    running: false,
    difficulty: 1,
    inUpgrade: false,
    wave: 1,
    score: 0,
    lastTime: 0,
    shake: 0,

    waveSpawning: true,
    toSpawn: 0,
    spawnCd: 0,
    spawnInterval: 0,
    waveTimeLeft: 0,
  };

  const baseStats = {
    hpMax: 10, speed: 260, fireRate: 6, damage: 1,
    bulletSpeed: 520, bulletSize: 6, spread: 0,
    shotCount: 1, pierce: 0, critChance: 0, critMult: 1.7, regen: 0
  };

  const player = {
    x: 0, y: 0,
    size: 18,
    speed: baseStats.speed,
    hpMax: baseStats.hpMax,
    hp: baseStats.hpMax,
    invuln: 0,

    fireRate: baseStats.fireRate,
    damage: baseStats.damage,
    bulletSpeed: baseStats.bulletSpeed,
    bulletSize: baseStats.bulletSize,
    spread: baseStats.spread,
    shotCount: baseStats.shotCount,
    pierce: baseStats.pierce,
    critChance: baseStats.critChance,
    critMult: baseStats.critMult,
    regen: baseStats.regen,
  };

  const bullets = [];
  const enemyBullets = [];
  const enemies = [];
  const particles = [];

  const keys = new Set();
  const pressedPointers = new Set();
  let shooting = false;

  let stick = { active: false, id: null, baseX: 0, baseY: 0, outX: 0, outY: 0, maxR: 56 };
  let fireCooldown = 0;

  function resize() {
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.floor(window.innerWidth);
    H = Math.floor(window.innerHeight);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    player.x = clamp(player.x || W / 2, 30, W - 30);
    player.y = clamp(player.y || H * 0.7, 60, H - 30);
  }
  window.addEventListener("resize", resize);
  resize();

  function resetGame() {
    state.wave = 1;
    state.score = 0;
    state.shake = 0;

    Object.assign(player, {
      hpMax: baseStats.hpMax,
      hp: baseStats.hpMax,
      speed: baseStats.speed,
      fireRate: baseStats.fireRate,
      damage: baseStats.damage,
      bulletSpeed: baseStats.bulletSpeed,
      bulletSize: baseStats.bulletSize,
      spread: baseStats.spread,
      shotCount: baseStats.shotCount,
      pierce: baseStats.pierce,
      critChance: baseStats.critChance,
      critMult: baseStats.critMult,
      regen: baseStats.regen,
      invuln: 0
    });

    bullets.length = 0;
    enemyBullets.length = 0;
    enemies.length = 0;
    particles.length = 0;
    pressedPointers.clear();
    shooting = false;

    player.x = W / 2;
    player.y = H * 0.7;

    startWave(state.wave);
    syncUI();
  }

  function syncUI() {
    ui.wave.textContent = `Wave ${state.wave}`;
    ui.score.textContent = `Score ${state.score}`;
    ui.hp.textContent = `HP ${Math.max(0, Math.ceil(player.hp))}/${player.hpMax}`;
  }

  // ---------- Enemy Variety ----------
  const enemyTypes = [
    { key: "chaser", weight: 52, make: (wave) => ({
      size: rand(14, 24),
      hp: 1 + Math.floor(wave * 0.22),
      speed: (78 + wave * 6) * rand(0.85, 1.12),
      hue: 185, touchDmg: 1
    })},
    { key: "runner", weight: 20, make: (wave) => ({
      size: rand(12, 18),
      hp: 1 + Math.floor(wave * 0.12),
      speed: (118 + wave * 10) * rand(1.0, 1.25),
      hue: 305, touchDmg: 1
    })},
    { key: "tank", weight: 16, make: (wave) => ({
      size: rand(24, 34),
      hp: 4 + Math.floor(wave * 0.55),
      speed: (52 + wave * 3) * rand(0.85, 1.05),
      hue: 125, touchDmg: 2
    })},
    { key: "zigzag", weight: 12, make: (wave) => ({
      size: rand(16, 24),
      hp: 2 + Math.floor(wave * 0.28),
      speed: (82 + wave * 6) * rand(0.9, 1.1),
      hue: 260, touchDmg: 1,
      zig: rand(2.2, 4.0),
      zigT: rand(0, Math.PI * 2),
    })},
    { key: "shooter", weight: 10, make: (wave) => ({
      size: rand(18, 26),
      hp: 3 + Math.floor(wave * 0.35),
      speed: (60 + wave * 4) * rand(0.9, 1.1),
      hue: 35, touchDmg: 1,
      shootCd: rand(0.4, 1.2),
      desiredRange: 220 + wave * 4,
    })},
    { key: "splitter", weight: 8, make: (wave) => ({
      size: rand(18, 26),
      hp: 2 + Math.floor(wave * 0.25),
      speed: (70 + wave * 5) * rand(0.9, 1.1),
      hue: 200, touchDmg: 1,
      splits: 2
    })},
  ];

  function weightedType(wave) {
    const mod = enemyTypes.map(t => {
      let w = t.weight;
      if (wave > 6 && t.key === "chaser") w *= 0.75;
      if (wave > 10 && (t.key === "shooter" || t.key === "tank")) w *= 1.15;
      return [t, w];
    });
    const total = mod.reduce((s, x) => s + x[1], 0);
    let r = Math.random() * total;
    for (const [t, w] of mod) { r -= w; if (r <= 0) return t; }
    return mod[0][0];
  }

  function spawnEnemy(wave) {
    const edgeRoll = Math.random();
    let x, y;
    if (edgeRoll < 0.45) { x = rand(30, W - 30); y = rand(70, 120); }
    else if (edgeRoll < 0.72) { x = rand(20, 60); y = rand(120, H - 60); }
    else { x = rand(W - 60, W - 20); y = rand(120, H - 60); }

    const type = weightedType(wave);
    const base = type.make(wave);

    // Apply per-wave difficulty scaling
    base.hp = Math.max(1, Math.round(base.hp * state.difficulty));
    base.speed = base.speed * state.difficulty;
    if (base.touchDmg) base.touchDmg = Math.max(1, Math.round(base.touchDmg * (1 + (state.difficulty - 1) * 0.6)));

    enemies.push({ type: type.key, x, y, ...base });
  }

  // ---------- Wave pacing: longer waves over time ----------
  function startWave(wave) {
    // Difficulty scales by +5% per wave
    state.difficulty = Math.pow(1.05, Math.max(0, wave - 1));

    enemies.length = 0;
    enemyBullets.length = 0;

    const waveLen = 6.0 + wave * 1.25;
    const total = Math.floor(10 + wave * 3.4);
    const interval = clamp(waveLen / total, 0.18, 0.85);

    state.waveSpawning = true;
    state.toSpawn = total;
    state.spawnInterval = interval;
    state.spawnCd = 0.4;
    state.waveTimeLeft = waveLen;

    const burst = Math.min(4, state.toSpawn);
    for (let i = 0; i < burst; i++) { spawnEnemy(wave); state.toSpawn--; }

    syncUI();
  }

  // ---------- Upgrades (expanded) ----------
  function pctFromBase(v, base) { return base === 0 ? 0 : (v / base - 1) * 100; }

  function buildStatLine() {
    const fr = pctFromBase(player.fireRate, baseStats.fireRate);
    const sp = pctFromBase(player.speed, baseStats.speed);
    const bs = pctFromBase(player.bulletSpeed, baseStats.bulletSpeed);
    const dm = pctFromBase(player.damage, baseStats.damage);
    const hp = pctFromBase(player.hpMax, baseStats.hpMax);
    const sc = pctFromBase(player.shotCount, baseStats.shotCount);
    const pr = player.pierce;
    const cc = player.critChance * 100;
    const rg = player.regen;

    ui.statLine.innerHTML = `
      <b>Stats</b> •
      Fire ${player.fireRate.toFixed(1)}/s (${fmtPct(fr)}) •
      Dmg ${player.damage} (${fmtPct(dm)}) •
      Speed ${Math.round(player.speed)} (${fmtPct(sp)}) •
      HP ${player.hpMax} (${fmtPct(hp)}) •
      Bullet ${Math.round(player.bulletSpeed)} (${fmtPct(bs)}) •
      Shots ${player.shotCount} (${fmtPct(sc)}) •
      Pierce ${pr} •
      Crit ${Math.round(cc)}% •
      Regen ${rg.toFixed(1)}/s
    `;
  }

  const upgradePool = [
    { key: "firerate", name: "Overclock", desc: "+20% fire rate",
      meta: () => `Now: ${player.fireRate.toFixed(1)}/s → ${(player.fireRate*1.2).toFixed(1)}/s`,
      apply: () => { player.fireRate *= 1.2; } },
    { key: "damage", name: "Hotter Lasers", desc: "+1 damage",
      meta: () => `Now: ${player.damage} → ${player.damage+1}`,
      apply: () => { player.damage += 1; } },
    { key: "speed", name: "Thrusters", desc: "+12% move speed",
      meta: () => `Now: ${Math.round(player.speed)} → ${Math.round(player.speed*1.12)}`,
      apply: () => { player.speed *= 1.12; } },
    { key: "hp", name: "Reinforced Hull", desc: "+3 max HP (heal 3)",
      meta: () => `Now: ${player.hpMax} → ${player.hpMax+3}`,
      apply: () => { player.hpMax += 3; player.hp = Math.min(player.hpMax, player.hp + 3); } },
    { key: "bulletspeed", name: "Rail Charge", desc: "+18% bullet speed",
      meta: () => `Now: ${Math.round(player.bulletSpeed)} → ${Math.round(player.bulletSpeed*1.18)}`,
      apply: () => { player.bulletSpeed *= 1.18; } },
    { key: "bigshot", name: "Wide Bolts", desc: "+2 bullet size",
      meta: () => `Now: ${player.bulletSize}px → ${player.bulletSize+2}px`,
      apply: () => { player.bulletSize += 2; } },
    { key: "trispark", name: "Tri-Spark", desc: "Shoot 3 bolts (small spread)",
      meta: () => `Shots: ${player.shotCount} → ${Math.max(player.shotCount,3)}`,
      apply: () => { player.shotCount = Math.max(player.shotCount, 3); player.spread = clamp(player.spread + 0.08, 0.08, 0.30); } },
    { key: "multishot", name: "Extra Emitter", desc: "+1 shot (adds spread)",
      meta: () => `Shots: ${player.shotCount} → ${player.shotCount+1}`,
      apply: () => { player.shotCount += 1; player.spread = clamp(player.spread + 0.05, 0, 0.35); } },
    { key: "pierce", name: "Phase Rounds", desc: "Bullets pierce +1 enemy",
      meta: () => `Pierce: ${player.pierce} → ${player.pierce+1}`,
      apply: () => { player.pierce += 1; } },
    { key: "crit", name: "Lucky Circuits", desc: "+6% crit chance",
      meta: () => `Crit: ${Math.round(player.critChance*100)}% → ${Math.round((player.critChance+0.06)*100)}%`,
      apply: () => { player.critChance = clamp(player.critChance + 0.06, 0, 0.50); } },
    { key: "critmult", name: "Amplifier", desc: "+0.3x crit multiplier",
      meta: () => `Crit x${player.critMult.toFixed(1)} → x${(player.critMult+0.3).toFixed(1)}`,
      apply: () => { player.critMult = clamp(player.critMult + 0.3, 1.7, 3.5); } },
    { key: "regen", name: "Nano-Regen", desc: "+0.6 HP/sec (between hits)",
      meta: () => `Regen: ${player.regen.toFixed(1)}/s → ${(player.regen+0.6).toFixed(1)}/s`,
      apply: () => { player.regen = clamp(player.regen + 0.6, 0, 4.0); } },
    { key: "heal", name: "Quick Patch", desc: "Heal 35% max HP",
      meta: () => `Heal: +${Math.ceil(player.hpMax*0.35)} HP`,
      apply: () => { player.hp = Math.min(player.hpMax, player.hp + player.hpMax * 0.35); } },
  ];

  function showUpgrades() {
    state.inUpgrade = true;
    ui.upgrade.classList.remove("hidden");
    ui.upgradeGrid.innerHTML = "";
    buildStatLine();

    const picks = [];
    const pool = [...upgradePool];
    while (picks.length < 3 && pool.length) {
      const idx = (Math.random() * pool.length) | 0;
      picks.push(pool.splice(idx, 1)[0]);
    }

    for (const up of picks) {
      const card = document.createElement("div");
      card.className = "upCard";
      const meta = up.meta ? up.meta() : "";
      card.innerHTML = `
        <h3>${up.name}</h3>
        <p>${up.desc}</p>
        <div class="upMeta">${meta}</div>
        <button class="btn" style="width:100%">TAKE</button>
      `;
      card.querySelector("button").addEventListener("click", () => {
        up.apply();
        ui.upgrade.classList.add("hidden");
        state.inUpgrade = false;
        state.wave += 1;
        startWave(state.wave);
        syncUI();
      });
      ui.upgradeGrid.appendChild(card);
    }
  }

  // ---------- Shooting ----------
  function shoot() {
    const now = performance.now() / 1000;
    if (fireCooldown > now) return;
    fireCooldown = now + 1 / player.fireRate;

    let tx = player.x, ty = player.y - 200;
    if (enemies.length) {
      let best = 1e18, bestE = null;
      for (const e of enemies) {
        const d = dist2(player.x, player.y, e.x, e.y);
        if (d < best) { best = d; bestE = e; }
      }
      if (bestE) { tx = bestE.x; ty = bestE.y; }
    }

    const baseAng = Math.atan2(ty - player.y, tx - player.x);
    const shots = Math.max(1, player.shotCount);
    const spread = player.spread;

    for (let i = 0; i < shots; i++) {
      const center = (shots - 1) / 2;
      const t = (i - center) * spread;
      const ang = baseAng + t;

      const isCrit = Math.random() < player.critChance;
      const dmg = isCrit ? Math.round(player.damage * player.critMult) : player.damage;

      bullets.push({
        x: player.x, y: player.y,
        vx: Math.cos(ang) * player.bulletSpeed,
        vy: Math.sin(ang) * player.bulletSpeed,
        size: player.bulletSize,
        dmg, life: 1.4,
        pierceLeft: player.pierce,
        crit: isCrit
      });
    }

    burst(player.x, player.y, 6, 190);
  }

  // ---------- Particles ----------
  function burst(x, y, n, hue) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(60, 260);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.55), r: rand(1.5, 3.2), hue });
    }
  }

  // ---------- Input ----------
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","w","a","s","d","W","A","S","D"].includes(e.key)) e.preventDefault();
    keys.add(e.key);
    if (e.key === " ") shooting = true;
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.key);
    if (e.key === " ") shooting = pressedPointers.size > 0;
  });

  function setStickKnob(nx, ny) { ui.stickKnob.style.transform = `translate(${nx}px, ${ny}px)`; }
  function resetStick() { stick.active = false; stick.id = null; stick.outX = 0; stick.outY = 0; setStickKnob(0, 0); }
  function baseRect() { return ui.stickBase.getBoundingClientRect(); }

  ui.stickBase.addEventListener("pointerdown", (e) => {
    if (!isTouch) return;
    e.preventDefault();
    if (stick.active) return;
    stick.active = true;
    stick.id = e.pointerId;
    ui.stickBase.setPointerCapture(e.pointerId);
    const r = baseRect();
    stick.baseX = r.left + r.width / 2;
    stick.baseY = r.top + r.height / 2;
  });

  ui.stickBase.addEventListener("pointermove", (e) => {
    if (!stick.active || e.pointerId !== stick.id) return;
    e.preventDefault();
    const dx = e.clientX - stick.baseX;
    const dy = e.clientY - stick.baseY;
    const len = Math.hypot(dx, dy);
    const m = stick.maxR;
    const nx = len > m ? dx / len * m : dx;
    const ny = len > m ? dy / len * m : dy;
    stick.outX = clamp(nx / m, -1, 1);
    stick.outY = clamp(ny / m, -1, 1);
    setStickKnob(nx, ny);
  });

  ui.stickBase.addEventListener("pointerup", (e) => { if (e.pointerId === stick.id) { e.preventDefault(); resetStick(); } });
  ui.stickBase.addEventListener("pointercancel", (e) => { if (e.pointerId === stick.id) { e.preventDefault(); resetStick(); } });

  function releaseShootPointer(pointerId) { pressedPointers.delete(pointerId); shooting = pressedPointers.size > 0 || keys.has(" "); }

  ui.shootBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ui.shootBtn.setPointerCapture(e.pointerId);
    pressedPointers.add(e.pointerId);
    shooting = true;
  });
  ui.shootBtn.addEventListener("pointerup", (e) => { e.preventDefault(); releaseShootPointer(e.pointerId); });
  ui.shootBtn.addEventListener("pointercancel", (e) => { e.preventDefault(); releaseShootPointer(e.pointerId); });
  ui.shootBtn.addEventListener("lostpointercapture", (e) => { releaseShootPointer(e.pointerId); });

  ui.howBtn.addEventListener("click", () => ui.how.classList.toggle("hidden"));

  ui.startBtn.addEventListener("click", () => {
    chooseInitialMusic();
    startMusic();
    ui.overlay.classList.add("hidden");
    ui.gameover.classList.add("hidden");
    ui.upgrade.classList.add("hidden");
    state.running = true;
    state.inUpgrade = false;
    resetGame();
    state.lastTime = performance.now();
    requestAnimationFrame(loop);
  });

  ui.restartBtn.addEventListener("click", () => {
    // keep the same track on restart (do not reroll)
    startMusic();
    ui.gameover.classList.add("hidden");
    ui.overlay.classList.add("hidden");
    state.running = true;
    resetGame();
    state.lastTime = performance.now();
    requestAnimationFrame(loop);
  });

  ui.shareBtn.addEventListener("click", async () => {
    const text = `NEON DEFENDER — Wave ${state.wave} — Score ${state.score}`;
    try {
      await navigator.clipboard.writeText(text);
      ui.shareBtn.textContent = "COPIED!";
      setTimeout(() => (ui.shareBtn.textContent = "COPY SCORE"), 900);
    } catch {}
  });

  // ---------- Update ----------
  function update(dt) {
    if (audio.ctx && audio.started && !audio.muted) scheduleMusic();

    if (player.regen > 0 && player.invuln <= 0.2) player.hp = Math.min(player.hpMax, player.hp + player.regen * dt);

    let ix = 0, iy = 0;
    if (!isTouch) {
      if (keys.has("w") || keys.has("W") || keys.has("ArrowUp")) iy -= 1;
      if (keys.has("s") || keys.has("S") || keys.has("ArrowDown")) iy += 1;
      if (keys.has("a") || keys.has("A") || keys.has("ArrowLeft")) ix -= 1;
      if (keys.has("d") || keys.has("D") || keys.has("ArrowRight")) ix += 1;
    } else { ix = stick.outX; iy = stick.outY; }

    const len = Math.hypot(ix, iy);
    if (len > 1e-6) { ix /= Math.max(1, len); iy /= Math.max(1, len); }

    player.x += ix * player.speed * dt;
    player.y += iy * player.speed * dt;
    player.x = clamp(player.x, 20, W - 20);
    player.y = clamp(player.y, 70, H - 20);

    if (shooting && !state.inUpgrade) shoot();

    if (state.waveSpawning) {
      state.waveTimeLeft -= dt;
      state.spawnCd -= dt;
      if (state.toSpawn > 0 && state.spawnCd <= 0) {
        spawnEnemy(state.wave);
        state.toSpawn--;
        state.spawnCd += state.spawnInterval;
      }
      if (state.toSpawn <= 0 && state.waveTimeLeft <= 0) state.waveSpawning = false;
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -40 || b.x > W + 40 || b.y < 40 || b.y > H + 40) { bullets.splice(i, 1); continue; }

      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        const r = (b.size + e.size) * 0.55;
        if (dist2(b.x, b.y, e.x, e.y) <= r * r) {
          e.hp -= b.dmg;
          state.shake = 0.18;
          burst(b.x, b.y, b.crit ? 14 : 10, b.crit ? 60 : e.hue);

          if (e.hp <= 0) {
            state.score += 10 + state.wave * 2 + (e.type === "tank" ? 8 : 0);
            burst(e.x, e.y, 18, 190);

            if (e.type === "splitter" && e.splits) {
              for (let k = 0; k < e.splits; k++) {
                enemies.push({
                  type: "runner",
                  x: e.x + rand(-10, 10),
                  y: e.y + rand(-10, 10),
                  size: rand(12, 18),
                  hp: 1 + Math.floor(state.wave * 0.12),
                  speed: (118 + state.wave * 10) * rand(1.0, 1.25),
                  hue: 305, touchDmg: 1
                });
              }
            }
            enemies.splice(j, 1);
          }

          if (b.pierceLeft > 0) b.pierceLeft--;
          else { bullets.splice(i, 1); break; }
        }
      }
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -40 || b.x > W + 40 || b.y < 40 || b.y > H + 40) { enemyBullets.splice(i, 1); continue; }
      const r = (b.size + player.size) * 0.55;
      if (player.invuln <= 0 && dist2(b.x, b.y, player.x, player.y) <= r * r) {
        player.hp -= b.dmg;
        player.invuln = 0.75;
        state.shake = 0.30;
        burst(player.x, player.y, 18, 35);
        enemyBullets.splice(i, 1);
      }
    }

    for (const e of enemies) {
      const dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.hypot(dx, dy) + 1e-6;
      const nx = dx / d, ny = dy / d;

      if (e.type === "shooter") {
        const desired = e.desiredRange || 230;
        const dir = d > desired ? 1 : -1;
        e.x += nx * e.speed * dt * dir;
        e.y += ny * e.speed * dt * dir;

        e.shootCd -= dt;
        if (e.shootCd <= 0) {
          e.shootCd = 1.15 - Math.min(0.6, state.wave * 0.03) + rand(-0.10, 0.12);
          const spd = (210 + state.wave * 6) * state.difficulty;
          enemyBullets.push({ x: e.x, y: e.y, vx: nx * spd, vy: ny * spd, size: 6, dmg: Math.max(1, Math.round((1 + state.wave * 0.08) * (1 + (state.difficulty - 1) * 0.7))), life: 2.0 });
          burst(e.x, e.y, 6, 35);
        }
      } else {
        e.x += nx * e.speed * dt;
        e.y += ny * e.speed * dt;

        if (e.type === "zigzag") {
          e.zigT = (e.zigT || 0) + dt * (e.zig || 3.0);
          const sx = -ny, sy = nx;
          const amp = 38;
          e.x += sx * Math.sin(e.zigT) * amp * dt;
          e.y += sy * Math.sin(e.zigT) * amp * dt;
        }
      }

      const r = (e.size + player.size) * 0.55;
      if (player.invuln <= 0 && dist2(e.x, e.y, player.x, player.y) <= r * r) {
        player.hp -= e.touchDmg;
        player.invuln = 0.75;
        state.shake = 0.35;
        burst(player.x, player.y, 22, 305);
      }
    }

    player.invuln = Math.max(0, player.invuln - dt);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.pow(0.001, dt); p.vy *= Math.pow(0.001, dt);
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    if (!state.inUpgrade && !state.waveSpawning && enemies.length === 0 && enemyBullets.length === 0) {
      player.hp = Math.min(player.hpMax, player.hp + 2);
      syncUI();
      showUpgrades();
    }

    if (player.hp <= 0 && state.running) {
      state.running = false;
      ui.finalLine.textContent = `You reached Wave ${state.wave} with Score ${state.score}.`;
      ui.gameover.classList.remove("hidden");
      playDeathMusic();
    }

    syncUI();
  }

  // ---------- Render ----------
  function glowRect(x, y, w, h, color, glow) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  function render() {
    let sx = 0, sy = 0;
    if (state.shake > 0) {
      state.shake = Math.max(0, state.shake - 0.016);
      const m = state.shake * 10;
      sx = rand(-m, m);
      sy = rand(-m, m);
    }

    ctx.save();
    ctx.translate(sx, sy);

    ctx.fillStyle = "#06060b";
    ctx.fillRect(-sx, -sy, W, H);

    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = "#15f4ff";
    ctx.lineWidth = 1;
    const grid = 44;
    ctx.beginPath();
    for (let x = 0; x <= W; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += grid) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.globalAlpha = 1;

    const g = ctx.createRadialGradient(W/2, H/2, 80, W/2, H/2, Math.max(W,H)*0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    for (const b of bullets) {
      const col = b.crit ? "#ffe14d" : "#15f4ff";
      glowRect(b.x - b.size/2, b.y - b.size/2, b.size, b.size, col, 16);
    }

    for (const b of enemyBullets) glowRect(b.x - b.size/2, b.y - b.size/2, b.size, b.size, "#ff7a00", 14);

    for (const e of enemies) {
      const col = `hsl(${e.hue} 100% 60%)`;
      glowRect(e.x - e.size/2, e.y - e.size/2, e.size, e.size, col, 22);

      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#ffffff";
      if (e.type === "tank") ctx.fillRect(e.x - 2, e.y - e.size/2 - 18, 4, 4);
      if (e.type === "runner") ctx.fillRect(e.x - 6, e.y - e.size/2 - 18, 12, 2);
      if (e.type === "shooter") ctx.fillRect(e.x - 5, e.y - e.size/2 - 18, 10, 3);
      ctx.globalAlpha = 1;
    }

    const blink = player.invuln > 0 && Math.floor(performance.now()/80) % 2 === 0;
    const pCol = blink ? "rgba(255,255,255,0.55)" : "#ff2bd6";
    glowRect(player.x - player.size/2, player.y - player.size/2, player.size, player.size, pCol, 26);

    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life * 2.2, 0, 1);
      const col = `hsl(${p.hue} 100% 60%)`;
      glowRect(p.x - p.r, p.y - p.r, p.r*2, p.r*2, col, 18);
      ctx.restore();
    }

    ctx.restore();
  }

  // ---------- Main Loop ----------
  function loop(t) {
    if (!state.running) {
      if (audio.ctx && audio.started && !audio.muted) scheduleMusic();
      return;
    }

    const dt = clamp((t - state.lastTime) / 1000, 0, 0.033);
    state.lastTime = t;

    if (!state.inUpgrade) update(dt);
    else if (audio.ctx && audio.started && !audio.muted) scheduleMusic();

    render();
    requestAnimationFrame(loop);
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!state.running && !ui.overlay.classList.contains("hidden")) {
      e.preventDefault();
      ui.startBtn.click();
    }
  }, { passive: false });

  syncUI();
})();