// 玩家：移動、攻擊、受傷。攻擊方式的差別都在 data/characters.json。
import * as THREE from 'three';
import { Actor } from './actor.js';
import { Horse, mountActor, dismountActor, ensureRideClips } from './mount.js';

const INVULNERABLE_TIME = 1.0;
const AUTO_AIM_RANGE = 4;
const LUNGE_SPEED = 3;
const LUNGE_TIME = 0.16;
const ATTACK_RECOVERY = 0.72; // 攻擊動作播到這個比例就能接下一招
const CLIMB_SPEED = 3.8;      // 爬梯子每秒幾公尺
const CLIMB_STEP = 0.28;      // 跨上牆頂的秒數
// 跳（關卡 JSON 寫 "jump": true 才能跳，2026-11-11 大亂鬥）：跳起來躲地面的攻擊；空中按攻擊＝落地重擊
const JUMP_SPEED = 8.6;       // 起跳速度，最高約 1.8 公尺
const JUMP_GRAVITY = 20;
const PLUNGE_SPEED = 17;      // 落地重擊往下衝的速度
const PLUNGE_REST = 0.32;     // 落地後停多久
const PUSH_FRICTION = 6;      // 被推開後每秒減速的比例
// 騎馬（關卡 JSON 寫 "ride"，2026-11-12 長坂坡突圍）：馬先站在 ride.at，走過去就騎上去；
// 騎馬時跑得快、攻擊打一整圈（RideAttack）、跑起來撞到小兵會把他撞開（踐踏）、受傷先扣馬的耐久，扣完被打下馬
const MOUNT_DISTANCE = 1.7;   // 離馬多近自動騎上去
const RIDE_RADIUS = 0.85;     // 騎馬時的碰撞半徑（馬比較長）
const TRAMPLE_SPEED = 5;      // 馬速超過這個才會踐踏
const TRAMPLE_AHEAD = 1.3;    // 踐踏的判定點在馬頭前面幾公尺
const TRAMPLE_EVERY = 0.7;    // 同一個敵人多久才會再被撞一次
const THROWN_INVULNERABLE = 1.6;
const LOOSE_RUN = 7;          // 被打下馬後馬跑開幾公尺
const SPOOKED = 3;            // 被打下馬後幾秒內馬受驚、騎不上去
const HORSE_REGEN = 3;        // 沒人騎的馬每幾秒回 1 點耐久
// 攻擊方式（characters.json 的 attack.type，2026-11-09）：
//   沒寫＝扇形（attackRange、attackArcDegrees）
//   dash  突刺衝鋒：出手時往前衝 distance 公尺，路上寬 width 的敵人全部打到，衝刺中不會受傷（長槍）
//   spin  旋風斬：以自己為中心一整圈，半徑 radius（大刀、雙手武器）
//   smash 重砸：前方 ahead 公尺處一個圓，半徑 radius，被砸到的小兵會被震暈 stun 秒
// attack.clip 指定播哪段動作（Thrust 突刺、Attack3 旋斬…，綁骨動作工坊匯出的攻擊動作組），模型沒有就播 Attack

export class Player extends Actor {
  constructor(game, def, instance) {
    super(game, def, instance);
    this.state = 'idle';
    this.attackTime = 0;
    this.attackConnected = false;
    this.invulnerable = 0;
    this.play('Idle');
  }

  // 商店買的愛心上限每個角色分開算
  get maxHp() { return this.def.hp + this.game.shop.total('maxHp', this.def.id); }
  get hidden() { return this.game.skills.hidden > 0; }

  reset(x, z) {
    this.removeHorse();
    this.hp = this.maxHp;
    this.state = 'idle';
    this.invulnerable = 0;
    this.slowTime = 0;
    this.dash = null;   // 上一局在衝刺中結束時，不能帶到下一局（會一直不受傷）
    this.climb = null;
    this.air = false;
    this.vy = 0;
    this.push = null;
    this.fallOut = false;
    this.root.rotation.x = 0;
    this.setOpacity(1);
    this.position.set(x, this.game.groundY(x, z), z);
    this.root.rotation.y = Math.PI;
    this.model.visible = true;
    this.currentName = '';
    this.play('Idle');
  }

