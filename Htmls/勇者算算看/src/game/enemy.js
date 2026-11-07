// 路上的怪物：站在路上等隊伍來，隊伍靠近就走過去打。打的是「隊伍」（傷害累積到打倒最後一個人）。
// Boss 另外有招式：砸地（預警圈後扣很多血）、召喚小怪。數值在 data/characters.json。
// 第 5～8 關的能力（打到的人和陷阱一樣逐人判斷，全部有預警，左右閃就躲得掉）：
//   ability.type shoot 站著不動、往隊伍射一條直線（先畫預警線）；lob 往隊伍要經過的地方丟（紅圈）；
//   charge 沿自己那一道直線衝過隊伍；blink 消失後出現在隊伍旁邊；fly 飛在隊伍前方，近戰打不到，俯衝落地後才砍得到；
//   trail 走過的地方留下毒池；split 倒下時分裂（在 main.js）
import * as THREE from 'three';
import { Actor } from './actor.js';

const AGGRO = 13;            // 隊伍多近才開始走過來
const DEATH_HOLD = 0.9;
const DEATH_FADE = 0.5;
const BAR_WIDTH = 1.15;
const FLAME_EVERY = 0.06;
const WARN_COLOR = 0xff3b2f;
const BLINK_COLOR = 0xb07cff;
const MELEE_CLOSE = 3.5;     // 遠程敵人被貼到這麼近就改成近戰
const DIVE_TIME = 0.4;
const lineGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const circleGeometry = new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2);
const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });

// 預警線：路面上從 zFrom 到 zTo 的紅色長條
function warnLane(game, x, zFrom, zTo, width) {
  const mesh = new THREE.Mesh(lineGeometry, new THREE.MeshBasicMaterial({ color: WARN_COLOR, transparent: true, opacity: 0.2, depthWrite: false }));
  mesh.position.set(x, 0.07, (zFrom + zTo) / 2);
  mesh.scale.set(width, 1, Math.abs(zTo - zFrom));
  game.scene.add(mesh);
  return mesh;
}

export class Enemy extends Actor {
  constructor(game, def, instance, x, d) {
    super(game, def, instance);
    // Boss 有自己的難度倍率（bossHpMult），否則困難模式的 Boss 會硬到打不完
    const diff = game.difficulty;
    this.maxHp = Math.round(def.hp * (def.boss ? diff.bossHpMult ?? diff.enemyHpMult ?? 1 : diff.enemyHpMult ?? 1) * (game.level?.hpMult ?? 1) * (game.ramp ?? 1));
    this.stun = 0;
    this.hp = this.maxHp;
    this.state = 'idle';
    this.timer = 0;
    this.cooldown = def.attackCooldown * Math.random();
    this.removed = false;
    this.position.set(x, 0, -d);
    this.root.rotation.y = 0; // 面向隊伍（+z）
    this.makeBar();
    this.play('Idle');
    this.warnings = [];
    this.abilityTimer = (def.ability?.cooldown ?? 0) * (0.2 + Math.random() * 0.4);
    this.trailTimer = (def.trail?.every ?? 0) * 0.3; // 第一灘毒早一點出現
    this.swoopTimer = def.fly?.swoop ? def.fly.swoop.cooldown * (0.4 + Math.random() * 0.4) : 0; // Boss 會飛但不俯衝
    this.side = Math.random() * Math.PI * 2;
    if (def.fly) {
      this.position.y = def.fly.height;
      this.play('Fly');
      this.shadow = new THREE.Mesh(circleGeometry, shadowMaterial);
      this.shadow.scale.setScalar(def.radius * 1.5);
      game.scene.add(this.shadow);
    }
  }

  get alive() { return this.hp > 0; }
  get canBeHit() { return this.alive && !this.vanished; }
  get ability() { return this.def.ability; }
  // 在空中：夥伴的近戰（騎士、盜賊）打不到，只有弓箭、火球打得到
  get airborne() { return Boolean(this.def.fly) && this.position.y > 1; }
  // 會擋住隊伍前進的：在地上、看得到
  get blocking() { return this.alive && !this.airborne && !this.vanished; }

