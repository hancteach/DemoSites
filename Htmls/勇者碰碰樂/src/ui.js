// 畫面：標題、選關、隊伍編成、召喚、戰鬥 HUD（下方角色卡、必殺技按鈕）、頭上的血條與倒數、結算。
import { portrait } from './models.js';
import { TEAM_MAX } from './save.js';
import { HERO_H, ENEMY_SCALE } from './battle.js';

const $ = (id) => document.getElementById(id);
const TYPE = { bounce: '反彈', pierce: '貫穿' };
// 金幣圖示用 CSS 畫（金幣的 emoji 比較新，Windows 的字型可能沒有，會變成方框）
const COIN = '<i class="coin"></i>';

export class UI {
  constructor(game) {
    this.game = game;
    this.labels = new Map();
    this.screens = ['title', 'stages', 'team', 'gacha', 'hud', 'result'];
    $('btnAdventure').onclick = () => this.show('stages');
    $('btnTeam').onclick = () => this.show('team');
    $('btnGacha').onclick = () => this.show('gacha');
    for (const b of document.querySelectorAll('[data-back]')) b.onclick = () => this.show('title');
    $('pullButton').onclick = () => this.pull();
    $('specialBtn').onclick = (ev) => { ev.stopPropagation(); this.game.battle?.useSpecial(); };
    $('quitBtn').onclick = () => { if (this.game.battle) this.game.quitBattle(); };
    $('resultAgain').onclick = () => this.game.startStage(this.game.lastStage);
    $('resultBack').onclick = () => this.show('stages');
  }

  show(name) {
    this.game.sfx.unlock();
    for (const s of this.screens) $(s).hidden = s !== name;
    this.current = name;
    if (name === 'title') this.renderTitle();
    if (name === 'stages') this.renderStages();
    if (name === 'team') this.renderTeam();
    if (name === 'gacha') this.renderGacha();
    if (name !== 'hud' && name !== 'result') this.game.showMenuScene();
  }

  coinsText() { return `${COIN}${this.game.save.coins}`; }

  async img(model) { try { return await portrait(model); } catch { return ''; } }
  // 頭像圖片先放空的，拍好再補上（第一次要等模型下載）
  face(def, cls = 'face') {
    const el = document.createElement('img');
    el.className = cls;
    el.alt = def.name;
    el.style.setProperty('--c', def.color);
    this.img(def.model).then((src) => { if (src) el.src = src; });
    return el;
  }

  renderTitle() {
    const s = this.game.save;
    $('titleCoins').innerHTML = this.coinsText();
    const row = $('titleTeam');
    row.innerHTML = '';
    for (const id of s.team) row.appendChild(this.face(this.game.heroDef(id)));
    $('titleStars').textContent = `★ ${Object.values(s.stars).reduce((a, b) => a + b, 0)} / ${this.game.data.stages.list.length * 3}`;
  }

  renderStages() {
    const s = this.game.save, box = $('stageList');
    $('stagesCoins').innerHTML = this.coinsText();
    box.innerHTML = '';
    this.game.data.stages.list.forEach((st, i) => {
      const locked = i > 0 && !s.cleared[this.game.data.stages.list[i - 1].id];
      const stars = s.stars[st.id] ?? 0;
      const boss = st.waves.at(-1)[0][0];
      const unlock = st.unlock && !s.owned[st.unlock] ? `　過關得到 <b>${st.unlock}</b>` : '';
      const b = document.createElement('button');
      b.className = 'stageCard' + (locked ? ' locked' : '');
      b.dataset.id = st.id;
      b.style.setProperty('--g', st.ground);
      b.innerHTML = `<span class="no">${i + 1}</span><span class="info"><b>${st.name}</b><small>${locked ? '🔒 先打過上一關' : `3 波　Boss：${boss}　${COIN}${s.cleared[st.id] ? st.again : st.coins}${unlock}`}</small></span><span class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>`;
      if (!locked) b.onclick = () => this.game.startStage(st);
      box.appendChild(b);
    });
    $('stageTeam').innerHTML = '';
    for (const id of s.team) $('stageTeam').appendChild(this.face(this.game.heroDef(id)));
  }

