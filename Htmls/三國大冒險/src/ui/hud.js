// 畫面上的文字與選單。遊戲邏輯只呼叫這些方法，不直接碰 DOM。
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.hud = $('hud');
    this.bannerEl = $('banner');
    this.overlay = $('overlay');
    this.buffsEl = $('buffs');
    this.bannerTimer = 0;
  }

  setHearts(hp, max) {
    $('hearts').innerHTML = Array.from({ length: max }, (_, i) => `<span class="${i < hp ? '' : 'lost'}">❤️</span>`).join('');
  }

  setWave(number, total, remaining) { $('waveInfo').textContent = `第 ${number} / ${total} 波　剩下 ${remaining} 隻`; }
  setWaveText(text) { $('waveInfo').textContent = text; }
  setScore(score) { $('score').textContent = `分數 ${score}`; }

  setCoins(total) {
    $('coinCount').textContent = total;
    const el = $('coins');
    el.classList.add('gain');
    clearTimeout(this.coinTimer);
    this.coinTimer = setTimeout(() => el.classList.remove('gain'), 120);
  }
  showHud(show) { this.hud.hidden = !show; this.buffsEl.hidden = !show; }

  setBuffs(list) {
    this.buffsEl.innerHTML = list.map((b) => `<div class="buff" style="--c:${b.color}"><b>${b.name}</b> ${Math.ceil(b.remaining)} 秒</div>`).join('');
  }

  showBoss(name, ratio) {
    $('bossBar').hidden = false;
    $('bossName').textContent = name;
    $('bossFill').style.width = `${ratio * 100}%`;
  }

  hideBoss() { $('bossBar').hidden = true; }

  toast(text, color) { this.banner(text, 0.9, color); }

  flashScreen(color) {
    const el = $('flash');
    el.style.background = color;
    el.classList.remove('go');
    void el.offsetWidth; // 重新觸發動畫
    el.classList.add('go');
  }

  setLegend(items) {
    $('legend').innerHTML = items.map((i) => `<span style="--c:${i.color}">${i.name}</span>`).join('');
  }

  banner(text, seconds = 1.6, color = '') {
    this.bannerEl.style.color = color;
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.bannerEl.classList.remove('show'), seconds * 1000);
  }

  // 畫面下方的技能與攜帶藥水。list：[{ key, name, color, state: ready／cooling／active, seconds }]
  setAbilities(list) {
    const html = list.map((a) => `<div class="ability ${a.state}" data-key="${a.key}" style="--c:${a.color}"><kbd>${a.key}</kbd><b>${a.name}</b>${a.seconds ? `<span>${Math.ceil(a.seconds)}</span>` : ''}</div>`).join('');
    if (html !== this.abilitiesHtml) $('abilities').innerHTML = html; // 每格都會呼叫，內容沒變就不動畫面
    this.abilitiesHtml = html;
  }

  showOverlay({ title, text, button, onClick, second, onSecond, third, onThird }) {
    this.closeCharacterList();
    this.overlay.hidden = false;
    if (title) $('overlayTitle').textContent = title;
    $('overlayText').textContent = text;
    const btn = $('overlayButton');
    btn.hidden = !button;
    btn.textContent = button ?? '';
    btn.onclick = onClick ?? null;
    const other = $('overlaySecond');
    other.hidden = !second;
    other.textContent = second ?? '';
    other.onclick = onSecond ?? null;
    const extra = $('overlayThird');
    extra.hidden = !third;
    extra.textContent = third ?? '';
    extra.onclick = onThird ?? null;
    if (button) btn.focus();
  }

  hideOverlay() {
    this.closeCharacterList();
    this.overlay.hidden = true;
  }

  // 選將畫面（2026-11-11 改版）：左邊陣營印章（「全」＝全部）、中間橫向卡片（滑鼠拖曳有慣性、手指滑動、滾輪、←→）、
  // 下面是選中武將的資料、關卡與按鈕。
  // factions：[{ id, name, seal, color, count }]；characters：[{ id, name, faction, art, hp, moveSpeed, desc, style }]
  // filter：一開始顯示哪個陣營（'全' 或陣營 id）；onPick(id)：選了武將（可能換陣營）；onFilter(id)：換了陣營頁籤
  showCharacterList({ factions = [], filter = '全', onFilter, characters, selected, levels, selectedLevel, onPick, onPickLevel, onConfirm, onBack, onShop }) {
    this.closeCharacterList();
    this.overlay.hidden = true;
    const root = $('generalSelect');
    root.hidden = false;
    document.body.classList.add('selectingGeneral');
    const touch = document.body.classList.contains('touch');
    $('gsHint').textContent = touch ? '左右滑動挑武將，點一下選擇，再按「出發」'
      : '拖曳或滾輪瀏覽　Q／E 換陣營　←→ 選武將　↑↓ 選關卡　Enter 出發';
    const facs = factions.filter((f) => f.count);
    const tabs = [{ id: '全', name: '全部', seal: '全', color: '#c9a04e', count: characters.length }, ...facs];
    const byId = Object.fromEntries(characters.map((c) => [c.id, c]));
    const facOf = Object.fromEntries(factions.map((f) => [f.id, f]));
    let current = selected;
    let view = tabs.some((t) => t.id === filter) ? filter : '全';
    let shown = [];
    const track = $('gsTrack');

    const renderTabs = () => {
      $('gsFactions').innerHTML = tabs.map((t) => `<button class="gsSeal${t.id === view ? ' on' : ''}" data-id="${t.id}" tabindex="-1" style="--fc:${t.color}" title="${t.name}（${t.count}）">
        <span>${t.seal}</span>${t.name !== t.seal ? `<small>${t.name}</small>` : ''}</button>`).join('');
    };
    const card = (c) => {
      const f = facOf[c.faction] ?? {};
      return `<button class="gsCard${c.id === current ? ' on' : ''}" data-id="${c.id}" tabindex="-1" style="--fc:${f.color ?? '#888'}">
        <span class="gsArt"><img src="${c.art}" alt="" draggable="false"></span>
        <span class="gsTag">${f.seal ?? ''}</span>
        <span class="gsStyle">${c.style}</span>
        <b class="gsName">${c.name}</b>
        <span class="gsStats">❤️ ${c.hp}　🏃 ${c.moveSpeed}</span>
      </button>`;
    };
    const centerOn = (id, smooth = true) => {
      const el = [...track.children].find((x) => x.dataset.id === id);
      if (!el) return;
      const target = el.offsetLeft + el.offsetWidth / 2 - track.clientWidth / 2;
      track.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
    };
    const renderTrack = () => {
      shown = characters.filter((c) => view === '全' || c.faction === view);
      track.innerHTML = shown.map(card).join('');
      track.scrollLeft = 0;
      requestAnimationFrame(() => centerOn(current, false));
    };
    const renderInfo = () => {
      const c = byId[current];
      if (!c) { $('gsInfo').innerHTML = ''; return; }
      const f = facOf[c.faction] ?? {};
      $('gsInfo').innerHTML = `<div class="gsInfoHead"><b>${c.name}</b><span class="gsFac" style="--fc:${f.color}">${f.name ?? ''}</span>
        <span class="gsStyle">${c.style}</span></div><p>${c.desc}</p><span class="gsStats">❤️ 生命 ${c.hp}　🏃 速度 ${c.moveSpeed}</span>`;
    };
    const mark = () => {
      for (const el of track.children) el.classList.toggle('on', el.dataset.id === current);
      renderInfo();
    };
    const pick = (id, smooth = true) => {
      if (!byId[id]) return;
      centerOn(id, smooth);
      if (id === current) return;
      current = id;
      mark();
      onPick(id);
    };
    const setView = (id) => {
      if (id === view || !tabs.some((t) => t.id === id)) return;
      view = id;
      onFilter?.(id);
      renderTabs();
      // 換到別的陣營時選中那個陣營的第一位；「全部」維持目前的武將
      if (view !== '全' && byId[current]?.faction !== view) {
        const first = characters.find((c) => c.faction === view);
        if (first) { current = first.id; onPick(first.id); }
      }
      renderTrack();
      mark();
    };

    // 拖曳：滑鼠按住拖、放開有慣性；拖超過 6 像素就不算點選。手指用瀏覽器原生的橫向捲動
    const drag = { on: false, moved: 0, x: 0, left: 0, raf: 0, hist: [] };
    const stopGlide = () => { cancelAnimationFrame(drag.raf); drag.raf = 0; };
    track.onpointerdown = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      stopGlide();
      Object.assign(drag, { on: true, moved: 0, x: e.clientX, left: track.scrollLeft, hist: [[performance.now(), track.scrollLeft]] });
    };
    this.gsMove = (e) => {
      if (!drag.on) return;
      const dx = e.clientX - drag.x;
      track.scrollLeft = drag.left - dx;
      drag.hist.push([performance.now(), track.scrollLeft]);
      if (drag.hist.length > 12) drag.hist.shift();
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      if (drag.moved > 6) track.classList.add('dragging');   // 真的在拖才關掉卡片的點擊（只是點一下不能關）
    };
    this.gsUp = () => {
      if (!drag.on) return;
      drag.on = false;
      track.classList.remove('dragging');
      // 放開時的速度：最後一次移動在 120 毫秒內才算「甩出去」（停住再放開就不滑），
      // 速度用最後一次移動之前 150 毫秒內的位置算
      const now = performance.now();
      const last = drag.hist[drag.hist.length - 1];
      let v = 0;
      if (last && now - last[0] < 120) {
        const first = drag.hist.find(([t]) => last[0] - t < 150) ?? last;
        if (last[0] > first[0]) v = ((last[1] - first[1]) / (last[0] - first[0])) * 16;   // 每格（約 16 毫秒）移動的像素
      }
      const glide = () => {
        if (Math.abs(v) < 0.4) { drag.raf = 0; return; }
        track.scrollLeft += v;
        v *= 0.93;
        drag.raf = requestAnimationFrame(glide);
      };
      if (drag.moved > 6 && Math.abs(v) > 1.5) drag.raf = requestAnimationFrame(glide);
    };
    addEventListener('pointermove', this.gsMove);
    addEventListener('pointerup', this.gsUp);
    track.onclick = (e) => {
      if (drag.moved > 6) { drag.moved = 0; return; }   // 拖曳結束時的 click 不算選擇
      const el = e.target.closest('.gsCard');
      if (el) pick(el.dataset.id);
    };
    track.onwheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); stopGlide(); track.scrollLeft += e.deltaY; }
    };
    $('gsFactions').onclick = (e) => { const b = e.target.closest('.gsSeal'); if (b) setView(b.dataset.id); };

    // 關卡：鎖住的看得到但選不了
    const levelBox = $('gsLevels');
    const open = levels.filter((l) => !l.locked).map((l) => l.id);
    let currentLevel = selectedLevel;
    levelBox.innerHTML = levels.map((l, i) => `<button class="gsLevel${l.locked ? ' locked' : ''}" data-id="${l.id}" tabindex="-1" title="${l.locked ? '打過前一關才開放' : l.desc}">
      <b>${l.locked ? '🔒 ' : l.cleared ? '⭐ ' : ''}第 ${i + 1} 關</b><small>${l.name}</small></button>`).join('');
    const markLevel = () => { for (const el of levelBox.children) el.classList.toggle('on', el.dataset.id === currentLevel); };
    const pickLevel = (id) => {
      if (id === currentLevel || !open.includes(id)) return;
      currentLevel = id;
      markLevel();
      onPickLevel(id);
    };
    levelBox.onclick = (e) => { const b = e.target.closest('.gsLevel'); if (b) pickLevel(b.dataset.id); };
    markLevel();

    $('gsBack').onclick = onBack;
    $('gsShop').onclick = onShop;
    $('gsGo').onclick = onConfirm;
    this.selectKeys = (e) => {
      const step = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[e.code];
      if (e.repeat && !step) return;
      const levelStep = { ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 }[e.code];
      const tabStep = { KeyQ: -1, KeyE: 1 }[e.code];
      if (tabStep) { const ids = tabs.map((t) => t.id); setView(ids[(ids.indexOf(view) + tabStep + ids.length) % ids.length]); return; }
      if (step) {
        e.preventDefault();
        const ids = shown.map((c) => c.id);
        const i = ids.indexOf(current);
        pick(ids[i < 0 ? 0 : (i + step + ids.length) % ids.length]);
      } else if (levelStep && open.length) { e.preventDefault(); pickLevel(open[(open.indexOf(currentLevel) + levelStep + open.length) % open.length]); }
      else if (e.code === 'Escape') onBack();
      else if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (document.activeElement === $('gsShop')) onShop(); else onConfirm();
      }
    };
    addEventListener('keydown', this.selectKeys);
    renderTabs();
    renderTrack();
    mark();
    $('gsGo').focus({ preventScroll: true });
  }

  closeCharacterList() {
    const root = $('generalSelect');
    if (root) root.hidden = true;
    document.body.classList.remove('selectingGeneral');
    if (this.selectKeys) removeEventListener('keydown', this.selectKeys);
    if (this.gsMove) removeEventListener('pointermove', this.gsMove);
    if (this.gsUp) removeEventListener('pointerup', this.gsUp);
    this.selectKeys = this.gsMove = this.gsUp = null;
  }

}
