// 一場關卡：隊伍往前走（畫面往上捲動）、自動射擊、敵人依距離出現、牢籠救夥伴、道具、最後 Boss。
// 座標：x 左右（-LANE～LANE 是路），z 越小越前面（畫面上方）。cz 是鏡頭中心，走了 dist 公尺 → cz = -dist。
import * as THREE from 'three';
import { Actor, loadGltf } from './models.js';
import { LANE } from './world.js';

export const HERO_H = 1.75;
const ENEMY_SCALE = 1.15;
const HERO_R = 0.5;          // 角色被打中的範圍
const MOVE_SPEED = 13;       // 隊長最快移動速度
// 隊形：相對隊長的位置（V 字跟在後面）
const SLOTS = [[0, 0], [-1.4, 1.2], [1.4, 1.2], [-2.8, 2.4], [2.8, 2.4]];
const D2R = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);

export class Run {
  constructor(game, stage, picks) {
    this.game = game;
    this.scene = game.scene;
    this.data = game.data;
    this.stage = stage;
    this.picks = picks;
    this.shots = game.shots;
    this.view = game.view;
    this.dist = 0;
    this.cz = 0;
    this.speed = stage.speed;
    this.time = 0;
    this.heroes = [];        // 隊伍（第 0 位是隊長）
    this.fallen = [];        // 倒下的角色（留在原地，跑出畫面再移除）
    this.enemies = [];
    this.cages = [];
    this.items = [];
    this.joiners = [];       // 剛救出來、正跑向隊伍的夥伴
    this.eventIndex = 0;
    this.state = 'play';     // play → boss → won / lost
    this.coins = 0;
    this.kills = 0;
    this.lost = 0;           // 倒下幾位
    this.cagesTotal = stage.events.filter((e) => e.cage).length;
    this.rescuedNow = 0;
    this.power = 1;          // 武器強化等級 1～3
    this.bomb = 0;           // 必殺計量 0～100
    this.boss = null;        // 第一隻 Boss（bosses 是全部）
    this.bosses = [];
    // 難度與這一關的倍率
    const diff = game.difficulty();
    this.diff = diff;
    this.hpMul = diff.hp * (stage.hpScale ?? 1);
    this.dmgMul = diff.damage * (stage.damageScale ?? 1);
    this.bulletMul = diff.bulletSpeed;
    this.fireMul = diff.fire;
    this.target = { x: 0, z: 3 };   // 隊長要去的位置（相對鏡頭）
    this.inv = 0;
    this.gltfs = new Map();
  }

  heroDef(id) { return this.data.heroes.list.find((h) => h.id === id); }
  enemyDef(id) { return this.data.enemies.list[id]; }

  // 先把這關會用到的模型都載好（之後產生敵人就不用等）
  async load() {
    const models = new Set();
    for (const id of this.picks) models.add(this.heroDef(id).model);
    const add = (id) => { const d = this.enemyDef(id); if (!d) throw new Error(`沒有這種敵人：${id}`); models.add(d.model); for (const a of d.attacks ?? []) if (a.minion) add(a.minion); };
    for (const e of this.stage.events) if (e.enemy) add(e.enemy);
    for (const b of this.bossIds()) add(b);
    // 牢籠裡是誰：先決定好（* 是隨機一位有、但沒上場的角色）
    const used = new Set(this.picks);
    for (const e of this.stage.events) if (e.cage && e.cage !== '*') used.add(e.cage);
    this.captives = new Map();
    for (const e of this.stage.events) {
      if (!e.cage) continue;
      let id = e.cage;
      if (id === '*') {
        const pool = Object.keys(this.game.save.owned).filter((h) => !used.has(h));
        const other = this.data.heroes.list.map((h) => h.id).filter((h) => !used.has(h));
        id = pool.length ? pool[Math.floor(Math.random() * pool.length)] : other[Math.floor(Math.random() * other.length)];
        if (!id) continue;
        used.add(id);
      }
      this.captives.set(e, id);
      models.add(this.heroDef(id).model);
    }
    await Promise.all([...models].map(async (m) => this.gltfs.set(m, await loadGltf(m))));
    this.picks.forEach((id, i) => this.addHero(id, (i - (this.picks.length - 1) / 2) * 1.6, 0 + i * 0.6));
  }

  actor(model, height) { return new Actor(this.gltfs.get(model), height); }

  // 測試用：多載入幾個模型（角色 id、敵人 id 或模型名稱都可以）
  async preload(names) {
    for (const n of names) { const m = this.heroDef(n)?.model ?? this.enemyDef(n)?.model ?? n; if (!this.gltfs.has(m)) this.gltfs.set(m, await loadGltf(m)); }
  }

  addHero(id, x, z) {
    const def = this.heroDef(id);
    const lv = Math.max(1, this.game.save.level(id));
    const mult = 1 + this.data.heroes.levelBonus * (lv - 1);
    const actor = this.actor(def.model, HERO_H);
    actor.root.position.set(x, 0, this.cz + z);
    actor.root.rotation.y = Math.PI;
    actor.play('Run');
    this.scene.add(actor.root);
    const h = { id, def, actor, lv, mult, hp: Math.round(def.hp * mult), max: Math.round(def.hp * mult), x, z: this.cz + z, cool: rand(0, def.weapon.period), inv: 0, aura: def.aura ? def.aura.every : 0, alive: true };
    this.heroes.push(h);
    this.game.ui.addLabel(h, 'hero');
    return h;
  }