  update(dt, input) {
    this.updateLooseHorse(dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.invulnerable > 0) this.model.visible = Math.floor(this.invulnerable * 14) % 2 === 0;
    else this.model.visible = true;
    this.updateShield();
    if (this.slowTime > 0) this.slowTime -= dt;

    if (this.state === 'dead') return;
    if (this.fallOut) return;                         // 掉出沙場：由 brawl.js 處理
    this.updatePush(dt);
    if (this.air && this.updateAir(dt, input)) return;
    if (this.state === 'land') { if ((this.landTime -= dt) <= 0) this.state = 'idle'; return; }
    if (input.consumeSkill()) this.game.skills.use(); // 技能不打斷動作，攻擊中也能放
    if (input.consumePotion()) this.game.usePotion();
    if (this.climb) { this.updateClimb(dt); return; }
    if (this.state === 'attack') { this.updateAttack(dt, input); return; }
    if (!this.air && input.consumeJump() && this.game.levelData.jump) this.startJump();
    if (!this.air && input.consumeAttack()) { this.startAttack(); return; }

    const move = input.move;
    if (move.moving) {
      const found = this.game.level.ladderAt(this.position, move);   // 攻城關卡：在梯子前往牆走就爬
      if (found) { this.startClimb(found); return; }
      const boost = (this.game.items.buff('speed')?.speedMultiplier ?? 1) * (this.slowTime > 0 ? this.slowFactor : 1);   // 寒冰：變慢
      const speed = this.mount ? this.mount.cfg.speed ?? 8.5 : this.def.moveSpeed;
      this.position.x += move.x * speed * boost * dt;
      this.position.z += move.z * speed * boost * dt;
      this.faceToward(move.x, move.z, dt, this.mount ? 9 : 14);
      if (this.mount) this.trample(dt);
      if (!this.air) this.play('Run', { speed: 1.05 * boost });
    } else if (!this.air) {
      this.play('Idle');
    }
  }

  // ---------- 跳 ----------
  startJump() {
    this.air = true;
    this.vy = JUMP_SPEED;
    this.plunging = false;
    this.play('Jump', { once: true, fade: 0.06, speed: 1.2 });
    this.game.sfx.swing();
    this.game.fx.dust(this.position.x, 0.15, this.position.z, 6);
  }

  // 在空中：往上再落下，可以左右移動；按攻擊＝落地重擊（直直往下衝）。回傳 true＝這一格不能做別的事
  updateAir(dt, input) {
    const ground = this.game.groundY(this.position.x, this.position.z);
    if (!this.plunging && input.consumeAttack()) {
      this.plunging = true;
      this.vy = -PLUNGE_SPEED;
      this.play(this.clips.has('Plunge') ? 'Plunge' : this.attackClip, { once: true, fade: 0.05, speed: 1.4 });
      this.game.sfx.swing();
    }
    if (!this.plunging) this.vy -= JUMP_GRAVITY * dt;
    this.position.y += this.vy * dt;
    if (this.position.y > ground) return this.plunging;   // 一般跳躍：空中照樣可以移動
    this.position.y = ground;
    this.air = false;
    this.vy = 0;
    this.game.fx.dust(this.position.x, 0.15, this.position.z, 8);
    if (!this.plunging) { this.currentName = ''; return false; }
    this.plunging = false;
    this.state = 'land';
    this.landTime = PLUNGE_REST;
    this.play(this.clips.has('PlungeLand') ? 'PlungeLand' : 'Idle', { once: true, fade: 0.05 });
    this.game.plungeImpact(this);
    return true;
  }

  // 被對手打到：往外滑一段（大亂鬥：滑出沙場邊緣就掉下去）
  pushFrom(x, z, power) {
    const dx = this.position.x - x, dz = this.position.z - z, len = Math.hypot(dx, dz) || 1;
    this.push = { x: (dx / len) * power, z: (dz / len) * power };
    this.dash = null;
  }

  updatePush(dt) {
    const p = this.push;
    if (!p) return;
    this.position.x += p.x * dt;
    this.position.z += p.z * dt;
    const keep = Math.max(0, 1 - PUSH_FRICTION * dt);
    p.x *= keep; p.z *= keep;
    if (Math.hypot(p.x, p.z) < 1.2) this.push = null;
  }

  // ---------- 爬梯子（攻城關卡，2026-11-11）----------
  // 往上：先貼到梯子下端，沿梯子升到牆頂，最後跨上牆頂；往下相反。爬的時候不能攻擊，放開方向鍵也會爬完
  startClimb({ ladder, up }) {
    const [bx, bz] = ladder.base, [hx, hz] = ladder.head;
    this.climb = { ladder, up, time: 0, duration: ladder.top / CLIMB_SPEED + CLIMB_STEP,
      from: this.position.clone(), low: new THREE.Vector3(bx, 0, bz), high: new THREE.Vector3(hx, ladder.top, hz) };
    this.faceToward(ladder.dx, ladder.dz, Infinity);
    this.play('Walk', { speed: 1.5 });
    this.game.sfx.swing();
  }

