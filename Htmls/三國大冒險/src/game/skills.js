// 特殊技能（K 鍵或滑鼠右鍵）：商店買了才有，數值在 characters.json 的 skill。
// 新技能在 EFFECTS 加一項，shop.json 加一個 effect 為 skill 的商品。
const REVEAL_DUST = 12;

// 把玩家周圍的敵人彈開並暈眩，不扣血；山豬半獸人與 Boss 推不動。復活羽毛也用這個
export function pushAway(game, { radius, knockback, stun }, color) {
  const { x, z } = game.player.position;
  game.fx.blastRing(x, z, radius, color);
  game.fx.burst(x, 0.6, z, 40, color, 7);
  game.fx.shake(0.5);
  game.sfx.blast();
  for (const enemy of game.enemies) {
    if (!enemy.canBeHit || (!enemy.def.fly && Math.abs(enemy.position.y - game.player.position.y) > 1.2)) continue;   // 不同層（城牆上下）推不到
    if (Math.hypot(enemy.position.x - x, enemy.position.z - z) > radius + enemy.radius) continue;
    enemy.shove(x, z, { knockback, stun });
  }
}

const EFFECTS = {
  // 騎士：周圍敵人彈開
  shockwave(skills, skill) {
    pushAway(skills.game, skill, skill.color);
    skills.cooldown = skill.cooldown;
  },

  // 盜賊：敵人找不到玩家。冷卻從現身才開始算
  stealth(skills, skill) {
    const { game } = skills;
    skills.hidden = skill.duration;
    game.player.setOpacity(skill.opacity);
    game.fx.dust(game.player.position.x, 0.5, game.player.position.z, REVEAL_DUST);
    game.modelFx.spawn('戰場煙霧', game.player.position.x, game.player.position.z, { size: 3.2, life: 1.3, grow: [0.5, 1.2], rise: 0.3, fadeOut: 0.6 });   // 隱身：冒一團煙
    game.sfx.wave();
  },
};

export class Skills {
  constructor(game) {
    this.game = game;
    this.skill = null;
    this.cooldown = 0;
    this.hidden = 0;
  }

  reset() {
    const { game } = this;
    this.skill = game.shop.skillOf(game.characterId);
    this.cooldown = 0;
    this.hidden = 0;
    game.player.setOpacity(1);
  }

  use() {
    if (!this.skill || this.cooldown > 0 || this.hidden > 0) return false;
    EFFECTS[this.skill.type](this, this.skill);
    return true;
  }

  reveal() {
    if (this.hidden <= 0) return;
    const { game, skill } = this;
    this.hidden = 0;
    this.cooldown = skill.cooldown;
    game.player.setOpacity(1);
    game.fx.dust(game.player.position.x, 0.5, game.player.position.z, REVEAL_DUST);
    game.modelFx.spawn('戰場煙霧', game.player.position.x, game.player.position.z, { size: 2.2, life: 0.8, grow: [0.6, 1.1], rise: 0.4, fadeOut: 0.5 });
  }

  // 按攻擊立刻現身；這一刀的傷害倍率
  onAttack() {
    if (this.hidden <= 0) return 1;
    const { ambush = 1 } = this.skill;
    this.reveal();
    return ambush;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.hidden <= 0) return;
    this.hidden -= dt;
    if (this.hidden <= 0) { this.hidden = 0.001; this.reveal(); }
  }
}
