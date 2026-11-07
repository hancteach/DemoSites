// Boss 戰：Boss 本體（大型模型、多種招式、每招都有預警、半血狂暴）＋Boss 清單與存檔。
// 招式與數值在 data/bosses.json。Boss 和敵將用同一套介面（alive、hp、maxHp、position、radius、strike、update、hide），
// 所以主角的攻擊、子彈、碰撞、HUD 血條都照敵將的程式走；Boss 戰時 main.js 把 game.captain 換成 Boss。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const D2R = Math.PI / 180;
const SAVE_KEY = 'musou.bosses';
const STAGGER_GAP = 5;     // 踉蹌後幾秒內不會再踉蹌（不然一直落地重擊就永遠不能出招）
const MOVE_GAP = 1.1;      // 招式之間休息幾秒（狂暴時乘 0.7）
const RAGE_SPEED = 1.3, RAGE_WINDUP = 0.8;
const COLORS = { slam: 0xff2a2a, shockwave: 0xff9a1a, rain: 0xff2a2a, cone: 0xff2a2a, charge: 0xff2a2a };
const gltfCache = new Map();

function loadGltf(model) {
  if (!gltfCache.has(model)) gltfCache.set(model, new GLTFLoader().loadAsync(`assets/models/${encodeURIComponent(model)}/${encodeURIComponent(model)}.glb`));
  return gltfCache.get(model);
}

export class Boss {
  constructor(game) {
    this.game = game;
    this.alive = false;
    this.root = new THREE.Group();
    this.root.visible = false;
    game.scene.add(this.root);
    this.warns = [];   // 正在預警的範圍（圓、扇形、線）
    this.def = { attackRadius: 0 };
  }

  // 換成某一隻 Boss（模型第一次用時才下載）
  async setBoss(def) {
    const gltf = await loadGltf(def.model);
    if (this.model) this.root.remove(this.model);
    this.def = { ...def, attackRadius: 0 };
    this.radius = def.radius;
    this.model = cloneSkinned(gltf.scene);
    this.model.scale.setScalar(def.scale);
    this.materials = [];
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      o.material = o.material.clone();
      this.materials.push(o.material);
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = new Map(gltf.animations.map((c) => [c.name, c]));
    this.current = null; this.currentName = '';
  }

