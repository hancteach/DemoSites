// 勇者算算看：自動往前跑，跑到題目牆前停下來算加減題；答對拿獎勵（+N 夥伴、×2、×3），答錯或時間到獎勵反過來
// （−N、÷2、÷3）。路上打怪，終點打 Boss。由《勇者衝衝衝》改出來，題目牆在 src/game/quiz.js。
// 模型與動作沿用《勇者大冒險》（tools/copy_models.mjs 抄過來），玩法數值都在 data/*.json。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Assets, loadJson } from './core/assets.js';
import { Input } from './core/input.js';
import { Sfx } from './core/sfx.js';
import { Crowd } from './game/crowd.js';
import { Boss, Enemy } from './game/enemy.js';
import { Fx } from './game/fx.js';
import { Obstacles } from './game/obstacles.js';
import { QuizWalls, rewardText } from './game/quiz.js';
import { Projectiles } from './game/projectiles.js';
import { EnemyShots } from './game/enemyShots.js';
import { Save } from './game/save.js';
import { Hud } from './ui/hud.js';
import { renderPortraits } from './ui/portraits.js';
import { Track } from './world/track.js';

const GOLD = '#ffd75e';
const ICONS = { 騎士: '🛡️', 魔法師: '🔥', 盜賊: '🗡️', 弓箭手: '🏹', 忍者: '🥷', 死靈盔甲武士: '⚔️' };
const BLOCK_GAP = 1.2;       // 敵人離隊伍邊緣多近就停下來打
const ENEMY_AHEAD = 60;      // 怪物在隊伍前方多遠出現
const BOSS_AHEAD = 45;
const DRAG_SCALE = 1.6;      // 拖曳整個畫面寬度＝移動路寬的幾倍
const STEP = 1 / 60;
const LANE_DRAG = 90;         // 作答時拖曳多少像素換一個答案

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc7e8);
    this.scene.fog = new THREE.Fog(0x9fc7e8, 40, 95);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.assets = new Assets();
    this.input = new Input(this.canvas);
    this.input.onKey = (code) => this.onKey(code);
    this.sfx = new Sfx();
    this.hud = new Hud();
    this.fx = new Fx(this.scene);
    this.save = new Save();
    this.enemies = [];
    this.groups = [];
    this.state = 'loading';
    this.clock = new THREE.Clock();
    this.fps = { frames: 0, time: 0, value: 0 };
    document.getElementById('pauseBtn').onclick = () => this.pause();
    this.quizDrag = 0;
    document.getElementById('skillBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); this.useSkill(); });
    addEventListener('resize', () => this.resize());
    this.resize();
    this.setupLights();
  }

  setupLights() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();
    this.hemi = new THREE.HemisphereLight(0xdbeafe, 0x3f6b35, 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4d6, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    Object.assign(this.sun.shadow.camera, { left: -16, right: 16, top: 22, bottom: -22, near: 1, far: 70 });
    this.scene.add(this.sun, this.sun.target);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.fov = THREE.MathUtils.clamp(50 * (1.6 / Math.max(1, this.camera.aspect)), 50, 72); // 直的螢幕看寬一點
    this.camera.updateProjectionMatrix();
  }

  async load() {
    await this.assets.init();
    this.settings = await loadJson('data/game.json');
    this.characters = await loadJson('data/characters.json');
    for (const [id, def] of Object.entries(this.characters)) def.id = id;
    this.classes = await loadJson('data/classes.json');
    this.abilities = this.settings.abilities;
    this.levels = Object.fromEntries(await Promise.all(this.settings.levels.map(async (id) => [id, await loadJson(`data/levels/${id}.json`)])));
    this.levelOrder = [...this.settings.levels];
    // 第一版不做商店：只用一開始就有的英雄（classes.json 沒有 locked 的）
    this.heroTypes = Object.keys(this.classes).filter((id) => !this.classes[id].locked && this.assets.catalog[this.characters[id]?.model]);
    this.order = Object.keys(this.settings.difficulties);
    let saved = null;
    try { saved = localStorage.getItem('hero-quiz-difficulty'); } catch { /* 無痕模式 */ }
    this.difficultyId = this.order.includes(saved) ? saved : this.settings.defaultDifficulty;
    this.heroId = this.settings.hero;

    const levels = Object.values(this.levels);
    const bosses = [...new Set(levels.flatMap((l) => l.boss ?? []))];
    const spawnIds = levels.flatMap((l) => [...(l.enemies ?? []), { spawns: l.bossEscort ?? [] }].flatMap((g) => g.spawns.map((s) => s.enemy)));
    const extra = bosses.flatMap((b) => [...this.characters[b].boss.skills.map((s) => s.enemy), ...(this.characters[b].boss.reinforce?.enemies ?? [])]).filter(Boolean);
    const enemyIds = [...new Set([...spawnIds, ...bosses, ...extra])];
    for (let i = 0; i < enemyIds.length; i++) { // 分裂出來的小怪（史萊姆）也要載入
      const def = this.characters[enemyIds[i]];
      if (!def) throw new Error(`data/characters.json 沒有「${enemyIds[i]}」`);
      if (def.split && !enemyIds.includes(def.split.into)) enemyIds.push(def.split.into);
    }
    // 敵人丟出來的東西（飛鏢、箭、火焰彈）
    const enemyShotModels = enemyIds.flatMap((id) => [this.characters[id].ability?.shot, ...(this.characters[id].boss?.skills ?? []).map((k) => k.shot)])
      .map((s) => s?.model).filter((m) => m && this.assets.catalog[m]);
    const shots = this.heroTypes.map((id) => this.characters[id].shot).filter(Boolean);
    const models = [...this.heroTypes, ...enemyIds].map((id) => this.characters[id].model)
      .concat(shots.map((s) => s.model).filter((m) => m && this.assets.catalog[m]), enemyShotModels, Obstacles.modelIds().filter((m) => this.assets.catalog[m]));
    await this.assets.preload(models, (done, total) => this.hud.showOverlay({ text: `載入模型 ${done} / ${total}…` }));

    this.projectiles = new Projectiles(this);
    this.enemyShots = new EnemyShots(this);
    this.setLevel(this.settings.levels[0]);
    this.crowd = new Crowd(this);
    this.quiz = new QuizWalls(this);
    this.obstacles = new Obstacles(this);
    this.crowd.reset(this.heroId);
    this.portraits = renderPortraits(this.assets, Object.fromEntries(this.heroTypes.map((id) => [id, this.characters[id].model])));
    this.projectiles.prepare(shots);
    this.showTitle();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- 存檔 ----------
  get difficulty() { return this.settings.difficulties[this.difficultyId]; }
  get starKey() { return `${this.levelId}:${this.difficultyId}`; }
  // 加夥伴時會出現的職業
  get partnerTypes() { return this.heroTypes; }
  get maxCount() { return this.settings.maxCount; }

  isLevelUnlocked(id) {
    const i = this.levelOrder.indexOf(id);
    if (i <= 0) return true;
    const prev = this.levelOrder[i - 1];
    return this.order.some((d) => this.save.stars(`${prev}:${d}`) > 0);
  }

  setLevel(id) {
    if (id === this.levelId) return;
    this.track?.dispose();
    this.levelId = id;
    this.level = this.levels[id];
    this.track = new Track(this, this.level);
    const t = this.level.theme;
    this.scene.background.set(t.background);
    this.scene.fog.color.set(t.fog);
    this.scene.fog.near = t.fogNear;
    this.scene.fog.far = t.fogFar;
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.hemi.intensity = t.hemiIntensity;
    this.sun.color.set(t.sun);
    this.sun.intensity = t.sunIntensity;
  }

  // ---------- 畫面流程 ----------
  clearField() {
    for (const e of this.enemies) e.destroy();
    this.enemies = [];
    this.groups = [];
    this.projectiles.clear();
    this.enemyShots.clear();
    this.quiz?.clear();
    this.hud.hideQuiz();
    this.obstacles?.clear();
    this.hud.hideBoss();
    this.hud.clearBanner();
    this.hud.setSkill(null);
    clearTimeout(this.endTimer);
  }

  showTitle() {
    this.state = 'title';
    this.clearField();
    this.crowd.reset(this.heroId);
    this.hud.showHud(false);
    this.hud.showOverlay({
      title: this.settings.title,
      text: '勇者自動往前衝！遇到題目牆會停下來，算出答案、選對的那一個。\n答對：夥伴照獎勵變多（+ 或 ×）；答錯或時間到：獎勵反過來（+ 變 −、× 變 ÷）。\n帶最多夥伴打倒終點的 Boss！',
      buttons: [{ label: '開始遊戲', onClick: () => this.showSelect() }],
      html: '<div class="controls">作答：<kbd>←</kbd><kbd>→</kbd> 或 <kbd>A</kbd><kbd>D</kbd> 換答案、<kbd>Enter</kbd> 或 <kbd>空白鍵</kbd> 確定（也可以直接點答案、按數字鍵 <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>）<br>跑步時：左右移動（滑鼠、手指拖曳也可以）、<kbd>空白鍵</kbd> 英雄技能、<kbd>P</kbd> 暫停</div>',
    });
    this.hud.keys = (code) => (code === 'Enter' || code === 'Space' ? (this.showSelect(), true) : false);
  }

  showSelect() {
    this.sfx.unlock();
    this.state = 'select';
    if (!this.heroTypes.includes(this.heroId)) this.heroId = this.heroTypes[0];
    this.crowd.reset(this.heroId);
    this.hud.showSelect({
      levels: this.levelOrder.map((id) => ({
        id, name: this.levels[id].name, desc: this.levels[id].desc ?? '', locked: !this.isLevelUnlocked(id),
        max: this.order.length * 3, stars: this.order.reduce((sum, d) => sum + this.save.stars(`${id}:${d}`), 0),
      })),
      level: this.levelId,
      heroes: this.heroTypes.map((id) => ({ id, portrait: this.portraits[id], desc: this.classes[id].desc, skill: this.classes[id].skill?.name ?? '無', locked: false })),
      hero: this.heroId,
      difficulties: this.order.map((id) => ({ id, ...this.settings.difficulties[id], stars: this.save.stars(`${this.levelId}:${id}`) })),
      difficulty: this.difficultyId,
      onLevel: (id) => {
        if (!this.isLevelUnlocked(id)) { this.sfx.hurt(); return; }
        this.setLevel(id);
        this.sfx.pickup();
        this.showSelect();
      },
      onHero: (id) => { this.heroId = id; this.crowd.reset(id); this.sfx.pickup(); },
      onDifficulty: (id) => { this.difficultyId = id; try { localStorage.setItem('hero-quiz-difficulty', id); } catch { /* 無痕模式 */ } this.sfx.pickup(); this.showSelect(); },
      onStart: () => this.startRun(),
      onBack: () => this.showTitle(),
    });
  }

  startRun() {
    this.sfx.unlock();
    this.clearField();
    this.input.clear();
    this.hud.keys = null;
    const { crowd } = this;
    crowd.reset(this.heroId);
    const start = this.settings.startCrowd ?? 0; // 一開始就帶幾位夥伴（輪流用四種職業）
    if (start) { for (let i = 0; i < start; i++) crowd.add(this.partnerTypes[i % this.partnerTypes.length], 1); crowd.refreshBadge(); }
    this.ramp = 1;
    this.time = 0;
    this.quiz.load(this.level.walls);
    this.obstacles.load(this.level.obstacles ?? []);
    this.groups = this.level.enemies.map((g) => ({ ...g, spawned: false }));
    this.bossSpawned = false;
    this.boss = null;
    this.bossesBeaten = 0;
    this.gold = 0;
    this.kills = 0;
    this.skillCd = 0;
    this.multiplier = 1;
    this.state = 'playing';
    this.hud.hideOverlay();
    this.hud.showHud(true);
    this.hud.banner(`${this.level.name}・出發！`, 1.6);
  }

  pause() {
    if (this.state === 'playing' || this.state === 'quiz') {
      this.pausedFrom = this.state;
      this.state = 'paused';
      this.hud.showOverlay({ title: '暫停', text: '休息一下。', buttons: [{ label: '繼續', onClick: () => this.pause() }, { label: '重新開始', onClick: () => this.startRun() }, { label: '回標題', onClick: () => this.showTitle() }] });
    } else if (this.state === 'paused') {
      this.state = this.pausedFrom ?? 'playing';
      this.hud.hideOverlay();
    }
  }

  onKey(code) {
    if (this.state === 'title' || this.state === 'select') return this.hud.keys?.(code) ?? false;
    if (code === 'KeyP' || code === 'Escape') { if (this.state === 'playing' || this.state === 'quiz' || this.state === 'paused') { this.pause(); return true; } }
    if (this.state === 'quiz') { // 作答：左右換答案、Enter／空白鍵確定、數字鍵直接選
      const q = this.quiz;
      if (!q.current) return true;
      if (code === 'ArrowLeft' || code === 'KeyA') { q.move(-1); return true; }
      if (code === 'ArrowRight' || code === 'KeyD') { q.move(1); return true; }
      if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') { q.answer(q.current.lane); return true; }
      const digit = /^(?:Digit|Numpad)([1-3])$/.exec(code);
      if (digit) { q.select(digit[1] - 1); q.answer(digit[1] - 1); return true; }
      return true;
    }
    if ((code === 'Space' || code === 'KeyK') && this.state === 'playing') { this.useSkill(); return true; }
    return false;
  }

  // ---------- 英雄技能（空白鍵／右下按鈕） ----------
  get skill() { return this.classes[this.heroId]?.skill ?? null; }

  useSkill() {
    const s = this.skill;
    if (!s || this.state !== 'playing' || this.skillCd > 0) return;
    const { crowd, fx } = this;
    const c = crowd.center;
    this.skillCd = s.cooldown;
    const ahead = (range) => this.enemies.filter((e) => e.alive && Math.hypot(e.position.x - c.x, e.position.z - c.z) <= range);
    if (s.type === 'shield') crowd.shield = s.seconds;
    if (s.type === 'frenzy') { crowd.frenzy = s.seconds; crowd.frenzyRate = s.rate; }
    if (s.type === 'volley') {
      for (const e of ahead(s.range)) { this.damageEnemy(e, s.damage); fx.burst(e.position.x, 2, e.position.z, 6, s.color, 3); }
    }
    if (s.type === 'meteor') { // 砸在怪最多的地方
      const list = ahead(18);
      let best = null, bestN = 0;
      for (const e of list) {
        const n = list.filter((o) => Math.hypot(o.position.x - e.position.x, o.position.z - e.position.z) <= s.radius).length + (e.def.boss ? 3 : 0);
        if (n > bestN) { best = e; bestN = n; }
      }
      if (best) {
        const { x, z } = best.position;
        this.blast({ x, z }, s.radius, s.damage, s.burn);
        fx.blastRing(x, z, s.radius, s.color);
        fx.burst(x, 3, z, 60, s.color, 7);
        fx.shake(0.6);
        this.sfx.blast();
      }
    }
    if (s.type === 'smoke') {
      crowd.trapImmune = s.seconds;
      for (const e of ahead(16)) e.stun = Math.max(e.stun, s.stun);
      fx.burst(c.x, 1, c.z, 60, s.color, 3);
    }
    if (s.type === 'quake') {
      for (const e of ahead(s.range)) { e.stun = Math.max(e.stun, s.stun); this.damageEnemy(e, s.damage); }
      fx.blastRing(c.x, c.z, s.range, s.color);
      fx.shake(0.7);
      this.sfx.blast();
    }
    this.hud.banner(s.name, 1, s.color);
    this.hud.flashScreen(s.color);
    this.sfx.wave();
  }

  // ---------- 戰鬥 ----------
  spawnEnemy(id, x, d, summoned = false) {
    const def = this.characters[id];
    const Cls = def.boss ? Boss : Enemy;
    const e = new Cls(this, def, this.assets.instantiate(def.model), x, d);
    e.summoned = summoned;
    if (summoned) e.state = 'chase';
    this.enemies.push(e);
    return e;
  }

  // 怪物小隊排在路上：每排 4 隻；隻數乘上難度的 enemyCountMult
  spawnGroup(g, chase = false) {
    g.spawned = true;
    let i = 0;
    for (const s of g.spawns) {
      const n = Math.round(s.count * (this.difficulty.enemyCountMult ?? 1));
      for (let k = 0; k < n; k++, i++) {
        const row = Math.floor(i / 4), col = i % 4;
        this.spawnEnemy(s.enemy, -3 + col * 2 + (row % 2) * 0.6, g.d + row * 1.6, chase);
      }
    }
  }

  // melee：近戰找不到空中的飛龍
  nearestEnemy(pos, range, melee = false) {
    let best = null, bestD = range;
    for (const e of this.enemies) {
      if (!e.canBeHit || (melee && e.airborne)) continue;
      const d = Math.hypot(e.position.x - pos.x, e.position.z - pos.z);
      if (d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  nearestEnemies(pos, n, range, melee = false) {
    return this.enemies.filter((e) => e.canBeHit && !(melee && e.airborne) && Math.hypot(e.position.x - pos.x, e.position.z - pos.z) <= range)
      .sort((a, b) => Math.hypot(a.position.x - pos.x, a.position.z - pos.z) - Math.hypot(b.position.x - pos.x, b.position.z - pos.z)).slice(0, n);
  }

  blast(pos, radius, damage, burn) {
    for (const e of this.enemies) {
      if (!e.alive || Math.hypot(e.position.x - pos.x, e.position.z - pos.z) > radius + e.radius) continue;
      if (this.damageEnemy(e, damage) && burn) e.ignite(burn);
    }
  }

  // mode：true＝燃燒（橘色閃光）；projectiles 傳 'plain'／'magic' 字串
  damageEnemy(e, amount, mode) {
    if (!e.takeHit(amount, mode === true)) return false;
    if (mode !== true) this.fx.sparks(e.position.x, 1, e.position.z);
    if (!e.alive) {
      this.kills += 1;
      this.fx.bones(e.position.x, 1, e.position.z);
      this.sfx.bones();
      if (e.def.gold && this.state === 'playing') this.addGold(e.def.gold, e.position);
      if (e.def.split && this.state === 'playing') this.splitEnemy(e);
      if (e.def.boss) this.onBossDefeated(e);
    }
    return true;
  }

  // 現在危險的地方（給測試機器人閃躲）：直線 { x, w }（整條路）、圓 { x, z, r }
  enemyDangers() {
    const out = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const a = e.ability;
      if (e.state === 'aim' && a?.type === 'shoot') out.push(...e.aimXs.map((x) => ({ x, w: (a.shot.width ?? 0.4) + 0.6 })));
      if (e.state === 'aim' && a?.type === 'charge') out.push({ x: e.position.x, w: a.width / 2 + 0.4 });
      if ((e.state === 'swoopAim' || e.state === 'dive') && e.diveTarget) out.push({ x: e.diveTarget.x, z: e.diveTarget.z, r: e.def.fly.swoop.radius });
      if (e.lanes && e.aimXs) out.push(...e.aimXs.map((x) => ({ x, w: (e.skill.shot.width ?? 0.4) + 0.6 })));
      if (e.warn) out.push({ x: e.warn.position.x, z: e.warn.position.z, r: e.skill.radius });
    }
    for (const s of this.enemyShots.lanes) out.push({ x: s.x, w: (s.spec.width ?? 0.4) + 0.6 });
    for (const l of this.enemyShots.lobs) out.push({ x: l.target.x, z: l.target.z, r: l.spec.radius });
    for (const q of this.enemyShots.pools) out.push({ x: q.x, z: q.z, r: q.def.radius });
    return out;
  }

  // 史萊姆：倒下的地方彈出幾隻小的，直接衝向隊伍
  splitEnemy(e) {
    const { into, count, color } = e.def.split;
    for (let i = 0; i < count; i++) this.spawnEnemy(into, e.position.x + (i - (count - 1) / 2) * 1.1, -e.position.z, true);
    this.fx.burst(e.position.x, 0.6, e.position.z, 20, color ?? '#5ec8ff', 4);
  }

  hurtCrowd(amount) {
    if (this.state !== 'playing') return;
    const before = this.crowd.count, hp = this.crowd.heroHp;
    this.crowd.takeDamage(amount);
    if (this.crowd.count < before || this.crowd.heroHp < hp) this.sfx.hurt();
    if (!this.crowd.alive) this.endRun(false);
  }

  onBossDefeated(boss) {
    this.hud.hideBoss();
    this.hud.banner(`擊敗${boss.def.boss.name}！`, 2);
    this.fx.shake(0.6);
    this.bossesBeaten += 1;
    for (const e of this.enemies) if (e.alive && e !== boss && e.summoned) this.damageEnemy(e, e.hp);
    for (const e of this.enemies) if (e.alive && e !== boss) this.damageEnemy(e, e.hp);
    this.endRun(true);
  }

  // ---------- 題目牆 ----------
  // 跑到牆前、出題了
  onQuizStart(w) {
    this.state = 'quiz';
    this.quizDrag = 0;
    this.input.takeDrag();
    this.hud.showQuiz({ question: w.q.text, reward: rewardText(w.reward), choices: w.q.choices, lane: w.lane, seconds: w.total, onPick: (i) => { this.quiz.select(i); this.quiz.answer(i); } });
    this.sfx.wave();
  }

  onQuizSelect(w) { this.hud.selectQuiz(w.lane); this.sfx.coin(); }

  // 答完：照獎勵（或反過來的獎勵）改人數，牆碎掉，過一下再繼續跑
  onQuizAnswer(w, rec) {
    const { crowd } = this;
    const { before, after } = rec;
    if (after > before && rec.applied.op === '+') {
      for (let i = 0; i < after - before; i++) crowd.add(this.partnerTypes[Math.floor(Math.random() * this.partnerTypes.length)], 1);
    } else if (after !== before) crowd.setCount(after); // 乘、除照現在的組成比例
    crowd.refreshBadge();
    const math = `${rec.q} = ${rec.answer}`;
    const change = `夥伴 ${rewardText(rec.applied)}：${before} → ${after}`;
    if (rec.right) {
      this.hud.gateFeedback(`答對了！${math}<small>${change}</small>`, 'right');
      this.sfx.win();
      this.fx.burst(crowd.x, 1.5, -crowd.d, 40, '#60a5fa', 5);
    } else {
      this.hud.gateFeedback(`${rec.value === null ? '時間到！' : '答錯了！'}正確答案 ${math}<small>${change}</small>`, 'wrong');
      this.sfx.lose();
    }
    this.hud.answerQuiz(w.chosen, w.q.choices.indexOf(rec.answer));
    if (rec.value === null) this.hud.quizTimer(0, 0);
    this.hud.flashScreen(rec.right ? '#3b82f6' : '#ef4444');
    this.fx.shake(0.35);
    this.sfx.blast();
    this.fx.after(1.2, () => {
      this.hud.hideQuiz();
      if (this.state === 'quiz') this.state = 'playing';
      else if (this.state === 'paused') this.pausedFrom = 'playing';
    });
  }

  // 陷阱碰到某一個人：夥伴直接倒下，並連帶扣掉沒畫出來的人（每個畫出來的人代表 人數 ÷ 畫出來的人數）；
  // 英雄扣 1 血（1 秒無敵）。有護盾、煙遁都不扣。傷害數字合併成一次顯示
  trapMember(m, def) {
    if (this.state !== 'playing') return;
    const { crowd } = this;
    if (crowd.shield > 0 || crowd.trapImmune > 0) { this.hud.gateFeedback('陷阱傷不到！', 'even'); return; }
    let lost = 0;
    if (m.hero) {
      if (crowd.heroGrace > 0) return;
      const dead = crowd.hurtHero(def.heroDamage ?? 1, 1);
      this.hud.gateFeedback(dead ? '英雄倒下了！' : `英雄受傷！剩 ${crowd.heroHp} / ${crowd.heroMax}`, 'wrong');
      this.sfx.hurt();
      this.hud.flashScreen('#ef4444');
      if (dead || !crowd.alive) this.endRun(false);
      return;
    }
    const drawn = crowd.members.filter((x) => x.actor).length || 1;
    const extra = Math.max(0, Math.round((crowd.count - drawn) / drawn));
    crowd.removeMember(m);
    lost = 1;
    if (extra) { const before = crowd.count; crowd.remove(Math.min(extra, crowd.count - 1), false); lost += before - crowd.count; }
    this.trapLost = (this.trapLost ?? 0) + lost;
    clearTimeout(this.trapTimer);
    const label = def.label ?? '撞到陷阱';
    this.trapTimer = setTimeout(() => { if (this.trapLost) this.hud.gateFeedback(`${label} −${this.trapLost}`, 'wrong'); this.trapLost = 0; }, 120);
    this.fx.burst(m.actor?.position.x ?? crowd.x, 1, m.actor?.position.z ?? -crowd.d, 8, '#ef4444', 3);
    this.sfx.hurt();
    this.fx.shake(0.15);
  }

  // 金幣
  addGold(amount, pos, big = false) {
    const n = Math.max(1, Math.round(amount));
    this.gold += n;
    this.fx.floatText(pos.x, (pos.y ?? 0) + 1.4, pos.z, `+${n}`, GOLD);
    if (big) this.fx.burst(pos.x, (pos.y ?? 0) + 1, pos.z, 26, GOLD, 4);
    this.sfx.coin();
  }

  // 藥水：紅＝加夥伴、黃＝護盾、紫＝炸掉前面的怪（Boss 扣一部分）
  usePotion(item, pos) {
    const p = this.settings.potions[item];
    if (!p) return;
    const { crowd } = this;
    if (p.effect === 'partners') {
      crowd.add(this.partnerTypes[Math.floor(Math.random() * this.partnerTypes.length)], Math.max(0, Math.min(p.amount, this.maxCount - crowd.count)));
      crowd.refreshBadge();
    }
    if (p.effect === 'shield') crowd.shield = p.seconds;
    if (p.effect === 'blast') {
      for (const e of this.enemies) {
        if (!e.alive || -e.position.z - crowd.d > p.range) continue;
        this.damageEnemy(e, e.def.boss ? Math.round(e.maxHp * p.bossRatio) : e.hp, 'plain');
      }
      this.fx.shake(0.6);
      this.sfx.blast();
    }
    this.hud.gateFeedback(p.text, 'right');
    this.hud.flashScreen(p.color);
    this.fx.burst(pos.x, 1, pos.z, 30, p.color, 4);
    this.sfx.pickup();
  }

  endRun(won) {
    if (this.state !== 'playing' && this.state !== 'quiz') return;
    this.state = 'ending';
    this.lastWon = won; // 測試用：英雄倒下時夥伴可能還在，不能用人數判斷輸贏
    this.hud.hideQuiz();
    const { save } = this;
    const history = this.quiz.history;
    const correct = history.filter((h) => h.right).length;
    const ratio = history.length ? correct / history.length : 1;
    if (won) this.sfx.win(); else this.sfx.lose();
    const { three, two } = this.level.stars;
    const stars = won ? (ratio >= three ? 3 : ratio >= two ? 2 : 1) : 0;
    const best = won && save.recordStars(this.starKey, stars);
    const title = won ? '打倒 Boss 了！' : '隊伍全滅了…';
    const text = `${won ? `剩下 ${this.crowd.count} 位夥伴，` : ''}答對 ${correct} / ${history.length} 題，打倒 ${this.kills} 隻怪物，金幣 ${this.gold}。${best ? `\n${this.difficultyId}新紀錄！` : ''}`;
    const review = history.map((h, i) => {
      const ans = h.value === null ? '沒有作答（時間到）' : `選 ${h.value}`;
      return `<div class="${h.right ? 'right' : 'wrong'}">第 ${i + 1} 題　${h.q} = ${h.answer}　${ans}<br><small>夥伴 ${rewardText(h.applied)}：${h.before} → ${h.after}</small></div>`;
    }).join('');
    const buttons = [
      { label: '再玩一次', onClick: () => this.startRun() },
      { label: '換英雄／難度', onClick: () => this.showSelect(), style: 'second' },
    ];
    this.endScreen = () => {
      this.hud.showHud(false);
      this.hud.setSkill(null);
      const body = this.hud.showOverlay({ cls: 'result', title, text, buttons });
      body.innerHTML = `${stars ? `<div class="stars">${[1, 2, 3].map((n) => `<span class="${n <= stars ? '' : 'off'}">⭐</span>`).join('')}</div>` : ''}<div class="review">${review}</div>`;
    };
    this.endTimer = setTimeout(() => this.endScreen(), 1600);
  }

  // ---------- 每一格 ----------
  step(dt) {
    const { crowd } = this;
    if (this.state === 'playing') {
      const length = this.level.length;
      const blocked = this.enemies.some((e) => e.blocking && e.distanceTo(crowd) < BLOCK_GAP); // 空中的飛龍、消失的黑貓不擋路
      const moving = !blocked && crowd.d < length;
      if (moving) crowd.d = Math.min(length, crowd.d + this.settings.runSpeed * dt);
      const half = crowd.edge; // 英雄永遠可以走到路邊；後面的夥伴會被石牆擠住，不會限制英雄
      crowd.x += this.input.steer * this.settings.strafeSpeed * dt + (this.input.takeDrag() / innerWidth) * this.track.halfWidth * 2 * DRAG_SCALE;
      crowd.x = THREE.MathUtils.clamp(crowd.x, -half, half);
      this.time += dt;
      this.skillCd = Math.max(0, this.skillCd - dt);
      this.quiz.update(dt);
      if (this.state !== 'playing') return; // 剛跑到題目牆
      this.obstacles.update(dt);
      for (const g of this.groups) if (!g.spawned && g.d - crowd.d < ENEMY_AHEAD) this.spawnGroup(g);
      if (!this.bossSpawned && length - crowd.d < BOSS_AHEAD) {
        this.bossSpawned = true;
        const pool = this.level.boss;
        this.boss = this.spawnEnemy(pool[Math.floor(Math.random() * pool.length)], 0, length + 12);
        if (this.level.bossEscort) this.spawnGroup({ d: length + 4, spawns: this.level.bossEscort }); // Boss 帶著一隊小兵
        this.hud.banner('Boss 出現了！', 1.6, '#ff5a3c');
      }
      crowd.update(dt, moving);
      crowd.combat(dt);
    } else if (this.state === 'quiz') {
      // 作答中：怪物、子彈都停住；英雄走到選的答案前面。拖曳一段距離換一個答案
      const w = this.quiz.current;
      if (w) {
        this.quizDrag += this.input.takeDrag();
        if (Math.abs(this.quizDrag) > LANE_DRAG) { this.quiz.move(Math.sign(this.quizDrag)); this.quizDrag = 0; }
        crowd.x += (this.quiz.laneX(w.lane) - crowd.x) * Math.min(1, dt * 8);
        this.hud.quizTimer(Math.max(0, w.time) / w.total, Math.ceil(Math.max(0, w.time)));
        const sec = Math.ceil(w.time);
        if (sec !== this.lastTick && sec <= 3 && sec > 0) this.sfx.tick();
        this.lastTick = sec;
      } else this.input.takeDrag();
      this.quiz.update(dt);
      crowd.update(dt, false);
      this.track.update(dt, this.clock.elapsedTime, crowd.d);
      return;
    } else {
      crowd.update(dt, false);
    }
    if (this.state === 'playing' || this.state === 'ending') {
      for (const e of this.enemies) e.update(dt, crowd);
      this.separate();
      this.projectiles.update(dt);
      this.enemyShots.update(dt);
      for (const e of this.enemies) if (e.removed) e.destroy();
      this.enemies = this.enemies.filter((e) => !e.removed);
      for (const e of this.enemies) e.updateVisual(dt);
    }
    this.track.update(dt, this.clock.elapsedTime, crowd.d);
  }

  separate() {
    const list = this.enemies.filter((e) => e.alive);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i].position, b = list[j].position;
      const min = list[i].radius + list[j].radius;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz) || 0.01;
      if (d >= min) continue;
      const push = ((min - d) / d) * 0.5;
      if (!list[i].def.boss) { a.x -= dx * push; a.z -= dz * push; }
      if (!list[j].def.boss) { b.x += dx * push; b.z += dz * push; }
    }
  }

  updateHud() {
    const comp = {};
    for (const m of this.crowd.members) comp[m.type] = (comp[m.type] ?? 0) + 1;
    this.hud.setStatus({
      count: this.crowd.count, gold: this.gold, difficulty: this.difficultyId, color: this.difficulty.color,
      progress: this.crowd.d / this.level.length,
      comp: Object.entries(comp).map(([t, n]) => `<span>${ICONS[t] ?? ''}${n}</span>`).join(''),
    });
    const s = this.skill;
    this.hud.setSkill(s && this.state === 'playing' ? { name: s.name, color: s.color, cooldown: this.skillCd } : null);
  }

  updateCamera(dt) {
    const { crowd } = this;
    if (this.state === 'title' || this.state === 'select') { // 選單時從正面看英雄
      const t = this.clock.elapsedTime * 0.3;
      const x = crowd.x, z = -crowd.d;
      this.camera.position.set(x + Math.sin(t) * 1.2, 1.8, z - 5.5);
      this.camera.lookAt(x, this.state === 'title' ? -0.4 : -1.4, z); // 看低一點，英雄才會在面板上方
      return;
    }
    const pull = Math.min(4, crowd.radius); // 人越多鏡頭越遠
    // 作答時鏡頭拉高、往後看一點：題目板和英雄都在畫面上半部，下面留給作答面板
    const q = this.state === 'quiz' ? 1 : 0;
    this.camQuiz = (this.camQuiz ?? 0) + (q - (this.camQuiz ?? 0)) * Math.min(1, dt * 3);
    const k = this.camQuiz;
    const want = new THREE.Vector3(crowd.x * 0.4 * (1 - k), crowd.y + 9.5 + pull * 1.2 + k * 2.5, -crowd.d + 9.5 + pull + k * 2.5);
    if (!this.camTarget) this.camTarget = want.clone();
    this.camTarget.lerp(want, Math.min(1, dt * 4));
    this.camera.position.copy(this.camTarget).add(this.fx.offset);
    this.camera.lookAt(crowd.x * 0.4 * (1 - k), crowd.y + 0.5 + k * 0.5, -crowd.d - 4.5 + k * 7);
    this.sun.position.set(crowd.x + 8, 24, -crowd.d + 6);
    this.sun.target.position.set(crowd.x, 0, -crowd.d - 6);
  }

  frame() {
    const raw = Math.min(this.clock.getDelta(), 0.05);
    this.fx.update(raw);
    if (this.state !== 'paused') {
      let dt = raw;
      while (dt > 0) { const d = Math.min(STEP, dt); this.step(d); dt -= d; }
    }
    if (this.state === 'playing' || this.state === 'quiz') this.updateHud();
    this.updateCamera(raw);
    this.renderer.render(this.scene, this.camera);
    this.fps.frames += 1;
    this.fps.time += raw;
    if (this.fps.time >= 1) { this.fps.value = this.fps.frames / this.fps.time; this.fps.frames = 0; this.fps.time = 0; }
  }

  // 測試用：不畫面、直接快轉
  simulate(seconds, dt = 1 / 30) {
    for (let t = 0; t < seconds && (this.state === 'playing' || this.state === 'ending' || this.state === 'quiz'); t += dt) {
      this.fx.update(dt);
      this.step(dt);
    }
    this.camTarget = null; // 快轉後鏡頭直接到位
  }
}

const game = new Game();
window.__game = game;
game.load().catch((err) => {
  console.error(err);
  game.hud.showOverlay({ title: '載入失敗', text: err.message });
});
