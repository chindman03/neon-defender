(() => {
  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };

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

  // ---------- Audio: 8-bit-ish loop (WebAudio synth) ----------
  let audio = {
    ctx: null,
    master: null,
    muted: false,
    started: false,
    nextNoteTime: 0,
    step: 0,
    tempo: 132,          // bpm-ish
    scheduleAhead: 0.20, // seconds
  };

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
    if (!audio.started || audio.muted) return;
    const a = audio.ctx;
    const secondsPerBeat = 60 / audio.tempo;
    const stepDur = secondsPerBeat / 2; // 8th notes

    // A tiny "Tron-ish" arpeggio loop
    const bass = [55, 55, 73.42, 82.41, 55, 55, 98.00, 82.41]; // A1, D2, E2-ish
    const arp  = [440, 554.37, 659.25, 880, 659.25, 554.37, 493.88, 659.25];

    while (audio.nextNoteTime < a.currentTime + audio.scheduleAhead) {
      const t = audio.nextNoteTime;
      const s = audio.step % 16;

      // bass on even steps
      if (s % 2 === 0) playBeep(bass[(audio.step / 2) % bass.length | 0], t, stepDur * 0.95, "square", 0.12);

      // arp every step with light bite
      const f = arp[s % arp.length];
      playBeep(f, t, stepDur * 0.60, "square", 0.06);

      // tiny "hat" noise-ish via very high square
      if (s % 4 === 2) playBeep(6000, t, 0.03, "square", 0.02);

      audio.nextNoteTime += stepDur;
      audio.step++;
    }
  }

  function startMusic() {
    initAudio();
    if (audio.started) return;
    audio.started = true;
    audio.nextNoteTime = audio.ctx.currentTime + 0.05;
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

  // Any user gesture should unlock audio on mobile
  window.addEventListener("pointerdown", () => startMusic(), { once: true });

  // ---------- Game State ----------
  let W = 0, H = 0, dpr = 1;

  const state = {
    running: false,
    inUpgrade: false,
    wave: 1,
    score: 0,
    lastTime: 0,
    shake: 0,
  };

  const player = {
    x: 0, y: 0,
    size: 18,
    speed: 260,
    hpMax: 10,
    hp: 10,
    invuln: 0,
    fireRate: 6,      // shots per second
    damage: 1,
    bulletSpeed: 520,
    bulletSize: 6,
    spread: 0,        // radians
  };

  const bullets = [];
  const enemies = [];
  const particles = [];

  // input
  const keys = new Set();
  let shooting = false;
  let moveX = 0, moveY = 0;

  // touch joystick
  let stick = {
    active: false,
    id: null,
    baseX: 0, baseY: 0,
    knobX: 0, knobY: 0,
    outX: 0, outY: 0,
    maxR: 56
  };

  // fire cooldown
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

    // keep player in bounds on resize
    player.x = clamp(player.x || W / 2, 30, W - 30);
    player.y = clamp(player.y || H * 0.7, 60, H - 30);
  }
  window.addEventListener("resize", resize);
  resize();

  function resetGame() {
    state.wave = 1;
    state.score = 0;
    state.shake = 0;
    player.hpMax = 10;
    player.hp = 10;
    player.speed = 260;
    player.fireRate = 6;
    player.damage = 1;
    player.bulletSpeed = 520;
    player.bulletSize = 6;
    player.spread = 0;
    player.invuln = 0;

    bullets.length = 0;
    enemies.length = 0;
    particles.length = 0;

    player.x = W / 2;
    player.y = H * 0.7;

    spawnWave(state.wave);
    syncUI();
  }

  function syncUI() {
    ui.wave.textContent = `Wave ${state.wave}`;
    ui.score.textContent = `Score ${state.score}`;
    ui.hp.textContent = `HP ${Math.max(0, Math.ceil(player.hp))}/${player.hpMax}`;
  }

  // ---------- Spawning ----------
  function spawnWave(wave) {
    enemies.length = 0;
    const count = Math.floor(6 + wave * 2.2);
    const hpBase = 1 + Math.floor(wave * 0.25);
    const spdBase = 70 + wave * 6;

    for (let i = 0; i < count; i++) {
      const edge = Math.random() < 0.5 ? "top" : (Math.random() < 0.5 ? "left" : "right");
      let x, y;
      if (edge === "top") { x = rand(30, W - 30); y = rand(70, 120); }
      else if (edge === "left") { x = rand(20, 60); y = rand(120, H - 60); }
      else { x = rand(W - 60, W - 20); y = rand(120, H - 60); }

      enemies.push({
        x, y,
        size: rand(14, 26),
        hp: hpBase + (Math.random() < 0.15 ? 2 : 0),
        speed: spdBase * rand(0.85, 1.15),
        touchDmg: 1,
        hue: Math.random() < 0.5 ? 185 : 305,
      });
    }
  }

  // ---------- Upgrades ----------
  const upgradePool = [
    {
      key: "firerate",
      name: "Overclock",
      desc: "+20% fire rate",
      apply: () => { player.fireRate *= 1.2; }
    },
    {
      key: "damage",
      name: "Hotter Lasers",
      desc: "+1 damage",
      apply: () => { player.damage += 1; }
    },
    {
      key: "speed",
      name: "Thrusters",
      desc: "+12% move speed",
      apply: () => { player.speed *= 1.12; }
    },
    {
      key: "hp",
      name: "Reinforced Hull",
      desc: "+3 max HP (heal 3)",
      apply: () => {
        player.hpMax += 3;
        player.hp = Math.min(player.hpMax, player.hp + 3);
      }
    },
    {
      key: "bulletspeed",
      name: "Rail Charge",
      desc: "+18% bullet speed",
      apply: () => { player.bulletSpeed *= 1.18; }
    },
    {
      key: "bigshot",
      name: "Wide Bolts",
      desc: "+2 bullet size",
      apply: () => { player.bulletSize += 2; }
    },
    {
      key: "spread",
      name: "Tri-Spark",
      desc: "Add slight spread (more coverage)",
      apply: () => { player.spread = clamp(player.spread + 0.08, 0, 0.30); }
    },
  ];

  function showUpgrades() {
    state.inUpgrade = true;
    ui.upgrade.classList.remove("hidden");
    ui.upgradeGrid.innerHTML = "";

    // pick 3 unique upgrades
    const picks = [];
    const pool = [...upgradePool];
    while (picks.length < 3 && pool.length) {
      const idx = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(idx, 1)[0]);
    }

    for (const up of picks) {
      const card = document.createElement("div");
      card.className = "upCard";
      card.innerHTML = `
        <h3>${up.name}</h3>
        <p>${up.desc}</p>
        <button class="btn" style="width:100%">TAKE</button>
      `;
      card.querySelector("button").addEventListener("click", () => {
        up.apply();
        ui.upgrade.classList.add("hidden");
        state.inUpgrade = false;
        state.wave += 1;
        spawnWave(state.wave);
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

    // Auto-aim to nearest enemy; if none, shoot upward
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
    const shots = player.spread > 0.001 ? 3 : 1;
    const spread = player.spread;

    for (let i = 0; i < shots; i++) {
      const t = shots === 1 ? 0 : (i - 1) * spread; // -spread, 0, +spread
      const ang = baseAng + t;

      bullets.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(ang) * player.bulletSpeed,
        vy: Math.sin(ang) * player.bulletSpeed,
        size: player.bulletSize,
        dmg: player.damage,
        life: 1.4
      });
    }

    // tiny shoot particle
    burst(player.x, player.y, 6, 190);
  }

  // ---------- Particles ----------
  function burst(x, y, n, hue) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(60, 260);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.25, 0.55),
        r: rand(1.5, 3.2),
        hue
      });
    }
  }

  // ---------- Input ----------
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","w","a","s","d","W","A","S","D"].includes(e.key)) {
      e.preventDefault();
    }
    keys.add(e.key);
    if (e.key === " ") shooting = true;
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.key);
    if (e.key === " ") shooting = false;
  });

  // Touch: joystick
  function setStickKnob(nx, ny) {
    stick.knobX = nx;
    stick.knobY = ny;
    ui.stickKnob.style.transform = `translate(${nx}px, ${ny}px)`;
  }

  function resetStick() {
    stick.active = false;
    stick.id = null;
    stick.outX = 0; stick.outY = 0;
    setStickKnob(0, 0);
  }

  function baseRect() {
    return ui.stickBase.getBoundingClientRect();
  }

  ui.stickBase.addEventListener("pointerdown", (e) => {
    if (!isTouch) return;
    stick.active = true;
    stick.id = e.pointerId;
    ui.stickBase.setPointerCapture(e.pointerId);
    const r = baseRect();
    stick.baseX = r.left + r.width / 2;
    stick.baseY = r.top + r.height / 2;
  });

  ui.stickBase.addEventListener("pointermove", (e) => {
    if (!stick.active || e.pointerId !== stick.id) return;
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

  ui.stickBase.addEventListener("pointerup", (e) => {
    if (e.pointerId === stick.id) resetStick();
  });
  ui.stickBase.addEventListener("pointercancel", (e) => {
    if (e.pointerId === stick.id) resetStick();
  });

  // Shoot button
  ui.shootBtn.addEventListener("pointerdown", () => { shooting = true; });
  ui.shootBtn.addEventListener("pointerup", () => { shooting = false; });
  ui.shootBtn.addEventListener("pointercancel", () => { shooting = false; });

  // Buttons
  ui.howBtn.addEventListener("click", () => ui.how.classList.toggle("hidden"));

  ui.startBtn.addEventListener("click", () => {
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
    } catch {
      // ignore
    }
  });

  // ---------- Update ----------
  function update(dt) {
    // music scheduling
    if (audio.ctx && audio.started && !audio.muted) scheduleMusic();

    // input -> movement
    let ix = 0, iy = 0;
    if (!isTouch) {
      if (keys.has("w") || keys.has("W") || keys.has("ArrowUp")) iy -= 1;
      if (keys.has("s") || keys.has("S") || keys.has("ArrowDown")) iy += 1;
      if (keys.has("a") || keys.has("A") || keys.has("ArrowLeft")) ix -= 1;
      if (keys.has("d") || keys.has("D") || keys.has("ArrowRight")) ix += 1;
    } else {
      ix = stick.outX;
      iy = stick.outY;
    }

    const len = Math.hypot(ix, iy);
    if (len > 1e-6) { ix /= Math.max(1, len); iy /= Math.max(1, len); }

    player.x += ix * player.speed * dt;
    player.y += iy * player.speed * dt;

    // bounds (top UI area)
    player.x = clamp(player.x, 20, W - 20);
    player.y = clamp(player.y, 70, H - 20);

    // shooting
    if (shooting && !state.inUpgrade) shoot();

    // bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      if (b.life <= 0 || b.x < -30 || b.x > W + 30 || b.y < 40 || b.y > H + 30) {
        bullets.splice(i, 1);
        continue;
      }

      // hit enemies
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        const r = (b.size + e.size) * 0.55;
        if (dist2(b.x, b.y, e.x, e.y) <= r * r) {
          e.hp -= b.dmg;
          state.shake = 0.18;
          burst(b.x, b.y, 10, e.hue);
          bullets.splice(i, 1);

          if (e.hp <= 0) {
            state.score += 10 + state.wave * 2;
            burst(e.x, e.y, 18, 190);
            enemies.splice(j, 1);
          }
          break;
        }
      }
    }

    // enemies
    for (const e of enemies) {
      const ang = Math.atan2(player.y - e.y, player.x - e.x);
      e.x += Math.cos(ang) * e.speed * dt;
      e.y += Math.sin(ang) * e.speed * dt;

      // collide with player
      const r = (e.size + player.size) * 0.55;
      if (player.invuln <= 0 && dist2(e.x, e.y, player.x, player.y) <= r * r) {
        player.hp -= e.touchDmg;
        player.invuln = 0.75;
        state.shake = 0.35;
        burst(player.x, player.y, 22, 305);
      }
    }

    player.invuln = Math.max(0, player.invuln - dt);

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.001, dt); // quick damping
      p.vy *= Math.pow(0.001, dt);
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // win wave -> upgrade
    if (!state.inUpgrade && enemies.length === 0) {
      // small heal between waves
      player.hp = Math.min(player.hpMax, player.hp + 2);
      syncUI();
      showUpgrades();
    }

    // game over
    if (player.hp <= 0) {
      state.running = false;
      ui.finalLine.textContent = `You reached Wave ${state.wave} with Score ${state.score}.`;
      ui.gameover.classList.remove("hidden");
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
    // camera shake
    let sx = 0, sy = 0;
    if (state.shake > 0) {
      state.shake = Math.max(0, state.shake - 0.016);
      const m = state.shake * 10;
      sx = rand(-m, m);
      sy = rand(-m, m);
    }

    ctx.save();
    ctx.translate(sx, sy);

    // background
    ctx.fillStyle = "#06060b";
    ctx.fillRect(-sx, -sy, W, H);

    // subtle grid
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = "#15f4ff";
    ctx.lineWidth = 1;
    const grid = 44;
    ctx.beginPath();
    for (let x = 0; x <= W; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += grid) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // vignette
    const g = ctx.createRadialGradient(W/2, H/2, 80, W/2, H/2, Math.max(W,H)*0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // bullets
    for (const b of bullets) {
      glowRect(b.x - b.size/2, b.y - b.size/2, b.size, b.size, "#15f4ff", 16);
    }

    // enemies
    for (const e of enemies) {
      const col = `hsl(${e.hue} 100% 60%)`;
      glowRect(e.x - e.size/2, e.y - e.size/2, e.size, e.size, col, 22);

      // hp pip
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(e.x - e.size/2, e.y - e.size/2 - 8, e.size, 4);
      ctx.fillStyle = "rgba(21,244,255,0.85)";
      ctx.fillRect(e.x - e.size/2, e.y - e.size/2 - 8, e.size * clamp(e.hp / (1 + Math.floor(state.wave*0.25) + 2), 0, 1), 4);
      ctx.globalAlpha = 1;
    }

    // player (blink when invulnerable)
    const blink = player.invuln > 0 && Math.floor(performance.now()/80) % 2 === 0;
    const pCol = blink ? "rgba(255,255,255,0.55)" : "#ff2bd6";
    glowRect(player.x - player.size/2, player.y - player.size/2, player.size, player.size, pCol, 26);

    // particles
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life * 2.2, 0, 1);
      const col = `hsl(${p.hue} 100% 60%)`;
      glowRect(p.x - p.r, p.y - p.r, p.r*2, p.r*2, col, 18);
      ctx.restore();
    }

    // crosshair-ish indicator (auto aim)
    if (enemies.length) {
      let best = 1e18, bestE = null;
      for (const e of enemies) {
        const d = dist2(player.x, player.y, e.x, e.y);
        if (d < best) { best = d; bestE = e; }
      }
      if (bestE) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = "#a6ff4d";
        ctx.shadowColor = "#a6ff4d";
        ctx.shadowBlur = 12;
        ctx.lineWidth = 2;
        const r = bestE.size * 0.75;
        ctx.beginPath();
        ctx.rect(bestE.x - r, bestE.y - r, r*2, r*2);
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();
  }

  // ---------- Main Loop ----------
  function loop(t) {
    if (!state.running) return;

    const dt = clamp((t - state.lastTime) / 1000, 0, 0.033);
    state.lastTime = t;

    if (!state.inUpgrade) update(dt);
    else {
      // still schedule music while paused in upgrade
      if (audio.ctx && audio.started && !audio.muted) scheduleMusic();
    }
    render();

    requestAnimationFrame(loop);
  }

  // ---------- Start in overlay ----------
  // Also: let clicking canvas dismiss overlay + start (nice for mobile)
  canvas.addEventListener("pointerdown", () => {
    if (!state.running && !ui.overlay.classList.contains("hidden")) {
      ui.startBtn.click();
    }
  }, { passive: true });

  // Keep UI correct initially
  syncUI();
})();
