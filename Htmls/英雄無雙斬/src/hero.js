// 主角：移動、四段連斬（橫斬 → 回斬 → 迴旋斬 → 挑斬）、跳躍、空中連斬（三段 → 落地重擊）、
// 突進斬、無雙奧義、受傷。可以換角色（data/game.json 的 heroes），六個角色骨架與動作相同，只換模型和數值。
// 綁骨工坊的「攻擊動作組」（2026-11-06）讓每一招有自己的動作（招式的 clip 欄位）；模型沒有這些動作時退回 Attack，
// 用不同速度、轉身、刀光方向、跳躍高度做出差別。遠程招式（有 shot）一律用 Attack（施法、拉弓）。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const D2R = Math.PI / 180;
// 每段動作在第幾秒揮到最前面（工坊 CLIP_DEFS 的 hit × dur）。播放速度 = 這個時間 ÷ 招式的 hit，刀光才會對上
const CLIP_HIT = { Attack2: 0.294, Attack3: 0.45, Launcher: 0.315, Thrust: 0.273, AirAttack: 0.2, AirAttack2: 0.2, AirAttack3: 0.27 };
const AIR_STATES = new Set(['air', 'airAttack', 'plunge']);

// 角色數值 = 基本招式（騎士）× 角色倍率
export function buildHeroDef(base, ch) {
  const d = structuredClone(base);
  // moves：這個角色自己的招式（照順序蓋過基本招式的欄位，例如加上 shot 變成遠程）
  for (const key of ['combo', 'air']) (ch.moves?.[key] ?? []).forEach((patch, i) => { if (patch) Object.assign(d[key][i], structuredClone(patch)); });
  Object.assign(d, { id: ch.id, name: ch.name, model: ch.model, hp: ch.hp, speed: ch.speed, color: ch.color ?? base.color, scale: ch.scale ?? 1, musouHeal: ch.musouHeal ?? 0 });
  const tempo = ch.tempo ?? 1, rs = ch.rangeScale ?? 1, as = ch.arcScale ?? 1;
  for (const s of [...d.combo, ...d.air]) {
    s.hit /= tempo; s.dur /= tempo; s.animSpeed *= tempo;
    s.range *= rs;
    if (s.arc < 360) s.arc = Math.min(359, s.arc * as);
  }
  d.plunge.range *= rs;
  d.dash.finish.range *= rs;
  if (ch.dashCooldown) d.dash.cooldown = ch.dashCooldown;
  if (ch.dashDistance) d.dash.distance = ch.dashDistance;
  d.jump.speed *= ch.jumpScale ?? 1;
  const ms = ch.musouScale ?? 1;
  d.musou.pulse.range *= ms; d.musou.finish.range *= ms;
  if (ch.musouColor) { d.musou.pulse.color = ch.musouColor; d.musou.finish.color = ch.musouColor; }
  return d;
}

const gltfCache = new Map();
function loadModel(name) {
  if (!gltfCache.has(name)) {
    gltfCache.set(name, new GLTFLoader().loadAsync(`assets/models/${encodeURIComponent(name)}/${encodeURIComponent(name)}.glb`).then((gltf) => {
      const materials = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        if (o.isSkinnedMesh) o.frustumCulled = false;
        o.material = o.material.clone();
        materials.push(o.material);
      });
      return { gltf, materials };
    }));
  }
  return gltfCache.get(name);
}

export class Hero {
  constructor(game, base) {
    this.game = game;
    this.base = base;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // 轉身、跳躍只動這層，root 保持面向
    this.root.add(this.body);
    this.radius = 0.5;
    game.scene.add(this.root);
    // 無雙時腳下的光圈
    this.aura = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.4, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb340, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.aura.position.y = 0.05;
    this.root.add(this.aura);
  }

  // 換角色：載入模型（同一個模型只載一次）、套用數值
  async setCharacter(ch) {
    const def = buildHeroDef(this.base, ch);
    const { gltf, materials } = await loadModel(def.model);
    this.def = def;
    if (this.model) this.body.remove(this.model);
    this.model = gltf.scene;
    this.model.scale.setScalar(def.scale);
    this.materials = materials;
    for (const m of materials) if (m.emissive) m.emissiveIntensity = 0;
    this.body.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = new Map(gltf.animations.map((c) => [c.name, c]));
    this.aura.material.color.set(def.musou.finish.color ?? '#ffb340');
    this.reset();
  }

