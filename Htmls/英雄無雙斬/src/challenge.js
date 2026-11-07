// 挑戰任務：任務清單在 data/challenges.json，這裡負責記錄成績、算星星、存檔、畫任務清單與遊戲中的任務框。
// 遊戲在各種事件時呼叫 record(名稱, 數值)；每個任務只看自己的 metric。
const SAVE_KEY = 'musou.challenges';

// metric：怎麼計、畫面上怎麼說。best＝取最大值（一招打中幾隻這類）；sum＝累加
export const METRICS = {
  ko: { label: '擊破', unit: '隻', mode: 'sum' },
  combo: { label: '最高連擊', unit: '', mode: 'best' },
  captains: { label: '討取敵將', unit: '名', mode: 'sum' },
  noHit: { label: '撐了', unit: '秒', mode: 'best' },
  airKo: { label: '空中擊破', unit: '隻', mode: 'sum' },
  plungeBest: { label: '一次落地重擊', unit: '隻', mode: 'best' },
  dashBest: { label: '一次突進斬', unit: '隻', mode: 'best' },
  musouBest: { label: '一次無雙擊破', unit: '隻', mode: 'best' },
  shotBest: { label: '一招打中', unit: '隻', mode: 'best' },
  burning: { label: '同時燃燒', unit: '隻', mode: 'best' },
};

const $ = (id) => document.getElementById(id);
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

export class Challenges {
  constructor(game, data) {
    this.game = game;
    this.groups = data.groups;
    this.list = data.list;
    this.save = this.load();
    this.active = null;
    this.selected = this.list[0].id;
  }

  load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) ?? {}; } catch { return {}; } }
  store() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch { /* 無痕模式存不了 */ } }

  get totalStars() { return Object.values(this.save).reduce((n, r) => n + (r.stars ?? 0), 0); }
  starsOf(id) { return this.save[id]?.stars ?? 0; }
  groupOf(c) { return this.groups.find((g) => g.id === c.group); }
  unlocked(c) { return this.totalStars >= (this.groupOf(c)?.unlock ?? 0); }
  find(id) { return this.list.find((c) => c.id === id); }
  starsFor(c, value) { return c.stars.filter((s) => value >= s).length; }

  // ---------- 任務清單（標題畫面） ----------
  buildList(onPick) {
    const box = $('challengeList');
    const total = this.totalStars;
    box.innerHTML = this.groups.map((g) => {
      const locked = total < g.unlock;
      const items = this.list.filter((c) => c.group === g.id).map((c) => `
        <button class="mission${locked ? ' locked' : ''}" data-id="${c.id}" ${locked ? 'disabled' : ''}>
          <b>${c.name}</b><span class="stars">${starText(this.starsOf(c.id))}</span>
        </button>`).join('');
      return `<div class="missionGroup"><h3>${g.name}${locked ? `<small>🔒 共 ${g.unlock} 顆星開放（還差 ${g.unlock - total}）</small>` : ''}</h3><div class="missionGrid">${items}</div></div>`;
    }).join('');
    $('starTotal').textContent = `${total} / ${this.list.length * 3}`;
    box.querySelectorAll('.mission:not(.locked)').forEach((b) => { b.onclick = () => onPick(b.dataset.id); });
    this.mark();
  }

  mark() {
    document.querySelectorAll('.mission').forEach((b) => b.classList.toggle('on', b.dataset.id === this.selected));
    const c = this.find(this.selected);
    const m = METRICS[c.metric];
    const best = this.save[c.id]?.best;
    $('missionInfo').innerHTML = `<b>${c.name}</b>　${c.desc}<br>
      <small>${c.time} 秒｜${m.label}：${c.stars.map((s, i) => `${'★'.repeat(i + 1)} ${s}${m.unit}`).join('　')}${c.hero ? `｜指定角色：${this.game.pickHero(c.hero).name}` : ''}${best !== undefined ? `｜最佳 ${best}${m.unit}` : ''}</small>`;
  }

  // 上下鍵換任務（只在開放的任務裡換）
  move(step) {
    const open = this.list.filter((c) => this.unlocked(c));
    const i = open.findIndex((c) => c.id === this.selected);
    this.selected = open[(i + step + open.length) % open.length].id;
    this.mark();
  }

  // ---------- 遊戲中 ----------
  begin(c) {
    this.active = c;
    this.value = 0;
    this.shown = -1;
  }

  record(name, v) {
    const c = this.active;
    if (!c || c.metric !== name || this.game.state !== 'play') return;
    const before = this.starsFor(c, this.value);
    this.value = METRICS[name].mode === 'sum' ? this.value + v : Math.max(this.value, v);
    const after = this.starsFor(c, this.value);
    if (after > before) {
      this.game.banner(after === 3 ? '★★★ 完美達成！' : `${'★'.repeat(after)} 達成！`, 1.4, 'gold');
      this.game.sfx.win();
      if (after === 3) this.game.end('clear');
    }
  }

  hud() {
    const c = this.active;
    if (!c) return;
    const v = Math.floor(this.value);
    if (v === this.shown) return;
    this.shown = v;
    const m = METRICS[c.metric];
    const n = this.starsFor(c, v);
    const next = c.stars[n];
    $('missionHud').innerHTML = `<b>${c.name}</b><span class="stars">${starText(n)}</span>
      <div>${m.label} <big>${v}</big>${m.unit}${next !== undefined ? `<small>／下一顆星 ${next}</small>` : ''}</div>`;
  }

  // 結束：回傳結果並存最佳紀錄。倒下算失敗（0 顆星），毫髮無傷被打到不算倒下
  finish(reason) {
    const c = this.active;
    const value = Math.floor(this.value);
    const stars = reason === 'dead' ? 0 : this.starsFor(c, value);
    const old = this.save[c.id] ?? { stars: 0 };
    const newBest = old.best === undefined || value > old.best;
    const before = this.totalStars;
    this.save[c.id] = { stars: Math.max(old.stars, stars), best: Math.max(old.best ?? 0, value) };
    this.store();
    const unlockedNow = this.groups.filter((g) => before < g.unlock && this.totalStars >= g.unlock);
    this.active = null;
    return { challenge: c, value, stars, newBest, unlockedNow, metric: METRICS[c.metric] };
  }
}
