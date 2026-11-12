// 對手武將（大亂鬥關卡，2026-11-11）：把「玩家可以選的武將」當成敵人上場，照他原本的攻擊方式打玩家。
// 資料直接用 characters.json 裡那位武將的設定（main.js 的 rivalDef() 轉成敵人用的數值）：
//   沒寫 attack＝扇形橫掃（attackRange、attackArcDegrees）；attack.type dash 突刺衝鋒、spin 旋風斬、smash 重砸；有 shot＝遠程
//   skill.type shockwave＝震退（把玩家彈開，不扣血）、stealth＝隱身一下子，下一擊多扣 1
// 每一招出手前都有預警（紅色扇形、圓、長條），和其他敵人一樣。頭上用愛心顯示血量。
// 被打到會往後退，血越少退越遠；在沙場上被打出邊緣就掉下去（brawl.js 處理）。
import * as THREE from 'three';
import { Enemy, fanDirections } from './enemy.js';

const WINDUP = { fan: 0.6, spin: 0.75, smash: 0.85, dash: 0.75, shot: 0.8 };
const HEART_FULL = '#ff5c7a', HEART_EMPTY = '#4a3040';
const FALL_GRAVITY = 22;
const ACTING = ['windup', 'lunge', 'shock'];   // 正在出招：這時候打他會扣血，但打不斷（霸體），要躲開或跳起來

// 一顆愛心（畫在 canvas 上）
function heart(g, x, y, s, color) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y + s * 0.3);
  g.bezierCurveTo(x, y - s * 0.3, x - s, y - s * 0.3, x - s, y + s * 0.3);
  g.bezierCurveTo(x - s, y + s * 0.85, x, y + s * 1.15, x, y + s * 1.5);
  g.bezierCurveTo(x, y + s * 1.15, x + s, y + s * 0.85, x + s, y + s * 0.3);
  g.bezierCurveTo(x + s, y - s * 0.3, x, y - s * 0.3, x, y + s * 0.3);
  g.fill();
}

export class Rival extends Enemy {
  constructor(game, def, instance, x, z) {
    super(game, def, instance, x, z);
    this.style = def.shot ? 'shot' : def.attack?.type ?? 'fan';
    this.skillTimer = def.skill ? def.skill.cooldown * (0.35 + Math.random() * 0.3) : Infinity;
    this.hiddenTime = 0;
    this.ambush = 0;
  }

  get clip() { const c = this.def.attack?.clip; return c && this.clips.has(c) ? c : 'Attack'; }
  get speed() { return this.def.moveSpeed * (this.hiddenTime > 0 ? 1.35 : 1); }
  get canBeHit() { return super.canBeHit && this.state !== 'fall'; }

  // ---------- 頭上的名字＋愛心 ----------
  makeHealthBar() {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 96;
    this.tagCanvas = canvas;
    this.tagTexture = new THREE.CanvasTexture(canvas);
    this.tagTexture.colorSpace = THREE.SRGBColorSpace;
    this.tagMaterial = new THREE.SpriteMaterial({ map: this.tagTexture, transparent: true, depthTest: false, depthWrite: false });
    this.bar = new THREE.Sprite(this.tagMaterial);
    this.bar.scale.set(3.1, 1.16, 1);
    this.bar.position.y = 1.9 * this.def.scale + 0.9;
    this.bar.renderOrder = 16;
    this.root.add(this.bar);
    this.updateHealthBar();
  }