  makeBar() {
    const { fx } = this.game;
    this.bar = new THREE.Group();
    const back = new THREE.Sprite(fx.barMaterials.back);
    back.scale.set(BAR_WIDTH + 0.06, 0.18, 1);
    this.barFill = new THREE.Sprite(fx.barMaterials.fill);
    this.barFill.scale.set(BAR_WIDTH, 0.12, 1);
    back.renderOrder = 14; this.barFill.renderOrder = 15;
    this.bar.add(back, this.barFill);
    this.bar.position.y = 1.9 * this.def.scale + 0.4;
    this.bar.visible = false;
    this.root.add(this.bar);
  }

  updateBar() {
    const ratio = Math.max(0, this.hp / this.maxHp);
    this.bar.visible = this.hp > 0 && ratio < 1;
    if (ratio <= 0) return;
    this.barFill.scale.set(BAR_WIDTH * ratio, 0.12, 1);
    this.barFill.center.set(0.5 / ratio, 0.5);
  }

  update(dt, crowd) {
    this.updateBurn(dt);
    if (this.stun > 0 && this.alive) { // 技能暈眩：原地發呆
      this.stun -= dt;
      this.play('Idle');
      if (Math.random() < dt * 6) this.game.fx.burst(this.position.x, 2.2, this.position.z, 1, '#fde047', 1);
      return;
    }
    this.timer += dt;
    this.cooldown -= dt;
    this.abilityTimer -= dt;
    if (!this.alive && this.warnings.length) this.clearWarnings();
    this[`update_${this.state}`](dt, crowd);
    if (this.def.trail && this.alive && this.state !== 'idle') this.updateTrail(dt);
    if (this.shadow) {
      this.shadow.position.set(this.position.x, 0.05, this.position.z);
      this.shadow.visible = this.alive;
    }
  }

  clearWarnings() {
    for (const m of this.warnings) { this.game.scene.remove(m); m.material.dispose(); }
    this.warnings = [];
  }

  glowWarnings(progress) {
    for (const m of this.warnings) m.material.opacity = 0.18 + 0.42 * Math.min(1, progress);
  }

  // ---------- 第 5～8 關的能力 ----------
  // 回傳 true＝這一格由能力處理（不要照一般的追過去打）
  useAbility(dt, crowd) {
    const a = this.ability;
    const dist = this.distanceTo(crowd);
    const c = crowd.center;
    if (a.type === 'shoot' || a.type === 'lob') {
      if (dist <= MELEE_CLOSE) return false; // 被貼近了：一般近戰
      this.faceToward(c.x - this.position.x, c.z - this.position.z, dt, 8);
      this.play('Idle');
      if (this.abilityTimer <= 0 && dist <= a.range) this.startAim(crowd);
      return true; // 站在原地等隊伍過來
    }
    if (this.abilityTimer > 0 || dist > a.range || dist < (a.min ?? 0)) return false;
    if (a.type === 'charge' || a.type === 'blink') { this.startAim(crowd); return true; }
    return false;
  }

  startAim(crowd) {
    const a = this.ability, { game } = this;
    const back = -crowd.d + crowd.depth + 2;
    this.state = 'aim';
    this.timer = 0;
    if (a.type === 'shoot') {
      const n = a.shot.count ?? 1, gap = a.shot.gap ?? 1.6;
      this.aimXs = Array.from({ length: n }, (_, i) => crowd.x + (i - (n - 1) / 2) * gap);
      for (const x of this.aimXs) this.warnings.push(warnLane(game, x, this.position.z + 0.6, back, (a.shot.width ?? 0.4) * 2 + 0.5));
    } else if (a.type === 'lob') {
      const lead = game.settings.runSpeed * (a.windup + a.shot.flight) * 0.85; // 丟到隊伍「等一下會到」的地方
      game.enemyShots.lob(this, { x: crowd.x, z: crowd.center.z - lead }, a.shot, a.windup);
    } else if (a.type === 'charge') {
      this.faceToward(0, 1, Infinity);
      this.warnings.push(warnLane(game, this.position.x, this.position.z, back + 2, a.width));
    } else if (a.type === 'blink') {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.blinkTo = { x: THREE.MathUtils.clamp(crowd.x + side * 1.8, -game.track.halfWidth + 0.6, game.track.halfWidth - 0.6), z: crowd.center.z };
      const ring = new THREE.Mesh(circleGeometry, new THREE.MeshBasicMaterial({ color: BLINK_COLOR, transparent: true, opacity: 0.2, depthWrite: false }));
      ring.position.set(this.blinkTo.x, 0.07, this.blinkTo.z);
      ring.scale.setScalar(0.9);
      game.scene.add(ring);
      this.warnings.push(ring);
      game.fx.burst(this.position.x, 0.8, this.position.z, 18, BLINK_COLOR, 3);
      this.vanished = true;
      this.root.visible = false;
    }
  }