  get leader() { return this.heroes[0]; }
  bossIds() { return [].concat(this.stage.boss); }

  // ===== 每一格 =====
  update(dt, input) {
    this.time += dt;
    if (this.state === 'play' || this.state === 'boss') {
      if (this.state === 'boss') this.speed = Math.max(0, this.speed - dt * 2);
      this.dist += this.speed * dt;
      this.cz = -this.dist;
      this.spawnEvents();
      if (this.state === 'play' && this.dist >= this.stage.length && this.eventIndex >= this.stage.events.length) this.startBoss();
    }
    if (this.state !== 'lost') {
      this.moveSquad(dt, input);
      if (this.state !== 'won') this.fire(dt);
    }
    this.updateShots(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateCages(dt);
    this.updateItems(dt);
    for (const h of this.heroes) h.actor.update(dt);
    for (const f of this.fallen) f.actor.update(dt);
    this.fallen = this.fallen.filter((f) => { if (f.z > this.cz + this.view.bottom + 3) { this.scene.remove(f.actor.root); return false; } return true; });
    this.inv = Math.max(0, this.inv - dt);
  }

  // ===== 依距離出現敵人、牢籠、道具 =====
  spawnEvents() {
    const ev = this.stage.events;
    while (this.eventIndex < ev.length && ev[this.eventIndex].at <= this.dist) {
      const e = ev[this.eventIndex++];
      const z0 = this.cz + this.view.top - 1.5;
      if (e.enemy) {
        for (const [x, dz] of formation(e)) this.spawnEnemy(e.enemy, clampX(x, 0.6), z0 - dz);
      } else if (e.cage && this.captives.has(e)) {
        this.spawnCage(this.captives.get(e), e.x ?? 0, z0 - 0.5);
      } else if (e.item) {
        this.spawnItem(e.item, e.x ?? 0, z0);
      }
    }
  }

  spawnEnemy(id, x, z) {
    const def = this.enemyDef(id);
    const actor = this.actor(def.model, def.height * ENEMY_SCALE);
    if (def.tint) { const t = new THREE.Color(def.tint); for (const m of actor.materials) m.color?.multiply(t); }
    actor.root.position.set(x, def.fly ? 0.4 : 0, z);
    actor.root.rotation.y = 0;
    actor.play(def.fly && actor.has('Fly') ? 'Fly' : (def.move === 'stand' || def.move === 'hover' ? 'Idle' : 'Walk'));
    this.scene.add(actor.root);
    const hp = Math.round(def.hp * this.hpMul);
    const e = { id, def, actor, x, z, hp, max: hp, r: def.radius, active: false, t: 0, cool: rand(0.6, (def.attack?.period ?? 2) / this.fireMul + 0.3), queue: [], dead: false, vx: 0, vz: 0, phase: Math.random() * 6, touchT: 0, atk: 0, baseX: x };
    this.enemies.push(e);
    if (def.boss || def.hp >= 60) this.game.ui.addLabel(e, def.boss ? 'boss' : 'enemy');
    return e;
  }

  startBoss() {
    this.state = 'boss';
    const z = this.cz + this.view.top - 2;
    const ids = this.bossIds();
    this.bosses = ids.map((id, i) => {
      const x = ids.length > 1 ? (i / (ids.length - 1) - 0.5) * 6 : 0;
      const b = this.spawnEnemy(id, x, z - i * 0.5);
      b.homeX = x;
      b.homeZ = this.view.top + 4.5 + (ids.length > 1 ? (i % 2) * 1.2 : 0);   // 相對鏡頭，Boss 停在畫面上方
      b.cool = 2.5 + i * 1.0;     // 兩隻的話錯開出招
      b.active = true;             // 畫面停下來了，Boss 自己走進來
      return b;
    });
    this.boss = this.bosses[0];
    this.game.ui.bossBar(this.bosses);
    this.game.ui.banner(`${ids.join('＋')} 出現了！`, 'boss');
    this.game.sfx.blast();
  }

  // ===== 隊伍移動 =====
  moveSquad(dt, input) {
    const L = this.leader;
    if (!L) return;
    const zMin = this.view.top + 5, zMax = this.view.bottom - 2.8;   // 隊長能走的範圍（相對鏡頭）
    if (input.drag) { this.target.x = input.drag.x; this.target.z = input.drag.z; }
    if (input.kx || input.kz) { this.target.x = (L.x) + input.kx * 1.2; this.target.z = (L.z - this.cz) + input.kz * 1.2; }
    this.target.x = clampX(this.target.x, 0.4);
    this.target.z = Math.min(zMax, Math.max(zMin, this.target.z));
    const tx = this.target.x, tz = this.cz + this.target.z;
    const dx = tx - L.x, dz = tz - L.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, MOVE_SPEED * dt);
    if (d > 1e-4) { L.x += dx / d * step; L.z += dz / d * step; }
    // 鏡頭往前走，隊長要跟著
    if (this.state !== 'won') L.z = Math.min(L.z, this.cz + zMax);
    this.heroes.forEach((h, i) => {
      if (i > 0) {
        const [sx, sz] = SLOTS[i] ?? SLOTS[SLOTS.length - 1];
        const gx = clampX(L.x + sx, 0.4), gz = L.z + sz;
        const k = 1 - Math.exp(-dt * 8);
        h.x += (gx - h.x) * k; h.z += (gz - h.z) * k;
      }
      h.actor.root.position.set(h.x, 0, h.z);
      // 側移時身體稍微轉一下
      const lean = i === 0 ? THREE.MathUtils.clamp(dx * 0.12, -0.5, 0.5) : 0;
      h.actor.root.rotation.y = Math.PI - lean;
      h.inv = Math.max(0, h.inv - dt);
      if (h.def.aura && this.state !== 'won') {
        h.aura -= dt;
        if (h.aura <= 0) { h.aura = h.def.aura.every; this.healAll(h.def.aura.heal, h); }
      }
    });
  }

