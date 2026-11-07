// 英雄無雙斬：主程式（場景、鏡頭、遊戲流程、命中停頓、HUD）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Input } from './input.js';
import { Sfx } from './sfx.js';
import { Fx } from './fx.js';
import { Horde } from './horde.js';
import { Hero } from './hero.js';
import { Captain } from './captain.js';
import { Shots } from './shots.js';
import { Challenges } from './challenge.js';
import { Boss, BossFights } from './boss.js';

const D2R = Math.PI / 180;
function loadChoice() { try { return localStorage.getItem('musou.hero'); } catch { return null; } }
function loadMode() { try { const m = localStorage.getItem('musou.mode'); return m === 'challenge' || m === 'boss' ? m : 'musou'; } catch { return 'musou'; } }
const $ = (id) => document.getElementById(id);

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`讀取失敗：${url}`);
  return r.json();
}

class Game {
  constructor() {
    this.canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc3d8);
    this.scene.fog = new THREE.Fog(0x9fc3d8, 26, 58);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.camOffset = new THREE.Vector3(0, 13, 11.5);
    this.camLook = new THREE.Vector3();
    this.arenaRadius = 58;
    this.input = new Input(this.canvas);
    this.input.onPause = () => this.togglePause();
    this.sfx = new Sfx();
    this.fx = new Fx(this.scene);
    this.state = 'loading';
    this.hitstop = 0;
    this.slowmo = 1;
    this.fps = 0;
    this.buildWorld();
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  async init() {
    let challengeData, bossData;
    [this.config, this.crowdConfig, challengeData, bossData] = await Promise.all([json('data/game.json'), json('data/crowd.json'), json('data/challenges.json'), json('data/bosses.json')]);
    this.challenges = new Challenges(this, challengeData);
    this.bossFights = new BossFights(this, bossData);
    this.mode = loadMode();
    // 電腦跑不動時：網址加 ?max=120（場上最多幾隻）或 ?low（再關掉影子、降解析度）
    const q = new URLSearchParams(location.search);
    if (q.has('max')) this.config.population.max = Math.max(20, Number(q.get('max')) || 120);
    if (q.has('low')) {
      this.config.population.max = Math.min(this.config.population.max, Number(q.get('max')) || 140);
      this.renderer.shadowMap.enabled = false;
      this.renderer.setPixelRatio(1);
    }
    this.config.population.start = Math.min(this.config.population.start, this.config.population.max);
    this.popCap = this.config.population.max; // 任務自己的人數也不超過這個（?low、?max 才有效）
    this.hero = new Hero(this, this.config.hero);
    this.horde = new Horde(this, this.crowdConfig);
    this.captain = new Captain(this, this.crowdConfig.captain);
    this.captainUnit = this.captain; // Boss 戰時 this.captain 換成 Boss（同一套介面），結束後換回來
    this.boss = new Boss(this);
    this.shots = new Shots(this);
    let done = 0;
    const total = 5;
    const tick = () => { $('overlayText').textContent = `載入中… ${Math.round(++done / total * 100)}%`; };
    await Promise.all([
      this.hero.setCharacter(this.pickHero(loadChoice())).then(tick),
      this.horde.load().then(tick),
      this.captain.load().then(tick),
      this.shots.load().then(tick),
      new GLTFLoader().loadAsync('assets/models/%E7%B4%85%E8%97%A5%E6%B0%B4/%E7%B4%85%E8%97%A5%E6%B0%B4.glb').then((g) => { this.healModel = g.scene; tick(); }),
    ]);
    this.heals = [];
    this.buildHeroSelect();
    this.buildModeTabs();
    this.showTitle();
    this.last = performance.now();
    this.frames = 0; this.fpsTime = 0;
    this.renderer.setAnimationLoop(() => this.loop());
  }

