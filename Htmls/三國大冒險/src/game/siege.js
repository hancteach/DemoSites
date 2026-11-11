// 攻城關卡的流程（2026-11-11）：關卡 JSON 有 "siege" 時，用這個代替一波一波出怪的 WaveDirector。
// 開場就把守軍擺好（城牆上的弓兵、投石兵、槍兵，通道裡的小兵），通道上橫著拒馬；
// 玩家打破拒馬、爬梯子上城牆，走到城門頂時敵將出現，打倒敵將就攻下城門。
//   siege.barricades: [{ z, hp }]              拒馬（橫在通道上，要打 hp 下）
//   siege.defenders:  [{ enemy, at: [x, z], wake }]   守軍；wake＝玩家靠近幾公尺內才開始行動（沒寫就一開始就動）
//   siege.bossAt: [x, z]、siege.rubbleMax       敵將出現的位置、落石碎堆最多幾堆
// 敵將寫在 waves 最後一項的 boss（和一般關卡一樣，也用它的 bossChest、healPlayer）。
// 拒馬、碎石是「打得壞的東西」：main.js 的 breakables 把它們和寶箱一起交給攻擊判定。
import { buildBarricade, buildRubble } from '../world/fortress.js';

const BREAK_TIME = 0.4;
const BOSS_TRIGGER = 7;     // 在牆頂走到離城門正面幾公尺內，敵將出現
const SEGMENT = 1.5;        // 拒馬每隔幾公尺一個碰撞圓

export class SiegeDirector {
  constructor(game, level) {
    this.game = game;
    this.def = level.siege;
    this.wave = level.waves.at(-1) ?? {};
    this.obstacles = [];
    this.breaking = [];
    this.finished = false;
    this.boss = null;
    this.index = 0;
    this.time = 0;
    this.barricadeCount = (this.def.barricades ?? []).length;
    for (const b of this.def.barricades ?? []) this.addBarricade(b);
    for (const d of this.def.defenders ?? []) {
      const enemy = game.spawnEnemy(d.enemy, d.at[0], d.at[1]);
      enemy.sleep = d.wake ?? 0;
      enemy.root.rotation.y = Math.atan2(-d.at[0], 0.001);   // 面向通道
    }
    game.hud.banner(level.siege.banner ?? '攻城開始！', 2.2);
    game.sfx.wave();
  }

  // ---------- HUD 用（和 WaveDirector 同名） ----------
  get total() { return 3; }
  get number() { return this.boss ? 3 : this.barricadesLeft ? 1 : 2; }
  get remaining() { return this.game.enemies.filter((e) => e.alive).length; }
  get barricadesLeft() { return this.obstacles.filter((o) => o.kind === 'barricade').length; }
  get label() {
    const onWall = this.game.player.position.y > this.def.height - 0.5;
    const goal = this.boss ? `擊敗${this.boss.def.boss.name}`
      : onWall ? '沿著城牆走到城門'
      : this.barricadesLeft ? `突破拒馬 ${this.barricadeCount - this.barricadesLeft} / ${this.barricadeCount}`
      : '爬梯子登上城門';
    return `${goal}　守軍 ${this.remaining}`;
  }

  // ---------- 拒馬、碎石 ----------
  get targets() { return this.obstacles.flatMap((o) => o.segments); }

  addObstacle(kind, object, x, z, hp, spots, radius, solid) {
    const { game } = this;
    object.position.set(x, 0, z);
    game.scene.add(object);
    const o = { kind, object, x, z, hp, max: hp, shake: 0, segments: [], colliders: [] };
    for (const [sx, sz] of spots) {
      const collider = { x: sx, z: sz, r: radius };
      game.level.colliders.push(collider);
      o.colliders.push(collider);
      o.segments.push({ position: { x: sx, y: 0, z: sz }, radius, owner: o, solid });
    }
    this.obstacles.push(o);
    return o;
  }

  addBarricade({ z, hp = 3 }) {
    const P = this.def.half;
    const n = Math.ceil((P * 2) / SEGMENT);
    const spots = Array.from({ length: n }, (_, i) => [-P + ((i + 0.5) * P * 2) / n, z]);
    this.addObstacle('barricade', buildBarricade(P * 2 - 0.1), 0, z, hp, spots, 0.9, true);
  }

  // 投石兵的石頭落在地面：留下一堆碎石擋路（打一下就碎）。太多、太靠近玩家或梯子就不留
  addRubble(x, z) {
    const { game } = this;
    if (this.obstacles.filter((o) => o.kind === 'rubble').length >= (this.def.rubbleMax ?? 6)) return;
    if (Math.hypot(game.player.position.x - x, game.player.position.z - z) < 1.6) return;
    if (game.level.ladders.some((l) => Math.hypot(l.base[0] - x, l.base[1] - z) < 2)) return;
    if (this.obstacles.some((o) => o.segments.some((s) => Math.hypot(s.position.x - x, s.position.z - z) < 1.7))) return;
    const spot = { x, y: 0, z };
    game.level.constrain(spot, 0.8);
    this.addObstacle('rubble', buildRubble(), spot.x, spot.z, 1, [[spot.x, spot.z]], 0.75, false);
    if (!this.toldRubble) { this.toldRubble = true; game.hud.toast('落石會擋路，打一下就碎', '#d6d0c4'); }
  }