  healAll(pct, from) {
    let any = false;
    for (const h of this.heroes) {
      const n = Math.min(h.max - h.hp, Math.round(h.max * pct));
      if (n > 0) { h.hp += n; any = true; this.game.ui.number(h.x, 2, h.z, `+${n}`, 'heal'); }
    }
    if (any && from) this.shots.ring(from.x, from.z, 3, '#ffe27a', 0.5);
    return any;
  }

  // ===== 自動射擊 =====
  // 武器強化（撿藍色水晶，全隊一起 Lv1～3）：每位角色的 weapon.levels[等級-1] 蓋過原本的數值
  //   弓箭扇形散射、火焰箭平行多發、騎士類攻擊變高劍氣變大、飛鏢蛇行、火球打到散開火花、苦無變多
  weaponOf(h) {
    const w = h.def.weapon;
    return { ...w, ...(w.levels?.[this.power - 1] ?? {}) };
  }

  fire(dt) {
    for (const h of this.heroes) {
      h.cool -= dt;
      if (h.cool > 0) continue;
      const w = this.weaponOf(h);
      h.cool += w.period;
      if (h.cool < 0) h.cool = 0;
      const n = w.count ?? 1;
      for (let i = 0; i < n; i++) {
        const off = n > 1 ? i - (n - 1) / 2 : 0;
        const ang = (w.spread ? off * w.spread : 0) * D2R;
        const x = h.x + (w.gap ? off * w.gap : 0);
        this.shots.addHero({ look: w.look, color: w.color, x, y: 1.0, z: h.z - 0.6, vx: Math.sin(ang) * w.speed, vz: -Math.cos(ang) * w.speed, yaw: -ang, speed: w.speed,
          dmg: w.damage * h.mult, r: w.radius * (w.scale ?? 1), pierce: w.pierce ?? 1, hit: new Set(), life: w.range / w.speed, s: w.scale ?? 1,
          splash: w.splash, splashDmg: (w.splashDamage ?? 0) * h.mult, frag: w.frag, fragDmg: (w.fragDamage ?? 0) * h.mult,
          homing: w.homing, weave: w.weave, phase: n > 1 ? i / n * Math.PI * 2 : 0, age: 0, off: 0 });
      }
      if (h === this.leader || Math.random() < 0.3) h.actor.play('Attack', { once: true, after: 'Run', speed: 1.6, fade: 0.08 });
    }
    if (this.heroes.length) this.game.sfx.shoot?.(this.time);
  }