  preload(models) { return Promise.all(models.map(loadModel)); }

  reset() {
    this.hp = this.def.hp;
    this.musou = 0;
    this.state = 'move';
    this.step = 0;
    this.airStep = 0;
    this.t = 0;
    this.h = 0;   // 離地高度
    this.vy = 0;
    this.invuln = 0;
    this.dashCd = 0;
    this.struck = false;
    this.alive = true;
    this.current = null;
    this.currentName = '';
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    if (this.mixer) { this.mixer.stopAllAction(); this.play('Idle'); }
  }

  get position() { return this.root.position; }
  get yaw() { return this.root.rotation.y; }
  get inAir() { return AIR_STATES.has(this.state); }

  play(name, { once = false, speed = 1, from = 0, fade = 0.08 } = {}) {
    const clip = this.clips.get(name);
    if (!clip) return;
    if (!once && name === this.currentName) { this.current.timeScale = speed; return; }
    const next = this.mixer.clipAction(clip);
    next.reset();
    next.time = from;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
    next.clampWhenFinished = once;
    next.timeScale = speed;
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    this.current = next;
    this.currentName = name;
  }

  // big：敵將的大範圍攻擊（跳起來也躲不掉，除非跳很高）
  takeDamage(amount, fromX, fromZ, { big = false } = {}) {
    if (!this.alive || this.invuln > 0 || this.state === 'musou') return;
    // 跳起來時小兵的刀砍不到
    if (this.h > (big ? 2.0 : 1.0)) return;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = 0.45;
    this.addMusou(amount * 0.6);
    this.game.onHeroHurt(amount);
    for (const m of this.materials) { m.emissive?.setHex(0xff3322); if (m.emissive) m.emissiveIntensity = 0.9; }
    this.hurtFlash = 0.12;
    if (this.hp <= 0) {
      this.alive = false;
      this.state = 'dead';
      this.h = 0; this.body.position.y = 0;
      this.play('Death', { once: true });
      this.game.onHeroDead();
      return;
    }
    // 攻擊中、空中有霸體（不中斷），只有走路時會踉蹌一下
    if (this.state === 'move') {
      this.state = 'hurt'; this.t = 0;
      this.play('Hit', { once: true, speed: 1.6 });
      const dx = this.position.x - fromX, dz = this.position.z - fromZ, d = Math.hypot(dx, dz) || 1;
      this.knock = { x: dx / d * 5, z: dz / d * 5 };
    }
  }

  addMusou(v) { this.musou = Math.min(100, this.musou + v); }

  heal(v) { this.hp = Math.min(this.def.hp, this.hp + v); }

