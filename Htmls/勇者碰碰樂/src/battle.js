// 一場戰鬥：我方最多 5 位輪流彈射 → 碰到隊友發動協力技 → 敵人倒數到 0 就攻擊 → 打完一波換下一波，最後一波是 Boss。
import * as THREE from 'three';
import { makeActor, makeProp, loadGltf } from './models.js';
import { stepBall, simulate, prepareBall, MAX_SPEED } from './physics.js';
import { makeObstacle, animateObstacle, PORTAL_COLORS } from './scenery.js';

const HERO_R = 0.6;
const HERO_H = 2.2;
const ENEMY_SCALE = 1.3; // 從斜上方看，模型放大一點才看得清楚（碰撞半徑不變）
const HEART_CHANCE = 0.22; // 打倒敵人掉紅藥水的機率
const HEART_HEAL = 0.3;

export { HERO_H, ENEMY_SCALE };

export class Battle {
  constructor(game, stage, team) {
    this.game = game;
    this.stage = stage;
    this.teamIds = team;
    this.board = game.data.stages.board;
    this.heroes = [];
    this.enemies = [];
    this.items = [];
    this.obstacles = [];
    this.wave = 0;
    this.turn = 0;
    this.turnIndex = 0;
    this.coins = 0;
    this.downs = 0;
    this.state = 'loading';
    this.timers = [];
    this.ball = null;
    this.log = { hits: 0, assists: 0, specials: 0, enemyAttacks: {}, obstacles: {} };
  }

  get fx() { return this.game.fx; }
  get sfx() { return this.game.sfx; }
  wait(sec) { return new Promise((resolve) => this.timers.push({ t: sec, resolve })); }

