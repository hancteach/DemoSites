// 子彈與特效：同一種外觀的子彈全部畫在同一個 InstancedMesh（一次畫完），上百顆也不卡。
// 有模型的用素材庫的模型（弓箭、苦無、飛鏢、火焰箭、火球、火焰彈），沒有的（劍氣、聖光、斬擊波、敵人的光球）才用簡單形狀。
// 模型的方向設定（rot 度、scale）和《勇者大冒險》characters.json 一樣：模型正面朝 +Z；這裡再轉半圈變成朝 -Z（畫面上方）。
import * as THREE from 'three';
import { loadGltf } from './models.js';

const D2R = Math.PI / 180;
const dummy = new THREE.Object3D();
const color = new THREE.Color();

// 用模型的外觀
const MODEL_LOOKS = {
  arrow: { model: '弓箭', scale: 1.5, rot: [0, 0, 0], max: 260 },
  kunai: { model: '角色武器_忍者_苦無', scale: 1.1, rot: [90, 0, 0], max: 260 },
  shuriken: { model: '角色武器_忍者_飛鏢', scale: 1.15, rot: [90, 0, 0], max: 220, spin: 14 },
  firearrow: { model: '角色武器_日本巫女_火焰箭', scale: 2.4, rot: [0, 90, 0], glow: 0.8, emit: '#ff7a30', max: 200 },
  fire: { model: '火球', scale: 1.0, rot: [-90, 0, 0], glow: 0.9, max: 140 },
  ember: { model: '火焰彈', scale: 0.85, rot: [0, 0, 0], glow: 0.9, max: 260 },
  // 敵人用的
  e_arrow: { model: '弓箭', scale: 1.4, rot: [0, 0, 0], max: 160 },
  e_star: { model: '飛鏢', scale: 0.5, rot: [-90, 0, 0], max: 200, spin: 10 },
  e_fire: { model: '火焰彈', scale: 0.6, rot: [0, 0, 0], glow: 0.9, max: 300 },
};

// 沒有模型的外觀：簡單形狀（正面朝 -Z）
function crescent(r, tube, arc = Math.PI * 0.9) {
  const g = new THREE.TorusGeometry(r, tube, 5, 20, arc);
  g.rotateZ((Math.PI - arc) / 2);
  g.rotateX(-Math.PI / 2);   // 弧形往 -Z 凸出
  g.scale(1, 0.35, 1);
  return g;
}
const SHAPE_LOOKS = {
  blade: { geo: () => crescent(0.85, 0.11), max: 120 },
  dark: { geo: () => crescent(1.25, 0.18), max: 60 },
  holy: { geo: () => new THREE.IcosahedronGeometry(0.36, 1), max: 140 },
};

class Pool {
  // parts：[{ geometry, material }]，同一顆子彈的每個部分用同一個位置
  constructor(scene, parts, max, colored = false) {
    this.meshes = parts.map(({ geometry, material }) => {
      const m = new THREE.InstancedMesh(geometry, material, max);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    });
    this.max = max;
    this.colored = colored;
  }
  // items：{ x, y, z, yaw, spin, s, color }
  sync(items, scale = 1) {
    let n = 0;
    for (const it of items) {
      if (n >= this.max) break;
      dummy.position.set(it.x, it.y ?? 1, it.z);
      dummy.rotation.set(0, it.yaw ?? 0, 0);
      if (it.spin) dummy.rotateY(it.spin);
      dummy.scale.setScalar((it.s ?? 1) * scale);
      dummy.updateMatrix();
      for (const m of this.meshes) {
        m.setMatrixAt(n, dummy.matrix);
        if (this.colored) m.setColorAt(n, color.set(it.color ?? '#ffffff'));
      }
      n++;
    }
    for (const m of this.meshes) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

// 把模型拆成「幾何＋材質」，模型本身的位置、旋轉、縮放都先烘進幾何裡
async function modelParts(look) {
  const gltf = await loadGltf(look.model);
  const root = new THREE.Group();
  const inner = gltf.scene.clone();
  inner.rotation.set(...look.rot.map((d) => d * D2R));
  root.add(inner);
  root.rotation.y = Math.PI;          // 正面 +Z → -Z
  root.scale.setScalar(look.scale);
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const material = o.material.clone();
    if (look.glow && material.emissive) {
      material.emissive.set(look.emit ?? '#ffffff');   // emit：發光的顏色（火焰箭原本偏粉紅，用橘色讓它像火）
      material.emissiveMap = material.map;
      material.emissiveIntensity = look.glow;
    }
    parts.push({ geometry, material });
  });
  return parts;
}

