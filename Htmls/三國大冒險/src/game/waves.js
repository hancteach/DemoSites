// 一波一波出怪：內容全部來自關卡 JSON 的 waves。
// 三國大冒險（2026-11-09）多了「據點波」：stronghold 寫據點 id，敵兵從那個營寨衝出來，
// captain（守將，副將或武將）在出兵到一半時登場；這波打完就「攻下據點」，軍旗換成玩家陣營。
// 2026-11-12：一波可以寫 "objective"（任務：燒毀建築、佔領旗台、護送糧車，見 missions.js），任務完成這波才結束；
// "reinforce": true 時任務完成前一直從 spawns 補兵；"from": [[x, z]...] 指定一般波的出兵點；最後一波可用 "bossFrom": [x, z]。
// boss 寫 "敵將" 時，由敵軍陣營有模型的武將上場（沒有就用 characters.json 的「敵將」本身）。
import { createObjective } from './missions.js';

const WAVE_BREAK = 2.2;
const MIN_SPAWN_DISTANCE = 7;
const CAPTAIN_AFTER = 0.4; // 守將在出了幾成的兵之後登場

export class WaveDirector {
  constructor(game, level) {
    this.game = game;
    this.waves = level.waves;
    this.points = level.spawnPoints.map((p) => p.at);
    this.index = -1;
    this.queue = [];
    this.timer = 0;
    this.pause = 0.6;
    this.finished = false;
    this.objective = null;
    this.objectives = [];   // 全部的任務（已完成的也留著，重新開始時還原場景）
    // 關門（breach）一開始就擋在路上：騎馬跑很快，不能等到那一波才出現（否則可能已經跑過去了）
    this.prebuilt = new Map();
    level.waves.forEach((w, i) => {
      if (w.objective?.type !== 'breach') return;
      const o = createObjective(game, w.objective, this);
      this.prebuilt.set(i, o);
      this.objectives.push(o);
    });
  }

  get number() { return Math.max(1, this.index + 1); }
  get total() { return this.waves.length; }
  get remaining() { return this.queue.length + this.game.enemies.filter((e) => e.alive).length; }
  // 任務波：畫面上方顯示目標（main.js 有 label 就顯示 label）
  get label() {
    if (!this.objective) return null;
    const alive = this.game.enemies.filter((e) => e.alive).length;
    if (this.objective.done) return this.objective.rout === false ? `${this.objective.doneLabel}　敵兵 ${alive}` : `${this.objective.doneLabel ?? '任務完成'}　打倒剩下的守將`;
    return `${this.objective.label}　敵兵 ${this.game.enemies.filter((e) => e.alive).length}`;
  }
  get targets() { return this.objective?.targets ?? []; }
  hit(target, swing) { return this.objective?.hit?.(target, swing) ?? false; }
  targetFor(enemy) { return this.objective?.targetFor?.(enemy) ?? null; }
  dispose() { for (const o of this.objectives) o.dispose(); this.objectives = []; this.objective = null; }

