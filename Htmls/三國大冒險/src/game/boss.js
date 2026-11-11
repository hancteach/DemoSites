// Boss：多了招式循環、地面預警、狂暴與畫面上方的血條。招式與數值都在 characters.json 的 boss。
// 招式類型：slam 地面預警後砸下、charge 直線衝撞、summon 召喚小怪、
//   volley 扇形射出一排（瞄準線）、rain 往玩家附近丟一串拋物線（落點紅圈，可留下毒池）、soar 飛上天一段時間往下丟火球。
// 新招式在 SKILLS 加一項。預警圈、線的畫法在 enemy.js（一般敵人也用）。
import * as THREE from 'three';
import { Enemy, fanDirections } from './enemy.js';

const SOAR_CLIMB = 3;
const SOAR_FOLLOW = 0.6;
const SLAM_COLOR = '#ff5a3c';
const SUMMON_SPREAD = 3;
const CHARGE_HIT_MARGIN = 0.2;
const BLOCKED_RATIO = 0.3;

const SKILLS = {
  slam: {
    start(boss, skill, player) {
      boss.targets = Array.from({ length: skill.count }, (_, i) => {
        // 第一圈一定對準玩家，其他的散在附近，逼玩家移動
        const angle = Math.random() * Math.PI * 2;
        const far = i === 0 ? 0 : skill.radius * (1 + Math.random());
        return { x: player.position.x + Math.cos(angle) * far, z: player.position.z + Math.sin(angle) * far };
      });
      for (const { x, z } of boss.targets) boss.warnCircle(x, z, skill.radius);
    },
    release(boss, skill, player) {
      const { fx, sfx } = boss.game;
      boss.play('Attack', { once: true, fade: 0.06 });
      for (const { x, z } of boss.targets) {
        fx.blastRing(x, z, skill.radius, SLAM_COLOR);
        fx.burst(x, 0.3, z, 22, SLAM_COLOR, 5);
        const level = Math.abs(player.position.y - boss.game.groundY(x, z)) < 1.2;   // 圈在城牆頂、玩家在牆下就打不到
        if (level && Math.hypot(player.position.x - x, player.position.z - z) <= skill.radius + player.radius) player.takeDamage(skill.damage);
      }
      fx.shake(0.5);
      sfx.blast();
      boss.recover(skill);
    },
  },

  charge: {
    start(boss, skill, player) {
      const dx = player.position.x - boss.position.x, dz = player.position.z - boss.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      boss.chargeX = dx / dist;
      boss.chargeZ = dz / dist;
      boss.faceToward(dx, dz, Infinity);
      boss.warnLine(skill.distance, skill.width);
    },
    release(boss, skill) {
      boss.charged = 0;
      boss.chargeHit = false;
      boss.setState('charging');
      boss.play('Run', { speed: 2.2 });
      boss.game.sfx.swing();
    },
  },

  volley: {
    start(boss, skill, player) {
      const dx = player.position.x - boss.position.x, dz = player.position.z - boss.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      boss.faceToward(dx, dz, Infinity);
      boss.aimDirs = fanDirections(dx / dist, dz / dist, skill.count, skill.spread);
      for (const [x, z] of boss.aimDirs) boss.warnLine(skill.shot.range, skill.shot.width * 2 + 0.4, x, z);
    },
    release(boss, skill) {
      boss.play('Attack', { once: true, fade: 0.06 });
      for (const [x, z] of boss.aimDirs) boss.game.enemyShots.fire(boss.position.x, boss.position.z, x, z, skill.shot);
      boss.game.sfx.swing();
      boss.recover(skill);
    },
  },

  rain: {
    start(boss) { boss.play('Wave'); },
    release(boss, skill, player) {
      boss.play('Attack', { once: true, fade: 0.06 });
      for (let i = 0; i < skill.count; i++) {
        const angle = Math.random() * Math.PI * 2, far = i === 0 ? 0 : skill.scatter * (0.4 + Math.random() * 0.6);
        const spot = new THREE.Vector3(player.position.x + Math.cos(angle) * far, player.position.y, player.position.z + Math.sin(angle) * far);
        boss.game.level.constrain(spot, 0.5);
        boss.game.enemyShots.lob(boss, spot, skill.shot, i * (skill.gap ?? 0.25));
      }
      boss.recover(skill);
    },
  },

  // 飛上天：近戰打不到，每隔一下往玩家丟一顆火球（落點紅圈），時間到再降落，落地後有破綻
  soar: {
    start(boss) { boss.play('Fly'); },
    release(boss, skill) {
      boss.soarDrop = skill.every * 0.5;
      boss.setState('soar');
    },
  },

  summon: {
    available(boss, skill) { return boss.minionCount() < skill.max; },
    start(boss) { boss.play('Wave'); },
    release(boss, skill) {
      const { fx, level } = boss.game;
      for (let i = 0; i < skill.count; i++) {
        const angle = (i / skill.count) * Math.PI * 2;
        const spot = new THREE.Vector3(boss.position.x + Math.cos(angle) * SUMMON_SPREAD, boss.position.y, boss.position.z + Math.sin(angle) * SUMMON_SPREAD);
        level.constrain(spot, 0.6);
        boss.game.spawnEnemy(skill.enemy, spot.x, spot.z);
        fx.burst(spot.x, 0.3, spot.z, 14, 0xb48cff, 3);
      }
      boss.recover(skill);
    },
  },
};