  heroCard(def, owned, level, inTeam) {
    const c = document.createElement('button');
    c.className = 'heroCard' + (owned ? '' : ' locked') + (inTeam ? ' inTeam' : '');
    c.dataset.id = def.id;
    c.style.setProperty('--c', def.color);
    const mult = 1 + (Math.max(1, level) - 1) * this.game.data.heroes.levelBonus;
    const how = def.unlock === 'start' ? '' : def.unlock === 'gacha' ? '召喚獲得' : `過關獲得（${this.game.data.stages.list.find((x) => `stage:${x.id}` === def.unlock)?.name ?? ''}）`;
    c.appendChild(this.face(def));
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<div><b>${def.name}</b> <span class="type ${def.type}">${TYPE[def.type]}</span> ${owned ? `<span class="lv">Lv${level}</span>` : `<span class="lock">🔒 ${how}</span>`}</div>
      <small>生命 ${Math.round(def.hp * mult)}　攻擊 ${Math.round(def.atk * mult)}</small>
      <small>協力：${def.assist.name}　必殺：${def.special.name}（${def.charge} 回合）</small>
      <small class="desc">${def.desc}</small>`;
    c.appendChild(info);
    if (inTeam) { const tag = document.createElement('span'); tag.className = 'teamNo'; tag.textContent = inTeam; c.appendChild(tag); }
    return c;
  }

  renderTeam() {
    const s = this.game.save;
    const slots = $('teamSlots');
    slots.innerHTML = '';
    for (let i = 0; i < TEAM_MAX; i++) {
      const id = s.team[i];
      const d = document.createElement('div');
      d.className = 'slot';
      if (id) d.appendChild(this.face(this.game.heroDef(id)));
      else d.textContent = '空';
      slots.appendChild(d);
    }
    $('teamCount').textContent = `${s.team.length} / ${TEAM_MAX}`;
    const box = $('roster');
    box.innerHTML = '';
    for (const def of this.game.data.heroes.list) {
      const owned = Boolean(s.owned[def.id]);
      const at = s.team.indexOf(def.id);
      const c = this.heroCard(def, owned, s.level(def.id), at >= 0 ? at + 1 : 0);
      if (owned) c.onclick = () => { s.toggleTeam(def.id); this.renderTeam(); };
      box.appendChild(c);
    }
  }

  renderGacha() {
    const s = this.game.save, cost = this.game.data.heroes.gachaCost;
    $('gachaCoins').innerHTML = this.coinsText();
    $('pullButton').disabled = s.coins < cost;
    $('pullButton').innerHTML = `召喚 1 次（${COIN}${cost}）`;
    const have = this.game.data.heroes.list.filter((h) => s.owned[h.id]).length;
    $('gachaInfo').textContent = `已擁有 ${have} / ${this.game.data.heroes.list.length} 位角色。還沒有的角色比較容易抽到；抽到已經有的角色會升級（最高 Lv${this.game.data.heroes.maxLevel}，滿級換回 30 枚金幣）。`;
  }

  pull() {
    const r = this.game.save.pull();
    if (!r) return;
    const def = this.game.heroDef(r.id);
    const box = $('gachaResult');
    box.innerHTML = '';
    box.className = 'reveal';
    void box.offsetWidth;
    box.classList.add('go');
    box.appendChild(this.face(def, 'face big'));
    const t = document.createElement('div');
    t.innerHTML = `<b style="color:${def.color}">${def.name}</b><span class="type ${def.type}">${TYPE[def.type]}</span><br>${r.isNew ? '<em class="new">NEW！加入隊伍候補</em>' : r.maxed ? '已經滿級，換回 30 枚金幣' : `等級提升 → Lv${r.level}`}`;
    box.appendChild(t);
    this.game.sfx.win();
    this.renderGacha();
  }

  // ===== 戰鬥 HUD =====
  setupHud(battle) {
    const box = $('cards');
    box.innerHTML = '';
    for (const h of battle.heroes) {
      const c = document.createElement('div');
      c.className = 'card';
      c.style.setProperty('--c', h.def.color);
      c.appendChild(this.face(h.def));
      c.insertAdjacentHTML('beforeend', `<div class="bar"><i></i></div><span class="charge"></span>`);
      h.card = c;
      box.appendChild(c);
    }
    $('hudStage').textContent = battle.stage.name;
    this.showLegend(battle);
    this.updateHud();
  }

  // 這一關有哪些機關：右上角列出來，第一次彈出去後收起來
  showLegend(battle) {
    // 圖示用彩色圓點（不用 emoji，學校電腦的字型可能沒有）
    const TEXT = {
      pillar: ['#8a6a44', '障礙物', '撞到會反彈'], block: ['#8a90a2', battle.stage.id === 'graveyard' ? '墓碑' : '城牆', '撞到會反彈'], bumper: ['#ffcf4a', '彈跳墊', '撞到會加速彈開'],
      spikes: ['#9aa0aa', '地刺', '經過會扣血'], poison: ['#8be04e', '毒池', '經過會扣血'], lava: ['#ff5a1a', '岩漿', '經過會扣血'],
      pad: ['#2f8a4a', '加速板', '經過會跑更快'], ice: ['#bfe8ff', '冰面', '滑溜溜，在上面跑更遠'], curse: ['#c080ff', '詛咒陣', '經過會扣血'], portal: ['#b46bff', '黑洞', '從一個進去，同顏色的另一個出來'],
    };
    const keys = [...new Set(battle.obstacles.map((o) => (o.type === 'trap' ? o.look ?? 'spikes' : o.type)))];
    const el = $('legend');
    el.innerHTML = keys.map((k) => `<div><span class="dot" style="background:${TEXT[k][0]}"></span><b>${TEXT[k][1]}</b><small>${TEXT[k][2]}</small></div>`).join('');
    el.hidden = !keys.length;
  }

  updateHud() {
    const b = this.game.battle;
    if (!b) return;
    $('hudWave').textContent = `第 ${b.wave + 1} / ${b.stage.waves.length} 波`;
    $('hudTurn').textContent = `第 ${b.turn + (b.state === 'aim' ? 1 : 0)} 回合`;
    $('hudCoins').innerHTML = `${COIN}${b.coins}`;
    const cur = b.state === 'aim' || b.state === 'special' ? b.current() : b.ball?.hero;
    for (const h of b.heroes) {
      if (!h.card) continue;
      h.card.classList.toggle('now', h === cur);
      h.card.classList.toggle('down', !h.alive);
      h.card.querySelector('.bar i').style.width = `${(100 * h.hp) / h.maxHp}%`;
      const ch = h.card.querySelector('.charge');
      ch.textContent = h.chargeLeft > 0 ? `必殺 ${h.chargeLeft}` : '必殺 OK';
      ch.classList.toggle('ready', h.chargeLeft <= 0);
      this.updateLabel(h);
    }
    const sp = $('specialBtn');
    const ready = b.state === 'aim' && cur && cur.chargeLeft <= 0 && !b.special;
    sp.hidden = !ready && !(b.special && b.state === 'aim');
    sp.disabled = Boolean(b.special);
    if (cur) sp.innerHTML = b.special ? `${cur.def.special.name} 準備好了！` : `必殺技 <b>${cur.def.special.name}</b><small>${cur.def.special.text}</small>`;
    $('hint').hidden = b.state !== 'aim' || b.turn > 2;
    if (b.turn >= 1) $('legend').hidden = true;
  }

  unitLabel(u) {
    const el = document.createElement('div');
    el.className = `ulabel ${u.kind}${u.def?.boss ? ' boss' : ''}`;
    el.innerHTML = u.kind === 'enemy' ? `<span class="cd"></span><div class="bar"><i></i></div>` : `<div class="bar"><i></i></div>`;
    $('labels').appendChild(el);
    this.labels.set(u, el);
    this.updateLabel(u);
    return el;
  }
  updateLabel(u) {
    const el = this.labels.get(u);
    if (!el) return;
    el.querySelector('.bar i').style.width = `${Math.max(0, (100 * u.hp) / u.maxHp)}%`;
    if (u.kind === 'enemy') {
      const cd = el.querySelector('.cd');
      cd.textContent = Math.max(0, u.cd);
      cd.classList.toggle('soon', u.cd <= 1);
      el.classList.toggle('burning', Boolean(u.burn));
    }
    el.classList.toggle('down', !u.alive);
  }
  removeLabel(u) { this.labels.get(u)?.remove(); this.labels.delete(u); }
  clearLabels() { for (const el of this.labels.values()) el.remove(); this.labels.clear(); }

  // 每一格把頭上的標籤移到角色頭上
  placeLabels() {
    for (const [u, el] of this.labels) {
      const y = u.kind === 'enemy' ? u.def.height * ENEMY_SCALE + 0.35 : HERO_H + 0.25;
      const r = u.actor.root.position;
      const s = this.game.toScreen(r.x, r.y + y, r.z);
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
    }
  }

  banner(text, time = 1.2, cls = '') {
    const el = $('banner');
    el.textContent = text;
    el.className = `on ${cls}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { el.className = ''; }, time * 1000);
  }

  flash(color) {
    const el = $('flash');
    el.style.background = color;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }

  showResult(r, stage, reward) {
    $('result').hidden = false;
    $('resultTitle').textContent = r.win ? '過關！' : '全員倒下…';
    $('resultTitle').className = r.win ? 'win' : 'lose';
    const conds = ['打倒 Boss', '沒有人倒下', `${stage.par} 回合內過關（${r.turns} 回合）`];
    $('resultStars').innerHTML = r.win ? conds.map((c, i) => `<li class="${r.met[i] ? 'ok' : ''}">${r.met[i] ? '★' : '☆'} ${c}</li>`).join('') : `<li>打到第 ${this.game.battle.wave + 1} 波、${r.turns} 回合</li>`;
    let text = `獲得金幣 ${COIN}${reward.coins}`;
    if (reward.unlocked) text += `<br><em class="new">新角色加入：${reward.unlocked}！</em>`;
    $('resultText').innerHTML = text;
  }
}
