// 畫面：標題、選關、名冊（出發前選角色、升級）、遊戲中的介面（進度、隊伍卡片、血條、Boss 血條、必殺）、結果。
import * as THREE from 'three';
import { portrait } from './models.js';

const $ = (id) => document.getElementById(id);
const COIN = '<i class="coin"></i>';
const v = new THREE.Vector3();

export class UI {
  constructor(game) {
    this.game = game;
    this.labels = new Map();
    this.numbers = [];
    this.screen = null;
    this.rosterMode = 'view';
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { game.sfx.unlock(); this.back(); }));
    $('btnAdventure').onclick = () => { game.sfx.unlock(); this.show('stages'); };
    $('btnRoster').onclick = () => { game.sfx.unlock(); this.openRoster('view'); };
    $('btnGo').onclick = () => { game.sfx.unlock(); game.startStage(this.stage); };
    $('quitBtn').onclick = () => game.quit();
    $('bombBtn').onclick = () => game.run?.useBomb();
    $('resultAgain').onclick = () => game.startStage(game.lastStage);
    $('resultBack').onclick = () => { $('result').hidden = true; this.show('stages'); };
  }

  show(name) {
    for (const s of ['title', 'stages', 'roster', 'hud', 'result']) $(s).hidden = s !== name;
    this.screen = name;
    if (name === 'title') this.renderTitle();
    if (name === 'stages') this.renderStages();
  }

  back() {
    if (this.screen === 'roster' && this.rosterMode === 'pick') this.show('stages');
    else this.show('title');
  }

  async face(id, cls = '') {
    const def = this.game.heroDef(id);
    const img = document.createElement('img');
    img.className = `face ${cls}`;
    img.style.setProperty('--c', def.color);
    img.alt = id;
    img.src = await portrait(def.model);
    return img;
  }

  renderTitle() {
    const s = this.game.save;
    const stars = Object.values(s.stars).reduce((a, b) => a + b, 0);
    $('titleCoins').innerHTML = `${COIN}${s.coins}`;
    $('titleStars').textContent = `★ ${stars} / ${this.game.data.stages.list.length * 3}`;
    const box = $('titleTeam');
    box.innerHTML = '';
    const ids = Object.keys(s.owned);
    Promise.all(ids.map((id) => this.face(id))).then((imgs) => { box.innerHTML = ''; imgs.forEach((i) => box.append(i)); });
  }

  renderStages() {
    const s = this.game.save;
    $('stagesCoins').innerHTML = `${COIN}${s.coins}`;
    const row = $('diffRow');
    row.innerHTML = '';
    for (const d of this.game.data.stages.difficulties) {
      const b = document.createElement('button');
      b.className = `diff ${d.id}${s.diff === d.id ? ' on' : ''}`;
      b.innerHTML = `<b>${d.name}</b><small>${d.desc}</small>`;
      b.onclick = () => { s.setDiff(d.id); this.game.sfx.coin(); this.renderStages(); };
      row.append(b);
    }
    const list = $('stageList');
    list.innerHTML = '';
    const theme = { goblin: '#7fb35c', forest: '#4f9a48', swamp: '#5f8a4a', snow: '#9fc0de', volcano: '#c0583a', fortress: '#a08e6c', graveyard: '#6c7590', cave: '#5e5c6a', ruins: '#7c6c8c', dragon: '#8a4a3a' };
    this.game.data.stages.list.forEach((st, i) => {
      const open = i === 0 || s.cleared[this.game.data.stages.list[i - 1].id];
      const b = document.createElement('button');
      b.className = `stageCard${open ? '' : ' locked'}`;
      b.style.setProperty('--g', theme[st.themes[0][0]] ?? '#556');
      const stars = s.stars[st.id] ?? 0;
      const cages = st.events.filter((e) => e.cage && e.cage !== '*').map((e) => e.cage);
      const news = cages.filter((id) => !s.owned[id]);
      const done = (s.diffCleared[st.id] ?? []).map((id) => this.game.data.stages.difficulties.find((d) => d.id === id)).filter(Boolean);
      const tags = done.map((d) => `<i class="dtag ${d.id}">${d.name}</i>`).join('');
      b.innerHTML = `<span class="no">${i + 1}</span><span class="info"><b>${st.name}${tags}</b><small>Boss：${[].concat(st.boss).join('＋')}${news.length ? `　被抓的夥伴：${news.join('、')}` : ''}</small></span><span class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>`;
      if (open) b.onclick = () => { this.stage = st; this.openRoster('pick'); };
      list.append(b);
    });
  }

  // 名冊：pick 模式＝出發前選 1～2 位；view 模式＝看角色、升級
  openRoster(mode) {
    this.rosterMode = mode;
    this.show('roster');
    const pick = mode === 'pick';
    $('rosterTitle').textContent = pick ? `出發準備：${this.stage.name}（${this.game.difficulty().name}）` : '英雄名冊';
    $('rosterTip').innerHTML = pick
      ? `選 ${this.game.data.heroes.pickMax} 位出發，其他夥伴要在路上打破牢籠救出來！第一位是隊長。`
      : '在關卡裡打破牢籠救出夥伴，就會加入名冊。花金幣可以升級（生命、攻擊 +15%）。';
    $('pickSlots').hidden = !pick;
    $('goWrap').hidden = !pick;
    this.renderRoster();
  }

  async renderRoster() {
    const g = this.game, s = g.save, heroes = g.data.heroes;
    $('rosterCoins').innerHTML = `${COIN}${s.coins}`;
    const pick = this.rosterMode === 'pick';
    const slots = $('pickSlots');
    slots.innerHTML = '';
    for (let i = 0; i < heroes.pickMax; i++) {
      const d = document.createElement('div');
      d.className = 'slot';
      const id = s.pick[i];
      if (id) d.append(await this.face(id)); else d.textContent = '空';
      if (i === 0) d.dataset.tag = '隊長';
      slots.append(d);
    }
    const list = $('heroList');
    const cards = [];
    for (const h of heroes.list) {
      const lv = s.level(h.id);
      const card = document.createElement('div');
      card.className = `heroCard${lv ? '' : ' locked'}${pick && s.pick.includes(h.id) ? ' picked' : ''}`;
      card.style.setProperty('--c', h.color);
      const w = h.weapon;
      const mult = 1 + heroes.levelBonus * (Math.max(1, lv) - 1);
      const cost = s.upgradeCost(h.id);
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = lv
        ? `<b>${h.id}<span class="lv">Lv${lv}</span></b><small>生命 ${Math.round(h.hp * mult)}　武器：${w.name}</small><small class="desc">${h.desc}</small><small class="upg">武器強化：${h.upgrade ?? ""}</small>`
        : `<b>？？？</b><small class="desc">在關卡的牢籠裡，打破牢籠就能救出來</small>`;
      card.append(await this.face(h.id), info);
      if (lv && !pick) {
        const up = document.createElement('button');
        up.className = 'up';
        up.innerHTML = cost == null ? '最高級' : `升級 ${COIN}${cost}`;
        up.disabled = cost == null || s.coins < cost;
        up.onclick = (ev) => { ev.stopPropagation(); if (s.upgrade(h.id)) { g.sfx.pickup(); this.renderRoster(); } };
        card.append(up);
      }
      if (pick && s.pick.includes(h.id)) {
        const no = document.createElement('span');
        no.className = 'pickNo';
        no.textContent = s.pick.indexOf(h.id) === 0 ? '隊長' : '2';
        card.append(no);
      }
      if (pick && lv) card.onclick = () => { s.togglePick(h.id); g.sfx.coin(); this.renderRoster(); };
      cards.push(card);
    }
    list.innerHTML = '';
    cards.forEach((c) => list.append(c));
  }

  // ===== 遊戲中 =====
  startHud(run) {
    this.show('hud');
    $('hudStage').textContent = run.diff.id === 'normal' ? run.stage.name : `${run.stage.name}・${run.diff.name}`;
    $('bossBar').hidden = true;
    $('hint').hidden = false;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => { $('hint').hidden = true; }, 6000);
    this.lastCards = '';
    this.refreshCards();
  }

  async refreshCards() {
    const run = this.game.run;
    if (!run) return;
    const box = $('cards');
    const ids = run.heroes.map((h) => h.id).join(',');
    if (ids === this.lastCards) return;
    this.lastCards = ids;
    const els = [];
    for (const h of run.heroes) {
      const c = document.createElement('div');
      c.className = 'card';
      c.style.setProperty('--c', h.def.color);
      c.dataset.id = h.id;
      c.append(await this.face(h.id));
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.innerHTML = '<i></i>';
      c.append(bar);
      els.push(c);
    }
    if (this.game.run !== run) return;
    box.innerHTML = '';
    els.forEach((e) => box.append(e));
    if (els[0]) els[0].classList.add('leader');
  }

  hud(run) {
    $('hudCoins').innerHTML = `${COIN}${run.coins}`;
    const p = Math.min(1, run.dist / run.stage.length);
    $('progress').querySelector('i').style.width = `${p * 100}%`;
    $('progress').querySelector('em').textContent = run.state === 'boss' ? 'BOSS' : `${Math.round(p * 100)}%`;
    const bomb = $('bombBtn');
    bomb.querySelector('i').style.width = `${run.bomb}%`;
    bomb.classList.toggle('ready', run.bomb >= 100);
    bomb.disabled = run.bomb < 100;
    $('powerTag').textContent = `武器 Lv${run.power}`;
    const ids = run.heroes.map((h) => h.id).join(',');
    if (ids !== this.lastCards) this.refreshCards();
    for (const c of $('cards').children) {
      const h = run.heroes.find((x) => x.id === c.dataset.id);
      if (h) c.querySelector('.bar i').style.width = `${Math.max(0, h.hp / h.max) * 100}%`;
    }
    if (run.bosses.length && !$('bossBar').hidden) {
      const hp = run.bosses.reduce((a, b) => a + Math.max(0, b.hp), 0), max = run.bosses.reduce((a, b) => a + b.max, 0);
      $('bossBar').querySelector('i').style.width = `${hp / max * 100}%`;
    }
  }

  bossBar(list) {
    const bar = $('bossBar');
    bar.hidden = false;
    bar.querySelector('b').textContent = list.map((e) => e.id).join('＋');
  }

  // 頭上的血條
  addLabel(u, kind) {
    const el = document.createElement('div');
    el.className = `ulabel ${kind}`;
    el.innerHTML = '<div class="bar"><i></i></div>';
    $('labels').append(el);
    this.labels.set(u, { el, kind, bar: el.querySelector('i') });
  }
  removeLabel(u) { const l = this.labels.get(u); if (l) { l.el.remove(); this.labels.delete(u); } }
  clearLabels() { for (const l of this.labels.values()) l.el.remove(); this.labels.clear(); for (const n of this.numbers) n.el.remove(); this.numbers = []; }

  updateLabels(camera, dt) {
    const w = innerWidth, h = innerHeight;
    for (const [u, l] of this.labels) {
      if (l.kind === 'boss') { l.el.style.display = 'none'; continue; }
      const height = l.kind === 'hero' ? 2.0 : l.kind === 'cage' ? 3.0 : (u.def?.height ?? 1.6) * 1.2 + 0.3;
      v.set(u.x, height, u.z).project(camera);
      const show = v.z < 1 && (l.kind !== 'enemy' || u.hp < u.max);
      l.el.style.display = show ? '' : 'none';
      if (!show) continue;
      l.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      l.bar.style.width = `${Math.max(0, u.hp / u.max) * 100}%`;
    }
    this.numbers = this.numbers.filter((n) => {
      n.t += dt;
      v.set(n.x, n.y + n.t * 1.6, n.z).project(camera);
      n.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      n.el.style.opacity = String(Math.min(1, 2.2 - n.t * 2.2));
      if (n.t > 1) { n.el.remove(); return false; }
      return true;
    });
  }

  number(x, y, z, text, cls = '') {
    if (this.numbers.length > 40) { const old = this.numbers.shift(); old.el.remove(); }
    const el = document.createElement('div');
    el.className = `num ${cls}`;
    el.textContent = text;
    $('numbers').append(el);
    this.numbers.push({ el, x, y, z, t: 0 });
  }

  banner(text, cls = '') {
    const b = $('banner');
    b.textContent = text;
    b.className = `on ${cls}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { b.className = cls; }, 1500);
  }

  result(run, won, stars, reward) {
    const r = $('result');
    r.hidden = false;
    $('resultTitle').textContent = won ? '過關！' : '全員倒下…';
    $('resultTitle').className = won ? 'win' : 'lose';
    const names = ['打倒 Boss', `救出全部夥伴（${run.rescuedNow}／${run.cagesTotal}）`, '沒有人倒下'];
    $('resultStars').innerHTML = names.map((n, i) => `<li class="${stars[i] ? 'ok' : ''}">${stars[i] ? '★' : '☆'} ${n}</li>`).join('');
    $('resultText').innerHTML = won
      ? `打倒 ${run.kills} 隻敵人　得到 ${COIN}${reward.earned}＋過關獎勵 ${COIN}${reward.bonus}${run.diff.coins !== 1 ? `（${run.diff.name}：金幣 ×${run.diff.coins}）` : ''}`
      : `打倒 ${run.kills} 隻敵人　帶回一半金幣 ${COIN}${reward.coins}`;
  }
}