  async load() {
    const g = this.game;
    const heroDefs = this.teamIds.map((id) => g.heroDef(id));
    const enemyNames = new Set(this.stage.waves.flat().map((e) => e[0]));
    for (const n of [...enemyNames]) for (const a of g.data.enemies.list[n].attacks ?? []) if (a.minion) enemyNames.add(a.minion);
    await Promise.all([...heroDefs.map((d) => d.model), ...[...enemyNames].map((n) => g.data.enemies.list[n].model)].map((m) => loadGltf(m))); // 先下載這關會用到的模型
    this.heartPrefab = await makeProp('紅藥水', 0.9);
    this.buildObstacles();
    // 我方排在下面一排
    const n = heroDefs.length, gap = Math.min(2.4, (this.board.w - 2) / n);
    for (let i = 0; i < n; i++) {
      const def = heroDefs[i];
      const actor = await makeActor(def.model, HERO_H);
      const lv = g.save.level(def.id) || 1;
      const mult = 1 + (lv - 1) * g.data.heroes.levelBonus;
      const h = {
        kind: 'hero', def, level: lv, actor, alive: true, r: HERO_R,
        x: (i - (n - 1) / 2) * gap, z: this.board.d / 2 - 2.2,
        maxHp: Math.round(def.hp * mult), atk: Math.round(def.atk * mult), chargeLeft: def.special ? def.charge : 0,
      };
      h.hp = h.maxHp;
      actor.root.position.set(h.x, 0, h.z);
      actor.root.rotation.y = Math.PI;
      actor.play('Idle');
      g.scene.add(actor.root);
      h.ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 36).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.85, depthWrite: false }));
      h.ring.position.y = 0.05;
      actor.root.add(h.ring);
      h.el = g.ui.unitLabel(h);
      this.heroes.push(h);
    }
    await this.spawnWave(0, false);
    this.state = 'ready';
  }

  // 場地上的機關（stages.json 的 obstacles）。傳送點用 pair 配對：同一個 pair 的兩個互通
  buildObstacles() {
    const theme = this.stage.theme ?? this.stage.id;
    this.obstacles = (this.stage.obstacles ?? []).map((o) => ({ ...o }));
    const pairs = new Map();
    for (const o of this.obstacles) {
      if (o.type === 'portal') { const list = pairs.get(o.pair ?? 0) ?? []; list.push(o); pairs.set(o.pair ?? 0, list); }
    }
    for (const [, list] of pairs) if (list.length === 2) { list[0].to = list[1]; list[1].to = list[0]; }
    for (const o of this.obstacles) {
      o.mesh = makeObstacle(o, theme);
      this.game.scene.add(o.mesh);
    }
  }

  async spawnWave(i, drop = true) {
    this.wave = i;
    const list = this.stage.waves[i];
    await Promise.all(list.map(([name, x, z]) => this.spawnEnemy(name, x, z, drop)));
    this.game.ui.updateHud();
  }

  async spawnEnemy(name, x, z, drop = true) {
    const def = this.game.data.enemies.list[name];
    const actor = await makeActor(def.model, def.height * ENEMY_SCALE);
    if (def.tint) { const t = new THREE.Color(def.tint); for (const m of actor.materials) m.color?.multiply(t); } // 同一個模型做成不同的敵人（冰龍、黑暗騎士）
    const e = {
      kind: 'enemy', name, def, actor, alive: true, r: def.radius, x, z,
      maxHp: Math.round(def.hp * (this.stage.hpScale ?? 1)), every: def.every, cd: def.every + (this.enemies.length % 2), next: 0, burn: null,
    };
    e.hp = e.maxHp; // 關卡可以調整敵人血量（stages.json 的 hpScale）
    if (def.boss) e.cd = def.every;
    actor.root.position.set(x, drop ? 8 : 0, z);
    actor.root.rotation.y = Math.atan2(0 - x, 6 - z);
    actor.play(def.fly && actor.has('Fly') ? 'Fly' : 'Idle');
    this.game.scene.add(actor.root);
    e.el = this.game.ui.unitLabel(e);
    this.enemies.push(e);
    if (drop) {
      const y0 = 8;
      this.fx.add(null, 0.45, (f, k) => { actor.root.position.y = y0 * (1 - k * k); if (k >= 1) { this.fx.ring(x, z, e.r * 2, 0xffffff, 0.35); } });
    }
    return e;
  }

  aliveHeroes() { return this.heroes.filter((h) => h.alive); }
  aliveEnemies() { return this.enemies.filter((e) => e.alive); }
  current() {
    const alive = this.aliveHeroes();
    if (!alive.length) return null;
    for (let k = 0; k < this.heroes.length; k++) {
      const h = this.heroes[(this.turnIndex + k) % this.heroes.length];
      if (h.alive) { this.turnIndex = this.heroes.indexOf(h); return h; }
    }
    return null;
  }

  // ===== 主流程 =====
  async run() {
    this.game.ui.banner(this.stage.name, 1.4);
    await this.wait(1.2);
    while (true) {
      const h = this.current();
      if (!h) return this.finish(false);
      this.state = 'aim';
      this.special = false;
      this.game.ui.updateHud();
      const shot = await new Promise((resolve) => { this.onLaunch = resolve; });
      this.onLaunch = null;
      this.turn += 1;
      await this.launch(h, shot.dx, shot.dz, shot.power);
      for (const x of this.heroes) if (x.alive && x.def.special && x.chargeLeft > 0) x.chargeLeft -= 1;
      if (await this.checkWave()) return this.finish(true);
      this.state = 'enemy';
      this.game.ui.updateHud();
      await this.enemyPhase();
      if (await this.checkWave()) return this.finish(true);
      if (!this.aliveHeroes().length) return this.finish(false);
      this.turnIndex = (this.heroes.indexOf(h) + 1) % this.heroes.length;
    }
  }

  // 這一波打完了嗎？打完就換下一波；最後一波打完回傳 true（過關）
  async checkWave() {
    if (this.aliveEnemies().length) return false;
    await this.wait(0.8);
    if (this.wave + 1 >= this.stage.waves.length) return true;
    this.fx.clearFires();
    this.sfx.wave();
    const last = this.wave + 2 === this.stage.waves.length;
    this.game.ui.banner(last ? 'BOSS 出現！' : `第 ${this.wave + 2} 波`, 1.3, last ? 'boss' : '');
    await this.wait(0.6);
    for (const e of this.enemies) this.game.scene.remove(e.actor.root);
    this.enemies = [];
    await this.spawnWave(this.wave + 1);
    await this.wait(0.7);
    return false;
  }

  finish(win) {
    this.state = 'over';
    this.won = win;
    const stars = win ? 1 + (this.downs === 0 ? 1 : 0) + (this.turn <= this.stage.par ? 1 : 0) : 0;
    this.result = { win, stars, met: [win, win && this.downs === 0, win && this.turn <= this.stage.par], turns: this.turn, coins: this.coins, downs: this.downs, log: this.log };
    this.game.onBattleEnd(this.result);
  }

  // ===== 我方 =====
  // 瞄準時按必殺技
  async useSpecial() {
    const h = this.current();
    if (this.state !== 'aim' || !h || h.chargeLeft > 0 || !h.def.special || this.special) return;
    const sp = h.def.special;
    this.log.specials += 1;
    h.chargeLeft = h.def.charge;
    this.game.ui.banner(sp.name, 1.0, 'special');
    this.sfx.blast();
    if (sp.kind === 'power') {
      this.special = sp;
      h.actor.setGlow(0xffcc33, 0.6);
      this.game.ui.updateHud();
      return;
    }
    this.state = 'special';
    this.game.ui.updateHud();
    h.actor.play('Attack', { once: true });
    await this.doEffect(h, sp, true);
    if (await this.checkWave()) return this.finishFromSpecial();
    this.state = 'aim';
    this.game.ui.updateHud();
  }

  // 必殺技把最後一波打完：直接過關（流程停在等待彈射，要讓它結束）
  finishFromSpecial() {
    this.onLaunch = null;
    this.finish(true);
  }

  launch(h, dx, dz, power) {
    const len = Math.hypot(dx, dz) || 1;
    const sp = this.special;
    const speed = MAX_SPEED * Math.max(0.15, Math.min(1, power)) * (h.def.power ?? 1) * (sp?.speed ?? 1);
    this.ball = prepareBall({ hero: h, x: h.x, z: h.z, vx: (dx / len) * speed, vz: (dz / len) * speed, r: h.r, pierce: h.def.type === 'pierce', inside: new Set(), touched: new Set(), mult: sp?.mult ?? 1 }, this.obstacles);
    this.pending = [];
    this.state = 'moving';
    this.sfx.swing();
    h.actor.play('Run', { speed: 1.4 });
    this.game.ui.updateHud();
    return new Promise((resolve) => { this.onStop = resolve; });
  }

  world() {
    return { w: this.board.w, d: this.board.d, enemies: this.enemies, allies: this.heroes.filter((x) => x !== this.ball?.hero), items: this.items, obstacles: this.obstacles };
  }

  // 機器人用：試射某個角度會撞幾下
  predict(angle, power = 1) {
    const h = this.current();
    if (!h) return null;
    const speed = MAX_SPEED * power * (h.def.power ?? 1);
    const others = this.heroes.filter((x) => x !== h);
    return simulate({ x: h.x, z: h.z, vx: Math.sin(angle) * speed, vz: Math.cos(angle) * speed, r: h.r, pierce: h.def.type === 'pierce' },
      { w: this.board.w, d: this.board.d, enemies: this.enemies, allies: others, items: this.items, obstacles: this.obstacles });
  }

  updateBall(dt) {
    const b = this.ball, h = b.hero;
    const events = [];
    const moving = stepBall(b, dt, this.world(), events);
    for (const ev of events) {
      if (ev.type === 'hit') this.heroHits(h, ev.target, ev.x, ev.z, b.mult);
      else if (ev.type === 'wall') { this.fx.sparks(ev.x, ev.z, 0xffffff, 4, 0.5); this.game.shake(0.05); }
      else if (ev.type === 'ally') this.pending.push(this.assist(ev.target));
      else if (ev.type === 'item') this.pickup(h, ev.target);
      else this.onObstacle(h, ev);
    }
    h.x = b.x; h.z = b.z;
    h.actor.root.position.set(b.x, 0, b.z);
    if (Math.hypot(b.vx, b.vz) > 0.5) h.actor.root.rotation.y = Math.atan2(b.vx, b.vz);
    if (!moving) {
      this.ball = null;
      this.state = 'resolve';
      if (h.alive) h.actor.play('Idle'); // 被陷阱打倒的不要站起來
      if (this.special) { h.actor.setGlow(0x000000, 0); this.special = false; }
      Promise.all(this.pending).then(() => this.wait(0.25)).then(() => { const f = this.onStop; this.onStop = null; f?.(); });
    }
  }

  // 碰到機關
  onObstacle(h, ev) {
    const o = ev.target;
    this.log.obstacles[ev.type] = (this.log.obstacles[ev.type] ?? 0) + 1;
    switch (ev.type) {
      case 'pillar':
      case 'block':
        this.fx.sparks(ev.x, ev.z, 0xffffff, 5, 0.6);
        this.game.shake(0.06);
        this.sfx.hit();
        break;
      case 'bumper':
        o.pulseT = 0.25;
        this.fx.ring(o.x, o.z, o.r + 1.2, 0xffcf4a, 0.3);
        this.fx.sparks(ev.x, ev.z, 0xffd04a, 8, 0.6);
        this.sfx.pickup();
        this.game.shake(0.1);
        break;
      case 'trap':
        this.fx.ring(ev.x, ev.z, 1.2, o.look === 'poison' ? 0x8be04e : o.look === 'lava' ? 0xff5a1a : 0xff3030, 0.35);
        this.fx.number(h.x, HERO_H + 0.8, h.z, o.look === 'poison' ? '中毒！' : o.look === 'lava' ? '好燙！' : '被刺到！', 'hurt');
        this.damageHero(h, o.damage ?? 10);
        if (!h.alive && this.ball) { this.ball.vx = 0; this.ball.vz = 0; } // 倒下就停住
        break;
      case 'pad':
        this.fx.ring(o.x, o.z, o.r + 0.8, 0x5af0ff, 0.35);
        this.fx.number(h.x, HERO_H + 0.8, h.z, '加速！', 'skill');
        this.sfx.wave();
        break;
      case 'ice':
        this.fx.sparks(ev.x, ev.z, 0xdff6ff, 8, 0.3);
        this.fx.number(h.x, HERO_H + 0.8, h.z, '滑溜溜！', 'skill');
        break;
      case 'portal': {
        const c = new THREE.Color(PORTAL_COLORS[o.pair ?? 0]);
        this.fx.ring(o.x, o.z, o.r + 1, c, 0.4);
        this.fx.ring(o.to.x, o.to.z, o.r + 1.4, c, 0.5);
        this.sfx.tone(300, 900, 0.25, 'sine', 0.14);
        break;
      }
      default: break;
    }
  }

  heroHits(h, e, x, z, mult = 1) {
    if (!e.alive) return;
    this.log.hits += 1;
    const dmg = Math.round(h.atk * mult * (0.9 + Math.random() * 0.2));
    this.sfx.hit();
    this.fx.sparks(x, z, mult > 1 ? 0xffd040 : 0xffe9a0, 8);
    this.game.hitstop(0.035);
    this.damageEnemy(e, dmg, mult > 1 ? 'crit' : '');
  }

  damageEnemy(e, dmg, cls = '') {
    if (!e.alive) return;
    e.hp -= dmg;
    this.fx.number(e.x, e.def.height * ENEMY_SCALE + 0.3, e.z, dmg, cls);
    e.actor.flash(0xff5050);
    if (e.hp <= 0) return this.killEnemy(e);
    if (!e.def.boss && e.actor.has('Hit')) e.actor.play('Hit', { once: true, after: e.def.fly && e.actor.has('Fly') ? 'Fly' : 'Idle' });
    this.game.ui.updateLabel(e);
  }

  killEnemy(e) {
    e.alive = false;
    e.hp = 0;
    this.coins += e.def.coins ?? 4;
    this.sfx.bones();
    this.fx.ring(e.x, e.z, e.r * 2.2, 0xffd060, 0.4);
    this.fx.number(e.x, e.def.height * ENEMY_SCALE + 0.9, e.z, `+${e.def.coins ?? 4}`, 'coin');
    e.actor.play('Death', { hold: true });
    this.game.ui.removeLabel(e);
    const root = e.actor.root;
    this.fx.add(null, 1.3, (f, k) => { if (k > 0.6) root.position.y = -(k - 0.6) * 3; if (k >= 1) this.game.scene.remove(root); });
    if (!e.def.boss && Math.random() < HEART_CHANCE) this.dropHeart(e.x, e.z);
    if (e.def.boss) { this.game.shake(0.5); this.game.slowmo(0.8); }
  }

  dropHeart(x, z) {
    const mesh = this.heartPrefab.clone();
    mesh.position.set(x, 0, z);
    this.game.scene.add(mesh);
    this.items.push({ x, z, r: 0.5, mesh, taken: false });
  }

  pickup(h, it) {
    this.game.scene.remove(it.mesh);
    this.healHero(h, Math.round(h.maxHp * HEART_HEAL));
    this.sfx.pickup();
  }

  healHero(h, amount) {
    if (!h.alive) return;
    const before = h.hp;
    h.hp = Math.min(h.maxHp, h.hp + amount);
    if (h.hp > before) this.fx.number(h.x, HERO_H + 0.4, h.z, `+${h.hp - before}`, 'heal');
    this.fx.ring(h.x, h.z, 1.2, 0x6dff8a, 0.5);
    this.game.ui.updateLabel(h);
  }

  damageHero(h, dmg) {
    if (!h.alive) return;
    h.hp -= dmg;
    this.fx.number(h.x, HERO_H + 0.4, h.z, dmg, 'hurt');
    h.actor.flash(0xff2020, 0.25);
    this.sfx.hurt();
    if (h.hp <= 0) {
      h.hp = 0; h.alive = false; this.downs += 1;
      h.actor.play('Death', { hold: true });
      h.ring.visible = false;
      this.game.ui.banner(`${h.def.name} 倒下了`, 1.0, 'down');
    } else h.actor.play('Hit', { once: true });
    this.game.ui.updateLabel(h);
  }

  // 協力技（被碰到的隊友發動）
  async assist(a) {
    this.log.assists += 1;
    a.actor.play('Attack', { once: true });
    this.fx.number(a.x, HERO_H + 0.8, a.z, a.def.assist.name, 'skill');
    a.actor.flash(0xffffff, 0.2);
    await this.doEffect(a, a.def.assist, false);
  }

  // 從 (x, z) 往 (ux, uz) 走到牆要多遠（光束只畫到牆）
  toEdge(x, z, ux, uz) {
    const hw = this.board.w / 2, hd = this.board.d / 2;
    const tx = ux > 0 ? (hw - x) / ux : ux < 0 ? (-hw - x) / ux : Infinity;
    const tz = uz > 0 ? (hd - z) / uz : uz < 0 ? (-hd - z) / uz : Infinity;
    return Math.max(0.5, Math.min(tx, tz));
  }

  nearest(x, z, n = 1) {
    return this.aliveEnemies().map((e) => ({ e, d: (e.x - x) ** 2 + (e.z - z) ** 2 })).sort((p, q) => p.d - q.d).slice(0, n).map((p) => p.e);
  }

  // 協力技、必殺技的效果（src 發動的人）
  async doEffect(src, fx, big) {
    const from = { x: src.x, y: 1.1, z: src.z };
    switch (fx.kind) {
      case 'ring': {
        this.fx.ring(src.x, src.z, fx.radius, new THREE.Color(fx.color ?? '#ffffff'), 0.45);
        this.sfx.swing();
        for (const e of this.aliveEnemies()) if (Math.hypot(e.x - src.x, e.z - src.z) < fx.radius + e.r) this.damageEnemy(e, fx.damage, 'skill');
        await this.wait(0.3);
        break;
      }
      case 'shot': {
        const targets = this.nearest(src.x, src.z, fx.count);
        if (!targets.length) break;
        const shots = [];
        for (let i = 0; i < fx.count; i++) {
          const e = targets[i % targets.length];
          shots.push(this.wait(i * 0.12).then(() => this.fx.projectile(from, { x: e.x, y: 1, z: e.z }, { look: fx.look, speed: 24 })).then(() => {
            if (fx.splash) {
              this.fx.ring(e.x, e.z, fx.splash, 0xff8a3a, 0.4);
              for (const o of this.aliveEnemies()) if (Math.hypot(o.x - e.x, o.z - e.z) < fx.splash + o.r) this.damageEnemy(o, fx.damage, 'skill');
            } else this.damageEnemy(e, fx.damage, 'skill');
            if (fx.fire) this.fx.addFire(e.x, e.z, fx.fire.radius, fx.fire.turns, fx.fire.damage);
            this.sfx.hit();
          }));
        }
        await Promise.all(shots);
        break;
      }
      case 'radial': {
        const n = fx.count, reach = 22, speed = 20;
        const jobs = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + 0.2;
          const dx = Math.sin(a), dz = Math.cos(a);
          jobs.push(this.fx.projectile(from, { x: src.x + dx * reach, y: 1.1, z: src.z + dz * reach }, { look: fx.look, speed }));
          for (const e of this.aliveEnemies()) {
            const t = (e.x - src.x) * dx + (e.z - src.z) * dz;
            if (t < 0) continue;
            const off = Math.abs((e.x - src.x) * dz - (e.z - src.z) * dx);
            if (off < e.r + 0.35) jobs.push(this.wait(t / speed).then(() => this.damageEnemy(e, fx.damage, 'skill')));
          }
        }
        this.sfx.swing();
        await Promise.all(jobs);
        break;
      }
      case 'line': {
        const [e] = this.nearest(src.x, src.z, 1);
        if (!e) break;
        const dx = e.x - src.x, dz = e.z - src.z, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len;
        const reach = this.toEdge(src.x, src.z, ux, uz);
        this.fx.beam(src.x, src.z, src.x + ux * reach, src.z + uz * reach, fx.width, new THREE.Color(fx.color ?? '#ffffff'), 0.05, 0.35);
        this.sfx.swing();
        for (const o of this.aliveEnemies()) {
          const t = (o.x - src.x) * ux + (o.z - src.z) * uz;
          if (t > 0 && Math.abs((o.x - src.x) * uz - (o.z - src.z) * ux) < fx.width / 2 + o.r) this.damageEnemy(o, fx.damage, 'skill');
        }
        await this.wait(0.35);
        break;
      }
      case 'heal': {
        this.sfx.pickup();
        for (const h of this.aliveHeroes()) this.healHero(h, Math.round(h.maxHp * fx.pct));
        await this.wait(0.4);
        break;
      }
      case 'strike': {
        const list = this.aliveEnemies();
        if (!list.length) break;
        const e = big ? list.reduce((m, x) => (x.hp > m.hp ? x : m)) : this.nearest(src.x, src.z, 1)[0];
        this.fx.disk(e.x, e.z, e.r + 0.6, 0xc8d0ff, 0.25);
        await this.wait(0.2);
        this.fx.ring(e.x, e.z, e.r + 1.6, new THREE.Color(fx.color ?? '#c8d0ff'), 0.4);
        this.fx.sparks(e.x, e.z, 0xffffff, 14, 1);
        this.game.shake(big ? 0.4 : 0.15);
        this.damageEnemy(e, fx.damage, 'crit');
        await this.wait(0.25);
        break;
      }
      case 'all': {
        const hits = fx.hits ?? 1;
        for (let k = 0; k < hits; k++) {
          await Promise.all(this.aliveEnemies().map((e, i) => this.wait(i * 0.08).then(() =>
            this.fx.projectile({ x: e.x + 2, y: 12, z: e.z - 3 }, { x: e.x, y: 0.5, z: e.z }, { look: fx.hits ? 'arrow' : 'fire', speed: 26 })).then(() => {
            this.fx.ring(e.x, e.z, e.r + 1.2, fx.hits ? 0xd0ffd0 : 0xff8a3a, 0.35);
            this.damageEnemy(e, fx.damage, 'skill');
          })));
        }
        this.game.shake(0.3);
        break;
      }
      case 'burnAll': {
        for (const e of this.aliveEnemies()) {
          e.burn = { turns: fx.turns, damage: fx.damage };
          this.fx.ring(e.x, e.z, e.r + 1, 0xff5a1a, 0.5);
          e.actor.setGlow(0xff4a10, 0.35);
          this.game.ui.updateLabel(e);
        }
        this.sfx.burn();
        await this.wait(0.5);
        break;
      }
      case 'power': break;
      default: break;
    }
  }

  // ===== 敵人 =====
  async enemyPhase() {
    // 地上的火、燃燒先扣血
    let burned = false;
    for (const f of this.fx.fires) {
      for (const e of this.aliveEnemies()) if (Math.hypot(e.x - f.x, e.z - f.z) < f.r + e.r * 0.5) { this.damageEnemy(e, f.damage, 'burn'); burned = true; }
      f.turns -= 1;
    }
    for (const f of this.fx.fires.filter((q) => q.turns <= 0)) this.game.scene.remove(f.mesh);
    this.fx.fires = this.fx.fires.filter((q) => q.turns > 0);
    for (const e of this.aliveEnemies()) {
      if (!e.burn) continue;
      this.damageEnemy(e, e.burn.damage, 'burn'); burned = true;
      if (--e.burn.turns <= 0) { e.burn = null; if (e.alive) e.actor.setGlow(0x000000, 0); }
    }
    if (burned) { this.sfx.burn(); await this.wait(0.5); }
    if (!this.aliveEnemies().length) return;
    for (const e of this.aliveEnemies()) { e.cd -= 1; this.game.ui.updateLabel(e); }
    await this.wait(0.3);
    for (const e of this.aliveEnemies()) {
      if (e.cd > 0) continue;
      if (!this.aliveHeroes().length) return;
      const atk = e.def.attacks ? e.def.attacks[e.next++ % e.def.attacks.length] : e.def.attack;
      await this.enemyAttack(e, atk);
      e.cd = e.every;
      this.game.ui.updateLabel(e);
      await this.wait(0.25);
    }
  }

  face(e, x, z) { e.actor.root.rotation.y = Math.atan2(x - e.x, z - e.z); }
  idleOf(e) { return e.def.fly && e.actor.has('Fly') ? 'Fly' : 'Idle'; }

  async enemyAttack(e, atk) {
    const heroes = this.aliveHeroes();
    const color = new THREE.Color(atk.color ?? '#ff3030');
    const dmg = Math.round((atk.damage ?? 0) * (this.stage.damageScale ?? 1)); // 關卡可以調整敵人傷害（stages.json 的 damageScale）
    this.log.enemyAttacks[atk.type] = (this.log.enemyAttacks[atk.type] ?? 0) + 1;
    const nearest = () => heroes.reduce((m, h) => ((h.x - e.x) ** 2 + (h.z - e.z) ** 2 < (m.x - e.x) ** 2 + (m.z - e.z) ** 2 ? h : m));
    const pick = () => heroes[Math.floor(Math.random() * heroes.length)];
    e.actor.flash(0xffffff, 0.3);
    switch (atk.type) {
      case 'slash': {
        const h = nearest();
        this.face(e, h.x, h.z);
        this.fx.disk(h.x, h.z, 1.1, 0xff3030, 0.5);
        e.actor.play('Attack', { once: true, after: this.idleOf(e) });
        await this.wait(0.5);
        this.fx.sparks(h.x, h.z, 0xff6060, 10);
        this.damageHero(h, dmg);
        break;
      }
      case 'shot': {
        const h = pick();
        this.face(e, h.x, h.z);
        e.actor.play('Attack', { once: true, after: this.idleOf(e) });
        this.fx.disk(h.x, h.z, 0.9, color, 0.35);
        await this.wait(0.3);
        await this.fx.projectile({ x: e.x, y: e.def.height * ENEMY_SCALE * 0.6, z: e.z }, { x: h.x, y: 1, z: h.z }, { look: atk.look ?? null, color, speed: 18, arc: 1 });
        if (h.alive) this.damageHero(h, dmg);
        break;
      }
      case 'quake': {
        e.actor.play('Attack', { once: true, after: this.idleOf(e) });
        this.fx.disk(e.x, e.z, atk.radius, 0xff3030, 0.7);
        await this.wait(0.7);
        this.fx.ring(e.x, e.z, atk.radius, 0xffa060, 0.45);
        this.game.shake(0.35);
        this.sfx.blast();
        for (const h of this.aliveHeroes()) if (Math.hypot(h.x - e.x, h.z - e.z) < atk.radius + h.r) this.damageHero(h, dmg);
        break;
      }
      case 'beam':
      case 'rush': {
        const h = pick();
        const dx = h.x - e.x, dz = h.z - e.z, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len;
        const reach = this.toEdge(e.x, e.z, ux, uz);
        this.face(e, h.x, h.z);
        this.fx.beam(e.x, e.z, e.x + ux * reach, e.z + uz * reach, atk.width, atk.type === 'rush' ? new THREE.Color('#ff9040') : color, 0.8, 0.3);
        await this.wait(0.8);
        if (atk.type === 'rush') {
          // 衝過去再回來（只是動畫，傷害照直線算）
          const root = e.actor.root, sx = e.x, sz = e.z, far = Math.min(len + 3, 14);
          e.actor.play(e.actor.has('Run') ? 'Run' : 'Walk', { speed: 2 });
          this.fx.add(null, 0.6, (f, k) => { const q = k < 0.5 ? k * 2 : (1 - k) * 2; root.position.x = sx + ux * far * q; root.position.z = sz + uz * far * q; if (k >= 1) { root.position.set(sx, 0, sz); e.actor.play(this.idleOf(e)); } });
        } else e.actor.play('Attack', { once: true, after: this.idleOf(e) });
        this.sfx.blast();
        for (const o of this.aliveHeroes()) {
          const t = (o.x - e.x) * ux + (o.z - e.z) * uz;
          if (t > 0 && Math.abs((o.x - e.x) * uz - (o.z - e.z) * ux) < atk.width / 2 + o.r) this.damageHero(o, dmg);
        }
        await this.wait(0.4);
        break;
      }
      case 'all': {
        e.actor.play('Attack', { once: true, after: this.idleOf(e) });
        this.game.ui.flash(atk.color ?? '#ff3030');
        await this.wait(0.5);
        this.game.shake(0.4);
        this.sfx.blast();
        for (const h of this.aliveHeroes()) { this.fx.ring(h.x, h.z, 1.4, color, 0.4); this.damageHero(h, dmg); }
        break;
      }
      case 'heal': {
        e.actor.play('Attack', { once: true, after: this.idleOf(e) });
        await this.wait(0.4);
        for (const o of this.aliveEnemies()) {
          const before = o.hp;
          o.hp = Math.min(o.maxHp, o.hp + atk.amount);
          this.fx.ring(o.x, o.z, o.r + 1, 0x6dff8a, 0.5);
          if (o.hp > before) this.fx.number(o.x, o.def.height * ENEMY_SCALE + 0.3, o.z, `+${o.hp - before}`, 'heal');
          this.game.ui.updateLabel(o);
        }
        this.sfx.pickup();
        break;
      }
      case 'summon': {
        e.actor.play('Attack', { once: true, after: this.idleOf(e) });
        this.fx.ring(e.x, e.z, e.r + 2, 0xc080ff, 0.6);
        await this.wait(0.4);
        const spots = this.freeSpots(atk.count);
        for (const [x, z] of spots) await this.spawnEnemy(atk.minion, x, z, true);
        this.game.ui.updateHud();
        break;
      }
      default: break;
    }
    await this.wait(0.2);
  }

  // 找空位放小兵（上半場、不和別人重疊）
  freeSpots(n) {
    const out = [];
    const taken = [...this.aliveEnemies(), ...this.aliveHeroes()].map((u) => [u.x, u.z, u.r]);
    for (const o of this.obstacles) taken.push([o.x, o.z, o.r ?? Math.max(o.w, o.d) / 2]);
    for (let tries = 0; tries < 200 && out.length < n; tries++) {
      const x = (Math.random() - 0.5) * (this.board.w - 3), z = -this.board.d / 2 + 2 + Math.random() * (this.board.d * 0.5);
      if (taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + 1.2)) { out.push([x, z]); taken.push([x, z, 0.8]); }
    }
    return out;
  }

  update(dt) {
    for (const t of this.timers) { t.t -= dt; if (t.t <= 0) t.resolve(); }
    this.timers = this.timers.filter((t) => t.t > 0);
    if (this.ball) this.updateBall(dt);
    for (const h of this.heroes) {
      h.actor.update(dt);
      if (h.ring) { const cur = this.state === 'aim' && h === this.current(); h.ring.material.opacity = cur ? 0.6 + 0.4 * Math.sin(this.game.time * 6) : 0.5; h.ring.scale.setScalar(cur ? 1.25 : 1); }
    }
    for (const e of this.enemies) e.actor.update(dt);
    for (const o of this.obstacles) animateObstacle(o, this.game.time, dt);
    for (const it of this.items) if (!it.taken) { it.mesh.rotation.y += dt * 2; it.mesh.position.y = 0.15 + Math.sin(this.game.time * 3 + it.x) * 0.12; }
  }

  dispose() {
    for (const u of [...this.heroes, ...this.enemies]) this.game.scene.remove(u.actor.root);
    for (const it of this.items) this.game.scene.remove(it.mesh);
    for (const o of this.obstacles) this.game.scene.remove(o.mesh);
    this.timers = [];
  }
}
