// 題目牆：路上橫著一道牆，隊伍跑到牆前停下來，牆上出一題加減題和三個答案，題目下面寫這題的獎勵。
// 答對拿獎勵（+N 夥伴、×2、×3），答錯或時間到獎勵反過來（+N→−N、×2→÷2、×3→÷3，除不盡無條件捨去，最少剩英雄 1 人）。
// 出題範圍、時間、獎勵都在 data/game.json 的 difficulties[難度].quiz。
import * as THREE from 'three';

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const STOP = 3.2;        // 隊伍停在牆前幾公尺
const WALL_H = 1.6;
const BOARD_Y = 3.4;     // 題目板的中心高度

// ---------- 出題 ----------
// mode：ten＝10 以內、twenty＝20 以內（多半有進位、退位）、hundred＝100 以內二位數
export function makeQuestion(mode) {
  const plus = Math.random() < 0.5;
  let a, b;
  if (mode === 'ten') {
    if (plus) { a = between(1, 9); b = between(1, 10 - a); } else { a = between(2, 10); b = between(1, a - 1); }
  } else if (mode === 'twenty') {
    const carry = Math.random() < 0.7;
    if (plus) {
      do { a = between(2, 15); b = between(2, 20 - a); } while (a + b > 20 || b < 2 || ((a % 10) + (b % 10) >= 10) !== carry);
    } else {
      do { a = between(11, 20); b = between(2, 9); } while (((a % 10) < b) !== carry);
    }
  } else {
    const carry = Math.random() < 0.5;
    if (plus) {
      do { a = between(10, 89); b = between(Math.random() < 0.3 ? 2 : 10, 99 - a); } while (b < 2 || ((a % 10) + (b % 10) >= 10) !== carry);
    } else {
      do { a = between(20, 99); b = between(Math.random() < 0.3 ? 2 : 10, a - 1); } while (((a % 10) < (b % 10)) !== carry);
    }
  }
  const answer = plus ? a + b : a - b;
  // 三個答案：正確答案＋兩個常見的錯（差 1、差 2；二位數多一個「差 10」＝進位、退位忘了算）
  const near = mode === 'hundred' ? [1, -1, 10, -10, 2, -2] : [1, -1, 2, -2, 3, -3];
  const top = { ten: 10, twenty: 20 }[mode] ?? 99; // 錯的答案也不超出範圍，才不會一看就知道
  const wrong = new Set();
  for (const d of [...near].sort(() => Math.random() - 0.5)) {
    const v = answer + d;
    if (v >= 0 && v <= top && v !== answer && wrong.size < 2) wrong.add(v);
  }
  const choices = [answer, ...wrong].sort(() => Math.random() - 0.5);
  return { text: `${a} ${plus ? '+' : '−'} ${b}`, a, b, op: plus ? '+' : '−', answer, choices };
}

// 獎勵：加 N 夥伴，或 ×2／×3（人數乘了會超過上限時改成加）
export function makeReward(cfg, count, max) {
  const k = Math.random() < 0.5 ? 2 : 3;
  if (Math.random() < (cfg.multChance ?? 0.3) && count >= 2 && count * k <= max) return { op: '×', k };
  return { op: '+', k: between(cfg.add[0], cfg.add[1]) };
}

export const rewardText = (r) => `${r.op}${r.k}`;
export const flipped = (r) => ({ op: { '+': '−', '×': '÷' }[r.op], k: r.k });

export function applyReward(r, n, max) {
  let v = n;
  if (r.op === '+') v = n + r.k;
  else if (r.op === '−') v = n - r.k;
  else if (r.op === '×') v = n * r.k;
  else if (r.op === '÷') v = Math.floor(n / r.k);
  return Math.min(max, Math.max(1, v));
}