  update_aim(dt, crowd) {
    const a = this.ability, { game } = this;
    this.glowWarnings(this.timer / a.windup);
    if (a.type === 'blink' && this.warnings[0]) { // 紫圈跟著隊伍走
      this.blinkTo.z = crowd.center.z;
      this.warnings[0].position.z = this.blinkTo.z;
    }
    if (this.timer < a.windup) return;
    this.clearWarnings();
    this.abilityTimer = a.cooldown;
    if (a.type === 'charge') {
      this.state = 'dash'; this.timer = 0;
      this.dashHit = new Set();
      this.play(this.clips.has('Run') ? 'Run' : 'Walk', { speed: 2.4 });
      game.sfx.swing();
      return;
    }
    if (a.type === 'blink') {
      this.position.set(this.blinkTo.x, 0, this.blinkTo.z);
      this.vanished = false;
      this.root.visible = true;
      game.fx.burst(this.position.x, 0.8, this.position.z, 18, BLINK_COLOR, 3);
      this.cooldown = 0;
      this.state = 'chase';
      return;
    }
    if (a.type === 'shoot') {
      for (const x of this.aimXs) game.enemyShots.lane(x, this.position.z + 0.6, a.shot);
      game.sfx.swing();
    }
    this.state = 'attack'; this.timer = 0;
    this.hitDone = true; // 出手動作沿用攻擊，不算近戰傷害
    this.play('Attack', { once: true, fade: 0.06 });
  }

  // 山豬：沿自己那一道往隊伍衝過去，撞到的人逐一判斷，衝過隊伍後回頭近戰
  update_dash(dt, crowd) {
    const a = this.ability;
    this.position.z += a.speed * dt;
    this.game.fx.dust(this.position.x, 0.2, this.position.z, 1);
    const { x, z } = this.position;
    this.game.enemyShots.hitMembers((p) => Math.abs(p.x - x) <= a.width / 2 && Math.abs(p.z - z) <= 0.9, this.dashHit, a);
    if (this.position.z > -crowd.d + crowd.depth + 2.5) { this.state = 'chase'; this.timer = 0; }
  }

  updateTrail(dt) {
    this.trailTimer -= dt;
    if (this.trailTimer > 0) return;
    this.trailTimer = this.def.trail.every;
    this.game.enemyShots.pool(this.position.x, this.position.z, this.def.trail.pool);
  }

  // 飛龍：飛在隊伍前方左右飄，時間到就俯衝（紅圈跟著隊伍），落地停一下才飛起來
  updateAir(dt, crowd) {
    const fly = this.def.fly, { game } = this;
    if (!crowd.alive) return;
    this.side += dt * 0.8;
    const tx = Math.sin(this.side) * (game.track.halfWidth - 1.5), tz = -crowd.d - fly.hover;
    const speed = Math.max(this.def.moveSpeed, game.settings.runSpeed + 3);
    const dx = tx - this.position.x, dz = tz - this.position.z, len = Math.hypot(dx, dz);
    if (len > 0.1) { const k = Math.min(len, speed * dt) / len; this.position.x += dx * k; this.position.z += dz * k; }
    this.position.y = Math.min(fly.height, this.position.y + 3 * dt);
    this.faceToward(crowd.x - this.position.x, crowd.center.z - this.position.z, dt, 6);
    this.play('Fly');
    if (this.position.y < fly.height - 0.1) return;
    if (this.ability && this.abilityTimer <= 0) { this.startAim(crowd); return; }
    this.swoopTimer -= dt;
    if (this.swoopTimer > 0) return;
    this.diveTarget = { x: crowd.x, z: crowd.center.z };
    const ring = new THREE.Mesh(circleGeometry, new THREE.MeshBasicMaterial({ color: WARN_COLOR, transparent: true, opacity: 0.2, depthWrite: false }));
    ring.position.set(this.diveTarget.x, 0.07, this.diveTarget.z);
    ring.scale.setScalar(fly.swoop.radius);
    game.scene.add(ring);
    this.warnings.push(ring);
    this.state = 'swoopAim'; this.timer = 0;
  }