  faceInput(move, dt, rate = 16) {
    if (move.len === 0) return;
    const target = Math.atan2(move.x, move.z);
    let d = target - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, rate * dt);
  }

  // 自動朝向附近最多敵人的方向（只在出招的瞬間，玩家沒按方向時）。空中優先對準被挑起來的敵人
  autoAim(preferAir = false, radius = 4.5) {
    const g = this.game;
    const near = g.horde.near(this.position.x, this.position.z, radius, this._aim ??= []);
    let sx = 0, sz = 0;
    for (const u of near) {
      if (u.hp <= 0) continue;
      const w = preferAir && u.y > 0.5 ? 5 : 1;
      sx += (u.x - this.position.x) * w; sz += (u.z - this.position.z) * w;
    }
    if (g.captain?.alive) {
      const dx = g.captain.position.x - this.position.x, dz = g.captain.position.z - this.position.z;
      if (Math.hypot(dx, dz) < radius + 0.5) { sx += dx * 4; sz += dz * 4; }
    }
    if (sx || sz) this.root.rotation.y = Math.atan2(sx, sz);
  }

  // 遠程招式自動瞄準的範圍比較大（射程的一半）
  aim(preferAir, s) {
    const move = this.game.input.move;
    if (move.len > 0) this.root.rotation.y = Math.atan2(move.x, move.z);
    else this.autoAim(preferAir, s?.shot ? Math.max(4.5, s.shot.range * 0.5) : 4.5);
  }

  // 打中的那一刻：有 shot 就射出去，沒有就近身揮砍
  release(s, air = false) {
    if (s.shot) this.game.heroShoot(s, { air });
    else this.game.heroStrike(s, { air });
  }

  // 播招式的動作：有專屬動作就用，並讓「揮到最前面」對上招式的命中時間；沒有就用 Attack
  playMove(s) {
    const clip = !s.shot && s.clip && this.clips.has(s.clip) ? s.clip : null;
    this.moveClip = clip;   // 專屬動作自己會轉身（旋斬），就不再用程式轉
    if (clip) this.play(clip, { once: true, speed: CLIP_HIT[clip] / s.hit, fade: 0.06 });
    else if (s.anim === 'Jump') this.play('Jump', { once: true, speed: s.animSpeed, from: 0.15 });
    else this.play('Attack', { once: true, speed: s.animSpeed, from: s.from ?? 0 });
  }

  startStep(step) {
    this.aim(false, this.def.combo[step]);
    this.state = 'attack';
    this.step = step;
    this.t = 0;
    this.struck = false;
    this.playMove(this.def.combo[step]);
    this.game.sfx.swing();
  }

  // ---------- 跳躍與空中 ----------
  startJump() {
    const move = this.game.input.move;
    if (move.len > 0) this.root.rotation.y = Math.atan2(move.x, move.z);
    this.h = Math.max(this.h, this.body.position.y, 0.01);
    this.body.rotation.y = 0;
    this.state = 'air'; this.t = 0;
    this.vy = this.def.jump.speed;
    this.airStep = 0;
    this.play('Jump', { once: true, speed: 1.3, from: 0.2 });
    this.game.sfx.swing();
    this.game.fx.burst(this.position.x, 0.2, this.position.z, 6, { color: [0.85, 0.8, 0.65], speed: 3, up: 1 });
  }

  startAirStep(i) {
    this.aim(true, this.def.air[i]);
    this.state = 'airAttack'; this.t = 0; this.struck = false;
    this.airStep = i;
    // 出招時往上浮一點，才接得住敵人；還在往上衝時保留一部分速度，才不會一按攻擊就停在低處
    this.vy = Math.max(this.vy * 0.6, this.def.jump.hoverLift);
    this.playMove(this.def.air[i]);
    this.game.sfx.swing();
  }

  startPlunge() {
    this.aim(false);
    this.body.rotation.y = 0;
    this.state = 'plunge'; this.t = 0;
    this.vy = -this.def.plunge.fallSpeed;
    // 舉劍過頭再朝下；播完停在最後一格，落地時接 PlungeLand
    if (this.clips.has('Plunge')) this.play('Plunge', { once: true, speed: 2.2, fade: 0.05 });
    else this.play('Attack', { once: true, speed: 0.9, from: 0.15 });
    this.game.sfx.swing();
  }

  // 空中物理：回傳 true 表示落地了
  fall(dt, gScale = 1) {
    this.vy -= this.def.jump.gravity * gScale * dt;
    this.h += this.vy * dt;
    if (this.h <= 0) { this.h = 0; this.vy = 0; this.body.position.y = 0; return true; }
    this.body.position.y = this.h;
    return false;
  }

  land() {
    this.state = 'move'; this.airStep = 0;
    this.body.rotation.y = 0;
    this.game.fx.burst(this.position.x, 0.2, this.position.z, 5, { color: [0.85, 0.8, 0.65], speed: 2.5, up: 0.8 });
  }

  steer(dt, k) {
    const move = this.game.input.move;
    const sp = this.def.speed * k;
    this.position.x += move.x * sp * dt; this.position.z += move.z * sp * dt;
  }

  update(dt) {
    const g = this.game;
    const input = g.input;
    this.mixer.update(dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    if (this.hurtFlash > 0) {
      this.hurtFlash -= dt;
      if (this.hurtFlash <= 0) for (const m of this.materials) if (m.emissive) m.emissiveIntensity = 0;
    }
    this.aura.material.opacity = this.musou >= 100 ? 0.45 + Math.sin(performance.now() / 120) * 0.25 : (this.state === 'musou' ? 0.9 : 0);
    this.aura.rotation.y += dt * 3;
    if (!this.alive) return;
    this.t += dt;
    const move = input.move;
    const pos = this.position;

    if (this.state === 'musou') return this.updateMusou(dt);
    if (this.inAir) { this.updateAir(dt); this.clampArena(); return; }

    // 地面上才能放無雙、突進（空中按住的會留到落地）
    if (input.peek('musou') && this.musou >= 100 && this.state !== 'dash') { input.consume('musou'); return this.startMusou(); }
    if (input.peek('dash') && this.dashCd <= 0 && this.state !== 'dash') { input.consume('dash'); return this.startDash(); }

    if (this.state === 'move') {
      if (input.consume('jump')) return this.startJump();
      if (input.consume('attack') || input.attackHeld) return this.startStep(0);
      if (move.len > 0) {
        pos.x += move.x * this.def.speed * dt; pos.z += move.z * this.def.speed * dt;
        this.faceInput(move, dt);
        this.play('Run', { speed: 1.1 });
      } else this.play('Idle');
    } else if (this.state === 'hurt') {
      pos.x += this.knock.x * dt; pos.z += this.knock.z * dt;
      this.knock.x *= 0.85; this.knock.z *= 0.85;
      if (this.t > 0.3) this.state = 'move';
    } else if (this.state === 'land') {
      // 落地重擊後的收招
      if (this.t > this.def.plunge.recover) this.state = 'move';
    } else if (this.state === 'attack') {
      const s = this.def.combo[this.step];
      // 出招前段往前踏一步，可以稍微轉向
      if (this.t < s.hit) {
        this.faceInput(move, dt, 6);
        const lunge = s.lunge / s.hit;
        pos.x += Math.sin(this.yaw) * lunge * dt; pos.z += Math.cos(this.yaw) * lunge * dt;
      }
      // 迴旋斬：整個身體轉一圈
      if (s.spin && !this.moveClip) this.body.rotation.y = Math.min(1, this.t / s.dur) * Math.PI * 2 * s.spin;
      // 小跳：跳起再落下
      if (s.hop) this.body.position.y = Math.max(0, Math.sin(Math.min(1, this.t / s.hit) * Math.PI) * s.hop * (this.t < s.hit ? 1 : 0));
      if (!this.struck && this.t >= s.hit) {
        this.struck = true;
        this.release(s);
      }
      // 打中之後可以馬上跳起來（挑斬 → 跳 → 空中連斬）
      if (this.struck && this.t >= s.hit + 0.02 && input.consume('jump')) return this.startJump();
      const canChain = this.t >= s.hit + 0.04 && this.step < this.def.combo.length - 1;
      if (canChain && (input.consume('attack') || input.attackHeld)) { this.body.rotation.y = 0; return this.startStep(this.step + 1); }
      if (this.t >= s.dur) {
        this.body.rotation.y = 0; this.body.position.y = 0;
        this.state = 'move'; this.step = 0;
      }
    } else if (this.state === 'dash') {
      const d = this.def.dash;
      if (this.t < d.time) {
        const v = d.distance / d.time;
        pos.x += Math.sin(this.yaw) * v * dt; pos.z += Math.cos(this.yaw) * v * dt;
        g.dashSweep(d);
      } else if (!this.struck) {
        this.struck = true;
        if (!this.clips.has('Thrust')) this.play('Attack', { once: true, speed: 2.4, from: 0.1 });
        g.heroStrike(d.finish);
      }
      // 突進收招也可以跳
      if (this.struck && input.consume('jump')) return this.startJump();
      if (this.t >= d.time + 0.32) { this.state = 'move'; }
    }
    this.clampArena();
  }

  updateAir(dt) {
    const g = this.game, input = this.game.input, J = this.def.jump;
    if (this.state === 'air') {
      this.steer(dt, J.airControl);
      this.faceInput(input.move, dt, 10);
      // 空中按 K／Shift：直接落地重擊
      if (input.consume('dash') && this.h > 0.6) return this.startPlunge();
      if ((input.consume('attack') || input.attackHeld) && this.h > 0.3) {
        return this.airStep < this.def.air.length ? this.startAirStep(this.airStep) : this.startPlunge();
      }
      if (this.fall(dt)) this.land();
    } else if (this.state === 'airAttack') {
      const s = this.def.air[this.airStep];
      this.steer(dt, 0.35);
      if (s.spin && !this.moveClip) this.body.rotation.y = Math.min(1, this.t / s.dur) * Math.PI * 2 * s.spin;
      if (!this.struck && this.t >= s.hit) { this.struck = true; this.release(s, true); }
      if (this.fall(dt, J.hoverGravity)) { this.land(); return; }
      if (this.struck && input.consume('dash')) return this.startPlunge();
      if (this.t >= s.hit + 0.04 && (input.consume('attack') || input.attackHeld)) {
        this.body.rotation.y = 0;
        return this.airStep + 1 < this.def.air.length ? this.startAirStep(this.airStep + 1) : this.startPlunge();
      }
      if (this.t >= s.dur) {
        this.body.rotation.y = 0;
        this.state = 'air'; this.airStep++;
        this.play('Jump', { once: true, speed: 0.8, from: 0.5 });
      }
    } else if (this.state === 'plunge') {
      if (this.fall(dt, 0)) {
        g.heroStrike(this.def.plunge);
        if (this.clips.has('PlungeLand')) this.play('PlungeLand', { once: true, speed: 1.6, fade: 0.04 });
        g.fx.burst(this.position.x, 0.3, this.position.z, 16, { color: [0.9, 0.8, 0.6], speed: 8, up: 4 });
        this.land();
        this.state = 'land'; this.t = 0;
        this.invuln = Math.max(this.invuln, 0.25);
      }
    }
  }

  startDash() {
    const move = this.game.input.move;
    if (move.len > 0) this.root.rotation.y = Math.atan2(move.x, move.z);
    this.state = 'dash'; this.t = 0; this.struck = false;
    this.body.rotation.y = 0; this.body.position.y = 0;
    this.dashCd = this.def.dash.cooldown;
    this.invuln = Math.max(this.invuln, this.def.dash.time + 0.1);
    this.dashHit = new Set();
    // 雙手突刺：衝刺時收劍蓄力，衝到底剛好刺出（沒有 Thrust 的舊模型用跑步＋Attack）
    if (this.clips.has('Thrust')) this.play('Thrust', { once: true, speed: CLIP_HIT.Thrust / this.def.dash.time, fade: 0.05 });
    else this.play('Run', { speed: 2.4 });
    this.game.sfx.swing();
  }

  startMusou() {
    this.state = 'musou'; this.t = 0; this.musou = 0;
    this.pulses = 0;
    this.body.position.y = 0;
    this.play('Attack', { once: false, speed: 2.6 });
    if (this.def.musouHeal) { const before = this.hp; this.heal(this.def.musouHeal); this.game.healed += this.hp - before; }
    this.game.onMusouStart();
  }

  updateMusou(dt) {
    const m = this.def.musou;
    this.body.rotation.y += dt * 16;
    const move = this.game.input.move;
    this.position.x += move.x * this.def.speed * 0.5 * dt;
    this.position.z += move.z * this.def.speed * 0.5 * dt;
    while (this.pulses < m.pulses && this.t >= m.firstPulse + this.pulses * m.interval) {
      this.pulses++;
      this.game.heroStrike(m.pulse);
    }
    if (this.t >= m.duration) {
      this.game.heroStrike(m.finish);
      this.body.rotation.y = 0;
      this.state = 'move';
      this.invuln = 0.6;
      this.game.onMusouEnd();
    }
    this.clampArena();
  }

  clampArena() {
    const R = this.game.arenaRadius - 1;
    const p = this.position;
    const r = Math.hypot(p.x, p.z);
    if (r > R) { p.x *= R / r; p.z *= R / r; }
  }
}

export { D2R };
