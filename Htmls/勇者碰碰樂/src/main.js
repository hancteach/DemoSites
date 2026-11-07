// 勇者碰碰樂：主程式（場景、鏡頭、主迴圈、瞄準與彈射的操作、畫面切換）
import * as THREE from 'three';
import { Sfx } from './sfx.js';
import { Fx } from './fx.js';
import { UI } from './ui.js';
import { Save } from './save.js';
import { Battle } from './battle.js';
import { loadLooks, portrait } from './models.js';
import { guidePath } from './physics.js';
import { Scenery, THEMES } from './scenery.js';

const $ = (id) => document.getElementById(id);
const PARAMS = new URLSearchParams(location.search);
const LOW = PARAMS.has('low');
const SPEED = Number(PARAMS.get('speed')) || 1; // 測試用：?speed=4 遊戲時間跑快 4 倍
const PULL_FULL = 4.5;   // 拉多遠（公尺）算拉滿
const PULL_MIN = 0.12;   // 拉太短當作取消

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
    this.scene.background = new THREE.Color('#1b2233');
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 200);
    this.camTarget = new THREE.Vector3();
    this.camBase = new THREE.Vector3();
    this.hemi = new THREE.HemisphereLight(0xdfeaff, 0x55604a, 1.6);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.Fog('#b9d6ea', 40, 90);
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    this.sun = sun;
    sun.position.set(-6, 18, 8);
    sun.castShadow = !LOW;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 13, bottom: -13, near: 1, far: 50 });
    this.scene.add(sun);
    this.time = 0;
    this.state = 'loading';
    this.hitstopT = 0; this.slowT = 0; this.shakeA = 0;
    this.sfx = new Sfx();
    this.fx = new Fx(this);
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.fps = 0; this.frames = 0; this.fpsTime = 0;
    addEventListener('resize', () => this.resize());
  }

  async init() {
    const [heroes, enemies, stages] = await Promise.all([json('data/heroes.json'), json('data/enemies.json'), json('data/stages.json')]);
    this.data = { heroes, enemies, stages };
    this.save = new Save(heroes);
    this.ui = new UI(this);
    this.buildBoard();
    this.scenery = new Scenery(this);
    this.setTheme(stages.list[0]);
    this.setupAim();
    this.resize();
    await loadLooks();
    for (const id of this.save.team) portrait(this.heroDef(id).model); // 先拍隊伍的頭像
    this.state = 'menu';
    $('loading').hidden = true;
    this.ui.show('title');
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  heroDef(id) { return this.data.heroes.list.find((h) => h.id === id); }

  // ===== 場地 =====
  buildBoard() {
    const { w, d } = this.data.stages.board;
    this.boardGroup = new THREE.Group();
    this.groundTex = this.makeGroundTexture('#7fae5a');
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 0.95 }));
    floor.receiveShadow = true;
    this.boardGroup.add(floor);
    this.outside = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3d5236', roughness: 1 }));
    this.outside.position.y = -0.02;
    this.boardGroup.add(this.outside);
    this.wallMat = new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.8 });
    const t = 0.5, h = 0.7;
    for (const [x, z, sx, sz] of [[0, -d / 2 - t / 2, w + t * 2, t], [0, d / 2 + t / 2, w + t * 2, t], [-w / 2 - t / 2, 0, t, d], [w / 2 + t / 2, 0, t, d]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), this.wallMat);
      m.position.set(x, h / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      this.boardGroup.add(m);
    }
    this.scene.add(this.boardGroup);
    // 瞄準：箭頭＋虛線
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1, 3).rotateX(Math.PI / 2).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.arrow.visible = false;
    this.scene.add(this.arrow);
    this.guide = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.45, gapSize: 0.3, transparent: true, opacity: 0.85 }));
    this.guide.visible = false;
    this.scene.add(this.guide);
  }

  // 場地地板：深淺格子＋小斑點（每關顏色不同）
  makeGroundTexture(color, speck = null) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 768;
    const g = c.getContext('2d');
    const base = new THREE.Color(color);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 8; x++) {
      const k = (x + y) % 2 ? 1 : 0.92;
      g.fillStyle = `#${base.clone().multiplyScalar(k).getHexString()}`;
      g.fillRect(x * 64, y * 64, 64, 64);
    }
    if (speck) this.specks(g, 512, 768, speck, 900, 1, 4);
    g.globalAlpha = 0.18; g.fillStyle = '#ffffff';
    g.fillRect(0, 382, 512, 4);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  specks(g, w, h, color, n, min, max) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = 0.75 + Math.random() * 0.5;
      g.globalAlpha = 0.25 + Math.random() * 0.35;
      g.fillStyle = `#${c.clone().multiplyScalar(k).getHexString()}`;
      const r = min + Math.random() * (max - min);
      g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, r * 1.6, r, Math.random() * 3, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }

  // 場地外面的地：斑點貼圖重複鋪
  makeOutsideTexture(color, speck) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 256, 256);
    this.specks(g, 256, 256, speck, 260, 2, 9);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(14, 14);
    return tex;
  }

  // 換關卡主題：地板、牆、外面的地、天空、霧、光線、布景（scenery.js 的 THEMES）
  setTheme(stage) {
    const id = stage?.theme ?? stage?.id ?? 'goblin';
    if (this.themeId === id) return;
    this.themeId = id;
    const T = THEMES[id] ?? THEMES.goblin;
    const tex = this.makeGroundTexture(stage?.ground ?? T.ground, T.speck);
    const floor = this.boardGroup.children[0].material;
    floor.map = tex; floor.needsUpdate = true;
    this.groundTex.dispose();
    this.groundTex = tex;
    this.wallMat.color.set(stage?.edge ?? '#6b4a2b');
    const out = this.makeOutsideTexture(T.outside, T.speck);
    this.outside.material.map?.dispose();
    this.outside.material.map = out;
    this.outside.material.color.set('#ffffff');
    this.outside.material.needsUpdate = true;
    this.scene.background = new THREE.Color(T.sky);
    this.scene.fog.color.set(T.fog);
    this.hemi.color.set(T.hemi[0]); this.hemi.groundColor.set(T.hemi[1]); this.hemi.intensity = T.hemi[2];
    this.sun.intensity = T.sun;
    this.scenery.build(id, this.data.stages.board);
  }

  // 鏡頭：從斜上方看整個場地，上面留給 HUD、下面留給角色卡
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.data) return;
    const { w: bw, d: bd } = this.data.stages.board;
    const top = (64 / h) * 2, bottom = ((this.state === 'battle' ? 118 : 30) / h) * 2, side = (12 / w) * 2;
    const tilt = 0.5;
    const pts = [];
    for (const x of [-bw / 2 - 0.5, bw / 2 + 0.5]) for (const z of [-bd / 2 - 0.5, bd / 2 + 0.5]) for (const y of [0, 0.7]) pts.push(new THREE.Vector3(x, y, z));
    pts.push(new THREE.Vector3(0, 4.6, -bd / 2 + 4)); // Boss 的頭也要看得到
    let tz = 0, dist = 30;
    const place = (dd) => {
      this.camera.position.set(0, Math.cos(tilt) * dd, tz + Math.sin(tilt) * dd);
      this.camera.lookAt(0, 0, tz);
      this.camera.updateMatrixWorld();
      let minX = 9, maxX = -9, minY = 9, maxY = -9;
      for (const p of pts) { const q = p.clone().project(this.camera); minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
      return { minX, maxX, minY, maxY };
    };
    for (let it = 0; it < 4; it++) {
      let lo = 5, hi = 120;
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2, b = place(mid);
        const fits = b.maxX - b.minX <= 2 - 2 * side && b.maxY - b.minY <= 2 - top - bottom;
        if (fits) hi = mid; else lo = mid;
      }
      dist = hi;
      const b = place(dist);
      const want = (1 - top + (-1 + bottom)) / 2, have = (b.maxY + b.minY) / 2;
      tz += (want - have) * bd * 0.45;
    }
    place(dist);
    this.camBase.copy(this.camera.position);
    this.camTarget.set(0, 0, tz);
  }

  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }

  groundAt(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, p) ? p : null;
  }

  // ===== 瞄準：在畫面任何地方按住往後拉，放開彈出去 =====
  setupAim() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      const b = this.battle;
      if (!b || b.state !== 'aim' || this.paused) return;
      this.sfx.unlock();
      const p = this.groundAt(e.clientX, e.clientY);
      if (!p) return;
      this.aim = { id: e.pointerId, start: p, dx: 0, dz: 0, power: 0 };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.aim || e.pointerId !== this.aim.id) return;
      const p = this.groundAt(e.clientX, e.clientY);
      if (!p) return;
      this.setAim(this.aim.start.x - p.x, this.aim.start.z - p.z);
    });
    const up = (e) => {
      if (!this.aim || e.pointerId !== this.aim.id) return;
      const a = this.aim;
      this.aim = null;
      this.arrow.visible = false; this.guide.visible = false;
      if (a.power >= PULL_MIN && this.battle?.state === 'aim' && this.battle.onLaunch) this.battle.onLaunch({ dx: a.dx, dz: a.dz, power: a.power });
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => { if (this.aim) { this.aim.power = 0; up(e); } });
  }

  // 拉的方向與長度 → 彈出去的方向與力道，畫箭頭和反彈預測線
  setAim(dx, dz) {
    const len = Math.hypot(dx, dz);
    const a = this.aim;
    a.power = Math.min(1, len / PULL_FULL);
    if (len < 0.01) return;
    a.dx = dx / len; a.dz = dz / len;
    const h = this.battle.current();
    const show = a.power >= PULL_MIN;
    this.arrow.visible = show; this.guide.visible = show;
    if (!show) return;
    const col = new THREE.Color().setHSL(0.33 - 0.33 * a.power, 0.9, 0.6);
    this.arrow.material.color.copy(col);
    this.arrow.position.set(h.x + a.dx * 0.9, 0.12, h.z + a.dz * 0.9);
    this.arrow.rotation.y = Math.atan2(a.dx, a.dz);
    this.arrow.scale.set(1, 1, 0.8 + a.power * 1.6);
    h.actor.root.rotation.y = Math.atan2(a.dx, a.dz);
    const { w, d } = this.data.stages.board;
    const pts = guidePath(h.x, h.z, a.dx, a.dz, 4 + a.power * 12, h.r, w, d, 2).map(([x, z]) => new THREE.Vector3(x, 0.1, z));
    this.guide.geometry.dispose();
    this.guide.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.guide.computeLineDistances();
    this.guide.material.color.copy(col);
  }

  // ===== 流程 =====
  showMenuScene() {
    if (this.battle) this.endBattleScene();
    this.state = 'menu';
    this.resize();
  }

  async startStage(stage) {
    if (this.battle) this.endBattleScene();
    this.lastStage = stage;
    $('result').hidden = true;
    $('loading').hidden = false;
    $('loadingText').textContent = `${stage.name} 載入中…`;
    this.setTheme(stage);
    const battle = new Battle(this, stage, [...this.save.team]);
    this.battle = battle;
    try { await battle.load(); } catch (err) { $('loadingText').textContent = `載入失敗：${err.message}`; throw err; }
    if (this.battle !== battle) return;
    $('loading').hidden = true;
    this.state = 'battle';
    this.ui.show('hud');
    this.ui.setupHud(battle);
    this.resize();
    battle.run();
  }

  onBattleEnd(r) {
    const stage = this.battle.stage;
    let reward;
    if (r.win) reward = this.save.clear(stage, r.stars);
    else { reward = { coins: Math.floor(r.coins / 2) }; this.save.addCoins(reward.coins); }
    if (r.win) { reward.coins += r.coins; this.save.addCoins(r.coins); }
    this.lastResult = { ...r, reward, stage: stage.id };
    setTimeout(() => {
      if (this.battle?.state !== 'over') return;
      r.win ? this.sfx.win() : this.sfx.lose();
      this.ui.showResult(r, stage, reward);
    }, r.win ? 900 : 700);
  }

  quitBattle() {
    this.ui.show('stages');
  }

  endBattleScene() {
    this.battle.dispose();
    this.battle = null;
    this.fx.clear();
    this.ui.clearLabels();
    this.aim = null;
    this.arrow.visible = false; this.guide.visible = false;
    $('result').hidden = true;
  }

  shake(a) { this.shakeA = Math.max(this.shakeA, a); }
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
  slowmo(t) { this.slowT = Math.max(this.slowT, t); }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const real = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frames++; this.fpsTime += real;
    if (this.fpsTime >= 1) { this.fps = this.frames / this.fpsTime; this.frames = 0; this.fpsTime = 0; }
    let dt = real * SPEED;
    if (this.hitstopT > 0) { this.hitstopT -= real; dt = real * 0.15; }
    if (this.slowT > 0) { this.slowT -= real; dt *= 0.3; }
    this.time += dt;
    if (this.battle && this.state === 'battle') this.battle.update(dt);
    this.fx.update(dt, this.time);
    this.scenery.update(this.time);
    // 畫面震動
    this.camera.position.copy(this.camBase);
    if (this.shakeA > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeA;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeA;
      this.shakeA *= Math.exp(-real * 10);
    }
    this.camera.lookAt(this.camTarget);
    if (this.battle) this.ui.placeLabels();
    this.renderer.render(this.scene, this.camera);
  }
}

const game = new Game();
window.__game = game;
game.init().catch((err) => { console.error(err); $('loadingText').textContent = `發生錯誤：${err.message}`; });