  // 攻擊打到其中一段：同一次攻擊（swing）整座拒馬只算一下
  hit(segment, swing) {
    const o = segment.owner;
    if (o.hp <= 0 || swing?.has(o)) return false;
    swing?.add(o);
    const { game } = this;
    o.hp -= 1;
    o.shake = 0.22;
    game.fx.sparks(segment.position.x, 0.8, segment.position.z);
    game.fx.dust(segment.position.x, 0.5, segment.position.z, 8);
    game.fx.shake(0.15);
    game.sfx.hit();
    if (o.hp > 0) {
      if (o.kind === 'barricade') game.fx.floatText(segment.position.x, 2.1, segment.position.z, `再 ${o.hp} 下`, '#ffd27a');
      return true;
    }
    this.removeColliders(o);
    this.obstacles.splice(this.obstacles.indexOf(o), 1);
    this.breaking.push({ o, time: 0 });
    for (const s of o.segments) game.fx.dust(s.position.x, 0.6, s.position.z, 10);
    game.sfx.bones();
    if (o.kind === 'barricade') {
      const left = this.barricadesLeft;
      game.hud.banner(left ? `拒馬打破了！還有 ${left} 道` : '拒馬全部打破！爬梯子上城牆', 1.8, '#ffd27a');
      game.score += 30;
      game.hud.setScore(game.score);
    }
    return true;
  }

  removeColliders(o) {
    const { colliders } = this.game.level;
    for (const c of o.colliders) {
      const i = colliders.indexOf(c);
      if (i >= 0) colliders.splice(i, 1);
    }
  }

  // ---------- 每一格 ----------
  update(dt) {
    const { game } = this;
    this.time += dt;
    for (const o of this.obstacles) {
      if (o.shake <= 0) continue;
      o.shake -= dt;
      o.object.rotation.x = Math.sin(o.shake * 70) * 0.06 * Math.max(0, o.shake / 0.22);
    }
    this.breaking = this.breaking.filter((b) => {
      b.time += dt;
      const left = Math.max(0, 1 - b.time / BREAK_TIME);
      b.o.object.scale.set(1, left, 1);
      b.o.object.position.y = -0.3 * (1 - left);
      if (left > 0) return true;
      this.dispose3d(b.o.object);
      return false;
    });
    if (this.finished) return;

    const { player } = game;
    // 第一次走到梯子附近：提示怎麼爬
    if (!this.toldLadder && player.position.y < 1 && game.level.ladders.some((l) => Math.hypot(l.base[0] - player.position.x, l.base[1] - player.position.z) < 3.2)) {
      this.toldLadder = true;
      game.hud.toast('梯子！走到梯子前，往牆的方向走就會爬上去', '#ffd27a');
    }
    // 走上城門頂（或城門旁的牆頂）：敵將出現
    if (!this.boss && player.position.y > this.def.height - 0.5 && player.position.z < this.def.gate + BOSS_TRIGGER) this.startBoss();
    if (this.boss && !this.boss.alive) {
      this.finished = true;
      const pf = game.factions.factions[game.factionId];
      game.level.fortress?.setBanner(pf.color, pf.banner);
      game.fx.burst(0, this.def.height + 2, -game.level.arena.halfDepth + 2, 50, pf.color, 6);
      game.onLevelCleared();
    }
  }

  startBoss() {
    const { game } = this;
    let id = (this.wave.boss ?? ['敵將'])[Math.floor(Math.random() * (this.wave.boss?.length ?? 1))];
    if (id === '敵將') id = game.enemyGeneral();
    const [x, z] = this.def.bossAt ?? [0, this.def.gate - 4];
    this.boss = game.spawnEnemy(id, x, z);
    if (this.wave.healPlayer) game.player.heal(game.player.maxHp);
    game.hud.banner(`${game.characters[id].boss.name}出現！`, 2.2, '#ff5a3c');
    game.fx.shake(0.7);
    game.sfx.blast();
  }

  dispose3d(object) {
    this.game.scene.remove(object);
    object.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }

  // 離開這一局：拒馬、碎石收掉
  dispose() {
    for (const o of this.obstacles) { this.removeColliders(o); this.dispose3d(o.object); }
    for (const b of this.breaking) this.dispose3d(b.o.object);
    this.obstacles = [];
    this.breaking = [];
  }
}