  updateClimb(dt) {
    const c = this.climb;
    c.time += dt;
    const step = CLIMB_STEP / c.duration;                 // 跨上／跨下牆頂佔的比例
    let t = Math.min(1, c.time / c.duration);
    if (!c.up) t = 1 - t;                                  // 往下＝倒著播
    const rise = Math.min(1, t / (1 - step));              // 0～1：沿梯子的高度
    const over = Math.max(0, (t - (1 - step)) / step);     // 0～1：跨上牆頂
    const edge = new THREE.Vector3(c.low.x, c.high.y, c.low.z);
    this.position.lerpVectors(c.low, edge, rise).lerp(c.high, over);
    if (c.time < 0.12) this.position.lerp(c.from, 1 - c.time / 0.12);   // 一開始從站的地方滑到梯子上
    this.faceToward(c.ladder.dx, c.ladder.dz, dt);
    if (c.time < c.duration) return;
    this.position.copy(c.up ? c.high : c.low);
    this.climb = null;
    this.play('Idle');
    this.game.fx.dust(this.position.x, 0.2, this.position.z, 8);
  }

  get attackClip() { const c = this.def.attack?.clip; return c && this.clips.has(c) ? c : 'Attack'; }
  // 動作長度：騎馬時播的是 RideAttack
  get swingLength() { return this.clipLength(this.mount ? 'RideAttack' : this.attackClip); }

  startAttack() {
    this.state = 'attack';
    this.attackTime = 0;
    this.attackConnected = false;
    this.dash = null;
    this.game.attackMultiplier = this.game.skills.onAttack();
    this.aim();
    this.play(this.attackClip, { once: true, fade: 0.06, speed: this.def.attackSpeed });
    this.game.clones.onPlayerAttack(this.def.attackSpeed, this.attackClip);
    this.game.castEffects();
    this.game.sfx.swing();
  }

  // 自動轉向最近的敵人；打得遠的角色也要看得遠
  aim() {
    const { def, game } = this;
    const boost = game.items.buff('waveSlash');
    const waveRange = boost ? (def.boost?.wave?.range ?? boost.range) * 0.8 : 0;
    const range = Math.max(AUTO_AIM_RANGE, def.shot?.range ?? waveRange, def.attack?.type === 'dash' ? def.attack.distance + 1 : 0);
    const target = game.nearestEnemy(this.position, range) ?? game.nearestBreakable(this.position, range); // 附近沒怪才瞄寶箱、拒馬
    if (target) this.faceToward(target.position.x - this.position.x, target.position.z - this.position.z, Infinity);
  }

