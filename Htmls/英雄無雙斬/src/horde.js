// 小兵大軍：生成、AI（包圍、輪流上前攻擊）、被打（硬直、擊退、擊飛）、倒地、沉入地面。
// 每隻小兵只是一筆資料，畫面由 crowd.js 的 InstancedMesh 一次畫完。
import * as THREE from 'three';
import { loadCrowdType, frameRow } from './crowd.js';
import { radialTexture } from './fx.js';

const CELL = 2;          // 空間格子大小（找附近的小兵用）
const MAX_ATTACKERS = 8; // 同時上前攻擊的最多幾隻（其他的在外圈包圍，像無雙一樣不會一擁而上）
const GRAVITY = 24;

export class Horde {
  constructor(game, config) {
    this.game = game;
    this.config = config;
    this.types = {};
    this.units = [];
    this.grid = new Map();
    this.spawnTimer = 0;
    this.attackers = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  async load(onProgress) {
    const entries = Object.entries(this.config.types);
    let done = 0;
    await Promise.all(entries.map(async ([name, def]) => {
      const t = await loadCrowdType(`assets/crowd/${encodeURIComponent(def.model)}.glb`, def.max);
      t.name = name;
      t.def = def;
      t.attackLen = t.clips.Attack?.duration ?? 0.75;
      t.deathLen = t.clips.Death?.duration ?? 1.8;
      t.hitLen = t.clips.Hit?.duration ?? 0.55;
      this.types[name] = t;
      this.game.scene.add(t.mesh);
      onProgress?.(++done, entries.length);
    }));
    // 腳下的圓形影子（一次畫完全部）
    const total = Object.values(this.config.types).reduce((s, d) => s + d.max, 0);
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false,
    }), total);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = -1;
    this.game.scene.add(this.shadows);
  }

  reset() {
    this.units.length = 0;
    this.spawnTimer = 0;
    for (const t of Object.values(this.types)) t.mesh.count = 0;
    this.shadows.count = 0;
  }

  get alive() { return this.units.reduce((n, u) => n + (u.hp > 0 ? 1 : 0), 0); }

  countOf(name) { let n = 0; for (const u of this.units) if (u.type.name === name) n++; return n; }

  pickType() {
    // allowed：Boss 戰只出現這個 Boss 的手下（null＝全部）
    const options = Object.values(this.types).filter((t) => this.countOf(t.name) < t.def.max && (!this.allowed || this.allowed.includes(t.name)));
    const total = options.reduce((s, t) => s + t.def.weight, 0);
    let r = Math.random() * total;
    for (const t of options) { r -= t.def.weight; if (r <= 0) return t; }
    return options[0];
  }

  spawn(type, x, z) {
    const d = type.def;
    const u = {
      type, x, z, y: 0, vx: 0, vz: 0, vy: 0, yaw: Math.random() * 6.28, spin: 0,
      hp: d.hp, state: 'walk', t: 0, anim: 'Walk', animTime: Math.random(), loop: true,
      flash: 0, atkCd: 1 + Math.random() * 2, struck: false, sink: 0, ring: 1.6 + Math.random() * 2.6,
    };
    this.units.push(u);
    return u;
  }

  // 一小隊從畫面外湧進來
  spawnSquad(cx, cz) {
    const type = this.pickType();
    if (!type) return 0;
    const n = 6 + Math.floor(Math.random() * 7);
    let made = 0;
    for (let i = 0; i < n && this.countOf(type.name) < type.def.max; i++) {
      const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 3;
      this.spawn(type, cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      made++;
    }
    return made;
  }

  maintain(dt, target) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 0.35;
    if (this.alive >= target) return;
    const hero = this.game.hero.position;
    const R = this.game.arenaRadius - 3;
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 24 + Math.random() * 10;
      const x = hero.x + Math.cos(a) * dist, z = hero.z + Math.sin(a) * dist;
      if (Math.hypot(x, z) < R) { this.spawnSquad(x, z); return; }
    }
  }

  setAnim(u, name, loop = true) {
    if (u.anim === name && loop) return;
    u.anim = name;
    u.animTime = 0;
    u.loop = loop;
  }

  buildGrid() {
    this.grid.clear();
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      const k = `${Math.floor(u.x / CELL)},${Math.floor(u.z / CELL)}`;
      let cell = this.grid.get(k);
      if (!cell) this.grid.set(k, cell = []);
      cell.push(u);
    }
  }

  near(x, z, r, out = []) {
    out.length = 0;
    const r2 = r * r;
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const cell = this.grid.get(`${i},${j}`);
        if (!cell) continue;
        for (const u of cell) { const dx = u.x - x, dz = u.z - z; if (dx * dx + dz * dz <= r2) out.push(u); }
      }
    }
    return out;
  }

  // 攻擊判定：扇形（arc 弧度、以 yaw 為中心）。回傳打中幾隻
  // y／yReach：空中出招時只打得到高度差 yReach 以內的；juggle：已經在空中的敵人被打到時再往上彈（空中連段）
  strike(x, z, yaw, arc, range, damage, { knock = 4, launch = 0, juggle = 0, y = 0, yReach = Infinity, onHit } = {}) {
    let hits = 0;
    const list = this.near(x, z, range + 0.6, this._list ??= []);
    for (const u of list) {
      if (u.hp <= 0) continue;
      const dx = u.x - x, dz = u.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range + u.type.def.radius) continue;
      if (Math.abs(u.y - y) > yReach) continue;
      if (arc < Math.PI * 2 - 0.01 && d > 0.3) {
        let diff = Math.atan2(dx, dz) - yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) > arc / 2) continue;
      }
      const up = juggle > 0 && (u.state === 'air' || u.y > 0.3) ? Math.max(launch, juggle) : launch;
      this.damage(u, damage, dx / (d || 1), dz / (d || 1), knock, up);
      onHit?.(u);
      hits++;
    }
    return hits;
  }

  damage(u, amount, nx, nz, knock, launch) {
    u.hp -= amount;
    u.flash = 1;
    u.vx = nx * knock;
    u.vz = nz * knock;
    const g = this.game;
    // 已經揮到一半的攻擊不會被打斷（沒打死、沒被擊飛時），不然主角一直砍就永遠不會受傷
    const committed = u.state === 'attack' && u.t > u.type.attackLen * 0.2 && launch <= 0;
    if (committed && u.hp > 0) { u.vx *= 0.3; u.vz *= 0.3; g.fx.burst(u.x, 1.0, u.z, 3, { speed: 5 }); return; }
    if (u.state === 'attack') this.attackers--;
    g.fx.burst(u.x, 1.0 + u.y, u.z, 5, { speed: 6 });
    if (u.hp <= 0) {
      u.state = 'dead';
      u.t = 0;
      // 打倒時一定飛出去一點，大招飛更高
      u.vy = Math.max(launch, 3.5 + Math.random() * 2);
      u.vx = nx * (knock + 3); u.vz = nz * (knock + 3);
      u.spin = (Math.random() - 0.5) * 14;
      this.setAnim(u, 'Death', false);
      g.onKill(u);
    } else if (launch > 0) {
      u.state = 'air'; u.t = 0; u.vy = launch; u.spin = (Math.random() - 0.5) * 10;
      this.setAnim(u, 'Hit', false);
    } else if (u.type.def.armor && u.state !== 'hit') {
      u.vx *= 0.25; u.vz *= 0.25; // 霸體：只被推一點點，照樣走過來打
    } else {
      u.state = 'hit'; u.t = 0;
      this.setAnim(u, 'Hit', false);
    }
  }

  update(dt) {
    const g = this.game;
    const hero = g.hero;
    const hx = hero.position.x, hz = hero.position.z;
    this.buildGrid();
    const list = this._near ??= [];
    const R = g.arenaRadius;

    for (const u of this.units) {
      const d = u.type.def;
      u.t += dt;
      u.animTime += dt;
      u.flash = Math.max(0, u.flash - dt * 9);
      u.atkCd -= dt;
      // 擊退速度衰減
      u.x += u.vx * dt; u.z += u.vz * dt;
      const fr = Math.exp(-7 * dt);
      if (u.state !== 'air' && u.state !== 'dead') { u.vx *= fr; u.vz *= fr; }

      const dx = hx - u.x, dz = hz - u.z;
      const dist = Math.hypot(dx, dz) || 0.001;

      if (u.state === 'dead') {
        if (u.y > 0 || u.vy > 0) {
          u.vy -= GRAVITY * dt; u.y += u.vy * dt; u.yaw += u.spin * dt;
          if (u.y <= 0) { u.y = 0; u.vy = 0; u.vx *= 0.3; u.vz *= 0.3; }
        } else { u.vx *= fr; u.vz *= fr; }
        if (u.t > 1.9) u.sink += dt;
        continue;
      }
      if (u.state === 'air') {
        u.vy -= GRAVITY * dt; u.y += u.vy * dt; u.yaw += u.spin * dt;
        if (u.y <= 0) { u.y = 0; u.vy = 0; u.state = 'hit'; u.t = 0; u.vx *= 0.3; u.vz *= 0.3; this.setAnim(u, 'Hit', false); }
        continue;
      }
      if (u.state === 'hit') {
        if (u.t > u.type.hitLen * 0.8) { u.state = 'walk'; u.t = 0; }
        continue;
      }
      if (u.state === 'attack') {
        u.yaw = turn(u.yaw, Math.atan2(dx, dz), dt * 6);
        const hitAt = u.type.attackLen * 0.45;
        if (!u.struck && u.t >= hitAt) {
          u.struck = true;
          if (dist < 2.1 && hero.alive) hero.takeDamage(d.damage * (g.enemyDamageScale ?? g.config.enemyDamageScale), u.x, u.z); // Boss 戰的小兵比較弱（bosses.json 的 minionDamageScale）
        }
        if (u.t >= u.type.attackLen) { u.state = 'walk'; u.t = 0; u.atkCd = 1.8 + Math.random() * 2; this.attackers--; }
        continue;
      }
      // 走路：靠近主角，在外圈包圍；輪到的才上前攻擊
      const wantAttack = hero.alive && u.atkCd <= 0 && this.attackers < MAX_ATTACKERS;
      const stopAt = wantAttack ? 1.3 : u.ring;
      if (wantAttack && dist < 1.7) {
        u.state = 'attack'; u.t = 0; u.struck = false; this.attackers++;
        this.setAnim(u, 'Attack', false);
        continue;
      }
      if (dist > stopAt) {
        const fast = dist > 14;
        const sp = d.speed * (fast ? 1.7 : 1);
        u.x += dx / dist * sp * dt; u.z += dz / dist * sp * dt;
        this.setAnim(u, fast ? 'Run' : 'Walk');
      } else {
        this.setAnim(u, 'Idle');
      }
      u.yaw = turn(u.yaw, Math.atan2(dx, dz), dt * 5);
    }

    // 互相推開（不重疊）＋不能穿過主角＋不能出場
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      const r = u.type.def.radius;
      this.near(u.x, u.z, r + 0.6, list);
      for (const o of list) {
        if (o === u) continue;
        const dx = u.x - o.x, dz = u.z - o.z;
        const min = r + o.type.def.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (min - d) * 0.5;
        u.x += dx / d * push; u.z += dz / d * push;
      }
      const hx2 = u.x - hx, hz2 = u.z - hz;
      const hd = Math.hypot(hx2, hz2), hmin = r + hero.radius;
      if (hd < hmin && hd > 1e-4) { u.x = hx + hx2 / hd * hmin; u.z = hz + hz2 / hd * hmin; }
      const rr = Math.hypot(u.x, u.z);
      if (rr > R - 0.5) { u.x *= (R - 0.5) / rr; u.z *= (R - 0.5) / rr; }
    }

    // 沉完的移除
    for (let i = this.units.length - 1; i >= 0; i--) if (this.units[i].sink > 0.8) this.units.splice(i, 1);
    this.render();
  }

  render() {
    for (const t of Object.values(this.types)) t.mesh.count = 0;
    let s = 0;
    for (const u of this.units) {
      const t = u.type;
      const i = t.mesh.count++;
      const sc = t.def.scale;
      this._e.set(u.state === 'air' ? Math.sin(u.t * 9) * 0.5 : 0, u.yaw, 0);
      this._q.setFromEuler(this._e);
      this._p.set(u.x, u.y - u.sink * 1.2, u.z);
      this._s.set(sc, sc, sc);
      this._m.compose(this._p, this._q, this._s);
      t.mesh.setMatrixAt(i, this._m);
      t.frameAttr.array[i] = frameRow(t, u.anim, u.animTime, u.loop);
      t.flashAttr.array[i] = u.flash * 0.5;
      if (u.sink === 0) {
        const r = t.def.radius * 2.4 * Math.max(0.4, 1 - u.y * 0.15);
        this._p.set(u.x, 0.03, u.z);
        this._s.set(r, 1, r);
        this._q.identity();
        this._m.compose(this._p, this._q, this._s);
        this.shadows.setMatrixAt(s++, this._m);
      }
    }
    this.shadows.count = s;
    this.shadows.instanceMatrix.needsUpdate = true;
    for (const t of Object.values(this.types)) {
      t.mesh.instanceMatrix.needsUpdate = true;
      t.frameAttr.needsUpdate = true;
      t.flashAttr.needsUpdate = true;
    }
  }
}

function turn(from, to, k) {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + d * Math.min(1, k);
}
