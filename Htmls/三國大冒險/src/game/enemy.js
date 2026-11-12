// 敵人：從地底爬出 → 追玩家 → 攻擊；被打到生命歸零就倒下並消失。血條在受傷後顯示。
// 同一份類別服務所有敵人，差異都在 data/characters.json。
// 特殊能力（都寫在 characters.json，全部有預警）：
//   ability.type shoot 直線射擊（瞄準線）、lob 拋物線投擲（落點紅圈）、charge 直線衝撞（預警線）、blink 瞬移到玩家背後（落點紫圈）
//   fly 飛行（近戰打不到，俯衝落地後才砍得到）、trail 走過的地方留下毒池、flank 從側面包抄、split 倒下時分裂（在 main.js）
import * as THREE from 'three';
import { Actor } from './actor.js';

const RISE_TIME = 0.9;
const RISE_DEPTH = 1.9;
const STUN_TIME = 0.42;
const KNOCKBACK_SPEED = 6;
const DEATH_HOLD = 1.0;
const DEATH_FADE = 0.55;
const FLAME_EVERY = 0.05;
const BAR_WIDTH = 1.15;
const BAR_HEIGHT = 0.12;
const BAR_OFFSET = 0.45; // 頭頂上方
const BAR_MIN_HP = 3;    // 打兩下就倒的小怪不需要血條
const WANDER_TIME = 1;
const WANDER_SPEED = 0.5;
const WARNING_COLOR = 0xff3b2f;
const BLINK_COLOR = 0xb07cff;
const WARNING_HEIGHT = 0.07;
const BACK_SPEED = 0.75;      // 遠程敵人後退的速度比例
const BLOCKED_RATIO = 0.3;
const DASH_HIT_MARGIN = 0.2;
const FLY_ARRIVE = 1.2;       // 飛行敵人從空中降到盤旋高度的秒數
const AIRBORNE_AT = 1.2;      // 高於這個高度算在空中（近戰打不到）
const CLIMB_SPEED = 2.4;
const DIVE_TIME = 0.4;

const circleGeometry = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
const lineGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });

// 射擊方向：第一發對準，其他往兩側散開
function fanDirections(dirX, dirZ, count = 1, spreadDeg = 0) {
  const base = Math.atan2(dirX, dirZ);
  const spread = THREE.MathUtils.degToRad(spreadDeg);
  return Array.from({ length: count }, (_, i) => {
    const a = base + (i - (count - 1) / 2) * spread;
    return [Math.sin(a), Math.cos(a)];
  });
}
export { fanDirections };

export class Enemy extends Actor {
  constructor(game, def, instance, x, z) {
    super(game, def, instance);
    this.state = 'rising';
    this.timer = 0;
    this.cooldown = def.attackCooldown * Math.random() * 0.5;
    this.attackConnected = false;
    this.knockX = 0;
    this.knockZ = 0;
    this.removed = false;
    this.warnings = [];
    this.abilityTimer = (def.ability?.cooldown ?? 0) * (0.4 + Math.random() * 0.4);
    this.trailTimer = def.trail?.every ?? 0;
    this.flankSign = Math.random() < 0.5 ? -1 : 1;
    if (def.hp >= BAR_MIN_HP) this.makeHealthBar();
    if (def.fly) {
      // 從空中飛進來，不是從地底爬出
      this.position.set(x, def.fly.height + 4, z);
      this.state = 'arrive';
      this.play('Fly');
      this.shadow = new THREE.Mesh(circleGeometry, shadowMaterial);
      this.shadow.scale.setScalar(def.radius * 1.4);
      game.scene.add(this.shadow);
      return;
    }
    this.position.set(x, -RISE_DEPTH, z);
    this.play('Idle');
    game.fx.dust(x, 0.1, z, 16);
  }

  get ability() { return this.def.ability; }
  // 在空中：近戰（揮砍、震退）、陷阱都打不到，只有箭和火球打得到
  get airborne() { return this.position.y - this.floorY > AIRBORNE_AT; }
  // 腳下的地面高度（攻城關卡的城牆頂是牆高，其他都是 0）
  get floorY() { return this.game.groundY(this.position.x, this.position.z); }
  // 和對方在同一層（一個在城牆頂、一個在地面就打不到彼此）
  sameLevel(other) { return Math.abs(other.position.y - this.position.y) < 1.2; }