  play(name, { once = false, speed = 1 } = {}) {
    if (!this.clips.has(name)) name = name === 'Run' || name === 'Fly' ? 'Walk' : 'Idle';
    if (!once && name === this.currentName) { this.current.timeScale = speed; return; }
    const next = this.mixer.clipAction(this.clips.get(name));
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
    next.clampWhenFinished = once;
    next.timeScale = speed;
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, 0.12, false);
    this.current = next;
    this.currentName = name;
  }

  get position() { return this.root.position; }
  get raging() { return this.hp <= this.maxHp * this.def.rage; }

  spawn(x, z) {
    this.alive = true;
    this.hp = this.maxHp = this.def.hp;
    this.state = 'walk';
    this.t = 0;
    this.cd = 2;
    this.moveIndex = 0;
    this.vx = this.vz = 0;
    this.flash = 0;
    this.staggerCd = 0;
    this.enraged = false;
    this.root.position.set(x, 0, z);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = true;
    this.model.position.y = 0;
    this.clearWarns();
    this.play('Walk');
  }

  hide() { this.alive = false; this.root.visible = false; this.clearWarns(); }

  // ---------- 預警範圍 ----------
  addWarn(shape, color) {
    let geo;
    if (shape.type === 'cone') geo = new THREE.CircleGeometry(1, 32, -Math.PI / 2 - shape.arc / 2, shape.arc).rotateX(-Math.PI / 2); // 扇形中線朝 +Z
    else if (shape.type === 'line') geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    else geo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false }));
    mesh.position.set(shape.x, 0.05 + this.warns.length * 0.002, shape.z);
    if (shape.type === 'line') { mesh.scale.set(shape.width, 1, shape.length); mesh.rotation.y = shape.yaw; }
    else if (shape.type === 'cone') { mesh.scale.setScalar(shape.r); mesh.rotation.y = shape.yaw; }
    else mesh.scale.setScalar(shape.r);
    this.game.scene.add(mesh);
    this.warns.push({ ...shape, mesh });
  }

  clearWarns() {
    for (const w of this.warns) { this.game.scene.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose(); }
    this.warns = [];
  }

  // 點 (x, z) 在不在某個預警範圍裡（機器人測試用來閃躲）
  dangerAt(x, z, margin = 0.6) {
    for (const w of this.warns) {
      const dx = x - w.x, dz = z - w.z, d = Math.hypot(dx, dz);
      if (w.type === 'circle' && d < w.r + margin) return { from: [w.x, w.z], jump: w.jumpable };
      if (w.type === 'cone' && d < w.r + margin) {
        let diff = Math.atan2(dx, dz) - w.yaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) < w.arc / 2 + 0.15) { // 往扇形的旁邊躲（往後跑還在扇形裡）
          const s = Math.sign(diff) || 1, px = Math.cos(w.yaw) * -s, pz = -Math.sin(w.yaw) * -s;
          return { from: [x + px, z + pz], side: true };
        }
      }
      if (w.type === 'line') {
        const fx = Math.sin(w.yaw), fz = Math.cos(w.yaw), along = dx * fx + dz * fz, side = dx * fz - dz * fx;
        if (along > -1 && along < w.length + 1 && Math.abs(side) < w.width / 2 + margin) return { from: [x - fz * Math.sign(side || 1), z + fx * Math.sign(side || 1)], side: true };
      }
    }
    return null;
  }

  // 主角在不在這個範圍裡（打下去那一刻判定）
  hits(w, hero) {
    const p = hero.position, dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz), r = hero.radius;
    if (w.type === 'circle') return d < w.r + r;
    if (w.type === 'cone') {
      if (d > w.r + r) return false;
      let diff = Math.atan2(dx, dz) - w.yaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      return Math.abs(diff) < w.arc / 2 + 0.1;
    }
    return false;
  }

  // ---------- 被主角打 ----------
  strike(x, z, yaw, arc, range, damage, { knock = 0, stagger = false } = {}) {
    if (!this.alive || this.hp <= 0) return 0;
    const dx = this.position.x - x, dz = this.position.z - z, d = Math.hypot(dx, dz);
    if (d > range + this.radius) return 0;
    if (arc < Math.PI * 2 - 0.01 && d > 0.3) {
      let diff = Math.atan2(dx, dz) - yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > arc / 2 + 0.3) return 0;
    }
    this.hp -= damage;
    this.flash = 0.1;
    for (const m of this.materials) { m.emissive?.setHex(0xfff0c0); if (m.emissive) m.emissiveIntensity = 0.7; }
    this.vx += dx / (d || 1) * knock * 0.05; this.vz += dz / (d || 1) * knock * 0.05;
    this.game.fx.burst(this.position.x, 2.2, this.position.z, 6, { speed: 7 });
    if (this.hp <= 0) {
      this.state = 'dying'; this.t = 0;
      this.clearWarns();
      this.play('Death', { once: true });
      this.game.onCaptainDown(this);
    } else if (stagger && this.staggerCd <= 0 && this.state !== 'charge') {
      // 落地重擊、無雙會讓 Boss 踉蹌，正在預警的招式也被打斷
      this.state = 'stagger'; this.t = 0; this.staggerCd = STAGGER_GAP;
      this.clearWarns();
      this.play('Hit', { once: true });
    }
    if (!this.enraged && this.raging && this.hp > 0) this.enrage();
    return 1;
  }

  enrage() {
    this.enraged = true;
    for (const m of this.materials) if (m.color) m.color.multiplyScalar(1).lerp(new THREE.Color(1, 0.55, 0.5), 0.35);
    this.game.banner(`${this.def.name} 狂暴了！`, 1.8, 'red');
    this.game.sfx.wave();
    this.summon({ count: 2 });
  }

  summon(move) {
    const g = this.game, p = this.position;
    for (let i = 0; i < (move.count ?? 2); i++) {
      const a = Math.random() * Math.PI * 2;
      g.horde.spawnSquad(p.x + Math.cos(a) * 5, p.z + Math.sin(a) * 5);
    }
    g.fx.ring(p.x, p.z, 5, { color: 0xb07dff, life: 0.5 });
  }

  // ---------- 招式 ----------
  startMove(m, dist, dx, dz) {
    const p = this.position, hero = this.game.hero.position;
    const yaw = Math.atan2(dx, dz);
    this.move = m;
    this.state = 'windup'; this.t = 0; this.struck = false;
    this.windup = m.windup * (this.enraged ? RAGE_WINDUP : 1);
    this.root.rotation.y = yaw;
    const color = m.color ? parseInt(m.color.slice(1), 16) : COLORS[m.type];
    if (m.type === 'slam') this.addWarn({ type: 'circle', x: p.x + Math.sin(yaw) * (this.radius + 1), z: p.z + Math.cos(yaw) * (this.radius + 1), r: m.radius }, color);
    else if (m.type === 'shockwave') { this.addWarn({ type: 'circle', x: p.x, z: p.z, r: m.radius, jumpable: true }, COLORS.shockwave); this.game.banner('跳起來躲！', 1.0, 'gold'); }
    else if (m.type === 'cone') this.addWarn({ type: 'cone', x: p.x, z: p.z, yaw, r: m.radius, arc: m.arc * D2R }, color);
    else if (m.type === 'charge') {
      this.chargeYaw = yaw;
      this.addWarn({ type: 'line', x: p.x, z: p.z, yaw, width: m.width, length: m.length }, color);
    } else if (m.type === 'rain') {
      // 第一個落在主角腳下，其他散在旁邊
      for (let i = 0; i < m.count; i++) {
        const a = Math.random() * Math.PI * 2, r = i === 0 ? 0 : m.spread * (0.4 + Math.random() * 0.6);
        this.addWarn({ type: 'circle', x: hero.x + Math.cos(a) * r, z: hero.z + Math.sin(a) * r, r: m.radius }, color);
      }
    }
    this.play(m.type === 'rain' && m.fly ? 'Fly' : 'Idle');
    if (m.type === 'summon') this.play('Wave', { once: true });
  }

  // 預警結束：打下去
  release() {
    const g = this.game, m = this.move, hero = g.hero, p = this.position;
    if (m.type === 'summon') { this.summon(m); this.endMove(); return; }
    if (m.type === 'charge') {
      this.clearWarns();
      this.state = 'charge'; this.t = 0; this.chargeLeft = m.length; this.chargeHit = false;
      this.play('Run', { speed: 1.8 });
      return;
    }
    this.play('Attack', { once: true, speed: 1.5 });
    for (const w of this.warns) {
      const big = !w.jumpable; // 橘圈（衝擊波）跳起來就躲得掉
      if (hero.alive && this.hits(w, hero)) hero.takeDamage(m.damage, p.x, p.z, { big });
      const col = w.mesh.material.color;
      if (w.type === 'cone') {
        for (let i = 0; i < 18; i++) {
          const a = w.yaw + (Math.random() - 0.5) * w.arc, r = Math.random() * w.r;
          g.fx.burst(w.x + Math.sin(a) * r, 0.8, w.z + Math.cos(a) * r, 2, { color: [col.r, col.g, col.b], speed: 3, up: 3 });
        }
      } else {
        g.fx.ring(w.x, w.z, w.r, { color: col.getHex(), life: 0.35 });
        g.fx.burst(w.x, 0.5, w.z, w.r > 4 ? 26 : 12, { color: [col.r, col.g, col.b], speed: 7, up: 4 });
      }
    }
    // Boss 的招式也會打飛擋在範圍裡的小兵（看起來比較有力）
    for (const w of this.warns) if (w.type === 'circle') g.horde.strike(w.x, w.z, 0, Math.PI * 2, w.r, 0, { knock: 8, launch: 6 });
    g.fx.addShake(0.45);
    g.sfx.blast();
    this.clearWarns();
    this.state = 'recover'; this.t = 0;
  }

  endMove() {
    this.state = 'walk'; this.t = 0;
    this.cd = MOVE_GAP * (this.enraged ? 0.7 : 1);
    this.moveIndex = (this.moveIndex + 1) % this.def.moves.length;
  }

  update(dt) {
    if (!this.alive) return;
    this.mixer.update(dt);
    this.t += dt;
    this.staggerCd -= dt;
    if (this.flash > 0) { this.flash -= dt; if (this.flash <= 0) for (const m of this.materials) if (m.emissive) m.emissiveIntensity = 0; }
    const g = this.game, p = this.position, hero = g.hero;
    p.x += this.vx * dt; p.z += this.vz * dt;
    this.vx *= Math.exp(-6 * dt); this.vz *= Math.exp(-6 * dt);
    const dx = hero.position.x - p.x, dz = hero.position.z - p.z, dist = Math.hypot(dx, dz) || 0.001;
    const speedMul = this.enraged ? RAGE_SPEED : 1;

    if (this.state === 'dying') {
      if (this.t > 2.4) this.model.position.y -= dt * 1.2;
      if (this.t > 3.6) this.hide();
      return;
    }
    if (this.state === 'stagger') { if (this.t > 1.1) this.endMove(); return; }
    if (this.state === 'windup') {
      const k = Math.min(1, this.t / this.windup);
      for (const w of this.warns) w.mesh.material.opacity = 0.12 + k * 0.38 + (k > 0.75 ? Math.sin(this.t * 40) * 0.08 : 0);
      if (this.move.type === 'summon' || this.move.type === 'rain') this.root.rotation.y = Math.atan2(dx, dz);
      if (this.t >= this.windup) this.release();
      return;
    }
    if (this.state === 'charge') {
      const step = Math.min(this.chargeLeft, this.move.speed * speedMul * dt);
      p.x += Math.sin(this.chargeYaw) * step; p.z += Math.cos(this.chargeYaw) * step;
      this.chargeLeft -= step;
      g.fx.burst(p.x, 0.3, p.z, 2, { color: [0.8, 0.7, 0.5], speed: 3, up: 1.5 });
      // 撞到的範圍和地上畫的線一樣寬（線外面就不會被撞）
      if (!this.chargeHit && hero.alive && Math.hypot(hero.position.x - p.x, hero.position.z - p.z) < this.move.width / 2 + hero.radius) {
        this.chargeHit = true;
        hero.takeDamage(this.move.damage, p.x, p.z, { big: true });
      }
      g.horde.strike(p.x, p.z, 0, Math.PI * 2, this.radius + 0.6, 0, { knock: 10, launch: 4 });
      const R = g.arenaRadius - 2, r = Math.hypot(p.x, p.z);
      if (r > R) { p.x *= R / r; p.z *= R / r; this.chargeLeft = 0; }
      if (this.chargeLeft <= 0) { this.state = 'recover'; this.t = 0; this.play('Idle'); }
      return;
    }
    if (this.state === 'recover') { if (this.t > 0.7) this.endMove(); return; }

    // 走路：輪到的招式距離夠近就出招，否則走過去
    this.cd -= dt;
    this.root.rotation.y = Math.atan2(dx, dz);
    const m = this.def.moves[this.moveIndex];
    if (this.cd <= 0 && hero.alive && dist <= m.range) { this.startMove(m, dist, dx, dz); return; }
    if (this.cd <= 0 && dist > m.range && dist > 12) { this.moveIndex = (this.moveIndex + 1) % this.def.moves.length; } // 太遠就換一招（例如衝撞）
    if (dist > this.radius + 1.6) {
      p.x += dx / dist * this.def.speed * speedMul * dt; p.z += dz / dist * this.def.speed * speedMul * dt;
      this.play('Walk', { speed: speedMul });
    } else this.play('Idle');
  }
}