  buildWorld() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xdfefff, 0x5a6b3a, 1.5));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(8, 18, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const c = sun.shadow.camera;
    c.left = c.bottom = -9; c.right = c.top = 9; c.near = 1; c.far = 50;
    s.add(sun, sun.target);
    this.sun = sun;

    // 草地：用畫布畫斑駁的草色＋泥土小路
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const g = cv.getContext('2d');
    g.fillStyle = '#6f9a4a'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? 'rgba(90,130,60,0.35)' : v < 0.85 ? 'rgba(140,170,80,0.3)' : 'rgba(150,120,80,0.25)';
      const r = 3 + Math.random() * 14;
      g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, r, 0, 7); g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(14, 14);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(this.arenaRadius + 40, 64).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
    ground.receiveShadow = true;
    s.add(ground);

    // 場地邊緣：一圈岩石與樹（InstancedMesh）
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: 0x8a8578, flatShading: true }), 140);
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 6).translate(0, 1, 0);
    const leafGeo = new THREE.ConeGeometry(1.6, 4, 7).translate(0, 4, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a2b }), 110);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x3f6e35, flatShading: true }), 110);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < 140; i++) {
      const a = i / 140 * Math.PI * 2 + Math.random() * 0.03;
      const r = this.arenaRadius + 0.5 + Math.random() * 2.5;
      const k = 1 + Math.random() * 1.6;
      q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, Math.random()));
      m.compose(p.set(Math.cos(a) * r, k * 0.4, Math.sin(a) * r), q, sc.set(k, k * 0.8, k));
      rocks.setMatrixAt(i, m);
    }
    for (let i = 0; i < 110; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = this.arenaRadius + 3 + Math.random() * 14;
      const k = 0.8 + Math.random() * 0.8;
      m.compose(p.set(Math.cos(a) * r, 0, Math.sin(a) * r), q.identity(), sc.set(k, k, k));
      trunks.setMatrixAt(i, m); leaves.setMatrixAt(i, m);
    }
    s.add(rocks, trunks, leaves);
    // 場內零星的石頭（純裝飾，不擋路）
    const pebbles = new THREE.InstancedMesh(rockGeo, rocks.material, 60);
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * (this.arenaRadius - 8), k = 0.15 + Math.random() * 0.3;
      m.compose(p.set(Math.cos(a) * r, k * 0.3, Math.sin(a) * r), q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, 0)), sc.set(k, k * 0.7, k));
      pebbles.setMatrixAt(i, m);
    }
    s.add(pebbles);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- 選角色 ----------
  pickHero(id) { return this.config.heroes.find((c) => c.id === id) ?? this.config.heroes[0]; }

  buildHeroSelect() {
    const box = $('heroSelect');
    const hs = this.config.heroes; // 長條以最高的角色為滿格
    const max = { hp: Math.max(...hs.map((c) => c.hp)), speed: Math.max(...hs.map((c) => c.speed)), range: Math.max(...hs.map((c) => c.rangeBar ?? c.rangeScale ?? 1)) };
    box.innerHTML = this.config.heroes.map((c) => `<button class="heroCard" data-id="${c.id}" style="--c:${c.color}">
      <b>${c.name}</b><em>${c.role}</em><small>${c.desc}</small>
      <span class="stat">生命<i style="width:${c.hp / max.hp * 100}%"></i></span>
      <span class="stat">速度<i style="width:${c.speed / max.speed * 100}%"></i></span>
      <span class="stat">範圍<i style="width:${(c.rangeBar ?? c.rangeScale ?? 1) / max.range * 100}%"></i></span>
    </button>`).join('');
    box.querySelectorAll('.heroCard').forEach((b) => { b.onclick = () => this.selectHero(b.dataset.id); });
    // 選角畫面可以用左右鍵換角色
    addEventListener('keydown', (e) => {
      if ($('heroSelect').hidden || $('overlay').hidden) return;
      if (this.mode !== 'musou' && this.state === 'title' && (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'KeyW' || e.code === 'KeyS')) {
        e.preventDefault();
        const step = e.code === 'ArrowUp' || e.code === 'KeyW' ? -1 : 1;
        if (this.mode === 'challenge') { this.challenges.move(step); this.pickMission(this.challenges.selected); }
        else this.bossFights.move(step);
        return;
      }
      if (this.fixedHero) return;
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight' && e.code !== 'KeyA' && e.code !== 'KeyD') return;
      const list = this.config.heroes, i = list.findIndex((c) => c.id === this.hero.def.id);
      const step = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : 1;
      this.selectHero(list[(i + step + list.length) % list.length].id);
    });
    this.markHero();
  }

  markHero() {
    document.querySelectorAll('.heroCard').forEach((b) => b.classList.toggle('on', b.dataset.id === this.hero.def.id));
  }

  async selectHero(id, { force = false } = {}) {
    if (this.state !== 'title' && this.state !== 'over') return;
    if (this.fixedHero && !force && id !== this.fixedHero) return; // 任務指定角色時不能換
    const ch = this.pickHero(id);
    if (ch.id === this.hero.def.id) return;
    const btn = $('startButton');
    btn.disabled = true;
    document.querySelectorAll('.heroCard').forEach((b) => b.classList.toggle('on', b.dataset.id === ch.id));
    await this.hero.setCharacter(ch);
    try { localStorage.setItem('musou.hero', ch.id); } catch { /* 無痕模式存不了也沒關係 */ }
    this.markHero();
    btn.disabled = false;
    btn.focus();
  }

  // ---------- 模式：千人斬／挑戰任務 ----------
  buildModeTabs() {
    document.querySelectorAll('#modeTabs button').forEach((b) => { b.onclick = () => this.setMode(b.dataset.mode); });
  }

  setMode(mode) {
    if (this.state !== 'title' && this.state !== 'over') return;
    this.mode = mode;
    try { localStorage.setItem('musou.mode', mode); } catch { /* 存不了也沒關係 */ }
    this.showTitle();
  }

  // 選任務：有指定角色就自動換成那個角色，其他角色卡片變暗
  pickMission(id) {
    this.challenges.selected = id;
    this.challenges.mark();
    const c = this.challenges.find(id);
    this.fixedHero = c.hero ?? null;
    document.querySelectorAll('.heroCard').forEach((b) => b.classList.toggle('dim', Boolean(this.fixedHero) && b.dataset.id !== this.fixedHero));
    if (this.fixedHero) this.selectHero(this.fixedHero, { force: true });
  }

  // ---------- 遊戲流程 ----------
  showTitle() {
    this.state = 'title';
    const challenge = this.mode === 'challenge';
    $('overlay').hidden = false;
    $('hud').hidden = true;
    $('overlayTitle').textContent = '英雄無雙斬';
    document.querySelectorAll('#modeTabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === this.mode));
    $('modeTabs').hidden = false;
    $('starTotal').textContent = `${this.challenges.totalStars} / ${this.challenges.list.length * 3}`;
    const boss = this.mode === 'boss';
    $('overlayText').innerHTML = challenge ? '選一個任務，達成目標拿星星！星星越多，開放越多任務。'
      : boss ? '一個人挑戰大魔王！看清楚地上的預警，躲開再反擊。打倒一隻開放下一隻。'
      : `${this.config.timeLimit / 60} 分鐘內，一個人擊破 <b>${this.config.goal}</b> 個敵人！`;
    $('challengePanel').hidden = !challenge;
    $('bossPanel').hidden = !boss;
    if (boss) {
      if (!this.bossFights.unlocked(this.bossFights.find(this.bossFights.selected))) this.bossFights.selected = this.bossFights.list[0].id;
      this.bossFights.buildList((id) => { this.bossFights.selected = id; this.bossFights.mark(); });
    }
    if (challenge) {
      if (!this.challenges.unlocked(this.challenges.find(this.challenges.selected))) this.challenges.selected = this.challenges.list[0].id;
      this.challenges.buildList((id) => this.pickMission(id));
      this.pickMission(this.challenges.selected);
    } else {
      this.fixedHero = null;
      document.querySelectorAll('.heroCard').forEach((b) => b.classList.remove('dim'));
    }
    $('result').hidden = true;
    $('backButton').hidden = true;
    $('heroSelect').hidden = false;
    $('overlay').classList.toggle('challenge', challenge || boss); // 挑戰、Boss 模式：面板加寬、角色卡片變小、不顯示按鍵說明
    $('startButton').textContent = challenge ? '開始挑戰' : boss ? '出戰' : '開始';
    $('startButton').onclick = () => this.start();
    $('startButton').focus({ preventScroll: true });
    document.querySelector('#overlay .panel').scrollTop = 0;
  }

  async start() {
    if ($('startButton').disabled) return; // 換角色還在載入
    this.sfx.unlock();
    const c = this.mode === 'challenge' ? this.challenges.find(this.challenges.selected) : null;
    const b = this.mode === 'boss' ? this.bossFights.find(this.bossFights.selected) : null;
    if (b) {
      // Boss 模型第一次用時才下載（每次重新複製一份，狂暴變色才不會留到下一場）
      $('startButton').disabled = true;
      $('startButton').textContent = '載入中…';
      await this.boss.setBoss(b);
      $('startButton').disabled = false;
    }
    this.bossFight = b;
    this.captainUnit.hide();
    this.boss.hide();
    this.captain = b ? this.boss : this.captainUnit;
    this.horde.allowed = b?.minions ?? null;
    this.enemyDamageScale = b?.minionDamageScale ?? this.config.enemyDamageScale;
    $('captainName').textContent = b ? `${b.name}` : `敵將 ${this.crowdConfig.captain.name}`;
    $('captainBar').classList.toggle('boss', Boolean(b));
    this.timeLimit = c?.time ?? b?.time ?? this.config.timeLimit;
    const pop = { ...this.config.population, ...c?.population, ...b?.population };
    pop.max = Math.min(pop.max, this.popCap);
    pop.start = Math.min(pop.start, pop.max);
    this.pop = pop;
    this.killSource = null;
    this.musouKo = 0;
    this.captainAt = c?.captainRush ? 1.5 : Infinity;
    this.input.clear();
    this.hero.reset();
    this.horde.reset();
    this.horde.attackers = 0;
    this.shots.clear();
    for (const h of this.heals) this.scene.remove(h.obj);
    this.heals = [];
    this.ko = 0; this.damageTaken = 0; this.healed = 0; this.combo = 0; this.maxCombo = 0; this.comboTimer = 0; this.captainsDown = 0;
    $('combo').hidden = true; // 上一局的連擊數字不要帶到新的一局
    this.nextCaptain = b ? Infinity : this.crowdConfig.captain.every;
    this.time = 0;
    this.hitstop = 0; this.slowmo = 1;
    // 開場：主角周圍先放一圈小兵
    const squads = Math.max(3, Math.min(10, Math.round(pop.start / 11)));
    for (let i = 0; i < squads; i++) {
      const a = i / squads * Math.PI * 2;
      this.horde.spawnSquad(Math.cos(a) * 12, Math.sin(a) * 12);
    }
    if (c?.musouFull) this.hero.musou = 100;
    if (b) this.boss.spawn(0, -14);
    $('overlay').hidden = true;
    $('heroSelect').hidden = true;
    $('heroName').textContent = this.hero.def.name;
    $('hud').hidden = false;
    $('missionHud').hidden = !c;
    $('koBox').hidden = Boolean(c); // 任務框在同一個位置，數字也顯示在任務框裡
    this.state = 'play';
    if (c) { this.challenges.begin(c); this.challenges.hud(); }
    this.banner(c ? c.name : b ? `${b.name} 出現！` : '出陣！', 1.6, b ? 'red' : '');
  }

  togglePause() {
    if (this.state === 'play') { this.state = 'pause'; $('pause').hidden = false; }
    else if (this.state === 'pause') { this.state = 'play'; $('pause').hidden = true; this.last = performance.now(); }
  }

  end(reason) {
    if (this.state !== 'play') return;
    if (this.challenges.active) { this.endChallenge(reason); return; }
    if (this.bossFight) { this.endBoss(reason); return; }
    this.state = 'over';
    const rank = this.config.ranks.find((r) => this.ko >= r.ko)?.rank ?? 'C';
    this.lastResult = { hero: this.hero.def.id, reason, ko: this.ko, maxCombo: this.maxCombo, captains: this.captainsDown, time: Math.round(this.time), rank, hp: Math.round(this.hero.hp), damageTaken: this.damageTaken, healed: this.healed };
    setTimeout(() => {
      $('overlay').hidden = false;
      $('hud').hidden = true;
      $('overlayTitle').textContent = reason === 'dead' ? '力盡倒下…' : (this.ko >= this.config.goal ? '千人斬達成！' : '時間到！');
      $('overlayText').textContent = '';
      $('result').hidden = false;
      $('heroSelect').hidden = false;
      $('result').innerHTML = `<div class="rank rank${rank}">${rank}</div>
        <dl><dt>角色</dt><dd>${this.hero.def.name}</dd><dt>擊破數</dt><dd>${this.ko}</dd><dt>最大連擊</dt><dd>${this.maxCombo}</dd>
        <dt>討取敵將</dt><dd>${this.captainsDown}</dd><dt>時間</dt><dd>${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, '0')}</dd></dl>`;
      $('startButton').textContent = '再戰一次';
      $('startButton').onclick = () => this.start();
      $('backButton').hidden = false;
      $('backButton').onclick = () => this.showTitle();
      $('startButton').focus();
    }, reason === 'dead' ? 1500 : 600);
    if (reason === 'dead') this.sfx.lose(); else this.sfx.win();
  }

  // 挑戰任務結束：clear 三顆星提早結束、time 時間到、hit 毫髮無傷被打到、dead 倒下（0 顆星）
  endChallenge(reason) {
    this.state = 'over';
    const r = this.challenges.finish(reason);
    this.lastResult = { hero: this.hero.def.id, mission: r.challenge.id, reason, value: r.value, stars: r.stars, ko: this.ko, time: Math.round(this.time) };
    const titles = { clear: '★★★ 完美達成！', time: r.stars ? '任務完成！' : '時間到…', hit: '被打到了！', dead: '力盡倒下…' };
    setTimeout(() => {
      $('overlay').hidden = false;
      $('hud').hidden = true;
      $('modeTabs').hidden = true;
      $('challengePanel').hidden = true;
      $('overlayTitle').textContent = titles[reason];
      $('overlayText').innerHTML = r.unlockedNow.length ? `🔓 開放新任務：<b>${r.unlockedNow.map((g) => g.name).join('、')}</b>`
        : (r.stars === 0 ? `再試一次！第一顆星要 ${r.challenge.stars[0]}${r.metric.unit}` : '');
      $('result').hidden = false;
      $('heroSelect').hidden = true;
      $('result').innerHTML = `<div class="bigStars">${'★'.repeat(r.stars)}<i>${'☆'.repeat(3 - r.stars)}</i></div>
        <dl><dt>任務</dt><dd>${r.challenge.name}</dd><dt>角色</dt><dd>${this.hero.def.name}</dd>
        <dt>${r.metric.label}</dt><dd>${r.value}${r.metric.unit}${r.newBest && r.value > 0 ? ' <span class="newBest">新紀錄！</span>' : ''}</dd>
        <dt>最佳紀錄</dt><dd>${this.challenges.save[r.challenge.id].best}${r.metric.unit}（${'★'.repeat(this.challenges.starsOf(r.challenge.id)) || '還沒有星星'}）</dd></dl>`;
      $('startButton').textContent = '再挑戰一次';
      $('startButton').onclick = () => this.start();
      $('backButton').hidden = false;
      $('backButton').onclick = () => this.showTitle();
      $('startButton').focus();
    }, reason === 'dead' ? 1500 : 700);
    if (reason === 'dead' || r.stars === 0) this.sfx.lose(); else this.sfx.win();
  }

  // Boss 戰結束：win 打倒、time 時間到、dead 倒下
  endBoss(reason) {
    this.state = 'over';
    const b = this.bossFight;
    const hpRatio = this.hero.hp / this.hero.def.hp;
    const r = this.bossFights.finish(b, reason, { time: this.time, hpRatio });
    this.lastResult = { hero: this.hero.def.id, boss: b.id, reason, stars: r.stars, met: r.met, time: Math.round(this.time), hp: Math.round(this.hero.hp), hpRatio: +hpRatio.toFixed(2), bossHp: Math.max(0, Math.round(this.boss.hp)), ko: this.ko };
    const titles = { win: `討伐${b.name}！`, time: '時間到…', dead: '力盡倒下…' };
    setTimeout(() => {
      $('overlay').hidden = false;
      $('hud').hidden = true;
      $('modeTabs').hidden = true;
      $('bossPanel').hidden = true;
      $('overlayTitle').textContent = titles[reason];
      $('overlayText').innerHTML = r.unlockedNow.length ? `🔓 開放下一戰：<b>${r.unlockedNow.map((x) => x.name).join('、')}</b>`
        : reason === 'win' ? '' : `${b.name} 還剩 ${Math.round(Math.max(0, this.boss.hp) / this.boss.maxHp * 100)}% 生命，再試一次！`;
      $('result').hidden = false;
      $('heroSelect').hidden = true;
      $('result').innerHTML = `<div class="bigStars">${'★'.repeat(r.stars)}<i>${'☆'.repeat(3 - r.stars)}</i></div>
        <dl><dt>Boss</dt><dd>${b.name}</dd><dt>角色</dt><dd>${this.hero.def.name}</dd>
        <dt>時間</dt><dd>${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, '0')}</dd>
        ${this.bossFights.conditions(b).map((t, i) => `<dt>${r.met[i] ? '★' : '☆'}</dt><dd class="${r.met[i] ? 'met' : 'miss'}">${t}</dd>`).join('')}</dl>`;
      $('startButton').textContent = '再戰一次';
      $('startButton').onclick = () => this.start();
      $('backButton').hidden = false;
      $('backButton').onclick = () => this.showTitle();
      $('startButton').focus();
    }, reason === 'win' ? 2600 : reason === 'dead' ? 1500 : 700);
    if (reason === 'win') this.sfx.win(); else this.sfx.lose();
  }

  // 挑戰任務的計分（不是挑戰模式時什麼都不做）
  record(name, v) { this.challenges.record(name, v); }

  banner(text, sec = 1.4, cls = '') {
    const b = $('banner');
    b.textContent = text;
    b.className = `show ${cls}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { b.className = ''; }, sec * 1000);
  }

  // ---------- 戰鬥事件 ----------
  heroStrike(s, { air = false } = {}) {
    const h = this.hero;
    const x = h.position.x, z = h.position.z, yaw = h.yaw;
    const arc = s.arc * D2R;
    const color = parseInt((s.color ?? h.def.color ?? '#bfe8ff').slice(1), 16);
    // 空中出招：只打得到高度差 airReach 以內的敵人，打到空中的敵人會再彈高（空中連段）
    const opt = air ? { y: h.h, yReach: h.def.airReach, juggle: s.juggle ?? 0 } : { juggle: s.juggle ?? 0 };
    const plunge = s === h.def.plunge;
    this.killSource = air || plunge ? 'air' : 'ground'; // 挑空連斬任務：空中攻擊、落地重擊的擊破算「空中擊破」
    const hits = this.horde.strike(x, z, yaw, arc, s.range, s.damage, { knock: s.knock, launch: s.launch ?? 0, ...opt })
      + (air && h.h > 3.5 ? 0 : this.captain.strike(x, z, yaw, arc, s.range, s.damage * 2, { knock: s.knock, stagger: Boolean(s.launch) }));
    const sy = air ? h.h : 0;
    if (s.arc >= 360) {
      this.fx.slash(x, z, yaw, Math.PI * 2 - 0.01, s.range, { color, y: 0.9 + sy, life: 0.22 });
    } else {
      this.fx.slash(x, z, yaw, arc, s.range, { color, y: 1.0 + sy, tilt: s.tilt ?? 0 });
    }
    if (plunge) this.record('plungeBest', hits);
    if (s.ring) this.fx.ring(x, z, s.range, { color: s.color ? color : 0xffd27a });
    if (s.shake) this.fx.addShake(s.shake);
    if (hits > 0) {
      this.addCombo(hits);
      this.hero.addMusou(hits * this.config.musouPerHit);
      // 命中停頓：打越多停越久，但有上限，否則一刀砍 30 隻會卡太久
      this.hitstop = Math.max(this.hitstop, Math.min(0.11, (s.hitstop ?? 0.04) + hits * 0.002));
      this.fx.addShake(Math.min(0.5, 0.12 + hits * 0.02));
      this.sfx.hit();
    }
    return hits;
  }

  // 遠程招式：箭、火球從胸口高度射出去，打中在 shots.js 裡算
  heroShoot(s, { air = false } = {}) {
    const h = this.hero;
    this.shots.fire(h.position.x, h.h + 1.0, h.position.z, h.yaw, s.shot, { air });
    this.sfx.swing();
  }

  onShotHits(hits, hitstop) {
    this.addCombo(hits);
    this.hero.addMusou(hits * this.config.musouPerHit);
    this.hitstop = Math.max(this.hitstop, Math.min(0.08, hitstop + hits * 0.002));
    this.fx.addShake(Math.min(0.35, 0.08 + hits * 0.015));
    this.sfx.hit();
  }

  // 突進斬：衝刺路徑上的小兵各被打一次
  dashSweep(d) {
    const h = this.hero;
    const near = this.horde.near(h.position.x, h.position.z, d.width, this._sweep ??= []);
    let hits = 0;
    this.killSource = 'dash';
    for (const u of near) {
      if (u.hp <= 0 || h.dashHit.has(u)) continue;
      h.dashHit.add(u);
      // 往衝刺方向的兩側彈開
      const side = Math.sign((u.x - h.position.x) * Math.cos(h.yaw) - (u.z - h.position.z) * Math.sin(h.yaw)) || 1;
      this.horde.damage(u, d.damage, Math.cos(h.yaw) * side, -Math.sin(h.yaw) * side, d.knock, 0);
      hits++;
    }
    if (this.captain.alive && !h.dashHit.has(this.captain) && Math.hypot(this.captain.position.x - h.position.x, this.captain.position.z - h.position.z) < d.width + this.captain.radius) {
      h.dashHit.add(this.captain);
      hits += this.captain.strike(h.position.x, h.position.z, h.yaw, Math.PI * 2, d.width + 1, d.damage * 2);
    }
    if (hits) { this.addCombo(hits); this.hero.addMusou(hits * this.config.musouPerHit); this.sfx.hit(); this.hitstop = Math.max(this.hitstop, 0.025); }
    this.record('dashBest', h.dashHit.size);
    this.fx.burst(h.position.x, 0.3, h.position.z, 2, { color: [0.8, 0.9, 1], speed: 2, up: 1 });
  }

  addCombo(n) {
    this.combo += n;
    this.comboTimer = 2.5;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.record('combo', this.combo);
    const el = $('combo');
    el.querySelector('b').textContent = this.combo;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    el.hidden = false;
  }

  onKill(u) {
    this.ko++;
    this.record('ko', 1);
    if (this.killSource === 'air') this.record('airKo', 1);
    if (this.hero.state === 'musou') this.record('musouBest', ++this.musouKo);
    if (Math.random() < this.config.healDropChance) this.dropHeal(u.x, u.z);
    if (this.ko >= this.nextCaptain && !this.captain.alive) this.spawnCaptain();
    if (this.ko === this.config.goal) this.banner(`${this.config.goal} 人斬！`, 2, 'gold');
    else if (this.ko % 100 === 0) this.banner(`${this.ko} 人擊破！`, 1.1);
  }

  spawnCaptain() {
    const h = this.hero.position;
    const a = Math.random() * Math.PI * 2;
    let x = h.x + Math.cos(a) * 14, z = h.z + Math.sin(a) * 14;
    const r = Math.hypot(x, z), R = this.arenaRadius - 4;
    if (r > R) { x *= R / r; z *= R / r; }
    this.captain.spawn(x, z);
    this.nextCaptain = this.ko + this.crowdConfig.captain.every;
    this.banner(`敵將「${this.crowdConfig.captain.name}」出現！`, 1.8, 'red');
    this.sfx.wave();
  }

  onCaptainDown(c) {
    if (c === this.boss) {
      // 討伐 Boss：大爆發、慢動作，然後結算
      this.banner('討伐成功！', 2.4, 'gold');
      this.hitstop = 0.25;
      this.slowmo = 0.3; this.slowmoTimer = 1.2;
      this.fx.addShake(1.2);
      this.fx.ring(c.position.x, c.position.z, 9, { color: 0xffd27a, life: 0.7 });
      this.killSource = 'ground';
      this.horde.strike(c.position.x, c.position.z, 0, Math.PI * 2, 9, 99, { knock: 14, launch: 12 });
      this.sfx.blast();
      this.end('win');
      return;
    }
    this.captainsDown++;
    this.ko += 1;
    this.record('ko', 1);
    this.record('captains', 1);
    if (this.challenges.active?.captainRush) this.captainAt = this.time + 2.5; // 討取敵將任務：下一隻馬上來
    this.banner(`討取敵將！`, 1.8, 'gold');
    this.hero.addMusou(40);
    this.dropHeal(c.position.x + 1, c.position.z);
    this.hitstop = 0.18;
    this.fx.addShake(1);
    this.fx.ring(c.position.x, c.position.z, 7, { color: 0xffd27a, life: 0.5 });
    this.killSource = 'ground';
    this.horde.strike(c.position.x, c.position.z, 0, Math.PI * 2, 6, 3, { knock: 12, launch: 10 });
    this.sfx.blast();
  }

  dropHeal(x, z) {
    if (this.heals.length >= 6) return;
    const obj = this.healModel.clone();
    obj.scale.setScalar(0.9);
    obj.position.set(x, 0.4, z);
    this.scene.add(obj);
    this.heals.push({ obj, life: 15 });
  }

  onHeroHurt(amount) {
    this.damageTaken += amount;
    if (this.challenges.active?.metric === 'noHit') this.end('hit'); // 毫髮無傷：被打到就結束
    this.sfx.hurt();
    this.fx.addShake(0.25);
    const f = $('flash');
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  }

  onHeroDead() { this.end('dead'); }

  onMusouStart() {
    this.musouKo = 0;
    this.banner('無雙奧義！', 1.6, 'gold');
    this.sfx.blast();
    document.body.classList.add('musou');
  }

  onMusouEnd() {
    document.body.classList.remove('musou');
    this.slowmo = 0.35; // 最後一擊放慢一下
    this.slowmoTimer = 0.5;
    this.sfx.blast();
  }

  // ---------- 每一格 ----------
  loop() {
    const now = performance.now();
    const real = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frames++; this.fpsTime += real;
    if (this.fpsTime >= 1) { this.fps = this.frames / this.fpsTime; this.frames = 0; this.fpsTime = 0; }

    if (this.state === 'play' || this.state === 'over') this.step(real);
    else if (this.state === 'title') { this.camLook.set(0, 1, 0); this.hero.mixer?.update(real); }
    this.updateCamera(real);
    this.renderer.render(this.scene, this.camera);
  }

  step(real) {
    this.input.tick(real);
    if (this.slowmoTimer > 0) { this.slowmoTimer -= real; if (this.slowmoTimer <= 0) this.slowmo = 1; }
    let dt = real * this.slowmo;
    if (this.hitstop > 0) { this.hitstop -= real; dt = 0; }
    this.fx.update(real);
    if (dt === 0) return; // 命中停頓：整個世界停住一瞬間（特效照跑）

    if (this.state === 'play') {
      this.time += dt;
      const pop = this.pop;
      this.horde.maintain(dt, Math.min(pop.max, pop.start + this.time * pop.growPerSecond));
      if (this.time >= this.captainAt && !this.captain.alive) { this.captainAt = Infinity; this.spawnCaptain(); }
      if (this.challenges.active) {
        this.record('noHit', this.time);
        this.record('burning', this.shots.burning.size);
        this.challenges.hud();
      }
      if (this.time >= this.timeLimit) this.end('time');
    }
    this.hero.update(dt);
    this.shots.update(dt);
    this.horde.update(dt);
    this.captain.update(dt);
    // 主角不能穿過敵將
    if (this.captain.alive && this.captain.state !== 'dying') {
      const p = this.hero.position, c = this.captain.position;
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = this.hero.radius + this.captain.radius;
      if (d < min && d > 1e-4) { p.x = c.x + dx / d * min; p.z = c.z + dz / d * min; }
    }
    this.updateHeals(dt);
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) { this.combo = 0; $('combo').hidden = true; } }
    this.updateHud();
  }

  updateHeals(dt) {
    const p = this.hero.position;
    for (let i = this.heals.length - 1; i >= 0; i--) {
      const h = this.heals[i];
      h.life -= dt;
      h.obj.rotation.y += dt * 2;
      h.obj.position.y = 0.4 + Math.sin(h.life * 4) * 0.12;
      h.obj.visible = h.life > 3 || Math.floor(h.life * 6) % 2 === 0;
      if (Math.hypot(h.obj.position.x - p.x, h.obj.position.z - p.z) < 1.2 && this.hero.alive) {
        this.healed += Math.min(this.config.healAmount, this.hero.def.hp - this.hero.hp);
        this.hero.heal(this.config.healAmount);
        this.sfx.pickup();
        this.fx.burst(p.x, 1, p.z, 14, { color: [0.4, 1, 0.5], speed: 3, up: 5 });
        h.life = 0;
      }
      if (h.life <= 0) { this.scene.remove(h.obj); this.heals.splice(i, 1); }
    }
  }

  updateCamera(real) {
    const p = this.hero?.position ?? new THREE.Vector3();
    const musou = this.hero?.state === 'musou';
    const k = musou ? 0.72 : 1;
    const hy = (this.hero?.h ?? 0) * 0.5; // 跳起來時鏡頭跟著抬一點，才看得出高度
    const target = new THREE.Vector3(p.x, hy, p.z).addScaledVector(this.camOffset, k);
    this.camera.position.lerp(target, 1 - Math.exp(-8 * real));
    this.camLook.lerp(new THREE.Vector3(p.x, 1 + hy, p.z), 1 - Math.exp(-10 * real));
    const sh = this.fx.shake * this.fx.shake * 0.6;
    this.camera.position.x += (Math.random() - 0.5) * sh;
    this.camera.position.y += (Math.random() - 0.5) * sh;
    this.camera.lookAt(this.camLook);
    this.sun.position.set(p.x + 8, 18, p.z + 6);
    this.sun.target.position.set(p.x, 0, p.z);
  }

  updateHud() {
    const h = this.hero;
    $('hpFill').style.width = `${h.hp / h.def.hp * 100}%`;
    $('hpText').textContent = Math.ceil(h.hp);
    $('musouFill').style.width = `${h.musou}%`;
    $('musouBar').classList.toggle('full', h.musou >= 100);
    $('ko').textContent = this.ko;
    const left = Math.max(0, this.timeLimit - this.time);
    $('timer').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    $('timer').classList.toggle('low', left < 30);
    const c = this.captain;
    $('captainBar').hidden = !(c.alive && c.hp > 0);
    if (c.alive) $('captainFill').style.width = `${Math.max(0, c.hp / c.maxHp * 100)}%`;
    // 敵將在畫面外時，畫面邊緣顯示方向箭頭
    const arrow = $('captainArrow');
    if (c.alive && c.hp > 0) {
      const v = c.position.clone().setY(1.5).project(this.camera);
      const off = Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95 || v.z > 1;
      arrow.hidden = !off;
      if (off) {
        const a = Math.atan2(c.position.x - h.position.x, c.position.z - h.position.z);
        arrow.style.transform = `translate(-50%,-50%) rotate(${-a * 180 / Math.PI + 180}deg) translateY(-38vh)`;
      }
    } else arrow.hidden = true;
  }
}

const game = new Game();
window.__game = game; // 測試用
game.init().catch((err) => { $('overlayText').textContent = `載入失敗：${err.message}`; console.error(err); });
