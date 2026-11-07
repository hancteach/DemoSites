// 打擊感特效：刀光、火花、地面衝擊波、畫面震動。全部用物件池，不在戰鬥中產生新物件。
import * as THREE from 'three';

function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.shake = 0;

    // 刀光：扇形環，加法混色
    this.slashes = [];
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.rotation.x = -Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.add(mesh);
      pivot.visible = false;
      scene.add(pivot);
      this.slashes.push({ pivot, mesh, mat, life: 0, max: 0, key: '' });
    }
    this.slashGeo = new Map();

    // 地面衝擊波
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, mat, life: 0, max: 0, radius: 1 });
    }

    // 火花：Points，每顆有速度與壽命
    this.maxSparks = 900;
    this.sparkPos = new Float32Array(this.maxSparks * 3);
    this.sparkCol = new Float32Array(this.maxSparks * 3);
    this.sparkVel = new Float32Array(this.maxSparks * 3);
    this.sparkLife = new Float32Array(this.maxSparks);
    this.sparkBase = new Float32Array(this.maxSparks * 3);
    this.sparkNext = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparks = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.42, map: radialTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
  }

  slash(x, z, yaw, arc, range, { color = 0xbfe8ff, y = 1.0, life = 0.16, tilt = 0 } = {}) {
    const key = `${arc.toFixed(2)}_${range.toFixed(1)}`;
    if (!this.slashGeo.has(key)) this.slashGeo.set(key, slashGeometry(arc, range));
    const s = this.slashes.find((q) => q.life <= 0) ?? this.slashes[0];
    s.mesh.geometry = this.slashGeo.get(key);
    // RingGeometry 的 0 度在 +X；角色正面是 +Z（yaw=0）
    s.mesh.rotation.z = -Math.PI / 2;
    s.pivot.position.set(x, y, z);
    s.pivot.rotation.set(tilt, yaw, 0, 'YXZ');
    s.mat.color.setHex(color);
    s.life = s.max = life;
    s.pivot.visible = true;
    s.pivot.scale.setScalar(0.7);
  }

  ring(x, z, radius, { color = 0xffd27a, life = 0.35 } = {}) {
    const r = this.rings.find((q) => q.life <= 0) ?? this.rings[0];
    r.mesh.position.set(x, 0.06, z);
    r.mat.color.setHex(color);
    r.life = r.max = life;
    r.radius = radius;
    r.mesh.visible = true;
  }

  burst(x, y, z, count = 10, { color = [1, 0.8, 0.45], speed = 7, up = 3 } = {}) {
    for (let n = 0; n < count; n++) {
      const i = this.sparkNext;
      this.sparkNext = (this.sparkNext + 1) % this.maxSparks;
      this.sparkPos[i * 3] = x; this.sparkPos[i * 3 + 1] = y; this.sparkPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.sparkVel[i * 3] = Math.cos(a) * s;
      this.sparkVel[i * 3 + 1] = up * (0.3 + Math.random());
      this.sparkVel[i * 3 + 2] = Math.sin(a) * s;
      this.sparkLife[i] = 0.25 + Math.random() * 0.2;
      this.sparkBase.set(color, i * 3);
    }
  }

  addShake(amount) { this.shake = Math.min(1.2, Math.max(this.shake, amount)); }

  update(dt) {
    for (const s of this.slashes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const k = Math.max(0, s.life / s.max);
      s.mat.opacity = k;
      s.pivot.scale.setScalar(0.7 + (1 - k) * 0.45);
      if (s.life <= 0) s.pivot.visible = false;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = Math.max(0, r.life / r.max);
      r.mesh.scale.setScalar(r.radius * (0.25 + (1 - k) * 0.85));
      r.mat.opacity = k;
      if (r.life <= 0) r.mesh.visible = false;
    }
    for (let i = 0; i < this.maxSparks; i++) {
      if (this.sparkLife[i] <= 0) { this.sparkCol[i * 3] = this.sparkCol[i * 3 + 1] = this.sparkCol[i * 3 + 2] = 0; continue; }
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 18 * dt;
      for (let c = 0; c < 3; c++) this.sparkPos[i * 3 + c] += this.sparkVel[i * 3 + c] * dt;
      const k = Math.max(0, Math.min(1, this.sparkLife[i] / 0.3));
      for (let c = 0; c < 3; c++) this.sparkCol[i * 3 + c] = this.sparkBase[i * 3 + c] * k;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;
    this.shake = Math.max(0, this.shake - dt * 3.2);
  }
}

// 刀光形狀：外緣最亮、往內變暗；揮過去的尾端也變暗，看起來像一道弧光
function slashGeometry(arc, range) {
  const geo = new THREE.RingGeometry(range * 0.45, range, 40, 3, -arc / 2, arc);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const full = arc > Math.PI * 1.9;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = (Math.hypot(x, y) - range * 0.45) / (range * 0.55);
    const a = full ? 1 : (Math.atan2(y, x) + arc / 2) / arc; // 0＝起點、1＝刀尖
    const k = Math.pow(r, 2.2) * (0.2 + 0.8 * a);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export { radialTexture };
