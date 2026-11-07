// 存檔：金幣、名冊（有哪些角色、幾級）、上次選的出發角色、每關星星。存在瀏覽器 localStorage 的 assemble.save。
const KEY = 'assemble.save';

export class Save {
  constructor(heroes) {
    this.heroes = heroes;
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch { d = null; }
    d ??= {};
    this.coins = d.coins ?? 0;
    this.owned = d.owned ?? Object.fromEntries(heroes.start.map((id) => [id, 1]));
    this.pick = (d.pick ?? heroes.start.slice(0, heroes.pickMax)).filter((id) => this.owned[id]).slice(0, heroes.pickMax);
    this.stars = d.stars ?? {};
    this.cleared = d.cleared ?? {};
    this.rescued = d.rescued ?? 0;
    this.diff = d.diff ?? 'normal';          // 目前選的難度
    this.diffCleared = d.diffCleared ?? {};  // 每關用哪些難度過關過：{ 關卡 id: ['easy', 'hard'] }
  }

  store() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ coins: this.coins, owned: this.owned, pick: this.pick, stars: this.stars, cleared: this.cleared, rescued: this.rescued, diff: this.diff, diffCleared: this.diffCleared }));
    } catch { /* 無痕模式存不了 */ }
  }

  level(id) { return this.owned[id] ?? 0; }

  // 救出來的角色加入名冊（已經有就不變）。回傳是不是新的
  unlock(id) {
    this.rescued += 1;
    if (this.owned[id]) { this.store(); return false; }
    this.owned[id] = 1;
    this.store();
    return true;
  }

  upgradeCost(id) {
    const lv = this.level(id);
    return lv && lv < this.heroes.maxLevel ? this.heroes.upgradeCost[lv] : null;
  }

  upgrade(id) {
    const cost = this.upgradeCost(id);
    if (cost == null || this.coins < cost) return false;
    this.coins -= cost;
    this.owned[id] += 1;
    this.store();
    return true;
  }

  // 出發角色：點一下選、再點一下取消；選滿了就把最早選的換掉
  togglePick(id) {
    const i = this.pick.indexOf(id);
    if (i >= 0) { if (this.pick.length > 1) this.pick.splice(i, 1); }
    else if (this.owned[id]) { this.pick.push(id); if (this.pick.length > this.heroes.pickMax) this.pick.shift(); }
    this.store();
  }

  setDiff(id) { this.diff = id; this.store(); }

  // 過關：記星星（只留最好的）、記難度、給金幣（乘難度的金幣倍率）
  clear(stage, stars, earned, coinMul = 1) {
    const first = !this.cleared[stage.id];
    this.cleared[stage.id] = true;
    const list = (this.diffCleared[stage.id] ??= []);
    if (!list.includes(this.diff)) list.push(this.diff);
    this.stars[stage.id] = Math.max(this.stars[stage.id] ?? 0, stars);
    const bonus = Math.round((first ? stage.coins : stage.again) * coinMul);
    this.coins += bonus + earned;
    this.store();
    return { first, bonus };
  }

  addCoins(n) { this.coins += n; this.store(); }
}