  update_swoopAim(dt, crowd) {
    const s = this.def.fly.swoop;
    this.glowWarnings(this.timer / s.windup);
    // 紅圈慢慢跟著隊伍（往前跑的速度一樣，左右跟得慢，閃得掉但要快）
    this.diveTarget.z = crowd.center.z;
    this.diveTarget.x += (crowd.x - this.diveTarget.x) * Math.min(1, dt * 1.2);
    this.warnings[0].position.set(this.diveTarget.x, 0.07, this.diveTarget.z);
    this.position.z = this.diveTarget.z - this.def.fly.hover;
    this.position.y += dt * 0.6;
    this.play('Fly');
    if (this.timer < s.windup) return;
    this.diveFrom = this.position.clone();
    this.state = 'dive'; this.timer = 0;
    this.play('Attack', { once: true, fade: 0.05 });
    this.game.sfx.swing();
  }

  update_dive(dt, crowd) {
    const s = this.def.fly.swoop;
    const t = Math.min(1, this.timer / DIVE_TIME);
    const f = this.diveFrom, g = this.diveTarget;
    g.z = crowd.center.z;
    this.position.set(f.x + (g.x - f.x) * t, f.y * (1 - t) * (1 - t), f.z + (g.z - f.z) * t);
    if (t < 1) return;
    this.clearWarnings();
    const { fx } = this.game;
    fx.blastRing(g.x, g.z, s.radius, '#ff5a3c');
    fx.dust(g.x, 0.3, g.z, 20);
    fx.shake(0.35);
    this.game.sfx.blast();
    this.game.enemyShots.hitMembers((p) => Math.hypot(p.x - g.x, p.z - g.z) <= s.radius, new Set(), s);
    this.position.y = 0;
    this.swoopTimer = s.cooldown;
    this.state = 'landed'; this.timer = 0;
    this.play('Idle');
  }

  // 落地喘氣：這時候騎士、盜賊才砍得到；擋在隊伍前面，隊伍會停下來打
  update_landed(dt, crowd) {
    this.faceToward(crowd.x - this.position.x, crowd.center.z - this.position.z, dt, 4);
    if (this.timer >= this.def.fly.swoop.ground) { this.state = 'chase'; this.timer = 0; }
  }

  distanceTo(crowd) {
    const c = crowd.center;
    return Math.hypot(c.x - this.position.x, c.z - this.position.z) - crowd.radius;
  }

  update_idle(dt, crowd) {
    if (this.def.fly && crowd.alive && this.distanceTo(crowd) < this.def.fly.aggro) { this.state = 'chase'; return; }
    if (this.ability && crowd.alive && this.distanceTo(crowd) <= this.ability.range && this.useAbility(dt, crowd)) return;
    if (crowd.alive && this.distanceTo(crowd) < AGGRO) this.state = 'chase';
  }

  update_chase(dt, crowd) {
    if (!crowd.alive) { this.play('Wave'); return; }
    if (this.def.fly && !this.def.boss) { this.updateAir(dt, crowd); return; }
    if (this.ability && this.useAbility(dt, crowd)) return;
    const c = crowd.center;
    const dx = c.x - this.position.x, dz = c.z - this.position.z;
    this.faceToward(dx, dz, dt, 8);
    if (this.distanceTo(crowd) <= this.def.attackRange) {
      if (this.cooldown <= 0) { this.startAttack(); return; }
      this.play('Idle');
      return;
    }
    const len = Math.hypot(dx, dz) || 1;
    this.position.x += (dx / len) * this.def.moveSpeed * dt;
    this.position.z += (dz / len) * this.def.moveSpeed * dt;
    this.play('Walk', { speed: this.def.moveSpeed / 2.2 });
  }

  startAttack() {
    this.state = 'attack';
    this.timer = 0;
    this.hitDone = false;
    this.cooldown = this.def.attackCooldown;
    this.play('Attack', { once: true, fade: 0.06 });
  }

  update_attack(dt, crowd) {
    if (!this.hitDone && this.timer >= this.def.attackHitTime) {
      this.hitDone = true;
      if (this.distanceTo(crowd) <= this.def.attackRange + 0.5) this.game.hurtCrowd(this.def.attackDamage);
    }
    if (this.timer >= this.clipLength('Attack')) this.state = 'chase';
  }