export class Boss extends Enemy {
  constructor(game, def, instance, x, z) {
    super(game, def, instance, x, z);
    this.plan = def.boss;
    this.skillIndex = 0;
    this.skillTimer = this.plan.skillEvery * 0.6;
    this.warnings = [];
    this.enraged = false;
    game.hud.showBoss(this.plan.name, 1);
  }

  get speed() { return super.speed * (this.enraged ? this.plan.enrage.pace : 1); }
  get pace() { return this.enraged ? this.plan.enrage.pace : 1; }

  update_soar(dt, player) {
    const { skill } = this;
    const flying = this.timer < skill.duration;
    this.play('Fly');
    if (flying) {
      this.position.y = Math.min(skill.height, this.position.y + SOAR_CLIMB * dt);
      const dx = player.position.x - this.position.x, dz = player.position.z - this.position.z;
      this.position.x += dx * SOAR_FOLLOW * dt;
      this.position.z += dz * SOAR_FOLLOW * dt;
      this.faceToward(dx, dz, dt, 5);
      this.soarDrop -= dt;
      if (this.soarDrop <= 0 && this.position.y >= skill.height * 0.8) {
        this.soarDrop = skill.every / this.pace;
        this.game.enemyShots.lob(this, player.position, skill.shot, 0);
      }
      return;
    }
    this.position.y = Math.max(0, this.position.y - SOAR_CLIMB * 1.5 * dt);
    if (this.position.y > 0) return;
    this.game.fx.shake(0.4);
    this.game.fx.dust(this.position.x, 0.3, this.position.z, 24);
    this.play('Idle');
    this.recover(skill);
  }

  minionCount() { return this.game.enemies.filter((e) => e !== this && e.alive).length; }

  // 血量都顯示在畫面上方，頭上不用再一條
  makeHealthBar() {}

  updateHealthBar() {
    const ratio = Math.max(0, this.hp / this.def.hp);
    this.game.hud.showBoss(this.plan.name, ratio);
    if (!this.enraged && this.hp > 0 && ratio <= this.plan.enrage.at) this.enrage();
  }

  enrage() {
    const { hud, fx, sfx } = this.game;
    this.enraged = true;
    for (const m of this.materials) m.color.setRGB(1, 0.62, 0.55);
    hud.banner('狂暴！', 1.4, '#ff5a3c');
    fx.shake(0.6);
    fx.burst(this.position.x, 1.5, this.position.z, 40, SLAM_COLOR, 6);
    sfx.blast();
  }


  // 走近玩家；近身時普通攻擊，時間到就放招
  update_chase(dt, player) {
    if (player.state !== 'dead' && !player.hidden) { // 找不到隱身的玩家就不放新招，已放出的招式照樣打得到
      this.skillTimer -= dt;
      if (this.skillTimer <= 0 && this.startSkill(player)) return;
    }
    super.update_chase(dt, player);
  }

  startSkill(player) {
    const { skills } = this.plan;
    for (let i = 0; i < skills.length; i++) {
      const skill = skills[this.skillIndex++ % skills.length];
      const action = SKILLS[skill.type];
      if (action.available && !action.available(this, skill)) continue;
      this.skill = skill;
      this.setState('windup');
      this.play('Idle');
      action.start(this, skill, player);
      return true;
    }
    this.skillTimer = this.plan.skillEvery;
    return false;
  }

  // 預警越接近爆發越亮，玩家看得出還剩多久
  update_windup(dt, player) {
    const windup = this.skill.windup / this.pace;
    this.glowWarnings(this.timer / windup);
    if (this.skill.type !== 'charge' && this.skill.type !== 'volley') this.faceToward(player.position.x - this.position.x, player.position.z - this.position.z, dt, 6);
    if (this.timer < windup) return;
    this.clearWarnings();
    SKILLS[this.skill.type].release(this, this.skill, player);
  }

  update_charging(dt, player) {
    const { skill } = this;
    // 上一格幾乎沒前進，代表撞到雕像、墓碑或牆，衝撞就此結束
    const moved = this.lastCharge ? Math.hypot(this.position.x - this.lastCharge.x, this.position.z - this.lastCharge.z) : Infinity;
    if (dt > 0 && moved < this.lastStep * BLOCKED_RATIO) { this.endCharge(skill); return; }
    this.lastCharge = this.position.clone();
    const step = skill.speed * this.pace * dt;
    this.lastStep = step;
    this.position.x += this.chargeX * step;
    this.position.z += this.chargeZ * step;
    this.charged += step;
    const dist = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
    if (!this.chargeHit && dist <= this.radius + player.radius + CHARGE_HIT_MARGIN && this.sameLevel(player)) {
      this.chargeHit = true;
      player.takeDamage(skill.damage);
    }
    this.game.fx.dust(this.position.x, 0.2, this.position.z, 2);
    if (this.charged >= skill.distance) this.endCharge(skill);
  }

  endCharge(skill) {
    this.lastCharge = null;
    this.game.fx.shake(0.4);
    this.game.fx.dust(this.position.x, 0.5, this.position.z, 18);
    this.play('Idle');
    this.recover(skill);
  }

  recover(skill) {
    this.recoverTime = (skill.recover ?? 1) / this.pace;
    this.setState('recover');
  }

  update_recover() {
    if (this.timer < this.recoverTime) return;
    this.skillTimer = this.plan.skillEvery / this.pace;
    this.play('Idle');
    this.setState('chase');
  }

}