// ---------- 牆的外觀 ----------
function boardTexture(question, reward) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const g = canvas.getContext('2d');
  g.fillStyle = '#2b1d12';
  g.beginPath(); g.roundRect(8, 8, 1008, 496, 40); g.fill();
  g.fillStyle = '#f5ead0';
  g.beginPath(); g.roundRect(28, 28, 968, 456, 30); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#1f2937';
  g.font = `900 ${question.length > 8 ? 170 : 200}px "Microsoft JhengHei", sans-serif`;
  g.fillText(`${question} = ?`, 512, 200);
  g.fillStyle = '#1d4ed8';
  g.beginPath(); g.roundRect(222, 340, 580, 110, 55); g.fill();
  g.fillStyle = '#fff';
  g.font = '900 76px "Microsoft JhengHei", sans-serif';
  g.fillText(`答對：夥伴 ${rewardText(reward)}`, 512, 397);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function choiceTexture(value) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const g = canvas.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${String(value).length > 2 ? 120 : 150}px "Microsoft JhengHei", sans-serif`;
  g.lineWidth = 16; g.lineJoin = 'round'; g.strokeStyle = '#1e3a8a';
  g.strokeText(String(value), 128, 136);
  g.fillStyle = '#fff';
  g.fillText(String(value), 128, 136);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.95, flatShading: true });
const postMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });

export class QuizWalls {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.pending = [];
    this.history = [];
    this.current = null;
  }

  load(defs) {
    this.clear();
    this.pending = defs.map((w) => ({ ...w }));
    this.history = [];
  }

  clear() {
    for (const w of this.list) this.game.scene.remove(w.group);
    this.list = [];
    this.current = null;
  }

  laneX(i) { const slot = (this.game.track.halfWidth * 2) / 3; return -this.game.track.halfWidth + slot * (i + 0.5); }

  // 牆在前方 spawnAhead 公尺時才蓋（題目在跑到牆前才出，人數才會是當下的）
  build(def) {
    const { game } = this;
    const half = game.track.halfWidth;
    const group = new THREE.Group();
    group.position.z = -def.d;
    // 石牆：一排石塊，打碎時各自飛出去
    const blocks = [];
    const cols = 8, rows = 2, bw = (half * 2 + 1) / cols, bh = WALL_H / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.96, bh * 0.94, 0.7), stoneMat);
      m.position.set(-half - 0.5 + bw * (c + 0.5) + (r % 2 ? bw * 0.15 : 0), bh * (r + 0.5), 0);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      blocks.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    // 題目板（題目出了才貼字）
    const boardMat = new THREE.MeshBasicMaterial({ color: 0xf5ead0 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.2), boardMat);
    board.position.set(0, BOARD_Y, 0.05);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, BOARD_Y + 1.6, 0.25), postMat);
      post.position.set(s * 3.0, (BOARD_Y + 1.6) / 2, -0.1);
      post.castShadow = true;
      group.add(post);
      blocks.push({ mesh: post, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    group.add(board);
    blocks.push({ mesh: board, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    // 三個答案牌，貼在牆前面
    const tiles = [0, 1, 2].map((i) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.85 });
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(2.6, WALL_H * 0.9), mat);
      tile.position.set(this.laneX(i), WALL_H / 2, 0.4);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      label.position.set(this.laneX(i), WALL_H / 2, 0.42);
      label.visible = false;
      group.add(tile, label);
      blocks.push({ mesh: tile, vel: new THREE.Vector3(), spin: new THREE.Vector3() }, { mesh: label, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
      return { tile, label };
    });
    game.scene.add(group);
    const wall = { ...def, group, board, tiles, blocks, state: 'waiting', fade: 0 };
    this.list.push(wall);
    return wall;
  }

  // 跑到牆前：出題
  ask(w) {
    const { game } = this;
    const cfg = game.difficulty.quiz;
    w.q = makeQuestion(cfg.mode);
    w.reward = makeReward(cfg, game.crowd.count, game.maxCount);
    w.state = 'asking';
    w.time = cfg.seconds;
    w.total = cfg.seconds;
    w.board.material = new THREE.MeshBasicMaterial({ map: boardTexture(w.q.text, w.reward) });
    w.tiles.forEach((t, i) => { t.label.material.map = choiceTexture(w.q.choices[i]); t.label.material.needsUpdate = true; t.label.visible = true; });
    // 一開始選英雄現在站的那一道
    w.lane = [0, 1, 2].reduce((best, i) => (Math.abs(this.laneX(i) - game.crowd.x) < Math.abs(this.laneX(best) - game.crowd.x) ? i : best), 1);
    this.current = w;
    game.onQuizStart(w);
  }

  select(i) {
    const w = this.current;
    if (!w || w.state !== 'asking') return;
    w.lane = Math.max(0, Math.min(2, i));
    this.game.onQuizSelect(w);
  }

  move(dir) { if (this.current) this.select(this.current.lane + dir); }

  // chosen：第幾個答案；null＝時間到
  answer(chosen) {
    const w = this.current;
    if (!w || w.state !== 'asking') return;
    const { game } = this;
    w.state = 'breaking';
    w.chosen = chosen;
    const value = chosen === null ? null : w.q.choices[chosen];
    const right = value === w.q.answer;
    const reward = right ? w.reward : flipped(w.reward);
    const before = game.crowd.count;
    const after = applyReward(reward, before, game.maxCount);
    // 牆碎掉：石塊往前後左右飛
    for (const b of w.blocks) {
      b.vel.set((Math.random() - 0.5) * 8, 3 + Math.random() * 5, -2 - Math.random() * 6);
      b.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    }
    this.current = null;
    const rec = { q: w.q.text, answer: w.q.answer, value, right, reward: w.reward, applied: reward, before, after };
    this.history.push(rec);
    game.onQuizAnswer(w, rec);
  }

  update(dt) {
    const { game } = this;
    const { crowd } = game;
    while (this.pending.length && this.pending[0].d - crowd.d < game.settings.spawnAhead) this.build(this.pending.shift());
    for (const w of this.list) {
      if (w.state === 'waiting' && crowd.d >= w.d - STOP) { crowd.d = w.d - STOP; this.ask(w); }
      if (w.state === 'asking') {
        w.time -= dt;
        w.tiles.forEach((t, i) => {
          const on = i === w.lane;
          t.tile.material.color.set(on ? 0xfacc15 : 0x3b82f6);
          t.tile.scale.setScalar(on ? 1.08 + Math.sin(game.clock.elapsedTime * 8) * 0.03 : 1);
        });
        if (w.time <= 0) this.answer(null);
      }
      if (w.state === 'breaking') {
        w.fade += dt;
        for (const b of w.blocks) {
          b.vel.y -= 18 * dt;
          b.mesh.position.addScaledVector(b.vel, dt);
          b.mesh.rotation.x += b.spin.x * dt; b.mesh.rotation.y += b.spin.y * dt;
        }
      }
    }
    this.list = this.list.filter((w) => {
      if (w.state === 'breaking' && w.fade > 1.6) { game.scene.remove(w.group); return false; }
      return true;
    });
  }

  // 隊伍是不是被牆擋住（還沒答完的牆）
  blocking(d) { return this.list.some((w) => (w.state === 'waiting' || w.state === 'asking') && d >= w.d - STOP - 0.01); }
}
