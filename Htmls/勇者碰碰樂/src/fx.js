// 特效：擴散的圈、預警範圍、光束、火花、飛行物、傷害數字、地上的火。全部跟著遊戲時間（暫停會停）。
import * as THREE from 'three';
import { makeLook, LOOKS } from './models.js';

const ringGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
const diskGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
const planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const sparkGeo = new THREE.SphereGeometry(0.09, 6, 4);
const ballGeo = new THREE.SphereGeometry(0.28, 12, 8);
const mat = (color, opacity, add = true) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });

export class Fx {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.list = [];
    this.layer = document.getElementById('numbers');
    this.fires = []; // 地上的火 { x, z, r, turns, damage, mesh }
  }

  add(obj, life, update) {
    if (obj) this.scene.add(obj);
    const f = { obj, life, t: 0, update };
    this.list.push(f);
    return f;
  }

  // 往外擴散的圈（協力技、震地、補血）
  ring(x, z, radius, color = 0xffffff, dur = 0.45, y = 0.08) {
    const m = new THREE.Mesh(ringGeo, mat(color, 0.9));
    m.position.set(x, y, z);
    this.add(m, dur, (f, k) => { m.scale.setScalar(radius * (0.25 + 0.75 * Math.sqrt(k))); m.material.opacity = 0.9 * (1 - k); });
  }

  // 預警：地上一塊半透明的範圍，時間到消失
  disk(x, z, radius, color = 0xff3030, dur = 0.6) {
    const m = new THREE.Mesh(diskGeo, mat(color, 0.35, false));
    m.position.set(x, 0.06, z);
    m.scale.setScalar(radius);
    this.add(m, dur, (f, k) => { m.material.opacity = 0.2 + 0.25 * Math.abs(Math.sin(k * Math.PI * 3)); });
  }

  // 直線光束：從 (x1,z1) 到 (x2,z2)，先半透明預警 warn 秒，再亮一下
  beam(x1, z1, x2, z2, width, color = 0xff3030, warn = 0.6, flash = 0.3) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(planeGeo, mat(color, 0.25, false));
    m.position.set((x1 + x2) / 2, 0.07, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    m.scale.set(width, 1, len);
    const total = warn + flash;
    this.add(m, total, (f, k) => {
      const t = k * total;
      if (t < warn) { m.material.opacity = 0.18 + 0.2 * Math.abs(Math.sin(t * 9)); m.scale.x = width; }
      else { const q = (t - warn) / flash; m.material.blending = THREE.AdditiveBlending; m.material.opacity = 0.95 * (1 - q); m.scale.x = width * (1.1 - 0.4 * q); }
    });
  }

  // 撞擊的火花
  sparks(x, z, color = 0xffe08a, n = 8, y = 0.7) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(sparkGeo, mat(color, 1));
      m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 4, up = 2 + Math.random() * 3;
      const v = new THREE.Vector3(Math.cos(a) * s, up, Math.sin(a) * s);
      this.add(m, 0.35 + Math.random() * 0.2, (f, k, dt) => { v.y -= 14 * dt; m.position.addScaledVector(v, dt); m.material.opacity = 1 - k; });
    }
  }

  // 飛行物：從 from 飛到 to（{x,y,z}），look 是投射物外觀或顏色。回傳 Promise，到了才 resolve
  projectile(from, to, { look = null, color = 0xffffff, speed = 22, arc = 0 } = {}) {
    return new Promise((resolve) => {
      let obj = look ? makeLook(look) : null;
      if (!obj) obj = new THREE.Mesh(ballGeo, mat(color, 1));
      const spin = look ? LOOKS[look]?.spin ?? 0 : 0;
      const a = new THREE.Vector3(from.x, from.y ?? 1, from.z), b = new THREE.Vector3(to.x, to.y ?? 1, to.z);
      const dist = a.distanceTo(b), dur = Math.max(0.12, dist / speed);
      obj.position.copy(a);
      obj.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      const inner = obj.children[0];
      this.add(obj, dur, (f, k, dt) => {
        obj.position.lerpVectors(a, b, k);
        obj.position.y += Math.sin(k * Math.PI) * arc;
        if (spin && inner) inner.rotation.z += spin * dt;
        if (k >= 1) resolve();
      });
    });
  }

  // 傷害、補血數字（HTML，跟著 3D 位置）
  number(x, y, z, text, cls = '') {
    const el = document.createElement('div');
    el.className = `num ${cls}`;
    el.textContent = text;
    this.layer.appendChild(el);
    const p = new THREE.Vector3(x + (Math.random() - 0.5) * 0.6, y, z);
    const s0 = this.game.toScreen(p.x, p.y, p.z);
    el.style.transform = `translate(${s0.x}px, ${s0.y}px) translate(-50%, -50%) scale(0.6)`;
    this.add(null, 0.9, (f, k) => {
      const s = this.game.toScreen(p.x, p.y + k * 1.2, p.z);
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${k < 0.15 ? 0.6 + k * 3 : 1})`;
      el.style.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
      if (k >= 1) el.remove();
    });
  }

  // 巫女的火：留在地上好幾回合
  addFire(x, z, r, turns, damage) {
    const m = new THREE.Mesh(diskGeo, mat(0xff4a10, 0.38));
    m.position.set(x, 0.05, z);
    m.scale.setScalar(r);
    this.scene.add(m);
    this.fires.push({ x, z, r, turns, damage, mesh: m });
  }
  clearFires() { for (const f of this.fires) this.scene.remove(f.mesh); this.fires = []; }

  clear() {
    for (const f of this.list) if (f.obj) this.scene.remove(f.obj);
    this.list = [];
    this.layer.innerHTML = '';
    this.clearFires();
  }

  update(dt, time) {
    for (const f of this.list) {
      f.t += dt;
      const k = Math.min(1, f.t / f.life);
      f.update(f, k, dt);
      if (k >= 1) { f.done = true; if (f.obj) this.scene.remove(f.obj); }
    }
    this.list = this.list.filter((f) => !f.done);
    for (const f of this.fires) f.mesh.material.opacity = 0.3 + 0.1 * Math.sin(time * 6 + f.x);
  }
}
