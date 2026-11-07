// 英雄大集結：主程式（場景、鏡頭、主迴圈、操作、畫面切換）
import * as THREE from 'three';
import { Sfx } from './sfx.js';
import { UI } from './ui.js';
import { Save } from './save.js';
import { Run } from './run.js';
import { Shots } from './shots.js';
import { World, THEMES, LANE } from './world.js';
import { portrait } from './models.js';

const $ = (id) => document.getElementById(id);
const PARAMS = new URLSearchParams(location.search);
const LOW = PARAMS.has('low');
const SPEED = Number(PARAMS.get('speed')) || 1; // 測試用：?speed=4 遊戲時間跑快 4 倍
const PITCH = 58 * Math.PI / 180;   // 鏡頭往下看的角度
const BOTTOM = 4;                    // 畫面下緣（隊伍卡片上面）在鏡頭中心後面幾公尺
const AHEAD = 19;                    // 往前至少看得到幾公尺
const THEME_NAMES = { goblin: '草原營地', forest: '森林', graveyard: '墓園', swamp: '毒沼', ruins: '遺跡', snow: '雪山', fortress: '要塞', volcano: '火山', dragon: '龍巢', cave: '洞窟' };

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`讀取失敗：${url}`);
  return r.json();
}

class Game {
  constructor() {
    this.canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !LOW, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, LOW ? 1 : 1.5));
    this.renderer.shadowMap.enabled = !LOW;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#9fc8e8');
    this.scene.fog = new THREE.Fog('#b9d6ea', 30, 80);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 220);
    this.hemi = new THREE.HemisphereLight(0xfff6e0, 0x5a6a3a, 1.6);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    this.sun = sun;
    sun.castShadow = !LOW;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 18, bottom: -18, near: 1, far: 60 });
    this.scene.add(sun, sun.target);
    this.world = new World(this.scene);
    this.shots = new Shots(this.scene);
    this.sfx = new Sfx();
    this.speedMult = SPEED;
    this.time = 0;
    this.menuDist = 0;
    this.run = null;
    this.view = { top: -20, bottom: 4, dist: 25, shift: 0 };
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.input = { drag: null, kx: 0, kz: 0 };
    this.keys = new Set();
    this.fps = 0; this.frames = 0; this.fpsTime = 0;
    this.themeNow = null;
    addEventListener('resize', () => this.resize());
  }

  async init() {
    const [heroes, enemies, stages] = await Promise.all([json('data/heroes.json'), json('data/enemies.json'), json('data/stages.json')]);
    this.data = { heroes, enemies, stages };
    this.save = new Save(heroes);
    this.ui = new UI(this);
    this.world.start(stages.list[0].themes);
    await this.shots.load();
    this.setupInput();
    this.resize();
    for (const id of Object.keys(this.save.owned)) portrait(this.heroDef(id).model);
    $('loading').hidden = true;
    this.ui.show('title');
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  heroDef(id) { return this.data.heroes.list.find((h) => h.id === id); }

  difficulty() {
    const list = this.data.stages.difficulties;
    return list.find((d) => d.id === this.save.diff) ?? list.find((d) => d.id === 'normal') ?? { hp: 1, damage: 1, bulletSpeed: 1, fire: 1, coins: 1 };
  }

  // ===== 鏡頭：從後上方往前看，讓整條路（左右）都在畫面裡 =====
  // 鏡頭固定往下斜 PITCH 度；dist 是鏡頭到注視點的距離、shift 是注視點相對鏡頭中心 cz 往後多少
  placeCamera(cz, cx = 0) {
    const { dist, shift } = this.view;
    const fz = cz + shift;
    this.camera.position.set(cx, Math.sin(PITCH) * dist, fz + Math.cos(PITCH) * dist);
    this.camera.lookAt(cx, 0, fz);
    this.camera.updateMatrixWorld();
  }

  groundAt(ndcX, ndcY) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, p) ? p : null;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const cardsY = -1 + 118 / h * 2;     // 下方隊伍卡片上緣（NDC）
    // 鏡頭距離 d 時，把注視點往前後移，讓畫面下緣（卡片上面）剛好是 z = +BOTTOM
    const fit = (d) => {
      this.view.dist = d; this.view.shift = 0;
      this.placeCamera(0);
      const b = this.groundAt(0, cardsY);
      this.view.shift = BOTTOM - (b ? b.z : BOTTOM);
      this.placeCamera(0);
    };
    // 找最近的距離：路的兩邊在畫面下緣也看得到；而且往前至少看得到 AHEAD 公尺
    let lo = 8, hi = 90;
    const p = new THREE.Vector3();
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      fit(mid);
      p.set(LANE + 0.6, 0, BOTTOM).project(this.camera);
      const top = this.groundAt(0, 0.92);
      const ahead = top ? BOTTOM - top.z : 999;
      if (Math.abs(p.x) > 0.97 || ahead < AHEAD) lo = mid; else hi = mid;
    }
    fit(hi);
    const top = this.groundAt(0, 0.92);
    this.view.top = top ? Math.max(-40, top.z) : -40;
    this.view.bottom = BOTTOM;
  }

  // ===== 操作：按住拖動（滑鼠、手指一樣），鍵盤方向鍵／WASD =====
  setupInput() {
    const c = this.canvas;
    const rel = (e) => {
      const r = c.getBoundingClientRect();
      const p = this.groundAt(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      return p ? { x: p.x, z: p.z - (this.run?.cz ?? 0) } : null;
    };
    c.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      const run = this.run;
      if (!run?.leader) return;
      const p = rel(e);
      if (!p) return;
      c.setPointerCapture(e.pointerId);
      this.dragStart = { p, x: run.target.x, z: run.target.z, id: e.pointerId };
      $('hint').hidden = true;
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragStart || e.pointerId !== this.dragStart.id) return;
      const p = rel(e);
      if (!p) return;
      const s = this.dragStart;
      this.input.drag = { x: s.x + (p.x - s.p.x) * 1.15, z: s.z + (p.z - s.p.z) * 1.15 };
    });
    const end = (e) => { if (this.dragStart?.id === e.pointerId) { this.dragStart = null; this.input.drag = null; } };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    const map = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd' };
    addEventListener('keydown', (e) => {
      if (map[e.code]) { this.keys.add(map[e.code]); e.preventDefault(); }
      if (e.code === 'Space' && this.run) { this.run.useBomb(); e.preventDefault(); }
    });
    addEventListener('keyup', (e) => { if (map[e.code]) this.keys.delete(map[e.code]); });
    addEventListener('blur', () => this.keys.clear());
  }

  // ===== 關卡 =====
  async startStage(stage) {
    if (!stage) return;
    this.lastStage = stage;
    this.quit(true);
    $('result').hidden = true;
    $('loading').hidden = false;
    $('loadingText').textContent = `${stage.name} 準備中…`;
    this.world.start(stage.themes);
    this.themeNow = null;
    const run = new Run(this, stage, [...this.save.pick]);
    try { await run.load(); } catch (err) { $('loadingText').textContent = String(err.message ?? err); throw err; }
    this.run = run;
    this.input.drag = null; this.dragStart = null;
    run.target = { x: run.leader.x, z: run.leader.z };
    $('loading').hidden = true;
    this.ui.startHud(run);
    this.ui.banner(stage.name);
  }

  quit(silent = false) {
    if (this.run) { this.run.dispose(); this.run = null; }
    this.ui.clearLabels();
    if (!silent) { this.world.start(this.data.stages.list[0].themes); this.menuDist = 0; this.themeNow = null; this.ui.show('stages'); }
  }

  onRunEnd(run, won, stars) {
    if (this.run !== run) return;
    let reward;
    const n = stars.filter(Boolean).length;
    const earned = Math.round(run.coins * run.diff.coins);   // 難度的金幣倍率
    if (won) reward = { ...this.save.clear(run.stage, n, earned, run.diff.coins), earned };
    else { reward = { coins: Math.floor(earned / 2) }; this.save.addCoins(reward.coins); }
    this.ui.result(run, won, stars, reward);
  }

  flash(color) {
    const f = $('flash');
    f.style.background = color;
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  }

  // ===== 主題（天空、霧、光線）慢慢換過去 =====
  updateTheme(d, dt) {
    const name = this.world.themeAt(d);
    const t = THEMES[name];
    if (this.themeNow !== name) {
      if (this.themeNow && this.run && this.run.state === 'play') this.ui.banner(`進入${THEME_NAMES[name] ?? name}`);
      if (!this.themeNow) { this.scene.background.set(t.sky); this.scene.fog.color.set(t.fog); this.hemi.color.set(t.hemi[0]); this.hemi.groundColor.set(t.hemi[1]); this.hemi.intensity = t.hemi[2]; this.sun.intensity = t.sun; }
      this.themeNow = name;
    }
    const k = 1 - Math.exp(-dt * 1.5);
    this.scene.background.lerp(tmp.set(t.sky), k);
    this.scene.fog.color.lerp(tmp.set(t.fog), k);
    this.hemi.color.lerp(tmp.set(t.hemi[0]), k);
    this.hemi.groundColor.lerp(tmp.set(t.hemi[1]), k);
    this.hemi.intensity += (t.hemi[2] - this.hemi.intensity) * k;
    this.sun.intensity += (t.sun - this.sun.intensity) * k;
  }

  loop(now) {
    const raw = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const dt = raw * SPEED;
    this.time += dt;
    this.frames++; this.fpsTime += raw;
    if (this.fpsTime >= 1) { this.fps = this.frames / this.fpsTime; this.frames = 0; this.fpsTime = 0; window.__fps = this.fps; }

    const run = this.run;
    let cz, cx = 0;
    if (run) {
      this.input.kx = (this.keys.has('r') ? 1 : 0) - (this.keys.has('l') ? 1 : 0);
      this.input.kz = (this.keys.has('d') ? 1 : 0) - (this.keys.has('u') ? 1 : 0);
      // 一次最多算 1/30 秒，子彈才不會一步跳過敵人（?speed 加速測試時特別重要）
      const n = Math.ceil(dt / 0.034);
      for (let i = 0; i < n; i++) run.update(dt / n, this.input);
      cz = run.cz;
      cx = (run.leader?.x ?? 0) * 0.12;
      this.ui.hud(run);
    } else {
      this.menuDist += dt * 2.5;
      cz = -this.menuDist;
    }
    this.placeCamera(cz, cx);
    this.sun.position.set(cx - 7, 22, cz + 10);
    this.sun.target.position.set(cx, 0, cz - 4);
    this.world.update(cz, this.view.bottom + 8, this.view.top - 30, this.time);
    this.updateTheme(-cz + (this.view.top + this.view.bottom) / -2 + 4, raw);
    this.shots.update(dt);
    this.shots.sync(this.time);
    this.ui.updateLabels(this.camera, dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((t) => this.loop(t));
  }
}

const tmp = new THREE.Color();
const game = new Game();
window.game = game;
game.init().catch((err) => { console.error(err); $('loadingText').textContent = `載入失敗：${err.message ?? err}`; });