  updateHealthBar() {
    if (!this.tagCanvas) return;
    const g = this.tagCanvas.getContext('2d');
    g.clearRect(0, 0, 256, 96);
    g.font = '900 34px "Microsoft JhengHei","Noto Sans TC",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = 'rgba(20,10,5,.9)';
    g.strokeText(this.def.name, 128, 24);
    g.fillStyle = '#fff3d6';
    g.fillText(this.def.name, 128, 24);
    const n = this.def.hp, size = Math.min(13, 100 / n), gap = size * 2.35, x0 = 128 - ((n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
      heart(g, x0 + i * gap, 52, size + 2.5, 'rgba(20,10,5,.9)');
      heart(g, x0 + i * gap, 54, size, i < this.hp ? HEART_FULL : HEART_EMPTY);
    }
    this.tagTexture.needsUpdate = true;
    this.bar.visible = this.hp > 0;
  }

  // ---------- 行動 ----------
  update(dt, player) {
    if (this.hiddenTime > 0) {
      this.hiddenTime -= dt;
      if (this.hiddenTime <= 0 || !this.alive) this.reveal();
    }
    if (this.alive && this.state === 'chase') this.skillTimer -= dt;
    super.update(dt, player);
  }

  reveal() {
    this.hiddenTime = 0;
    this.setOpacity(1);
  }

  update_chase(dt, player) {
    if (player.state === 'dead') { this.play('Wave'); return; }
    if (player.hidden || player.fallOut) { this.wander(dt); return; }
    const dx = player.position.x - this.position.x, dz = player.position.z - this.position.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    this.faceToward(dx, dz, dt, 8);
    if (this.skillTimer <= 0 && this.trySkill(dist)) return;
    const { def, style } = this;
    // 多遠會出手：各種打法不一樣
    const reach = style === 'shot' ? def.shot.range * 0.8
      : style === 'dash' ? def.attack.distance * 0.85
      : style === 'spin' ? def.attack.radius * 0.8
      : style === 'smash' ? def.attack.ahead + def.attack.radius * 0.6
      : def.attackRange * 0.8;
    // 一次只有一位出手（其他人等他打完），不然三位同時打躲不掉
    const busy = this.game.enemies.some((e) => e !== this && e.alive && ACTING.includes(e.state));
    if (dist <= reach && this.cooldown <= 0 && !busy) { this.startWindup(dx / dist, dz / dist); return; }
    // 遠程：保持距離；近戰：走過去（冷卻中就在旁邊繞）
    let dir = 1;
    if (style === 'shot') dir = dist > reach ? 1 : dist < def.shot.range * 0.4 ? -0.7 : 0;
    else if (dist <= reach * 0.7) dir = 0;
    if (!dir) { this.play('Idle'); return; }
    let mx = dx / dist, mz = dz / dist;
    if (style !== 'shot' && dist > 3) {   // 從兩側包夾，不要排成一直線
      const a = 0.5 * this.flankSign * Math.min(1, (dist - 3) / 4);
      [mx, mz] = [mx * Math.cos(a) - mz * Math.sin(a), mx * Math.sin(a) + mz * Math.cos(a)];
    }
    this.position.x += mx * this.speed * dir * dt;
    this.position.z += mz * this.speed * dir * dt;
    this.play(this.clips.has('Run') ? 'Run' : 'Walk', { speed: (this.speed / 4.2) * Math.abs(dir) });
  }

  // 蓄力：畫出預警，時間到才出手
  startWindup(dirX, dirZ) {
    const { def, style } = this;
    this.aimX = dirX; this.aimZ = dirZ;
    this.faceToward(dirX, dirZ, Infinity);
    const { x, z } = this.position;
    if (style === 'fan') this.warnFan(def.attackRange, THREE.MathUtils.degToRad(def.attackArcDegrees));
    else if (style === 'spin') this.warnCircle(x, z, def.attack.radius).userData.follow = true;
    else if (style === 'smash') this.warnCircle(x + dirX * def.attack.ahead, z + dirZ * def.attack.ahead, def.attack.radius);
    else if (style === 'dash') this.warnLine(def.attack.distance + 0.8, def.attack.width + 0.3, dirX, dirZ);
    else {
      this.aimDirs = fanDirections(dirX, dirZ, 1, 0);
      for (const [ax, az] of this.aimDirs) this.warnLine(def.shot.range, def.shot.width * 2 + 0.4, ax, az);
    }
    this.windup = WINDUP[style];
    this.setState('windup');
    this.play('Idle');
  }

  // 扇形預警（腳下一片扇形，中線對著出手方向）
  warnFan(range, arc) {
    const geometry = new THREE.RingGeometry(0.3, range, 24, 1, Math.PI / 2 - arc / 2, arc).rotateX(-Math.PI / 2);
    const mesh = this.warnMesh(geometry);
    mesh.position.set(this.position.x, 0.07 + this.floorY, this.position.z);
    mesh.rotation.y = Math.atan2(this.aimX, this.aimZ);
    mesh.userData.ownGeometry = true;
    mesh.userData.danger = { x: this.position.x + this.aimX * range * 0.5, z: this.position.z + this.aimZ * range * 0.5, r: range * 0.6 };
  }

  clearWarnings() {
    for (const mesh of this.warnings) if (mesh.userData.ownGeometry) mesh.geometry.dispose();
    super.clearWarnings();
  }

  update_windup(dt) {
    this.glowWarnings(this.timer / this.windup);
    if (this.timer < this.windup) return;
    this.clearWarnings();
    this.cooldown = this.def.attackCooldown * (0.8 + Math.random() * 0.4);
    this.strike();
  }

  // 打到玩家：扣血，並把他往外推（沒扣到血＝無敵中，就不推）
  hitPlayer(player, fromX, fromZ, damage, push) {
    if (player.fallOut || Math.abs(player.position.y - this.floorY) > 1.2) return false;   // 跳起來就躲掉
    const before = player.hp;
    player.takeDamage(damage + this.ambush);
    this.ambush = 0;
    if (player.hp >= before) return false;
    player.pushFrom(fromX, fromZ, push);
    return true;
  }

  strike() {
    const { def, style, game } = this;
    const { player, fx } = game;
    const { x, z } = this.position;
    const px = player.position.x - x, pz = player.position.z - z, dist = Math.hypot(px, pz) || 0.001;
    this.reveal();
    this.play(this.clip, { once: true, fade: 0.06, speed: 1.3 });
    game.sfx.swing();
    if (style === 'fan') {
      const arc = THREE.MathUtils.degToRad(def.attackArcDegrees), yaw = Math.atan2(this.aimX, this.aimZ);
      fx.slashAt(this.position, yaw, arc, def.attackRange);
      const inArc = (px * this.aimX + pz * this.aimZ) / dist >= Math.cos(arc / 2) || dist < 0.7;
      if (dist <= def.attackRange + player.radius && inArc) this.hitPlayer(player, x, z, 1, 9);
    } else if (style === 'spin') {
      fx.slashAt(this.position, this.root.rotation.y, Math.PI * 2, def.attack.radius);
      game.modelFx.spawn('旋風暴風', 0, 0, { follow: this, size: def.attack.radius * 1.7, life: 0.6, spin: 2.2, grow: [0.6, 1.05], fadeOut: 0.3 });
      if (dist <= def.attack.radius + player.radius) this.hitPlayer(player, x, z, 1, 11);
    } else if (style === 'smash') {
      const cx = x + this.aimX * def.attack.ahead, cz = z + this.aimZ * def.attack.ahead;
      fx.blastRing(cx, cz, def.attack.radius, def.attack.color ?? '#ffcf7a');
      game.modelFx.spawn('地裂岩石', cx, cz, { size: def.attack.radius * 1.9, life: 0.9, grow: [0.45, 1], fadeOut: 0.45 });
      fx.dust(cx, 0.3, cz, 22);
      fx.shake(0.3);
      game.sfx.blast();
      if (Math.hypot(player.position.x - cx, player.position.z - cz) <= def.attack.radius + player.radius) this.hitPlayer(player, cx, cz, 1, 14);
    } else if (style === 'dash') {
      this.dashLeft = def.attack.distance;
      this.dashHit = false;
      fx.slashAt(this.position, Math.atan2(this.aimX, this.aimZ), 0.35, def.attack.distance + 0.8);
      this.setState('lunge');
      return;
    } else {
      const s = def.shot;
      const spec = { model: s.model, modelScale: s.modelScale, modelRotation: s.modelRotation, modelGlow: s.modelGlow, color: s.color, size: (s.width ?? 0.3) * 0.9,
        speed: Math.min(s.speed, 15), range: s.range, width: s.width ?? 0.3, damage: 1, height: s.muzzle?.height ?? 1, trail: !s.model, push: 7 };
      for (const [ax, az] of this.aimDirs) game.enemyShots.fire(x, z, ax, az, spec);
    }
    this.setState('recover');
  }

  // 突刺衝鋒：沿著預警線衝過去，撞到玩家算一下
  update_lunge(dt, player) {
    const step = Math.min(this.dashLeft, 18 * dt);
    this.position.x += this.aimX * step;
    this.position.z += this.aimZ * step;
    this.dashLeft -= step;
    this.game.fx.dust(this.position.x, 0.2, this.position.z, 1);
    const d = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
    if (!this.dashHit && d <= this.def.attack.width / 2 + player.radius + 0.2) {
      this.dashHit = this.hitPlayer(player, this.position.x - this.aimX, this.position.z - this.aimZ, 1, 13) || this.dashHit;
    }
    if (this.dashLeft <= 0.001) this.setState('recover');
  }

  update_recover() {
    if (this.timer >= 0.55) this.setState('chase');
  }

  // ---------- 招式（商店賣給玩家的那個技能，對手直接會用）----------
  trySkill(dist) {
    const { skill } = this.def;
    if (!skill) { this.skillTimer = Infinity; return false; }   // 沒有技能的武將（祝融、王元姬、賈充）
    if (skill.type === 'shockwave') {
      if (dist > skill.radius * 0.8) return false;
      this.skillTimer = skill.cooldown;
      this.warnCircle(this.position.x, this.position.z, skill.radius, new THREE.Color(skill.color ?? '#fbbf24').getHex()).userData.follow = true;
      this.setState('shock');
      this.play('Idle');
      return true;
    }
    if (skill.type === 'stealth') {
      this.skillTimer = skill.cooldown;
      this.hiddenTime = Math.min(skill.duration, 3.5);
      this.ambush = 1;
      this.setOpacity(0.3);
      this.game.fx.dust(this.position.x, 0.5, this.position.z, 12);
      this.game.modelFx.spawn('戰場煙霧', this.position.x, this.position.z, { size: 3, life: 1.2, grow: [0.5, 1.2], rise: 0.3, fadeOut: 0.6 });
      this.game.sfx.wave();
      return false;   // 隱身後照常行動
    }
    this.skillTimer = Infinity;
    return false;
  }

  update_shock(dt, player) {
    this.glowWarnings(this.timer / 0.9);
    if (this.timer < 0.9) return;
    this.clearWarnings();
    const { skill } = this.def, { fx, sfx } = this.game, { x, z } = this.position;
    fx.blastRing(x, z, skill.radius, skill.color ?? '#fbbf24');
    fx.burst(x, 0.6, z, 36, skill.color ?? '#fbbf24', 7);
    fx.shake(0.45);
    sfx.blast();
    this.play(this.clip, { once: true, fade: 0.06 });
    const d = Math.hypot(player.position.x - x, player.position.z - z);
    if (d <= skill.radius + player.radius && !player.fallOut && Math.abs(player.position.y - this.floorY) < 1.2 && player.invulnerable <= 0) {
      player.pushFrom(x, z, 17);   // 只推開，不扣血
      this.game.sfx.hurt();
    }
    this.setState('recover');
  }

  // ---------- 受傷 ----------
  // 被打到往後退：血越少退得越遠（才推得下沙場）
  takeHit(amount, fromX, fromZ, force = false, soft = false) {
    const was = this.state;
    if (ACTING.includes(was) && this.hp - amount > 0) {   // 出招中：只扣血、不會被打斷
      if (!this.alive || (!force && !this.canBeHit)) return false;
      this.hp -= amount;
      this.updateHealthBar();
      this.flash(0xffffff);
      return true;
    }
    const hit = super.takeHit(amount, fromX, fromZ, force, soft);
    if (hit && this.alive && this.state === 'stunned' && was !== 'stunned') this.reveal();
    if (hit && this.alive && this.state === 'stunned') this.cooldown = Math.min(this.cooldown, 0.35);   // 被打之後很快還手，不會一直被壓著打
    if (hit && !soft && (this.state === 'stunned' || this.state === 'dying')) {
      const boost = 1.5 + 1.7 * (1 - Math.max(0, this.hp) / this.def.hp);
      this.knockX *= boost; this.knockZ *= boost;
    }
    return hit;
  }

  // 掉出沙場（brawl.js 叫的）：往下掉，掉到底就算被擊敗
  startFall() {
    this.clearWarnings();
    this.reveal();
    this.vy = 2;
    this.setState('fall');
    this.play('Hit', { once: true, fade: 0.05 });
    if (this.bar) this.bar.visible = false;
  }

  update_fall(dt) {
    this.vy -= FALL_GRAVITY * dt;
    this.position.y += this.vy * dt;
    this.position.x += this.knockX * dt;
    this.position.z += this.knockZ * dt;
    this.root.rotation.x += dt * 4;
    if (this.position.y > -7) return;
    this.hp = 0;
    this.removed = true;
  }

  update_stunned(dt) {
    super.update_stunned(dt);
    for (const w of this.warnings) if (w.userData.follow) w.position.set(this.position.x, w.position.y, this.position.z);
  }
}