  // ===== 我方子彈 =====
  updateShots(dt) {
    const keep = [];
    const born = [];
    for (const s of this.shots.hero) {
      s.life -= dt;
      s.age += dt;
      if (s.homing) {
        const t = this.nearestEnemy(s.x, s.z, 14);
        if (t) {
          const want = Math.atan2(t.x - s.x, -(t.z - s.z));        // 0 = 往前
          let cur = Math.atan2(s.vx, -s.vz);
          const diff = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          cur += THREE.MathUtils.clamp(diff, -s.homing * dt, s.homing * dt);
          s.vx = Math.sin(cur) * s.speed; s.vz = -Math.cos(cur) * s.speed; s.yaw = -cur;
        }
      }
      s.x += s.vx * dt; s.z += s.vz * dt;
      if (s.weave) {
        // 蛇行：沿著前進方向的垂直方向左右擺動（每支相位不同，會交錯成辮子）
        const off = s.weave.amp * Math.sin(s.age * s.weave.freq + s.phase) * Math.min(1, s.age * 3);
        const l = Math.hypot(s.vx, s.vz) || 1;
        s.x += (-s.vz / l) * (off - s.off); s.z += (s.vx / l) * (off - s.off);
        s.off = off;
      }
      let alive = s.life > 0 && Math.abs(s.x) < LANE + 6;
      let hitAt = null;
      if (alive) {
        for (const e of this.enemies) {
          if (e.dead || !e.active || s.hit.has(e)) continue;
          const rr = e.r + s.r;
          if ((e.x - s.x) ** 2 + (e.z - s.z) ** 2 > rr * rr) continue;
          s.hit.add(e);
          this.damageEnemy(e, s.dmg);
          if (s.splash) this.explode(s.x, s.z, s.splash, s.splashDmg, e);
          else this.shots.burst(s.x, s.z, '#ffffff', 2, 3);
          if (--s.pierce <= 0) { alive = false; hitAt = e; break; }
        }
      }
      if (alive) {
        for (const c of this.cages) {
          if (c.state !== 'caged' || s.hit.has(c)) continue;
          if ((c.x - s.x) ** 2 + (c.z - s.z) ** 2 > (1.1 + s.r) ** 2) continue;
          s.hit.add(c);
          this.hitCage(c, s.dmg);
          alive = false;
          break;
        }
      }
      if (alive) { keep.push(s); continue; }
      if (s.splash && s.life <= 0) this.explode(s.x, s.z, s.splash, s.splashDmg, null);
      // 火球散開成火花（火焰彈），往四面八方飛
      if (s.frag && (hitAt || s.life <= 0)) {
        const a0 = Math.random() * Math.PI * 2;
        for (let k = 0; k < s.frag; k++) {
          const a = a0 + k / s.frag * Math.PI * 2;
          born.push({ look: 'ember', x: s.x, y: 1, z: s.z, vx: Math.sin(a) * 10, vz: -Math.cos(a) * 10, yaw: -a, speed: 10, dmg: s.fragDmg, r: 0.35, pierce: 1,
            hit: new Set(hitAt ? [hitAt] : []), life: 0.45, age: 0, off: 0, s: 1 });
        }
        this.shots.burst(s.x, s.z, '#ff8a2a', 10, 7);
      }
    }
    this.shots.hero = keep.concat(born);
  }

  explode(x, z, radius, dmg, skip) {
    this.shots.ring(x, z, radius, '#ff9a3a', 0.35);
    this.shots.burst(x, z, '#ffb040', 8, 5);
    for (const e of this.enemies) {
      if (e === skip || e.dead || !e.active) continue;
      if ((e.x - x) ** 2 + (e.z - z) ** 2 <= (radius + e.r) ** 2) this.damageEnemy(e, dmg);
    }
  }