  updateAttack(dt, input) {
    this.attackTime += dt * this.def.attackSpeed;
    if (this.dash) this.updateDash(dt);
    if (!this.mount && this.def.lunge !== false && !this.def.attack && this.attackTime < LUNGE_TIME) {
      const dir = new THREE.Vector3(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
      this.position.addScaledVector(dir, LUNGE_SPEED * dt);
    }
    if (!this.attackConnected && this.attackTime >= this.def.attackHitTime) {
      this.attackConnected = true;
      if (this.def.shot) this.aim(); // 出手前敵人可能走動了
      if (this.def.attack?.type === 'dash' && !this.mount) this.startDash();   // 騎馬時不突刺，改成一整圈
      else this.game.resolvePlayerAttack();
    }
    if (!this.dash && this.attackTime >= this.swingLength * ATTACK_RECOVERY) {
      this.state = 'idle';
      if (input.consumeAttack()) this.startAttack();
    }
  }

  // 突刺衝鋒：直線往前衝，路上的敵人每隻只算一下（swing 記住打過的），撞到東西就停
  startDash() {
    const { distance, speed = 20 } = this.def.attack;
    const yaw = this.root.rotation.y;
    this.dash = { dx: Math.sin(yaw), dz: Math.cos(yaw), left: distance, speed, swing: new Set(), hits: 0, dustTime: 0, last: this.position.clone(), expected: 0 };
    this.game.fx.slashAt(this.position, yaw, 0.35, distance + 0.8);   // 一道長長的槍風
    this.game.sfx.swing();
    this.game.dashStrike(this, this.dash);   // 原地也算一下，貼身的敵人不會漏掉
  }

  updateDash(dt) {
    const d = this.dash;
    // 上一格被柵欄、樹擋住（位置被推回去）就停
    const moved = Math.hypot(this.position.x - d.last.x, this.position.z - d.last.z);
    if (d.expected && moved < d.expected * 0.3) { this.endDash(); return; }
    const step = Math.min(d.left, d.speed * dt);
    d.last.copy(this.position);
    this.position.x += d.dx * step;
    this.position.z += d.dz * step;
    d.left -= step;
    d.expected = step;
    this.game.dashStrike(this, d);
    d.dustTime -= dt;
    if (d.dustTime <= 0) { d.dustTime = 0.04; this.game.fx.dust(this.position.x, 0.2, this.position.z, 4); }
    if (d.left <= 1e-3) this.endDash();
  }

  endDash() {
    if (this.dash?.hits) this.game.fx.shake(0.25);
    this.dash = null;
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.game.hud.setHearts(this.hp, this.maxHp);
  }

  takeDamage(amount, { throughHorse = false } = {}) {
    if (this.state === 'dead' || this.invulnerable > 0 || (this.dash && this.state === 'attack')) return;   // 衝刺中不會受傷
    if (this.mount && !throughHorse) { this.horseHurt(amount); return; }   // 騎馬時先扣馬的耐久
    this.hp = Math.max(0, this.hp - amount);
    this.flash();
    this.game.sfx.hurt();
    this.game.fx.shake(0.35);
    this.game.hud.setHearts(this.hp, this.maxHp);
    if (this.hp <= 0 && this.game.tryRevive()) return; // 復活羽毛
    if (this.hp <= 0) {
      this.state = 'dead';
      this.climb = null;
      this.model.visible = true;
      this.invulnerable = 0;
      this.play('Death', { once: true });
      this.game.onPlayerDead();
      return;
    }
    this.invulnerable = this.def.invulnerableTime ?? INVULNERABLE_TIME;
  }
}

// ---------- 騎馬（2026-11-12）----------
Object.assign(Player.prototype, {
  // 關卡開始：馬站在 ride.at（還沒騎上去）
  setupHorse(ride) {
    this.removeHorse();
    if (!ride) return;
    const { game } = this;
    if (!ensureRideClips(game, this)) return;
    this.horse = new Horse(game, ride.horse, game.mounts[ride.horse]);
    this.horse.root.position.set(ride.at[0], 0, ride.at[1]);
    this.horse.root.rotation.y = THREE.MathUtils.degToRad(ride.rot ?? 180);
    game.scene.add(this.horse.root);
    this.horseLoose = { x: ride.at[0], z: ride.at[1], regen: 0 };
    this.horse.marker = makeMarker();
    this.horse.root.add(this.horse.marker);
  },

  removeHorse() {
    if (this.mount) { dismountActor(this); this.radius = this.def.radius; }
    this.horse?.dispose();
    this.horse = null;
    this.horseLoose = null;
  },

  // 沒人騎的馬：跑到目的地站好、慢慢回耐久；玩家走到旁邊就騎上去
  updateLooseHorse(dt) {
    const loose = this.horseLoose, horse = this.horse;
    if (!loose || !horse) return;
    const p = horse.root.position, dx = loose.x - p.x, dz = loose.z - p.z, d = Math.hypot(dx, dz);
    if (d > 0.2) {
      const step = Math.min(d, 7 * dt);
      p.x += (dx / d) * step; p.z += (dz / d) * step;
      horse.root.rotation.y = Math.atan2(dx, dz);
    }
    horse.animate(dt, p);
    horse.updateFlash(dt);
    horse.marker.position.y = 2.6 + Math.sin(this.game.level.time * 4) * 0.12;
    loose.regen += dt;
    if (loose.regen >= HORSE_REGEN) { loose.regen = 0; horse.hp = Math.min(horse.maxHp, horse.hp + 1); }
    if (loose.wait > 0) { loose.wait -= dt; horse.marker.material.color.set(loose.wait > 0 ? 0x9ca3af : 0xffd27a); return; }   // 受驚：還騎不上去
    if (this.state === 'dead' || this.state === 'attack' || this.air || this.climb) return;
    if (Math.hypot(this.position.x - p.x, this.position.z - p.z) < MOUNT_DISTANCE) this.rideOn();
  },

  rideOn() {
    const horse = this.horse, { game } = this;
    this.horseLoose = null;
    horse.marker.visible = false;
    this.position.set(horse.root.position.x, this.position.y, horse.root.position.z);
    this.root.rotation.y = horse.root.rotation.y;
    horse.hp = Math.max(2, horse.hp);
    mountActor(this, horse);
    this.radius = RIDE_RADIUS;
    horse.oneShot('RearUp', 1.3);
    game.sfx.pickup();
    game.fx.dust(this.position.x, 0.2, this.position.z, 14);
    if (!this.toldRide) { this.toldRide = true; game.hud.toast('騎上馬了！跑起來可以撞開小兵，I／Shift 跳過拒馬', '#ffd27a'); }
    else game.hud.toast('重新上馬！', '#ffd27a');
  },

  horseHurt(amount) {
    const horse = this.mount, { game } = this;
    horse.hp -= amount;
    this.flash();
    game.sfx.hurt();
    game.fx.shake(0.3);
    this.invulnerable = 0;
    if (horse.hp > 0) {
      // 重擊（扣 2 以上，例如敵將衝撞）連人也會受傷：扣 1 顆心
      if (amount >= 2) this.takeDamage(1, { throughHorse: true });
      if (this.state !== 'dead') this.invulnerable = 0.8;
      return;
    }
    // 被打下馬：馬往旁邊跑開，等玩家走過去再騎
    dismountActor(this);
    this.radius = this.def.radius;
    const yaw = this.root.rotation.y, side = Math.random() < 0.5 ? -1 : 1;
    const spot = { x: this.position.x + Math.cos(yaw) * LOOSE_RUN * side, y: 0, z: this.position.z - Math.sin(yaw) * LOOSE_RUN * side };
    game.level.constrain(spot, 0.9);
    this.horseLoose = { x: spot.x, z: spot.z, regen: 0, wait: SPOOKED };
    horse.marker.visible = true;
    horse.oneShot('RearUp', 1.2);
    this.state = 'idle';
    this.air = false;
    this.position.y = this.game.groundY(this.position.x, this.position.z);
    this.takeDamage(1, { throughHorse: true });   // 摔下馬扣 1 顆心
    if (this.state === 'dead') return;
    this.invulnerable = THROWN_INVULNERABLE;
    this.play('Hit', { once: true });
    game.hud.banner('被打下馬了！馬受驚了，等一下再騎', 1.8, '#ff6b5a');
    game.fx.dust(this.position.x, 0.3, this.position.z, 18);
  },

  // 踐踏：馬跑起來時，馬頭前面的小兵被撞開扣 1；打得壞的東西（關門）也撞得到
  trample() {
    const horse = this.mount, { game } = this;
    if (horse.speed < TRAMPLE_SPEED || this.air) return;
    const yaw = this.root.rotation.y;
    const fx = this.position.x + Math.sin(yaw) * TRAMPLE_AHEAD, fz = this.position.z + Math.cos(yaw) * TRAMPLE_AHEAD;
    const now = game.level.time;
    for (const e of game.enemies) {
      if (!e.canBeHit || e.airborne || (e.trampledAt ?? -9) > now - TRAMPLE_EVERY) continue;
      if (Math.hypot(e.position.x - fx, e.position.z - fz) > 0.9 + e.radius) continue;
      e.trampledAt = now;
      if (game.damageEnemy(e, 1, this.position.x, this.position.z)) {
        game.fx.dust(e.position.x, 0.4, e.position.z, 10);
        game.fx.shake(0.15);
        game.sfx.hit();
      }
    }
    if ((this.trampleGate ?? -9) > now - 0.5) return;
    for (const t of game.breakables) {
      if (Math.hypot(t.position.x - fx, t.position.z - fz) > t.radius + 0.6) continue;
      this.trampleGate = now;
      if (game.hitBreakable(t, new Set())) { game.fx.shake(0.25); horse.oneShot('Attack', 1.4); }
      break;
    }
  },
});

// 馬頭上的提示（往下的箭頭）：沒人騎的時候顯示
function makeMarker() {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 4), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  m.rotation.x = Math.PI;
  m.position.y = 2.6;
  return m;
}

// ---------- 特效模型（2026-11-12 晚）----------
Object.assign(Player.prototype, {
  // 受傷後的無敵時間：防禦護盾包住身體（無敵結束就淡出）
  updateShield() {
    const on = this.invulnerable > 0.05 && this.state !== 'dead' && !this.fallOut && this.root.visible;
    if (on && !this.shieldFx?.alive) {
      this.shieldFx = this.game.modelFx.spawn('防禦護盾', 0, 0, { follow: this, size: this.mount ? 3.4 : 1.9, y: -0.15, life: Infinity, fadeIn: 0.12, fadeOut: 0.25, grow: [1, 1] });
    } else if (!on && this.shieldFx?.alive) {
      this.shieldFx.stop();
      this.shieldFx = null;
    }
  },

  // 寒冰陷阱打到：一段時間變慢，腳下結冰
  chill(seconds, factor = 0.5) {
    this.slowTime = Math.max(this.slowTime ?? 0, seconds);
    this.slowFactor = factor;
    this.game.modelFx.spawn('寒冰', 0, 0, { follow: this, size: 1.6, life: seconds, grow: [0.6, 1], fadeOut: 0.4 });
  },
});