  // 受傷後才顯示。Sprite 永遠面向鏡頭，錨點調到左端，血量減少時才會往左縮
  makeHealthBar() {
    const { fx } = this.game;
    const y = 1.9 * this.def.scale + BAR_OFFSET;
    this.bar = new THREE.Group();
    const back = new THREE.Sprite(fx.barMaterials.back);
    back.scale.set(BAR_WIDTH + 0.06, BAR_HEIGHT + 0.06, 1);
    this.barFill = new THREE.Sprite(fx.barMaterials.fill);
    back.renderOrder = 14;
    this.barFill.renderOrder = 15;
    this.bar.add(back, this.barFill);
    this.bar.position.y = y;
    this.bar.visible = false;
    this.root.add(this.bar);
  }

  updateHealthBar() {
    if (!this.bar) return;
    const ratio = Math.max(0, this.hp / this.def.hp);
    this.bar.visible = this.hp > 0 && ratio < 1;
    if (ratio <= 0) return;
    this.barFill.scale.set(BAR_WIDTH * ratio, BAR_HEIGHT, 1);
    this.barFill.center.set(0.5 / ratio, 0.5);
  }

  get speed() { return this.def.moveSpeed; }
  get alive() { return this.hp > 0; }
  get canBeHit() { return this.alive && !this.vanished && this.state !== 'arrive' && (this.state !== 'rising' || this.timer > RISE_TIME * 0.5); }

  update(dt, player) {
    this.updateBurn(dt);
    this.timer += dt;
    this.cooldown -= dt;
    this.abilityTimer -= dt;
    if (!this.alive && this.warnings.length) this.clearWarnings();
    this.runState(dt, player);
    if (this.def.trail && this.alive && this.state !== 'rising') this.updateTrail(dt);
    if (this.shadow) {
      this.shadow.position.set(this.position.x, WARNING_HEIGHT, this.position.z);
      this.shadow.visible = this.alive;
    }
  }

  runState(dt, player) {
    this[`update_${this.state}`](dt, player);
  }

