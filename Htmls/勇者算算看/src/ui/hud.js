// 畫面上的文字與選單。遊戲邏輯只呼叫這些方法，不直接碰 DOM。
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Hud {
  constructor() {
    this.overlay = $('overlay');
    this.bannerEl = $('banner');
    this.cache = {};
  }

  set(id, value, prop = 'textContent') {
    if (this.cache[id] === value) return;
    this.cache[id] = value;
    $(id)[prop] = value;
  }

  showHud(show) { $('hud').hidden = !show; $('progress').hidden = !show; if (!show) this.hideBoss(); }

  setStatus({ count, gold, difficulty, color, progress, comp }) {
    this.set('countNum', String(count));
    this.set('goldNum', String(gold));
    this.set('diffName', difficulty);
    $('diffName').style.color = color;
    $('progressFill').style.width = `${Math.min(1, progress) * 100}%`;
    this.set('comp', comp, 'innerHTML');
  }

  // 穿過門之後的回饋：答對綠色、答錯紅色並說另一邊是多少
  gateFeedback(text, kind) {
    const el = $('feedback');
    el.innerHTML = text;
    el.className = kind;
    el.classList.add('show');
    clearTimeout(this.fbTimer);
    this.fbTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  showBoss(name, ratio) {
    $('bossBar').hidden = false;
    $('bossName').textContent = name;
    $('bossFill').style.width = `${ratio * 100}%`;
  }

  hideBoss() { $('bossBar').hidden = true; }

  banner(text, seconds = 1.6, color = '') {
    this.bannerEl.style.color = color;
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.bannerEl.classList.remove('show'), seconds * 1000);
  }

  clearBanner() { clearTimeout(this.bannerTimer); this.bannerEl.classList.remove('show'); $('feedback').classList.remove('show'); }

  flashScreen(color) {
    const el = $('flash');
    el.style.background = color;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  showOverlay({ title, text = '', html = '', buttons = [], cls = '' }) {
    this.overlay.hidden = false;
    this.overlay.querySelector('.panel').className = `panel ${cls}`;
    if (title !== undefined) $('overlayTitle').textContent = title;
    $('overlayText').textContent = text;
    $('overlayBody').innerHTML = html;
    const box = $('overlayButtons');
    box.innerHTML = '';
    buttons.forEach((b, i) => {
      const el = document.createElement('button');
      el.className = b.style ?? (i === 0 ? 'main' : 'second');
      el.textContent = b.label;
      el.onclick = b.onClick;
      box.append(el);
    });
    box.querySelector('button')?.focus();
    return $('overlayBody');
  }

  hideOverlay() { this.overlay.hidden = true; document.activeElement?.blur(); }

  // 技能鈕（右下）：{ name, color, cooldown, max } 或 null
  setSkill(skill) {
    const btn = $('skillBtn');
    btn.hidden = !skill;
    if (!skill) return;
    const ready = skill.cooldown <= 0;
    const key = `${skill.name}|${ready ? '' : Math.ceil(skill.cooldown)}`;
    if (this.cache.skill === key) return;
    this.cache.skill = key;
    btn.classList.toggle('cooling', !ready);
    btn.style.setProperty('--c', skill.color);
    btn.innerHTML = `<b>${esc(skill.name)}</b><span>${ready ? '<kbd>空白鍵</kbd>' : Math.ceil(skill.cooldown)}</span>`;
  }

  // 選關卡＋英雄＋難度。levels [{ id, name, desc, stars, max, locked, best }]、heroes [{ id, portrait, desc, skill, locked }]
  showSelect({ levels, level, heroes, hero, difficulties, difficulty, coins, onLevel, onHero, onDifficulty, onStart, onBack }) {
    const touch = matchMedia('(pointer: coarse)').matches;
    const body = this.showOverlay({
      title: '準備出發', cls: 'selecting',
      text: touch ? '點選英雄和難度，再按「出發」。' : '←→ 選英雄、↑↓ 選難度，Enter 出發。',
      buttons: [{ label: '出發', onClick: onStart }, { label: '返回', onClick: onBack }],
    });
    body.innerHTML = `<div id="levelList" ${levels.length < 2 ? 'hidden' : ''}>${levels.map((l, i) => `<button class="lvl ${l.locked ? 'locked' : ''}" data-id="${esc(l.id)}" title="${esc(l.desc)}">
        <b>${l.locked ? '🔒' : i + 1} ${esc(l.name)}</b><small>${l.locked ? '先過前一關' : l.best !== undefined ? `最遠 ${l.best} 公尺` : `⭐ ${l.stars} / ${l.max}`}</small></button>`).join('')}</div>
      <div id="heroList">${heroes.map((h) => `<button class="char ${h.locked ? 'locked' : ''}" data-id="${esc(h.id)}"><img src="${h.portrait}" alt=""><b>${h.locked ? '🔒 ' : ''}${esc(h.id)}</b>
        <small>${esc(h.desc)}</small><small class="skillName">${h.locked ? '到商店解鎖' : `技能：${esc(h.skill)}`}</small></button>`).join('')}</div>
      <div id="difficultyList">${difficulties.map((d) => `<button class="diff" data-id="${esc(d.id)}" style="--c:${d.color}"><b>${esc(d.id)}</b>
        <span class="dStars">${[1, 2, 3].map((n) => `<i class="${n <= d.stars ? '' : 'off'}">⭐</i>`).join('')}</span><small>${esc(d.desc)}</small></button>`).join('')}</div>`;
    let curHero = hero, curDiff = difficulty;
    const mark = () => {
      body.querySelectorAll('.lvl').forEach((el) => el.classList.toggle('selected', el.dataset.id === level));
      body.querySelectorAll('.char').forEach((el) => el.classList.toggle('selected', el.dataset.id === curHero));
      body.querySelectorAll('.diff').forEach((el) => el.classList.toggle('selected', el.dataset.id === curDiff));
    };
    const usable = heroes.filter((h) => !h.locked);
    const pickHero = (id) => { curHero = id; mark(); onHero(id); };
    const pickDiff = (id) => { curDiff = id; mark(); onDifficulty(id); };
    body.querySelectorAll('.lvl').forEach((el) => { el.onclick = () => onLevel(el.dataset.id); });
    body.querySelectorAll('.char').forEach((el) => { el.onclick = () => pickHero(el.dataset.id); });
    body.querySelectorAll('.diff').forEach((el) => { el.onclick = () => pickDiff(el.dataset.id); });
    mark();
    this.keys = (code) => {
      const hi = usable.findIndex((h) => h.id === curHero), di = difficulties.findIndex((d) => d.id === curDiff);
      if (code === 'ArrowLeft' || code === 'KeyA') { pickHero(usable[(hi + usable.length - 1) % usable.length].id); return true; }
      if (code === 'ArrowRight' || code === 'KeyD') { pickHero(usable[(hi + 1) % usable.length].id); return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { pickDiff(difficulties[Math.max(0, di - 1)].id); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { pickDiff(difficulties[Math.min(difficulties.length - 1, di + 1)].id); return true; }
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (digit && levels[digit[1] - 1]) { onLevel(levels[digit[1] - 1].id); return true; }
      if (code === 'Enter' || code === 'Space') { onStart(); return true; }
      if (code === 'Escape') { onBack(); return true; }
      return false;
    };
  }

  // ---------- 題目牆的作答面板 ----------
  // 下方三個大按鈕（點一下就作答），上面是題目、獎勵、倒數條
  showQuiz({ question, reward, choices, lane, seconds, onPick }) {
    const el = $('quiz');
    el.hidden = false;
    el.className = '';
    $('quizQ').textContent = `${question} = ?`;
    $('quizReward').innerHTML = `答對 夥伴 <b>${esc(reward)}</b>`;
    const box = $('quizChoices');
    box.innerHTML = '';
    choices.forEach((v, i) => {
      const b = document.createElement('button');
      b.textContent = v;
      b.dataset.i = i;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!el.classList.contains('done')) onPick(i); });
      box.append(b);
    });
    this.selectQuiz(lane);
    this.quizTimer(1, seconds);
  }

  selectQuiz(lane) { $('quizChoices').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === lane)); }

  quizTimer(ratio, sec) {
    $('quizFill').style.width = `${ratio * 100}%`;
    $('quizFill').classList.toggle('low', sec <= 3);
    this.set('quizSec', String(sec));
  }

  // 答完：選的那個標紅（錯）或綠（對），正確答案一律標綠
  answerQuiz(chosen, correct) {
    $('quiz').classList.add('done');
    $('quizChoices').querySelectorAll('button').forEach((b, i) => {
      b.classList.remove('on');
      b.classList.toggle('right', i === correct);
      b.classList.toggle('wrong', i === chosen && i !== correct);
    });
  }

  hideQuiz() { const el = $('quiz'); if (el) el.hidden = true; }
}
