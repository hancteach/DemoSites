// 玩家：移動、攻擊、受傷。攻擊方式的差別都在 data/characters.json。
import * as THREE from 'three';
import { Actor } from './actor.js';

const INVULNERABLE_TIME = 1.0;
const AUTO_AIM_RANGE = 4;
const LUNGE_SPEED = 3;
const LUNGE_TIME = 0.16;
const ATTACK_RECOVERY = 0.72; // 攻擊動作播到這個比例就能接下一招
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
    this.hp = this.maxHp;
    this.state = 'idle';
    this.invulnerable = 0;
    this.dash = null;   // 上一局在衝刺中結束時，不能帶到下一局（會一直不受傷）
    this.setOpacity(1);
    this.position.set(x, 0, z);
    this.root.rotation.y = Math.PI;
    this.model.visible = true;
    this.currentName = '';
    this.play('Idle');
  }

  update(dt, input) {
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.invulnerable > 0) this.model.visible = Math.floor(this.invulnerable * 14) % 2 === 0;
    else this.model.visible = true;

    if (this.state === 'dead') return;
    if (input.consumeSkill()) this.game.skills.use(); // 技能不打斷動作，攻擊中也能放
    if (input.consumePotion()) this.game.usePotion();
    if (this.state === 'attack') { this.updateAttack(dt, input); return; }
    if (input.consumeAttack()) { this.startAttack(); return; }

    const move = input.move;
    if (move.moving) {
      const boost = this.game.items.buff('speed')?.speedMultiplier ?? 1;
      this.position.x += move.x * this.def.moveSpeed * boost * dt;
      this.position.z += move.z * this.def.moveSpeed * boost * dt;
      this.faceToward(move.x, move.z, dt);
      this.play('Run', { speed: 1.05 * boost });
    } else {
      this.play('Idle');
    }
  }

  get attackClip() { const c = this.def.attack?.clip; return c && this.clips.has(c) ? c : 'Attack'; }

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
    const target = game.nearestEnemy(this.position, range) ?? game.chests.nearest(this.position, range); // 附近沒怪才瞄寶箱
    if (target) this.faceToward(target.position.x - this.position.x, target.position.z - this.position.z, Infinity);
  }

  updateAttack(dt, input) {
    this.attackTime += dt * this.def.attackSpeed;
    if (this.dash) this.updateDash(dt);
    if (this.def.lunge !== false && !this.def.attack && this.attackTime < LUNGE_TIME) {
      const dir = new THREE.Vector3(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
      this.position.addScaledVector(dir, LUNGE_SPEED * dt);
    }
    if (!this.attackConnected && this.attackTime >= this.def.attackHitTime) {
      this.attackConnected = true;
      if (this.def.shot) this.aim(); // 出手前敵人可能走動了
      if (this.def.attack?.type === 'dash') this.startDash();
      else this.game.resolvePlayerAttack();
    }
    if (!this.dash && this.attackTime >= this.clipLength(this.attackClip) * ATTACK_RECOVERY) {
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

  takeDamage(amount) {
    if (this.state === 'dead' || this.invulnerable > 0 || (this.dash && this.state === 'attack')) return;   // 衝刺中不會受傷
    this.hp = Math.max(0, this.hp - amount);
    this.flash();
    this.game.sfx.hurt();
    this.game.fx.shake(0.35);
    this.game.hud.setHearts(this.hp, this.maxHp);
    if (this.hp <= 0 && this.game.tryRevive()) return; // 復活羽毛
    if (this.hp <= 0) {
      this.state = 'dead';
      this.model.visible = true;
      this.invulnerable = 0;
      this.play('Death', { once: true });
      this.game.onPlayerDead();
      return;
    }
    this.invulnerable = this.def.invulnerableTime ?? INVULNERABLE_TIME;
  }
}