  // ---------- 預警（Boss 也用） ----------
  warnMesh(geometry, color = WARNING_COLOR) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    this.game.scene.add(mesh);
    this.warnings.push(mesh);
    return mesh;
  }

  warnCircle(x, z, radius, color) {
    const mesh = this.warnMesh(circleGeometry, color);
    mesh.position.set(x, WARNING_HEIGHT + this.game.groundY(x, z), z);
    mesh.scale.set(radius, 1, radius);
    mesh.userData.danger = { x, z, r: radius };
    return mesh;
  }

  // 從自己腳下往 (dirX, dirZ) 方向的長條
  warnLine(length, width, dirX = this.chargeX, dirZ = this.chargeZ) {
    const mesh = this.warnMesh(lineGeometry);
    const { x, z } = this.position;
    mesh.position.set(x + dirX * length / 2, WARNING_HEIGHT + this.floorY, z + dirZ * length / 2);
    mesh.rotation.y = Math.atan2(dirX, dirZ);
    mesh.scale.set(width, 1, length);
    mesh.userData.danger = { line: { x, z, dx: dirX, dz: dirZ }, width: width / 2 };
    return mesh;
  }

  clearWarnings() {
    for (const mesh of this.warnings) {
      this.game.scene.remove(mesh);
      mesh.material.dispose();
    }
    this.warnings = [];
  }

  // 預警越接近出手越亮
  glowWarnings(progress) {
    for (const mesh of this.warnings) mesh.material.opacity = 0.18 + 0.42 * Math.min(1, progress);
  }

  dangers() { return this.warnings.map((w) => w.userData.danger).filter(Boolean); }

  update_rising(dt, player) {
    const p = Math.min(1, this.timer / RISE_TIME);
    this.position.y = -RISE_DEPTH * (1 - p) ** 2;
    this.faceToward(player.position.x - this.position.x, player.position.z - this.position.z, dt, 5);
    if (p >= 1) this.setState('chase');
  }

  // 玩家隱身時找不到人，慢慢亂走
  wander(dt) {
    this.wanderTime = (this.wanderTime ?? 0) - dt;
    if (this.wanderTime <= 0) {
      this.wanderTime = WANDER_TIME * (1 + Math.random());
      this.wanderAngle = Math.random() * Math.PI * 2;
    }
    const x = Math.sin(this.wanderAngle), z = Math.cos(this.wanderAngle);
    const speed = this.speed * WANDER_SPEED;
    this.position.x += x * speed * dt;
    this.position.z += z * speed * dt;
    this.faceToward(x, z, dt, 6);
    this.play('Walk', { speed: speed / 2.2 });
  }

  update_chase(dt, player) {
    if (player.state === 'dead') { this.play('Wave'); return; } // 打贏了開心揮手
    if (player.hidden) { this.wander(dt); return; }
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (this.def.fly) { this.updateAir(dt, player, dx, dz, dist); return; }
    const same = this.sameLevel(player);
    // 攻城關卡的守軍：玩家靠近（sleep 公尺內、同一層）才開始行動，之前站崗
    if (this.sleep) {
      if (dist > this.sleep || (!same && !this.def.stationary)) { this.play('Idle'); return; }
      this.sleep = 0;
    }
    this.faceToward(dx, dz, dt, 8);
    if (same && dist <= this.def.attackRange) {
      if (this.cooldown <= 0) { this.startAttack(); return; }
      this.play('Idle');
      return;
    }
    // 不在同一層（玩家在城牆下、自己在牆頂）：近戰兵不追，站在原地等
    if (!same && !this.def.stationary) { this.play('Idle'); return; }
    if (this.ability && this.abilityTimer <= 0 && this.tryAbility(player, dx, dz, dist)) return;
    if (this.def.stationary) { this.play('Idle'); return; }   // 城牆上的弓兵、投石兵：守在原地，只會射擊／投擲
    if (this.ability?.keep) { this.keepDistance(dt, dx, dz, dist); return; }
    let mx = dx / dist, mz = dz / dist;
    const around = this.game.level.steer?.(this.position, player.position);   // 營寨擋在中間就繞過去
    if (around) [mx, mz] = around;
    else if (this.def.flank && dist > 2.5) {
      // 包抄：離越遠繞得越開，靠近後才直衝
      const a = THREE.MathUtils.degToRad(this.def.flank) * this.flankSign * Math.min(1, (dist - 2.5) / 4);
      [mx, mz] = [mx * Math.cos(a) - mz * Math.sin(a), mx * Math.sin(a) + mz * Math.cos(a)];
    }
    this.position.x += mx * this.speed * dt;
    this.position.z += mz * this.speed * dt;
    this.play('Walk', { speed: this.speed / 2.2 });
  }

  // 遠程敵人：太遠就靠近，太近就後退，中間站著
  keepDistance(dt, dx, dz, dist) {
    const { keep, range } = this.ability;
    this.faceToward(dx, dz, dt, 8);
    let dir = 0;
    if (dist > range * 0.9) dir = 1;
    else if (dist < keep) dir = -BACK_SPEED;
    if (!dir) { this.play('Idle'); return; }
    let mx = dx / dist, mz = dz / dist;
    const around = dir > 0 && this.game.level.steer?.(this.position, this.game.player.position);   // 往前靠時營寨擋路就繞
    if (around) [mx, mz] = around;
    this.position.x += mx * this.speed * dir * dt;
    this.position.z += mz * this.speed * dir * dt;
    this.play('Walk', { speed: (this.speed / 2.2) * Math.abs(dir) });
  }

  // ---------- 特殊能力 ----------
  tryAbility(player, dx, dz, dist) {
    const a = this.ability;
    if (dist > a.range || (a.min && dist < a.min)) return false;
    const dirX = dx / dist, dirZ = dz / dist;
    this.faceToward(dx, dz, Infinity);
    if (a.type === 'blink') return this.startBlink(player);
    if (!this.def.fly) this.play('Idle');
    if (a.type === 'shoot') {
      this.aimDirs = fanDirections(dirX, dirZ, a.shot.count, a.shot.spread);
      for (const [x, z] of this.aimDirs) this.warnLine(a.shot.range, a.shot.width * 2 + 0.4, x, z);
    } else if (a.type === 'lob') {
      this.game.enemyShots.lob(this, player.position, a.shot, a.windup);
    } else if (a.type === 'charge') {
      this.chargeX = dirX; this.chargeZ = dirZ;
      this.warnLine(a.distance, a.width);
    }
    this.setState('aim');
    return true;
  }

  update_aim(dt, player) {
    const a = this.ability;
    this.glowWarnings(this.timer / a.windup);
    if (a.type === 'lob') this.faceToward(player.position.x - this.position.x, player.position.z - this.position.z, dt, 6);
    if (this.timer < a.windup) return;
    this.clearWarnings();
    this.abilityTimer = a.cooldown;
    if (a.type === 'charge') {
      this.charged = 0;
      this.dashHit = false;
      this.lastDash = null;
      this.setState('dash');
      this.play(this.clips.has('Run') ? 'Run' : 'Walk', { speed: 2.2 });
      this.game.sfx.swing();
      return;
    }
    if (a.type === 'shoot') {
      for (const [x, z] of this.aimDirs) this.game.enemyShots.fire(this.position.x, this.position.z, x, z, a.shot);
      this.game.sfx.swing();
    }
    // 出手動作沿用普通攻擊，但不再算近戰傷害
    this.setState('attack');
    this.attackConnected = true;
    this.play('Attack', { once: true, fade: 0.08 });
  }

  update_dash(dt, player) {
    const a = this.ability;
    const moved = this.lastDash ? Math.hypot(this.position.x - this.lastDash.x, this.position.z - this.lastDash.z) : Infinity;
    if (dt > 0 && moved < this.lastStep * BLOCKED_RATIO) { this.endDash(); return; } // 撞到東西
    this.lastDash = this.position.clone();
    const step = a.speed * dt;
    this.lastStep = step;
    this.position.x += this.chargeX * step;
    this.position.z += this.chargeZ * step;
    this.charged += step;
    const dist = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
    if (!this.dashHit && dist <= this.radius + player.radius + DASH_HIT_MARGIN && this.sameLevel(player)) {
      this.dashHit = true;
      player.takeDamage(a.damage);
    }
    this.game.fx.dust(this.position.x, 0.2, this.position.z, 1);
    if (this.charged >= a.distance) this.endDash();
  }

  endDash() {
    this.lastDash = null;
    this.game.fx.dust(this.position.x, 0.4, this.position.z, 10);
    this.play('Idle');
    this.restTime = this.ability.recover ?? 0.8;
    this.setState('rest');
  }

  // 衝完喘一口氣：這時候最好打
  update_rest() {
    if (this.timer >= this.restTime) this.setState('chase');
  }

  // 黑貓：原地消失，玩家背後先出現紫圈，一下子後從那裡跳出來攻擊
  startBlink(player) {
    const a = this.ability;
    const yaw = player.root.rotation.y;
    const spot = new THREE.Vector3(player.position.x - Math.sin(yaw) * a.behind, 0, player.position.z - Math.cos(yaw) * a.behind);
    this.game.level.constrain(spot, this.radius);
    this.blinkTo = spot;
    this.warnCircle(spot.x, spot.z, 0.9, BLINK_COLOR);
    this.game.fx.burst(this.position.x, 0.8, this.position.z, 18, BLINK_COLOR, 3);
    this.game.sfx.swing();
    this.vanished = true;
    this.root.visible = false;
    this.setState('blink');
    return true;
  }

  update_blink(dt, player) {
    const a = this.ability;
    this.glowWarnings(this.timer / a.windup);
    if (this.timer < a.windup) return;
    this.clearWarnings();
    this.position.copy(this.blinkTo);
    this.root.visible = true;
    this.vanished = false;
    this.abilityTimer = a.cooldown;
    this.game.fx.burst(this.position.x, 0.8, this.position.z, 18, BLINK_COLOR, 3);
    this.faceToward(player.position.x - this.position.x, player.position.z - this.position.z, Infinity);
    this.cooldown = 0;
    this.startAttack();
  }

  // 蛇妖：每隔一段時間在腳下留一灘毒
  updateTrail(dt) {
    this.trailTimer -= dt;
    if (this.trailTimer > 0) return;
    this.trailTimer = this.def.trail.every;
    this.game.enemyShots.pool(this.position.x, this.position.z, this.def.trail.pool);
  }

  // ---------- 飛行 ----------
  update_arrive(dt, player) {
    const target = this.def.fly.height;
    this.position.y = Math.max(target, this.position.y - (4 / FLY_ARRIVE) * dt);
    this.faceToward(player.position.x - this.position.x, player.position.z - this.position.z, dt, 5);
    if (this.position.y <= target) this.setState('chase');
  }

  // 在玩家附近繞圈盤旋；時間到就俯衝（落點紅圈），落地後停一下才飛起來，這時近戰才打得到
  updateAir(dt, player, dx, dz, dist) {
    const fly = this.def.fly;
    if (this.position.y < fly.height) this.position.y = Math.min(fly.height, this.position.y + CLIMB_SPEED * dt);
    // 只在玩家後方（遠離鏡頭的北邊）左右來回盤旋，飛在鏡頭和玩家中間會把玩家擋住
    this.orbit = (this.orbit ?? Math.random() * Math.PI * 2) + dt * (fly.orbitSpeed ?? 0.5) * this.flankSign;
    const angle = -Math.PI / 2 + Math.sin(this.orbit) * 1.1;
    const tx = player.position.x + Math.cos(angle) * fly.hover, tz = player.position.z + Math.sin(angle) * fly.hover;
    const mx = tx - this.position.x, mz = tz - this.position.z;
    const md = Math.hypot(mx, mz);
    if (md > 0.3) {
      const step = Math.min(md, this.speed * dt);
      this.position.x += (mx / md) * step;
      this.position.z += (mz / md) * step;
    }
    this.faceToward(dx, dz, dt, 6);
    this.play('Fly');
    const ready = this.position.y >= fly.height - 0.1;
    if (this.ability && ready && this.abilityTimer <= 0 && dist <= this.ability.range) { this.tryAbility(player, dx, dz, dist); return; }
    this.swoopTimer = (this.swoopTimer ?? fly.swoop.cooldown * (0.5 + Math.random() * 0.5)) - dt;
    if (!ready || this.swoopTimer > 0 || dist > fly.hover + 4) return;
    // 俯衝
    this.diveTarget = { x: player.position.x, z: player.position.z };
    this.warnCircle(this.diveTarget.x, this.diveTarget.z, fly.swoop.radius);
    this.setState('swoopAim');
  }

  update_swoopAim(dt) {
    const s = this.def.fly.swoop;
    this.glowWarnings(this.timer / s.windup);
    this.position.y += dt * 0.8; // 先往上拉，看得出要衝下來
    this.faceToward(this.diveTarget.x - this.position.x, this.diveTarget.z - this.position.z, dt, 8);
    if (this.timer < s.windup) return;
    this.diveFrom = this.position.clone();
    this.setState('dive');
    this.play('Attack', { once: true, fade: 0.05 });
    this.game.sfx.swing();
  }

  update_dive(dt, player) {
    const s = this.def.fly.swoop;
    const t = Math.min(1, this.timer / DIVE_TIME);
    const { diveFrom: f, diveTarget: g } = this;
    this.position.set(f.x + (g.x - f.x) * t, f.y * (1 - t) * (1 - t), f.z + (g.z - f.z) * t);
    if (t < 1) return;
    this.clearWarnings();
    const { fx } = this.game;
    fx.blastRing(g.x, g.z, s.radius, '#ff5a3c');
    fx.dust(g.x, 0.3, g.z, 20);
    fx.shake(0.35);
    this.game.sfx.blast();
    if (Math.hypot(player.position.x - g.x, player.position.z - g.z) <= s.radius + player.radius) player.takeDamage(s.damage);
    this.swoopTimer = s.cooldown;
    this.restTime = s.ground;
    this.play('Idle');
    this.setState('landed');
  }

  // 落地喘氣：這時候近戰砍得到
  update_landed(dt, player) {
    this.faceToward(player.position.x - this.position.x, player.position.z - this.position.z, dt, 4);
    if (this.timer >= this.restTime) this.setState('chase');
  }

  startAttack() {
    this.setState('attack');
    this.attackConnected = false;
    this.cooldown = this.def.attackCooldown;
    this.play('Attack', { once: true, fade: 0.08 });
  }

  update_attack(dt, player) {
    if (!this.attackConnected && this.timer >= this.def.attackHitTime) {
      this.attackConnected = true;
      const reach = this.def.attackRange + 0.3;
      const dist = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
      if (dist <= reach && this.sameLevel(player)) player.takeDamage(this.def.attackDamage);
    }
    if (this.timer >= this.clipLength('Attack')) this.setState('chase');
  }

  update_stunned(dt) {
    this.position.x += this.knockX * dt;
    this.position.z += this.knockZ * dt;
    this.knockX *= 0.88;
    this.knockZ *= 0.88;
    if (this.timer >= (this.shoveStun ?? this.def.stunTime ?? STUN_TIME)) { this.shoveStun = null; this.setState('chase'); }
  }

  // 震退：彈開並暈眩，不扣血。poise 的重型敵人推不動
  shove(fromX, fromZ, { knockback, stun }) {
    this.flash(0xffffff);
    if (this.def.poise || this.airborne || this.vanished) return;
    this.clearWarnings();
    const dx = this.position.x - fromX;
    const dz = this.position.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.position.y = this.floorY;
    this.knockX = (dx / len) * knockback;
    this.knockZ = (dz / len) * knockback;
    this.shoveStun = stun;
    this.setState('stunned');
    this.play('Hit', { once: true, fade: 0.05 });
  }

  update_dying(dt) {
    const floor = this.floorY;
    if (this.position.y > floor) this.position.y = Math.max(floor, this.position.y - 6 * dt); // 飛行的掉下來
    this.position.x += this.knockX * dt;
    this.position.z += this.knockZ * dt;
    this.knockX *= 0.9;
    this.knockZ *= 0.9;
    if (this.timer < DEATH_HOLD) return;
    const fade = (this.timer - DEATH_HOLD) / DEATH_FADE;
    this.setOpacity(Math.max(0, 1 - fade));
    if (fade >= 1) {
      this.game.fx.dust(this.position.x, 0.3, this.position.z, 14);
      this.removed = true;
    }
  }

  // 燃燒：再被點燃時時間重算，扣血節奏不重來，否則連續打中會永遠不扣血
  ignite(burn) {
    if (!this.alive) return;
    this.burn = { def: burn, remaining: burn.duration, tick: this.burn?.tick ?? burn.interval, spark: 0 };
    if (!this.burnSprite) {
      this.burnSprite = this.game.fx.makeFlameSprite();
      this.burnSprite.position.y = 0.95;
      this.root.add(this.burnSprite);
    }
  }

  extinguish() {
    this.burn = null;
    if (this.burnSprite) this.root.remove(this.burnSprite);
    this.burnSprite = null;
  }

  updateBurn(dt) {
    const { burn } = this;
    if (!burn) return;
    if (!this.alive) { this.extinguish(); return; }
    const { fx } = this.game;
    burn.remaining -= dt;
    burn.tick -= dt;
    burn.spark -= dt;
    if (burn.spark <= 0) {
      burn.spark = FLAME_EVERY;
      fx.flame(this.position.x, 0.25, this.position.z);
    }
    this.burnSprite.scale.setScalar(1.7 + Math.sin(this.game.level.time * 19 + this.position.x) * 0.2);
    if (burn.tick <= 0) {
      burn.tick += burn.def.interval;
      this.game.burnDamage(this, burn.def.damage);
    }
    if (this.burn && burn.remaining <= 0) this.extinguish();
  }

  setState(state) {
    this.state = state;
    this.timer = 0;
  }

  // soft：燃燒這類持續傷害，只扣血閃光，不擊退也不打斷動作
  takeHit(amount, fromX, fromZ, force = false, soft = false) {
    if (!this.alive || (!force && !this.canBeHit)) return false;
    this.hp -= amount;
    this.updateHealthBar();
    if (soft && this.hp > 0) { this.flash(0xff6a1f); return true; }
    if (this.def.poise && this.hp > 0) { this.flash(0xffffff); return true; } // 重型敵人：打不斷也推不動
    // 飛行、衝刺、瞬移中不會被打斷（否則一碰就取消，能力形同虛設）
    if (this.hp > 0 && (this.airborne || ['dash', 'blink', 'swoopAim', 'dive', 'arrive'].includes(this.state))) { this.flash(0xffffff); return true; }
    if (this.position.y < 0) this.position.y = 0;
    this.clearWarnings();
    const dx = this.position.x - fromX;
    const dz = this.position.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.knockX = (dx / len) * KNOCKBACK_SPEED;
    this.knockZ = (dz / len) * KNOCKBACK_SPEED;
    this.flash(0xffffff);
    if (this.hp <= 0) {
      this.setState('dying');
      this.play('Death', { once: true, fade: 0.08 });
      this.mount?.oneShot('Death');   // 騎兵：馬一起倒下（騎士跟著馬鞍往下）
    } else {
      this.setState('stunned');
      this.play('Hit', { once: true, fade: 0.05 });
    }
    return true;
  }

  destroy() {
    this.clearWarnings();
    if (this.shadow) this.game.scene.remove(this.shadow);
    super.destroy();
  }
}
