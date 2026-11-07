// 輸入：按鍵 → 動作。遊戲只讀 move（方向）和 consume('attack'|'jump'|'dash'|'musou')。
// 照一般無雙電腦版：J 攻擊、空白鍵跳躍。
const MOVE = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] };
const ACTIONS = { attack: ['KeyJ'], jump: ['Space'], dash: ['KeyK', 'ShiftLeft', 'ShiftRight'], musou: ['KeyL', 'KeyE'] };
const BUFFER = 0.3; // 動作還沒結束就先按也算（連段才順）

export class Input {
  constructor(canvas) {
    this.down = new Set();
    this.buffer = { attack: 0, jump: 0, dash: 0, musou: 0 };
    this.onPause = null;
    addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      for (const [a, keys] of Object.entries(ACTIONS)) if (keys.includes(e.code)) this.buffer[a] = BUFFER;
      if (e.code === 'KeyP' || e.code === 'Escape') this.onPause?.();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('pointerdown', (e) => { this.buffer[e.button === 2 ? 'dash' : 'attack'] = BUFFER; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get attackHeld() { return ACTIONS.attack.some((k) => this.down.has(k)); }

  get move() {
    const on = (dir) => MOVE[dir].some((k) => this.down.has(k));
    let x = (on('right') ? 1 : 0) - (on('left') ? 1 : 0);
    let z = (on('down') ? 1 : 0) - (on('up') ? 1 : 0);
    const len = Math.hypot(x, z);
    if (len > 0) { x /= len; z /= len; }
    return { x, z, len };
  }

  tick(dt) { for (const a in this.buffer) this.buffer[a] = Math.max(0, this.buffer[a] - dt); }
  peek(a) { return this.buffer[a] > 0; }
  consume(a) { const had = this.buffer[a] > 0; this.buffer[a] = 0; return had; }
  clear() { for (const a in this.buffer) this.buffer[a] = 0; this.down.clear(); }
}
