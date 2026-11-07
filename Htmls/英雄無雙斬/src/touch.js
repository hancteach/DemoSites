// 觸控操作（平板、手機）：左半邊浮動搖桿、右下攻擊／跳躍／突進／無雙四顆按鈕、右上暫停。
// 只把結果寫進 Input（touchMove、touchAttack、press()），遊戲邏輯不用改。做法照勇者大冒險的 src/ui/touch.js。
// 觸控裝置（或第一次用手指點畫面）才出現；網址加 ?touch=1 強制開、?touch=0 強制關。
const STICK_RADIUS = 56;   // 搖桿底座半徑（px），手指拉到這裡就是最大
const DEAD_ZONE = 0.15;    // 中間這一小圈不算移動
const FULL_SPEED = 0.7;    // 推到 70% 就是全速

// 交叉雙劍：用 SVG 畫，不用表情符號（有些平板的字型沒有彩色版）
const SWORDS = `<svg viewBox="0 0 64 64" aria-hidden="true"><g stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 10 L46 42" stroke="#fff6df" stroke-width="7"/><path d="M50 10 L18 42" stroke="#fff6df" stroke-width="7"/>
  <path d="M38 46 L48 36 M26 46 L16 36" stroke="#f2c14e" stroke-width="6"/>
  <path d="M46 45 L54 53 M18 45 L10 53" stroke="#8a5a1c" stroke-width="7"/></g></svg>`;

const html = `
<div id="stickZone"><div id="stick"><i id="stickKnob"></i></div></div>
<button id="tPause" aria-label="暫停">II</button>
<div id="tButtons">
  <button id="tMusou" class="tBtn small" style="--c:#ffd27a"><b>無雙</b></button>
  <button id="tDash" class="tBtn small" style="--c:#8ac8ff"><b>突進</b><span class="cd"></span></button>
  <button id="tJump" class="tBtn small" style="--c:#b8ffb0"><b>跳躍</b></button>
  <button id="tAttack" class="tBtn big" aria-label="攻擊">${SWORDS}<b>攻擊</b></button>
</div>`;

export class TouchControls {
  constructor(input, { onPause }) {
    this.input = input;
    this.onPause = onPause;
    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.el.hidden = true;
    this.el.innerHTML = html;
    document.body.append(this.el);
    this.hint = document.createElement('div');
    this.hint.id = 'rotateHint';
    this.hint.innerHTML = '<div><span class="phone"></span><b>請把平板或手機轉成橫向</b><small>橫著拿畫面比較大，左手移動、右手攻擊</small></div>';
    document.body.append(this.hint);
    this.portrait = matchMedia('(orientation: portrait)');
    this.stick = null; // { id, x, y }：正在推搖桿的手指與起點
    this.cache = {};

    const forced = new URLSearchParams(location.search).get('touch');
    this.setMode(forced ? forced === '1' : matchMedia('(pointer: coarse)').matches);
    // 有觸控螢幕的筆電：手指一點就切成觸控模式
    if (forced === null) addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.setMode(true); }, true);

    this.setupStick();
    this.hold('tAttack', () => { input.touchAttack = true; input.press('attack'); }, () => { input.touchAttack = false; });
    this.hold('tJump', () => input.press('jump'));
    this.hold('tDash', () => input.press('dash'));
    this.hold('tMusou', () => input.press('musou'));
    this.hold('tPause', () => this.onPause?.());
    // iOS Safari 會忽略 user-scalable=no，兩指縮放要另外擋
    for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setMode(on) {
    if (this.mode === on) return;
    this.mode = on;
    document.body.classList.toggle('touch', on);
  }

  // 按下時馬上反應（不等 click），放開或手指滑出按鈕就結束
  hold(id, down, up = () => {}) {
    const btn = this.el.querySelector(`#${id}`);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      btn.classList.add('down');
      down();
    });
    const release = () => { btn.classList.remove('down'); up(); };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(type, release);
  }

  setupStick() {
    const zone = this.el.querySelector('#stickZone');
    this.base = this.el.querySelector('#stick');
    this.knob = this.el.querySelector('#stickKnob');
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stick) return; // 已經有一根手指在推了
      zone.setPointerCapture?.(e.pointerId);
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.base.classList.add('active');
      // 底座畫在手指按下的地方（按在邊緣時畫在區域內，方向仍以手指按下的位置為準）
      const box = zone.getBoundingClientRect();
      const r = this.base.offsetWidth / 2 + 4;
      this.base.style.left = `${Math.max(r, e.clientX - box.left)}px`;
      this.base.style.top = `${Math.min(box.height - r, Math.max(r, e.clientY - box.top))}px`;
      this.moveKnob(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (this.stick?.id !== e.pointerId) return;
      this.moveKnob(e.clientX - this.stick.x, e.clientY - this.stick.y);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      zone.addEventListener(type, (e) => { if (this.stick?.id === e.pointerId) this.releaseStick(); });
    }
  }

  // 往畫面上方推＝往畫面上方走，和 WASD 一樣
  moveKnob(dx, dy) {
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, STICK_RADIUS);
    const kx = dist ? (dx / dist) * clamped : 0, ky = dist ? (dy / dist) * clamped : 0;
    this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
    const amount = clamped / STICK_RADIUS;
    if (amount < DEAD_ZONE) { this.input.touchMove = null; return; }
    const strength = Math.min(1, (amount - DEAD_ZONE) / (FULL_SPEED - DEAD_ZONE));
    this.input.touchMove = { x: (dx / dist) * strength, z: (dy / dist) * strength };
  }

  releaseStick() {
    this.stick = null;
    this.input.touchMove = null;
    this.base.classList.remove('active');
    this.base.style.left = '';
    this.base.style.top = '';
    this.knob.style.transform = '';
  }

  // 每格呼叫：只在遊戲進行中顯示；直立拿著時自動暫停。hero 用來顯示突進冷卻、無雙量表滿了沒
  update(state, hero) {
    const show = this.mode && state === 'play';
    if (this.el.hidden === show) this.el.hidden = !show;
    if (!show) {
      if (this.stick) this.releaseStick();
      this.input.touchAttack = false;
      for (const b of this.el.querySelectorAll('.down')) b.classList.remove('down');
    } else if (hero) {
      const ready = hero.musou >= 100;
      if (this.cache.musou !== ready) { this.cache.musou = ready; this.el.querySelector('#tMusou').classList.toggle('ready', ready); }
      const cd = hero.dashCd > 0 ? Math.ceil(hero.dashCd * 10) / 10 : 0;
      if (this.cache.dash !== cd) {
        this.cache.dash = cd;
        const btn = this.el.querySelector('#tDash');
        btn.classList.toggle('cooling', cd > 0);
        btn.querySelector('.cd').textContent = cd > 0 ? cd.toFixed(1) : '';
      }
    }
    if (this.mode && state === 'play' && this.portrait.matches) this.onPause?.();
  }
}