  nearestEnemy(x, z, range) {
    let best = null, bd = range * range;
    for (const e of this.enemies) {
      if (e.dead || !e.active || e.z > z) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  damageEnemy(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    e.actor.flash(0xffffff, 0.1);
    this.bomb = Math.min(100, this.bomb + dmg * (e.def.boss ? 0.03 : 0.06));
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e, silent = false) {
    if (e.dead) return;
    e.dead = true;
    e.deadT = 0;
    e.actor.play('Death', { hold: true });
    this.game.ui.removeLabel(e);
    if (silent) return;
    this.kills++;
    this.coins += e.def.coins;
    this.game.ui.number(e.x, 2, e.z, `+${e.def.coins}`, 'coin');
    this.shots.burst(e.x, e.z, '#ffd27a', 8, 5);
    this.game.sfx.hit();
    // 掉道具
    const r = Math.random();
    if (!e.def.boss) {
      if (r < 0.035) this.spawnItem('potion', e.x, e.z);
      else if (r < 0.06) this.spawnItem('power', e.x, e.z);
    }
    if (this.bosses.includes(e) && this.bosses.every((b) => b.dead)) this.win();
  }

  // ===== 敵人 =====
  updateEnemies(dt) {
    const top = this.cz + this.view.top + 0.6;
    for (const e of this.enemies) {
      e.actor.update(dt);
      if (e.dead) {
        e.deadT += dt;
        if (e.deadT > 1.2) e.actor.root.position.y -= dt * 2;
        continue;
      }
      if (!e.active && (e.z > top || this.state === 'boss')) { e.active = true; e.t = 0; }
      e.t += dt;
      if (!e.active) continue;
      if (e.def.boss) this.bossMove(e, dt);
      else this.enemyMove(e, dt);
      e.actor.root.position.x = e.x;
      e.actor.root.position.z = e.z;
      // 攻擊
      if (this.state !== 'won' && this.state !== 'lost') {
        this.runQueue(e, dt);
        e.cool -= dt;
        if (e.cool <= 0) {
          if (e.def.boss) this.bossAttack(e);
          else if (e.def.attack && e.z < this.cz + this.view.bottom - 5) { this.enemyFire(e, e.def.attack); e.actor.play('Attack', { once: true, after: e.def.fly && e.actor.has('Fly') ? 'Fly' : (e.def.move === 'stand' || e.def.move === 'hover' ? 'Idle' : 'Walk') }); }
          // 兩隻 Boss 一起出來時，每隻出招慢一點（不然子彈是兩倍）
          e.cool = (e.def.boss ? e.def.every * (this.bosses.length > 1 ? 1.35 : 1) : (e.def.attack?.period ?? 99) * rand(0.85, 1.15)) / this.fireMul;
        }
      }
      // 撞到角色
      e.touchT -= dt;
      if (e.touchT <= 0) {
        for (const h of this.heroes) {
          const rr = e.r + HERO_R;
          if ((h.x - e.x) ** 2 + (h.z - e.z) ** 2 > rr * rr) continue;
          this.damageHero(h, Math.round(e.def.touch * this.dmgMul));
          e.touchT = 0.8;
          if (!e.def.boss) {
            this.damageEnemy(e, e.def.move === 'charge' ? e.max : 20);   // 衝過來撞到的會撞昏
            e.z -= 0.8;
          }
          break;
        }
      }
    }
    // 跑出畫面下方的移除
    this.enemies = this.enemies.filter((e) => {
      const gone = e.z > this.cz + this.view.bottom + 3 || Math.abs(e.x) > LANE + 10 || (e.dead && e.deadT > 2.2);
      if (gone) { this.scene.remove(e.actor.root); this.game.ui.removeLabel(e); }
      return !gone;
    });
  }

  enemyMove(e, dt) {
    const d = e.def;
    switch (d.move) {
      case 'walk': e.z += d.speed * dt; e.x = e.baseX + Math.sin(e.t * 1.3 + e.phase) * 0.4; break;
      case 'strafe': e.z += d.speed * 0.25 * dt; e.x = clampX(e.baseX + Math.sin(e.t * 1.1 + e.phase) * 2.5, 0.6); break;
      case 'chase': {
        const h = this.closestHero(e.x, e.z);
        if (h) { const dx = h.x - e.x, dz = h.z - e.z, l = Math.hypot(dx, dz) || 1; e.x += dx / l * d.speed * dt; e.z += Math.max(0.4, dz / l) * d.speed * dt; e.actor.root.rotation.y = Math.atan2(dx, dz); }
        break;
      }
      case 'charge': {
        if (!e.charging) {
          if (e.t > 0.7) {
            const h = this.closestHero(e.x, e.z) ?? { x: e.x, z: e.z + 5 };
            const dx = h.x - e.x, dz = Math.max(2, h.z - e.z), l = Math.hypot(dx, dz);
            e.vx = dx / l * d.speed; e.vz = dz / l * d.speed; e.charging = true;
            e.actor.root.rotation.y = Math.atan2(e.vx, e.vz);
            e.actor.play(e.actor.has('Run') ? 'Run' : 'Walk', { speed: 1.4 });
          } else if (e.t > 0.25) e.actor.flash(0xff4040, 0.15);
        } else { e.x += e.vx * dt; e.z += e.vz * dt; }
        break;
      }
      case 'hover': {
        const home = this.cz + this.view.top + 4;
        if (e.t < d.stay) { e.z += (home - e.z) * Math.min(1, dt * 1.5); e.x = clampX(e.baseX + Math.sin(e.t * 0.8 + e.phase) * 3, 1); }
        else e.z += d.speed * 1.6 * dt;
        break;
      }
      default: break;  // stand：站著，畫面捲動讓它靠近
    }
  }

  bossMove(e, dt) {
    if (e.rush) {
      const r = e.rush;
      r.t += dt;
      if (r.t < 0.6) { e.actor.flash(0xff3020, 0.1); }
      else if (r.phase === 'go') { e.z += r.speed * dt; if (e.z >= r.toZ) r.phase = 'back'; }
      else { e.z -= r.speed * 0.6 * dt; if (e.z <= this.cz + e.homeZ) { e.rush = null; e.actor.play(e.def.fly && e.actor.has('Fly') ? 'Fly' : 'Idle'); } }
      return;
    }
    const home = this.cz + e.homeZ;
    e.z += (home - e.z) * Math.min(1, dt * 1.2);
    const sway = this.bosses.length > 1 ? 1.8 : 3.5;
    e.x += ((e.homeX ?? 0) + Math.sin(e.t * 0.5 + (e.homeX ?? 0)) * sway - e.x) * Math.min(1, dt * 1.5);
    if (Math.abs(e.z - home) < 0.5 && !e.settled) { e.settled = true; e.actor.play(e.def.fly && e.actor.has('Fly') ? 'Fly' : 'Idle'); }
  }

  bossAttack(e) {
    if (e.rush || !e.settled) { e.cool = 0.5; return; }
    const atk = e.def.attacks[e.atk++ % e.def.attacks.length];
    e.actor.play('Attack', { once: true, after: e.def.fly && e.actor.has('Fly') ? 'Fly' : 'Idle' });
    if (atk.type === 'summon') {
      for (let i = 0; i < atk.count; i++) {
        const x = clampX(e.x + (i - (atk.count - 1) / 2) * 2.4, 0.6);
        const m = this.spawnEnemy(atk.minion, x, e.z + 1.5);
        m.active = true;
      }
      this.shots.ring(e.x, e.z, 4, '#c080ff', 0.5);
      return;
    }
    if (atk.type === 'rush') {
      const h = this.closestHero(e.x, e.z);
      e.rush = { t: 0, phase: 'go', speed: atk.speed, toZ: (h ? h.z : this.cz) + 1.5 };
      e.x = h ? clampX(h.x, 1) : e.x;
      e.def = { ...e.def, touch: atk.damage };
      e.actor.play(e.actor.has('Run') ? 'Run' : 'Walk', { speed: 1.5 });
      return;
    }
    this.enemyFire(e, atk);
  }

  // 敵人射擊：aimed 瞄準、spread 扇形、ring 一圈、rain 子彈雨；repeat／burst 會排進佇列，隔 gap 秒再射
  enemyFire(e, atk) {
    const times = Math.max(atk.repeat ?? 1, atk.burst ?? 1);
    for (let i = 0; i < times; i++) e.queue.push({ at: e.t + i * (atk.gap ?? 0.3), atk, i });
    this.runQueue(e, 0);
  }

  runQueue(e, dt) {
    while (e.queue.length && e.queue[0].at <= e.t) {
      const { atk, i } = e.queue.shift();
      this.shoot(e, atk, i);
    }
  }

  shoot(e, atk, i) {
    const dmg = Math.round(atk.damage * this.dmgMul);
    // ang 0 = 往畫面下方；模型正面朝 -Z，所以 yaw 要轉半圈
    const add = (x, z, ang, speed = atk.speed * this.bulletMul) => this.shots.addEnemy({ x, y: 1, z, vx: Math.sin(ang) * speed, vz: Math.cos(ang) * speed, yaw: Math.PI + ang, look: atk.look, dmg, color: atk.color ?? '#ff5a5a', r: 0.26, life: 9 });
    const x0 = e.x, z0 = e.z + e.r * 0.6;
    const h = this.randomHero();
    const aim = h ? Math.atan2(h.x - x0, h.z - z0) : 0;      // 0 = 往畫面下方
    switch (atk.type) {
      case 'aimed': {
        const n = atk.count ?? 1, spread = (atk.angle ?? 0) * D2R;
        for (let k = 0; k < n; k++) add(x0, z0, aim + (n > 1 ? (k / (n - 1) - 0.5) * spread : 0));
        break;
      }
      case 'spread': {
        const n = atk.count, spread = atk.angle * D2R;
        const base = i % 2 ? aim + spread / (n - 1) / 2 : aim;
        for (let k = 0; k < n; k++) add(x0, z0, base + (k / (n - 1) - 0.5) * spread);
        break;
      }
      case 'ring': {
        const off = (i * (atk.twist ?? 0)) * D2R + e.t;
        for (let k = 0; k < atk.count; k++) add(x0, z0, off + k / atk.count * Math.PI * 2);
        break;
      }
      case 'rain': {
        const n = atk.count, time = atk.time ?? 2;
        for (let k = 0; k < n; k++) {
          const x = rand(-LANE, LANE);
          e.queue.push({ at: e.t + k / n * time, atk: { ...atk, type: 'drop', x }, i: k });
        }
        e.queue.sort((a, b) => a.at - b.at);
        break;
      }
      case 'drop': add(atk.x, this.cz + this.view.top + 0.5, 0); break;
      default: break;
    }
    if (atk.type !== 'drop') this.game.sfx.enemyShot?.();
  }

  closestHero(x, z) {
    let best = null, bd = Infinity;
    for (const h of this.heroes) { const d = (h.x - x) ** 2 + (h.z - z) ** 2; if (d < bd) { bd = d; best = h; } }
    return best;
  }
  randomHero() {
    if (!this.heroes.length) return null;
    return Math.random() < 0.5 ? this.leader : this.heroes[Math.floor(Math.random() * this.heroes.length)];
  }

  // ===== 敵人子彈 =====
  updateBullets(dt) {
    const keep = [];
    const bottom = this.cz + this.view.bottom + 2, top = this.cz + this.view.top - 4;
    for (const b of this.shots.enemy) {
      b.life -= dt;
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (b.life <= 0 || b.z > bottom || b.z < top || Math.abs(b.x) > LANE + 8) continue;
      let hit = false;
      if (this.state !== 'won') {
        for (const h of this.heroes) {
          const rr = HERO_R + b.r;
          if ((h.x - b.x) ** 2 + (h.z - b.z) ** 2 > rr * rr) continue;
          this.damageHero(h, b.dmg);
          hit = true;
          break;
        }
      }
      if (!hit) keep.push(b);
    }
    this.shots.enemy = keep;
  }

  damageHero(h, dmg) {
    if (h.inv > 0 || this.inv > 0 || !h.alive || this.state === 'won') return;
    h.hp -= dmg;
    h.inv = 0.35;
    h.actor.flash(0xff3030, 0.25);
    this.game.ui.number(h.x, 2.2, h.z, `-${dmg}`, 'hurt');
    this.shots.burst(h.x, h.z, '#ff6a5a', 5, 4);
    this.game.sfx.hurt();
    if (h.hp <= 0) this.heroDown(h);
  }

  heroDown(h) {
    h.hp = 0;
    h.alive = false;
    this.lost++;
    h.actor.play('Death', { hold: true });
    this.heroes.splice(this.heroes.indexOf(h), 1);
    this.fallen.push(h);
    this.game.ui.removeLabel(h);
    this.game.ui.banner(`${h.id} 倒下了`, 'down');
    if (!this.heroes.length) this.lose();
  }

  // ===== 牢籠 =====
  spawnCage(id, x, z) {
    const def = this.heroDef(id);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const wood = new THREE.MeshStandardMaterial({ color: '#7a5634', roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: '#5a5e68', metalness: 0.6, roughness: 0.4 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.25, 12), wood);
    base.position.y = 0.12; base.castShadow = true; g.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.7, 12), wood);
    roof.position.y = 2.45; roof.castShadow = true; g.add(roof);
    const bars = new THREE.Group();
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 6), iron);
      b.position.set(Math.cos(a) * 1.0, 1.25, Math.sin(a) * 1.0);
      b.userData.dir = new THREE.Vector3(Math.cos(a), 0.6, Math.sin(a));
      bars.add(b);
    }
    g.add(bars);
    // 求救的驚嘆號
    const sign = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial({ color: '#ffd45c', toneMapped: false }));
    sign.position.y = 3.3; sign.scale.y = 1.6; g.add(sign);
    const actor = this.actor(def.model, HERO_H);
    actor.play('Wave');
    actor.root.rotation.y = 0;
    g.add(actor.root);
    this.scene.add(g);
    const c = { id, def, g, bars, sign, roof, actor, x, z, hp: 70, max: 70, state: 'caged', t: 0 };
    this.cages.push(c);
    this.game.ui.addLabel(c, 'cage');
    return c;
  }

  hitCage(c, dmg) {
    c.hp -= dmg;
    this.shots.burst(c.x, c.z, '#c8a070', 3, 3);
    if (c.hp <= 0) this.freeCage(c);
  }

  freeCage(c) {
    c.state = 'free';
    c.t = 0;
    this.game.ui.removeLabel(c);
    this.game.sfx.pickup();
    this.shots.burst(c.x, c.z, '#ffe27a', 16, 6);
    this.rescuedNow++;
    const isNew = this.game.save.unlock(c.id);
    if (this.heroes.length < this.data.heroes.squadMax && this.state !== 'lost') {
      this.game.ui.banner(isNew ? `救出 ${c.id}！加入名冊` : `救出 ${c.id}！`, 'special');
      c.actor.play('Run');
      // 從牢籠移到場景，跑向隊伍
      this.joiners.push(c);
    } else {
      this.healAll(0.3, this.leader);
      this.coins += 20;
      this.game.ui.banner(isNew ? `救出 ${c.id}！加入名冊（隊伍滿了，全隊補血）` : `救出 ${c.id}！隊伍滿了，全隊補血`, 'special');
      c.actor.play('Wave');
    }
  }

  updateCages(dt) {
    for (const c of this.cages) {
      c.t += dt;
      c.actor.update(dt);
      if (c.state === 'caged') {
        c.sign.rotation.y += dt * 3;
        c.sign.position.y = 3.3 + Math.sin(c.t * 4) * 0.15;
        if (c.z > this.cz + this.view.bottom - 1) { c.state = 'lost'; this.game.ui.removeLabel(c); this.game.ui.banner(`沒救到 ${c.id}…`, 'down'); }
      } else if (c.state === 'free') {
        c.sign.visible = false;
        for (const b of c.bars.children) { b.position.addScaledVector(b.userData.dir, dt * 6); b.userData.dir.y -= dt * 3; b.rotation.z += dt * 6; }
        c.roof.position.y += dt * 4; c.roof.rotation.x += dt * 4;
        if (c.t > 0.6) c.bars.visible = c.roof.visible = false;
        if (this.joiners.includes(c) && c.t > 0.25) {
          // 角色從牢籠跑到隊伍最後面的位置，然後正式加入
          if (!c.runner) {
            const wp = new THREE.Vector3(); c.actor.root.getWorldPosition(wp);
            c.g.remove(c.actor.root);
            this.scene.add(c.actor.root);
            c.actor.root.position.copy(wp);
            c.runner = { x: wp.x, z: wp.z };
          }
          const L = this.leader;
          if (!L) continue;
          const slot = SLOTS[Math.min(this.heroes.length, SLOTS.length - 1)];
          const gx = clampX(L.x + slot[0], 0.4), gz = L.z + slot[1];
          const dx = gx - c.runner.x, dz = gz - c.runner.z, d = Math.hypot(dx, dz);
          const step = Math.min(d, 14 * dt);
          c.runner.x += dx / (d || 1) * step; c.runner.z += dz / (d || 1) * step;
          c.actor.root.position.set(c.runner.x, 0, c.runner.z);
          c.actor.root.rotation.y = Math.atan2(dx, dz);
          if (d < 0.4) this.join(c);
        }
      }
    }
    this.cages = this.cages.filter((c) => {
      const gone = c.z > this.cz + this.view.bottom + 4 && !this.joiners.includes(c);
      if (gone) this.scene.remove(c.g);
      return !gone;
    });
  }

  join(c) {
    this.joiners.splice(this.joiners.indexOf(c), 1);
    this.scene.remove(c.actor.root);
    if (this.heroes.length >= this.data.heroes.squadMax || !this.leader) return;
    const h = this.addHero(c.id, c.runner.x, c.runner.z - this.cz);
    h.hp = h.max;
    this.shots.ring(h.x, h.z, 2, '#ffe27a', 0.4);
    this.game.ui.refreshCards();
  }

  // ===== 道具 =====
  spawnItem(kind, x, z) {
    const g = new THREE.Group();
    if (kind === 'potion') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), new THREE.MeshStandardMaterial({ color: '#ff3a5a', emissive: '#ff3a5a', emissiveIntensity: 0.6, roughness: 0.3 }));
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.3, 8), new THREE.MeshStandardMaterial({ color: '#e8e0d0' }));
      neck.position.y = 0.45;
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      cross.position.set(0, 0, 0.42);
      const cross2 = cross.clone(); cross2.scale.set(0.28, 3.6, 1);
      g.add(m, neck, cross, cross2);
    } else {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: '#4ad8ff', emissive: '#4ad8ff', emissiveIntensity: 0.9, roughness: 0.2 }));
      m.scale.y = 1.4;
      g.add(m);
    }
    g.position.set(clampX(x, 0.8), 1, z);
    this.scene.add(g);
    this.items.push({ kind, g, x: g.position.x, z, t: 0 });
  }

  updateItems(dt) {
    this.items = this.items.filter((it) => {
      it.t += dt;
      it.g.rotation.y += dt * 2.5;
      it.g.position.y = 1 + Math.sin(it.t * 3) * 0.2;
      // 靠近隊伍會被吸過來
      const h = this.closestHero(it.x, it.z);
      if (h) {
        const dx = h.x - it.x, dz = h.z - it.z, d = Math.hypot(dx, dz);
        if (d < 2.6) { it.x += dx / d * dt * 9; it.z += dz / d * dt * 9; }
        it.g.position.x = it.x; it.g.position.z = it.z;
        if (d < 0.9) { this.collect(it); this.scene.remove(it.g); return false; }
      }
      if (it.z > this.cz + this.view.bottom + 2) { this.scene.remove(it.g); return false; }
      return true;
    });
  }

  collect(it) {
    this.game.sfx.pickup();
    if (it.kind === 'potion') {
      if (!this.healAll(0.3, this.leader)) { this.coins += 5; }
      this.game.ui.banner('全隊補血！', 'special');
    } else if (this.power < 3) {
      this.power++;
      this.game.ui.banner(`武器強化 Lv${this.power}！`, 'special');
    } else {
      this.coins += 10;
      this.bomb = Math.min(100, this.bomb + 25);
      this.game.ui.number(it.x, 2, it.z, '+10', 'coin');
    }
  }

  // ===== 必殺：清掉畫面上所有子彈，打所有敵人 =====
  useBomb() {
    if (this.bomb < 100 || (this.state !== 'play' && this.state !== 'boss')) return false;
    this.bomb = 0;
    this.inv = 1.2;
    for (const b of this.shots.enemy) this.shots.burst(b.x, b.z, b.color, 1, 2);
    this.shots.enemy = [];
    const L = this.leader;
    if (L) this.shots.ring(L.x, L.z, 18, '#ffd45c', 0.7);
    for (const e of [...this.enemies]) if (e.active && !e.dead) this.damageEnemy(e, e.def.boss ? 160 : 120);
    this.game.flash('#fff2b0');
    this.game.ui.banner('英雄大集結！', 'special');
    this.game.sfx.blast();
    for (const h of this.heroes) h.actor.play('Attack', { once: true, after: 'Run' });
    return true;
  }

  // ===== 結束 =====
  win() {
    if (this.state === 'won' || this.state === 'lost') return;
    this.state = 'won';
    this.shots.enemy = [];
    for (const e of this.enemies) if (!e.dead) this.killEnemy(e, true);
    for (const h of this.heroes) h.actor.play('Wave');
    this.game.sfx.win();
    this.game.ui.banner('過關！', 'special');
    const stars = [true, this.rescuedNow >= this.cagesTotal, this.lost === 0];
    setTimeout(() => this.game.onRunEnd(this, true, stars), 2200 / this.game.speedMult);
  }

  lose() {
    if (this.state === 'won' || this.state === 'lost') return;
    this.state = 'lost';
    this.game.sfx.lose();
    setTimeout(() => this.game.onRunEnd(this, false, [false, false, false]), 1800 / this.game.speedMult);
  }

  dispose() {
    for (const h of [...this.heroes, ...this.fallen]) this.scene.remove(h.actor.root);
    for (const e of this.enemies) this.scene.remove(e.actor.root);
    for (const c of this.cages) { this.scene.remove(c.g); this.scene.remove(c.actor.root); }
    for (const it of this.items) this.scene.remove(it.g);
    this.shots.clear();
  }
}

function clampX(x, margin) { return Math.max(-LANE + margin, Math.min(LANE - margin, x)); }

// 隊形 → [[x, 往前多遠], ...]
function formation(e) {
  const n = e.n ?? 1, x = e.x ?? 0, w = e.w ?? 8;
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = n > 1 ? i / (n - 1) - 0.5 : 0;
    switch (e.form) {
      case 'column': out.push([x, i * 1.8]); break;
      case 'v': out.push([x + k * w, Math.abs(k) * 4]); break;
      case 'pair': out.push([i % 2 ? -x : x, Math.floor(i / 2) * 2]); break;
      case 'random': out.push([rand(-LANE + 1, LANE - 1), rand(0, 3)]); break;
      default: out.push([x + k * w, 0]);
    }
  }
  return out;
}