  // 打散順序，多種敵人混在一波時才不會一種出完才換下一種
  fill(spawns, at = null) {
    const list = spawns.flatMap((s) => Array.from({ length: s.count }, () => (at ? { id: s.enemy, at } : s.enemy)));
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  // 護送路上的埋伏：從指定的點衝出來，排在佇列最前面（最先出）
  ambush(a) {
    const pts = a.from ?? this.points;
    const list = this.fill(a.spawns ?? []).map((id) => ({ id, at: pts[Math.floor(Math.random() * pts.length)] }));
    this.queue.push(...list);
    this.timer = 0;
    this.game.hud.banner(a.banner ?? '有埋伏！', 1.8, '#ff5a3c');
    this.game.sfx.wave();
  }

  startNext() {
    this.index += 1;
    const wave = this.waves[this.index];
    this.queue = this.fill(wave.spawns ?? []);
    this.timer = 0;
    this.waveTime = 0;
    this.scheduled = [...(wave.items ?? [])]; // 關卡指定「這一波第幾秒」出現的道具
    this.from = wave.from ?? null;
    this.routed = false;
    this.objective = null;
    const shName = wave.stronghold && this.game.level.strongholds.get(wave.stronghold)?.def.name;
    if (wave.stronghold) {
      this.from = this.game.level.strongholdPoints(wave.stronghold);
      this.game.level.setStronghold(wave.stronghold, { attacking: true });
      // 佇列從尾端出：守將插在後面幾成的位置，出了一部分小兵才登場
      if (wave.captain) this.queue.splice(Math.floor(this.queue.length * (1 - CAPTAIN_AFTER)), 0, wave.captain);
      this.game.hud.banner(`進攻${shName}！`);
    } else {
      this.game.hud.banner(wave.banner ?? `第 ${this.index + 1} 波`);
    }
    if (wave.objective) {
      this.objective = this.prebuilt.get(this.index) ?? createObjective(this.game, wave.objective, this);
      if (!this.objectives.includes(this.objective)) this.objectives.push(this.objective);
      this.objective.activate?.();
      if (wave.captain && !wave.stronghold) this.queue.splice(Math.floor(this.queue.length * (1 - CAPTAIN_AFTER)), 0, wave.captain);
    }
    this.game.sfx.wave();
    if (wave.boss) this.startBoss(wave);
  }

  // boss 是清單，每局隨機一隻；打散後放在佇列最後，最先出場
  startBoss(wave) {
    let id = wave.boss[Math.floor(Math.random() * wave.boss.length)];
    if (id === '敵將') id = this.game.enemyGeneral();
    this.bossId = id;
    this.queue.push(id);
    if (wave.bossAt) this.from = this.game.level.strongholdPoints(wave.bossAt);
    if (wave.bossFrom) this.from = [wave.bossFrom];
    if (wave.healPlayer) this.game.player.heal(this.game.player.maxHp); // 最後一戰從滿血開始，才不會被前一波決定勝負
    this.game.hud.banner(`${this.game.characters[id].boss.name}出現！`, 2.2, '#ff5a3c');
    this.game.fx.shake(0.7);
    this.game.sfx.blast();
  }

  // 任務完成：還沒出場的兵不出了，場上的小兵潰散（倒下、掉金幣）；守將還要自己打倒
  rout() {
    const { game } = this;
    this.routed = true;
    const captain = this.waves[this.index].captain;
    this.queue = this.queue.filter((item) => (typeof item === 'string' ? item : item.id) === captain && !game.enemies.some((e) => e.alive && e.def.id === captain));
    const { x, z } = game.player.position;
    let fled = 0;
    for (const e of game.enemies) {
      if (!e.alive || e.def.boss) continue;
      game.damageEnemy(e, e.hp, x, z, { force: true });
      fled += 1;
    }
    if (fled) game.hud.toast('敵兵潰散了！', '#ffd27a');
  }

  pickPoint() {
    const player = this.game.player.position;
    // "behind": true（第 7 關的追兵）：從玩家後面（南邊，鏡頭那一側）追上來
    if (this.waves[this.index]?.behind) {
      const { halfWidth: W, halfDepth: D } = this.game.level.arena;
      return [(Math.random() * 2 - 1) * (W - 2), Math.min(D - 1.5, player.z + 15)];
    }
    const points = this.from ?? this.points;
    const near = this.waves[this.index]?.near ?? Infinity;   // 很長的關卡（第 7 關）：只從玩家附近幾公尺內的出兵點出來
    const far = points.filter(([x, z]) => { const d = Math.hypot(x - player.x, z - player.z); return d >= MIN_SPAWN_DISTANCE && d <= near; });
    const closest = () => [...points].sort((a, b) => Math.hypot(a[0] - player.x, a[1] - player.z) - Math.hypot(b[0] - player.x, b[1] - player.z)).slice(1, 3);
    const pool = this.from ? points : (far.length ? far : near < Infinity ? closest() : points); // 據點的兵一定從營裡出來
    return pool[Math.floor(Math.random() * pool.length)];
  }

  update(dt) {
    if (this.finished) return;
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) this.startNext();
      return;
    }
    const wave = this.waves[this.index];
    this.waveTime += dt;
    this.scheduled = this.scheduled.filter((entry) => {
      if (this.waveTime < entry.at) return true;
      this.game.items.spawnOnField(entry.item);
      return false;
    });
    const obj = this.objective;
    if (obj) {
      obj.update(dt);
      if (obj.failed) { this.finished = true; this.game.onMissionFailed(obj.failed); return; }
      if (obj.done && !this.routed) { if (obj.rout === false) this.routed = true; else this.rout(); }
      // 任務還沒完成：補兵（守將不重複出）
      if (!obj.done && wave.reinforce && !this.queue.length) this.queue = this.fill(wave.spawns ?? []);
    }
    this.timer -= dt;
    const alive = this.game.enemies.filter((e) => e.alive).length;
    if (this.queue.length && this.timer <= 0 && alive < wave.maxAlive) {
      this.timer = wave.interval;
      const item = this.queue.pop();
      const id = typeof item === 'string' ? item : item.id;   // 埋伏的兵是 { id, at }（字串本身也有 .at，要先分開）
      const [x, z] = typeof item === 'string' ? this.pickPoint() : item.at;
      const mount = id === this.bossId ? wave.bossMount : undefined;   // 騎馬的敵將（第 7 關）
      const enemy = this.game.spawnEnemy(id, x + (Math.random() - 0.5) * 1.5, z + (Math.random() - 0.5) * 1.5, { mount });
      obj?.onSpawn?.(enemy);
      if (id === wave.captain) {
        this.game.hud.banner(`${this.game.characters[id].boss?.name ?? id}出陣！`, 1.8, '#ffb020');
        this.game.sfx.blast();
      }
    }
    // 要重新數：剛生出來的這隻也算，否則最後一隻一出場這波就結束了
    if ((!obj || obj.done) && !this.queue.length && this.game.enemies.every((e) => !e.alive)) {
      this.objective = null;
      this.game.chests.onWaveCleared(this.index, wave);
      if (wave.stronghold) this.game.captureStronghold(wave.stronghold);
      if (this.index + 1 >= this.waves.length) { this.finished = true; this.game.onLevelCleared(); }
      else this.pause = WAVE_BREAK;
    }
  }
}