export class Shots {
  constructor(scene) {
    this.scene = scene;
    this.hero = [];     // 我方子彈
    this.enemy = [];    // 敵人子彈
    this.sparks = [];   // 火花
    this.rings = [];    // 爆炸圈
    this.pools = {};
    this.spins = {};
    for (const [k, d] of Object.entries(SHAPE_LOOKS)) {
      this.pools[k] = new Pool(scene, [{ geometry: d.geo(), material: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }) }], d.max, true);
    }
    const ball = new THREE.SphereGeometry(0.26, 10, 8);
    this.core = new Pool(scene, [{ geometry: ball, material: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }) }], 500);
    this.halo = new Pool(scene, [{ geometry: ball, material: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }) }], 600, true);
    this.spark = new Pool(scene, [{ geometry: new THREE.OctahedronGeometry(0.12, 0), material: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }) }], 400, true);
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);
  }

  // 載入子彈模型（遊戲開始前做一次）
  async load() {
    await Promise.all(Object.entries(MODEL_LOOKS).map(async ([k, look]) => {
      this.pools[k] = new Pool(this.scene, await modelParts(look), look.max);
      this.spins[k] = look.spin;
    }));
  }

  addHero(s) { this.hero.push(s); return s; }
  addEnemy(b) { if (this.enemy.length < 480) this.enemy.push(b); return b; }

  burst(x, z, col, n = 6, speed = 5, y = 1) {
    for (let i = 0; i < n && this.sparks.length < 380; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      this.sparks.push({ x, y, z, vx: Math.cos(a) * v, vy: 2 + Math.random() * 4, vz: Math.sin(a) * v, life: 0.35 + Math.random() * 0.3, color: col, s: 1 });
    }
  }

  ring(x, z, radius, col, time = 0.4) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    m.position.set(x, 0.08, z);
    this.scene.add(m);
    this.rings.push({ m, t: 0, time, radius });
  }

  update(dt) {
    for (const s of this.sparks) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vy -= 14 * dt; s.s = Math.max(0.1, s.life * 2.4); }
    this.sparks = this.sparks.filter((s) => s.life > 0 && s.y > 0);
    for (const r of this.rings) {
      r.t += dt;
      const k = r.t / r.time;
      r.m.scale.setScalar(0.2 + k * r.radius);
      r.m.material.opacity = 0.9 * (1 - k);
      if (k >= 1) { this.scene.remove(r.m); r.m.material.dispose(); }
    }
    this.rings = this.rings.filter((r) => r.t < r.time);
  }

  // 每一格畫面把位置寫進 InstancedMesh
  sync(time) {
    const by = {};
    for (const s of this.hero) (by[s.look] ??= []).push(s);
    const balls = [];
    for (const b of this.enemy) {
      if (b.look && this.pools[b.look]) (by[b.look] ??= []).push(b);
      else balls.push(b);
    }
    for (const [k, pool] of Object.entries(this.pools)) {
      const items = by[k] ?? [];
      const spin = this.spins[k];
      if (spin) for (const s of items) s.spin = time * spin;
      pool.sync(items);
    }
    this.core.sync(balls, 0.62);              // 中心白色、外圈是子彈的顏色
    this.halo.sync(this.enemy, 1.15);         // 有模型的敵人子彈也加一圈光，比較好閃
    this.spark.sync(this.sparks);
  }

  clear() {
    this.hero = []; this.enemy = []; this.sparks = [];
    for (const r of this.rings) { this.scene.remove(r.m); r.m.material.dispose(); }
    this.rings = [];
    this.sync(0);
  }
}
