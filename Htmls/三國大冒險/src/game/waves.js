// 一波一波出怪：內容全部來自關卡 JSON 的 waves。
// 三國大冒險（2026-11-09）多了「據點波」：stronghold 寫據點 id，敵兵從那個營寨衝出來，
// captain（守將，副將或武將）在出兵到一半時登場；這波打完就「攻下據點」，軍旗換成玩家陣營。
// boss 寫 "敵將" 時，由敵軍陣營有模型的武將上場（沒有就用 characters.json 的「敵將」本身）。
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
  }

  get number() { return Math.max(1, this.index + 1); }
  get total() { return this.waves.length; }
  get remaining() { return this.queue.length + this.game.enemies.filter((e) => e.alive).length; }

  startNext() {
    this.index += 1;
    const wave = this.waves[this.index];
    this.queue = (wave.spawns ?? []).flatMap((s) => Array.from({ length: s.count }, () => s.enemy));
    // 打散順序，多種敵人混在一波時才不會一種出完才換下一種
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.timer = 0;
    this.waveTime = 0;
    this.scheduled = [...(wave.items ?? [])]; // 關卡指定「這一波第幾秒」出現的道具
    this.from = null;
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
    this.game.sfx.wave();
    if (wave.boss) this.startBoss(wave);
  }

  // boss 是清單，每局隨機一隻；打散後放在佇列最後，最先出場
  startBoss(wave) {
    let id = wave.boss[Math.floor(Math.random() * wave.boss.length)];
    if (id === '敵將') id = this.game.enemyGeneral();
    this.queue.push(id);
    if (wave.bossAt) this.from = this.game.level.strongholdPoints(wave.bossAt);
    if (wave.healPlayer) this.game.player.heal(this.game.player.maxHp); // 最後一戰從滿血開始，才不會被前一波決定勝負
    this.game.hud.banner(`${this.game.characters[id].boss.name}出現！`, 2.2, '#ff5a3c');
    this.game.fx.shake(0.7);
    this.game.sfx.blast();
  }

  pickPoint() {
    const player = this.game.player.position;
    const points = this.from ?? this.points;
    const far = points.filter(([x, z]) => Math.hypot(x - player.x, z - player.z) >= MIN_SPAWN_DISTANCE);
    const pool = this.from ? points : (far.length ? far : points); // 據點的兵一定從營裡出來
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
    this.timer -= dt;
    const alive = this.game.enemies.filter((e) => e.alive).length;
    if (this.queue.length && this.timer <= 0 && alive < wave.maxAlive) {
      this.timer = wave.interval;
      const [x, z] = this.pickPoint();
      const id = this.queue.pop();
      this.game.spawnEnemy(id, x + (Math.random() - 0.5) * 1.5, z + (Math.random() - 0.5) * 1.5);
      if (id === wave.captain) {
        this.game.hud.banner(`${this.game.characters[id].boss?.name ?? id}出陣！`, 1.8, '#ffb020');
        this.game.sfx.blast();
      }
    }
    // 要重新數：剛生出來的這隻也算，否則最後一隻一出場這波就結束了
    if (!this.queue.length && this.game.enemies.every((e) => !e.alive)) {
      this.game.chests.onWaveCleared(this.index, wave);
      if (wave.stronghold) this.game.captureStronghold(wave.stronghold);
      if (this.index + 1 >= this.waves.length) { this.finished = true; this.game.onLevelCleared(); }
      else this.pause = WAVE_BREAK;
    }
  }
}
