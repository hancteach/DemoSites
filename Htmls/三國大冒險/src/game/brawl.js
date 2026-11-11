// 武將大亂鬥的流程（2026-11-11）：關卡 JSON 有 "brawl" 時，用這個代替一波一波出怪的 WaveDirector。
// 玩家一個人，對上敵軍陣營（每局隨機）的「全部武將」：每回合隨機上場 1～3 位（rival.js），
// 打到沒血、或打出沙場邊緣掉下去都算擊敗；場上的人都倒了，下一回合再上。全部擊敗就過關。
// 玩家被推出沙場：扣 fallDamage 顆心，回到沙場中央（有一小段無敵）。
//   brawl: { radius 沙場半徑, drop 台子高度, perRound [最少, 最多] 每回合幾位, hpScale 對手血量比例, speedScale 對手速度比例,
//            cooldown 對手出手間隔, fallDamage 掉下去扣幾顆心, healPerRound 每回合結束補幾顆心 }
const ROUND_BREAK = 2.2;
const FALL_GRAVITY = 22;
const EDGE = 0.15;            // 超出邊緣多少算掉下去

export class BrawlDirector {
  constructor(game, level) {
    this.game = game;
    this.def = level.brawl;
    this.label = '';
    this.finished = false;
    this.round = 0;
    this.pause = 1.2;
    this.defeated = 0;
    this.ringOuts = 0;
    const faction = game.enemyFaction;
    this.factionName = game.factions.factions[faction]?.name ?? faction;
    // 敵軍陣營所有有模型的武將，打散順序
    this.roster = game.playable.filter((id) => game.characters[id].faction === faction);
    for (let i = this.roster.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.roster[i], this.roster[j]] = [this.roster[j], this.roster[i]];
    }
    this.count = this.roster.length;
    game.hud.banner(`大亂鬥！對手：${this.factionName}軍 ${this.count} 位武將`, 2.4, game.factionColor(faction));
    game.sfx.wave();
    this.updateLabel();
  }

  // ---------- HUD 用（和 WaveDirector 同名） ----------
  get number() { return Math.max(1, this.round); }
  get total() { return this.count; }
  get remaining() { return this.roster.length + this.game.enemies.filter((e) => e.alive).length; }
  updateLabel() { this.label = `第 ${Math.max(1, this.round)} 回合　${this.factionName}軍還有 ${this.remaining} 位`; }

  startRound() {
    const { game } = this;
    const [min, max] = this.def.perRound ?? [1, 3];
    const n = Math.min(this.roster.length, min + Math.floor(Math.random() * (max - min + 1)));
    this.round += 1;
    // 從玩家對面的沙場邊上場，幾位就左右排開
    const p = game.player.position, R = this.def.radius - 2.4;
    const away = Math.hypot(p.x, p.z) > 1 ? Math.atan2(-p.x, -p.z) : Math.random() * Math.PI * 2;
    const names = [];
    for (let i = 0; i < n; i++) {
      const id = this.roster.pop();
      const a = away + (i - (n - 1) / 2) * 0.75;
      const x = Math.sin(a) * R, z = Math.cos(a) * R;
      const enemy = game.spawnEnemy(game.rivalDef(id), x, z);
      enemy.faceToward(p.x - x, p.z - z, Infinity);
      game.fx.burst(x, 0.8, z, 24, game.factionColor(game.enemyFaction), 4);
      names.push(enemy.def.name);
    }
    game.hud.banner(`第 ${this.round} 回合：${names.join('、')} 上場！`, 2.2, '#ffb020');
    game.sfx.blast();
  }

  // ---------- 每一格 ----------
  update(dt) {
    const { game } = this;
    const R = this.def.radius;
    this.checkEdge(dt, R);
    this.updateLabel();
    if (this.finished) return;
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) this.startRound();
      return;
    }
    if (game.enemies.some((e) => e.alive || e.state === 'fall')) return;
    // 這一回合的人都倒了
    if (!this.roster.length) {
      this.finished = true;
      game.onLevelCleared();
      return;
    }
    if (this.def.healPerRound && game.player.state !== 'dead') game.player.heal(this.def.healPerRound);
    game.items.spawnOnField();   // 每回合結束送一瓶藥水（不會有關卡禁用的）
    this.pause = ROUND_BREAK;
  }

  // 沙場邊緣：被打退的人滑出邊緣就掉下去（自己走路不會掉，level.constrain 會擋住）
  checkEdge(dt, R) {
    const { game } = this;
    for (const e of game.enemies) {
      if (e.state === 'fall' || e.removed || !e.startFall) continue;
      if (Math.hypot(e.position.x, e.position.z) <= R + EDGE) continue;
      const wasAlive = e.alive;
      e.startFall();
      if (!wasAlive) continue;   // 已經被打倒、屍體滑出去的不重複算
      e.hp = 0;
      this.ringOuts += 1;
      game.score += e.def.score ?? 0;
      game.hud.setScore(game.score);
      game.coins.onEnemyKilled(e);
      game.hud.banner(`${e.def.name} 掉下去了！`, 1.6, '#7dd3fc');
      game.sfx.bones();
      game.fx.shake(0.3);
    }
    const p = game.player;
    if (p.state === 'dead') return;
    if (!p.fallOut && Math.hypot(p.position.x, p.position.z) > R + EDGE) {
      p.fallOut = true;
      p.fallSpeed = 2;
      p.climb = null; p.dash = null; p.air = false; p.state = 'idle';
      p.play('Hit', { once: true, fade: 0.05 });
      game.sfx.hurt();
    }
    if (!p.fallOut) return;
    p.fallSpeed -= FALL_GRAVITY * dt;
    p.position.y += p.fallSpeed * dt;
    if (p.push) { p.position.x += p.push.x * dt; p.position.z += p.push.z * dt; }
    p.root.rotation.x += dt * 4;
    if (p.position.y > -7) return;
    // 掉到底：扣血，回到沙場中央
    p.fallOut = false;
    p.push = null;
    p.root.rotation.x = 0;
    p.position.set(0, 0, 0);
    p.currentName = '';
    p.play('Idle');
    p.invulnerable = 0;
    const damage = this.def.fallDamage ?? 2;
    p.takeDamage(damage);
    if (p.state === 'dead') return;
    p.invulnerable = 2;
    game.hud.banner(`掉下去了！少 ${damage} 顆心`, 1.6, '#ff8a6a');
    game.fx.burst(0, 0.8, 0, 30, '#ffffff', 5);
  }
}