  update_dying(dt) {
    if (this.position.y > 0) this.position.y = Math.max(0, this.position.y - 6 * dt); // 飛龍掉下來
    if (this.timer < DEATH_HOLD) return;
    const fade = (this.timer - DEATH_HOLD) / DEATH_FADE;
    this.setOpacity(Math.max(0, 1 - fade));
    if (fade >= 1) this.removed = true;
  }

  // 火球的燃燒：每 interval 秒扣 damage，持續 duration 秒
  ignite(burn) {
    if (!this.alive) return;
    this.burn = { def: burn, remaining: burn.duration, tick: this.burn?.tick ?? burn.interval, spark: 0 };
  }

  updateBurn(dt) {
    const b = this.burn;
    if (!b || !this.alive) { this.burn = null; return; }
    b.remaining -= dt; b.tick -= dt; b.spark -= dt;
    if (b.spark <= 0) { b.spark = FLAME_EVERY; this.game.fx.flame(this.position.x, 0.3, this.position.z, 2); }
    if (b.tick <= 0) { b.tick += b.def.interval; this.game.damageEnemy(this, b.def.damage, true); }
    if (this.burn && b.remaining <= 0) this.burn = null;
  }

  takeHit(amount, soft = false) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.updateBar();
    this.flash(soft ? 0xff6a1f : 0xffffff);
    if (this.hp <= 0) {
      this.state = 'dying';
      this.timer = 0;
      this.vanished = false;
      this.root.visible = true;
      this.clearWarnings();
      this.play('Death', { once: true, fade: 0.08 });
    }
    return true;
  }

  destroy() {
    this.clearWarnings();
    if (this.shadow) this.game.scene.remove(this.shadow);
    super.destroy();
  }
}

const WARN = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);

export class Boss extends Enemy {
  constructor(game, def, instance, x, d) {
    super(game, def, instance, x, d);
    this.plan = def.boss;
    this.skillIndex = 0;
    this.skillTimer = this.plan.skillEvery * 0.5;
    this.bar.visible = false;
    this.reinforceTimer = this.plan.reinforce?.first ?? 4;
    game.hud.showBoss(this.plan.name, 1);
  }

