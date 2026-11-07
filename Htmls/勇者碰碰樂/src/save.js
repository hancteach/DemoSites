// 存檔：金幣、擁有的角色與等級、隊伍（最多 5 位）、每關星星。存在瀏覽器 localStorage 的 bounce.save。
const KEY = 'bounce.save';
export const TEAM_MAX = 5;

export class Save {
  constructor(heroes) {
    this.heroes = heroes;
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch { d = null; }
    d ??= {};
    this.coins = d.coins ?? 0;
    this.owned = d.owned ?? Object.fromEntries(heroes.start.map((id) => [id, 1]));
    this.team = (d.team ?? heroes.start).filter((id) => this.owned[id]).slice(0, TEAM_MAX);
    this.stars = d.stars ?? {};
    this.cleared = d.cleared ?? {};
    this.pulls = d.pulls ?? 0;
  }

  store() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ coins: this.coins, owned: this.owned, team: this.team, stars: this.stars, cleared: this.cleared, pulls: this.pulls }));
    } catch { /* 無痕模式存不了 */ }
  }

  level(id) { return this.owned[id] ?? 0; }

  // 得到角色：沒有就加入（第 1 級），有了就升一級（最高 maxLevel）。回傳 { isNew, level, maxed }
  give(id) {
    const max = this.heroes.maxLevel;
    if (!this.owned[id]) {
      this.owned[id] = 1;
      if (this.team.length < TEAM_MAX) this.team.push(id);
      this.store();
      return { isNew: true, level: 1 };
    }
    if (this.owned[id] >= max) { this.coins += Math.round(this.heroes.gachaCost * 0.3); this.store(); return { isNew: false, level: max, maxed: true }; }
    this.owned[id] += 1;
    this.store();
    return { isNew: false, level: this.owned[id] };
  }

  // 召喚：花金幣隨機得到一位角色（沒有的角色機率高一點）
  pull(rand = Math.random) {
    const cost = this.heroes.gachaCost;
    if (this.coins < cost) return null;
    this.coins -= cost;
    this.pulls += 1;
    const pool = this.heroes.list.map((h) => ({ id: h.id, w: this.owned[h.id] ? (this.owned[h.id] >= this.heroes.maxLevel ? 0.3 : 1) : 2 }));
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = rand() * total, id = pool[0].id;
    for (const p of pool) { r -= p.w; if (r <= 0) { id = p.id; break; } }
    return { id, ...this.give(id) };
  }

  toggleTeam(id) {
    const i = this.team.indexOf(id);
    if (i >= 0) { if (this.team.length > 1) this.team.splice(i, 1); }
    else if (this.team.length < TEAM_MAX && this.owned[id]) this.team.push(id);
    this.store();
  }

  // 過關：記星星（只留最好的）、給金幣、第一次過關給角色
  clear(stage, stars) {
    const first = !this.cleared[stage.id];
    this.cleared[stage.id] = true;
    this.stars[stage.id] = Math.max(this.stars[stage.id] ?? 0, stars);
    const coins = first ? stage.coins : stage.again;
    this.coins += coins;
    let unlocked = null;
    if (first && stage.unlock && !this.owned[stage.unlock]) { this.give(stage.unlock); unlocked = stage.unlock; }
    this.store();
    return { first, coins, unlocked };
  }

  addCoins(n) { this.coins += n; this.store(); }
}