// ---------- Boss 清單（標題畫面）與存檔 ----------
const $ = (id) => document.getElementById(id);
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

export class BossFights {
  constructor(game, data) {
    this.game = game;
    this.list = data.list;
    this.save = this.load();
    this.selected = this.list[0].id;
  }

  load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) ?? {}; } catch { return {}; } }
  store() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch { /* 無痕模式存不了 */ } }
  find(id) { return this.list.find((b) => b.id === id); }
  starsOf(id) { return this.save[id]?.stars ?? 0; }
  // 打倒前一隻才開放
  unlocked(b) { const i = this.list.indexOf(b); return i === 0 || this.starsOf(this.list[i - 1].id) > 0; }

  conditions(b) { return ['打倒 Boss', `${b.par} 秒內打倒`, `打倒時生命還有 ${Math.round(b.hpStar * 100)}% 以上`]; }

  buildList(onPick) {
    $('bossList').innerHTML = this.list.map((b, i) => {
      const locked = !this.unlocked(b);
      return `<button class="bossCard${locked ? ' locked' : ''}" data-id="${b.id}" ${locked ? 'disabled' : ''}>
        <small>第 ${i + 1} 戰</small><b>${locked ? '🔒 ' : ''}${b.name}</b><em>${b.title}</em><span class="stars">${starText(this.starsOf(b.id))}</span></button>`;
    }).join('');
    $('bossList').querySelectorAll('.bossCard:not(.locked)').forEach((el) => { el.onclick = () => onPick(el.dataset.id); });
    this.mark();
  }

  mark() {
    document.querySelectorAll('.bossCard').forEach((el) => el.classList.toggle('on', el.dataset.id === this.selected));
    const b = this.find(this.selected), best = this.save[b.id];
    $('bossInfo').innerHTML = `<b>${b.name}</b>　${b.title}，限時 ${b.time / 60} 分鐘<br>
      <small>${this.conditions(b).map((c, i) => `${'★'.repeat(i + 1)} ${c}`).join('　')}${best?.time ? `｜最快 ${best.time} 秒` : ''}</small>`;
  }

  move(step) {
    const open = this.list.filter((b) => this.unlocked(b));
    const i = open.findIndex((b) => b.id === this.selected);
    this.selected = open[(i + step + open.length) % open.length].id;
    this.mark();
  }

  // 結算：win 打倒、time 時間到、dead 倒下
  finish(b, reason, { time, hpRatio }) {
    const met = reason === 'win' ? [true, time <= b.par, hpRatio >= b.hpStar] : [false, false, false];
    const stars = met.filter(Boolean).length;
    const old = this.save[b.id] ?? { stars: 0 };
    const wasLocked = this.list.map((x) => !this.unlocked(x));
    this.save[b.id] = { stars: Math.max(old.stars, stars), time: reason === 'win' ? Math.min(old.time ?? Infinity, Math.round(time)) : old.time };
    this.store();
    const unlockedNow = this.list.filter((x, i) => wasLocked[i] && this.unlocked(x));
    return { boss: b, reason, met, stars, unlockedNow };
  }
}