  // 援軍：Boss 活著的時候，每隔幾秒從後面跑出一批小兵（難度越高越多）
  reinforce(dt, crowd) {
    const r = this.plan.reinforce;
    if (!r || this.state === 'idle') return;
    this.reinforceTimer -= dt;
    if (this.reinforceTimer > 0) return;
    this.reinforceTimer = r.every;
    const count = Math.round(r.count * (this.game.difficulty.enemyCountMult ?? 1));
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * 1.3;
      this.game.spawnEnemy(r.enemies[i % r.enemies.length], x, -this.position.z + 4 + (i % 2), true);
    }
    this.game.fx.burst(this.position.x, 1, this.position.z - 3, 24, '#b48cff', 4);
  }

  updateBar() { this.game.hud.showBoss(this.plan.name, Math.max(0, this.hp / this.maxHp)); }

  update(dt, crowd) {
    // 會飛的 Boss（紅火龍）：平常在空中，放完招喘氣（recover）時才落地，這時近戰砍得到
    if (this.def.fly && this.alive) {
      const target = this.state === 'recover' ? 0 : this.def.fly.height;
      this.position.y += (target - this.position.y) * Math.min(1, dt * 3);
      if (this.state === 'chase' || this.state === 'windup') this.play('Fly');
    }
    if (this.stun > 0 && this.alive) { super.update(dt, crowd); return; }
    if (this.alive && crowd.alive) this.reinforce(dt, crowd);
    if (this.alive && crowd.alive && this.state === 'chase') {
      this.skillTimer -= dt;
      if (this.skillTimer <= 0) { this.startSkill(crowd); return; }
    }
    super.update(dt, crowd);
  }

  startSkill(crowd) {
    const skills = this.plan.skills;
    this.skill = skills[this.skillIndex++ % skills.length];
    this.state = 'windup';
    this.timer = 0;
    if (!this.def.fly) this.play(this.skill.type === 'summon' ? 'Wave' : 'Idle');
    if (this.skill.type === 'volley') { // 一排直線：每一道先畫預警線
      const n = this.skill.count, gap = this.skill.gap ?? 1.6;
      const back = -crowd.d + crowd.depth + 2;
      this.aimXs = Array.from({ length: n }, (_, i) => THREE.MathUtils.clamp(crowd.x + (i - (n - 1) / 2) * gap, -this.game.track.halfWidth + 0.5, this.game.track.halfWidth - 0.5));
      this.lanes = this.aimXs.map((x) => warnLane(this.game, x, this.position.z + 1, back, (this.skill.shot.width ?? 0.4) * 2 + 0.5));
    }
    if (this.skill.type === 'slam') { // 預警圈畫在隊伍中間
      const c = crowd.center;
      this.warn = new THREE.Mesh(WARN, new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.2, depthWrite: false }));
      this.warn.position.set(c.x, 0.06, c.z);
      this.warn.scale.setScalar(this.skill.radius);
      this.game.scene.add(this.warn);
    }
  }

  update_windup(dt, crowd) {
    const { skill } = this;
    if (this.warn) {
      const c = crowd.center;
      this.warn.position.x += (c.x - this.warn.position.x) * Math.min(1, dt * 1.5); // 慢慢跟著隊伍，躲得掉但要快
      this.warn.material.opacity = 0.2 + 0.4 * Math.min(1, this.timer / skill.windup);
    }
    const { fx, sfx } = this.game;
    for (const m of this.lanes ?? []) m.material.opacity = 0.2 + 0.4 * Math.min(1, this.timer / skill.windup);
    if (this.timer < skill.windup) return;
    if (skill.type === 'volley') {
      this.clearWarn();
      this.play('Attack', { once: true, fade: 0.06 });
      for (const x of this.aimXs) this.game.enemyShots.lane(x, this.position.z + 1, skill.shot);
      sfx.swing();
    } else if (skill.type === 'rain') { // 往隊伍附近丟一串（紅圈），第一顆一定對準
      this.play('Attack', { once: true, fade: 0.06 });
      const lead = this.game.settings.runSpeed * skill.shot.flight * 0.6;
      const half = this.game.track.halfWidth - 0.8;
      for (let i = 0; i < skill.count; i++) {
        const x = i === 0 ? crowd.x : THREE.MathUtils.clamp(crowd.x + (Math.random() - 0.5) * skill.scatter * 2, -half, half);
        const z = crowd.center.z - lead - (i === 0 ? 0 : (Math.random() - 0.3) * skill.scatter);
        this.game.enemyShots.lob(this, { x, z }, skill.shot, i * (skill.gap ?? 0.25));
      }
    }
    if (skill.type === 'slam') {
      const { x, z } = this.warn.position;
      this.clearWarn();
      this.play('Attack', { once: true, fade: 0.06 });
      fx.blastRing(x, z, skill.radius, '#ff5a3c');
      fx.burst(x, 0.4, z, 30, '#ff5a3c', 5);
      fx.shake(0.5);
      sfx.blast();
      const c = crowd.center;
      // 打到的人數：隊伍有多少在圈裡（用中心距離估），躲開就打不到
      const off = Math.hypot(c.x - x, c.z - z);
      const inside = Math.max(0, 1 - off / (skill.radius + crowd.radius));
      if (inside > 0) this.game.hurtCrowd(skill.damage * inside);
    } else if (skill.type === 'summon') {
      const count = Math.round(skill.count * (this.game.difficulty.enemyCountMult ?? 1));
      for (let i = 0; i < count; i++) {
        const x = this.position.x + (i - (count - 1) / 2) * 1.4;
        this.game.spawnEnemy(skill.enemy, x, -this.position.z + 2, true);
      }
      fx.burst(this.position.x, 1, this.position.z, 30, '#b48cff', 4);
    }
    this.state = 'recover';
    this.timer = 0;
  }

  update_recover() {
    if (this.timer < (this.skill.recover ?? 1)) return;
    this.skillTimer = this.plan.skillEvery;
    this.state = 'chase';
  }

  clearWarn() {
    for (const m of this.lanes ?? []) { this.game.scene.remove(m); m.material.dispose(); }
    this.lanes = null;
    if (!this.warn) return;
    this.game.scene.remove(this.warn);
    this.warn.material.dispose();
    this.warn = null;
  }

  takeHit(amount, soft) {
    const hit = super.takeHit(amount, soft);
    if (!this.alive) this.clearWarn();
    return hit;
  }

  destroy() {
    this.clearWarn();
    super.destroy();
  }
}
