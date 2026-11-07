// 遠程攻擊：弓箭手的箭、魔法師的火球、忍者的苦無與飛鏢、日本巫女的火焰箭。招式裡寫 shot 就會射出去，不寫就是近身揮砍。
// shot 欄位：kind（arrow／fire／bigfire／kunai／shuriken／firearrow，決定外觀）、kinds（一招混著丟，例如 ["kunai","shuriken"]，
//   第幾發輪流用）、count 幾發、spread 每發間隔幾度、speed、range 飛多遠、
//   radius 碰撞半徑、pierce 穿透幾隻（箭）、blast 爆炸半徑（火球：碰到第一隻或飛到底就爆）、damage、knock、launch、juggle、
//   burn 打中的敵人燃燒 { time 秒, every 幾秒扣一次, damage }、fire 停下的地方地上著火 { radius, time }，敵人碰到火也燃燒
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 外觀：模型、大小、轉向（模型正面要朝 +Z）、自發光（火不受場景光影響）、拖尾火花顏色、
// roll 整個繞飛行方向轉（火球）、spin 模型繞自己的面轉（飛鏢，弧度／秒）
const LOOKS = {
  arrow: { model: '弓箭', scale: 1.5, rot: [0, 0, 0], glow: 0, trail: null },
  fire: { model: '火球', scale: 0.95, rot: [-90, 0, 0], glow: 0.9, trail: [1, 0.55, 0.2], roll: true },
  bigfire: { model: '火焰彈', scale: 1.7, rot: [0, 0, 0], glow: 0.9, trail: [1, 0.45, 0.15], roll: true },
  kunai: { model: '角色武器_忍者_苦無', scale: 0.9, rot: [90, 0, 0], glow: 0, trail: null },
  shuriken: { model: '角色武器_忍者_飛鏢', scale: 0.9, rot: [90, 0, 0], glow: 0, trail: null, spin: 16 },
  firearrow: { model: '角色武器_日本巫女_火焰箭', scale: 1.5, rot: [0, 90, 0], glow: 0.6, trail: [1, 0.5, 0.15] },
};
const D2R = Math.PI / 180;
const FIRE_MAX = 24;          // 地上的火最多同時幾塊
const FIRE_CHECK = 0.2;       // 幾秒檢查一次誰踩在火上
const FIRE_FADE = 0.6;
const FLAME_EVERY = 0.18;     // 燃燒中的敵人多久冒一次火花
const fireGeometry = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);

export class Shots {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.prefabs = new Map();
    this._near = [];
    this.fires = [];
    this.burning = new Set();
  }

  async load() {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(LOOKS).map(async ([kind, look]) => {
      const gltf = await loader.loadAsync(`assets/models/${encodeURIComponent(look.model)}/${encodeURIComponent(look.model)}.glb`);
      const inner = gltf.scene;
      inner.rotation.set(...look.rot.map((d) => d * D2R));
      inner.traverse((o) => {
        if (!o.isMesh) return;
        if (look.glow) {
          o.material = o.material.clone();
          o.material.emissive?.setHex(0xffffff);
          o.material.emissiveMap = o.material.map;
          o.material.emissiveIntensity = look.glow;
        }
      });
      const prefab = new THREE.Group();
      prefab.add(inner);
      prefab.scale.setScalar(look.scale);
      this.prefabs.set(kind, prefab);
    }));
  }

  // 從物件池拿一個同種類、沒在用的，沒有才複製新的
  take(kind) {
    let s = this.list.find((q) => !q.alive && q.kind === kind);
    if (!s) {
      s = { kind, obj: this.prefabs.get(kind).clone(), hit: new Set() };
      this.game.scene.add(s.obj);
      this.list.push(s);
    }
    s.alive = true;
    s.hit.clear();
    s.obj.visible = true;
    return s;
  }

  // 主角射出一招：count 發，以 yaw 為中心左右散開
  fire(x, y, z, yaw, spec, { air = false } = {}) {
    const n = spec.count ?? 1;
    const volley = { hits: 0 }; // 同一招射出去的一起算「一招打中幾隻」（挑戰任務）
    for (let i = 0; i < n; i++) {
      const a = yaw + (i - (n - 1) / 2) * (spec.spread ?? 0) * D2R;
      const s = this.take(spec.kinds ? spec.kinds[i % spec.kinds.length] : spec.kind);
      s.spec = spec; s.air = air; s.volley = volley;
      s.dx = Math.sin(a); s.dz = Math.cos(a);
      s.x = x + s.dx * 0.6; s.z = z + s.dz * 0.6; s.y = y;
      s.dist = 0;
      s.pierce = spec.pierce ?? 1;
      s.obj.position.set(s.x, s.y, s.z);
      s.obj.rotation.set(0, a, 0);
    }
  }

  clear() {
    for (const s of this.list) { s.alive = false; s.obj.visible = false; }
    for (const f of this.fires) { this.game.scene.remove(f.mesh); f.mesh.material.dispose(); }
    this.fires = [];
    for (const u of this.burning) u.burn = null;
    this.burning.clear();
  }

  // 燃燒：再被點燃時時間重算，扣血節奏不重來（否則一直踩在火上永遠不扣血）
  ignite(u, burn) {
    if (u.hp <= 0) return;
    u.burn = { left: burn.time ?? 4, every: burn.every ?? 1, damage: burn.damage ?? 1, tick: u.burn?.tick ?? (burn.every ?? 1), flame: 0 };
    this.burning.add(u);
  }

  // 地上著火：主角踩到不會受傷
  burnGround(x, z, sp) {
    const { fire } = sp;
    if (this.fires.length >= FIRE_MAX) { const old = this.fires.shift(); this.game.scene.remove(old.mesh); old.mesh.material.dispose(); }
    const mesh = new THREE.Mesh(fireGeometry, new THREE.MeshBasicMaterial({ color: fire.color ?? 0xff4a10, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.set(x, 0.05, z);
    mesh.scale.setScalar(fire.radius);
    this.game.scene.add(mesh);
    this.fires.push({ mesh, x, z, radius: fire.radius, left: fire.time ?? 4, burn: sp.burn ?? {}, check: 0, flame: 0 });
  }

  updateFire(dt) {
    const g = this.game;
    this.fires = this.fires.filter((f) => {
      f.left -= dt; f.check -= dt; f.flame -= dt;
      f.mesh.material.opacity = 0.4 * Math.min(1, f.left / FIRE_FADE) * (0.85 + Math.sin(f.left * 13 + f.x) * 0.15);
      if (f.flame <= 0) {
        f.flame = 0.07;
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * f.radius * 0.85;
        g.fx.burst(f.x + Math.cos(a) * r, 0.15, f.z + Math.sin(a) * r, 1, { color: [1, 0.45 + Math.random() * 0.3, 0.1], speed: 0.8, up: 3 });
      }
      if (f.check <= 0) {
        f.check = FIRE_CHECK;
        for (const u of g.horde.near(f.x, f.z, f.radius + 0.6, this._near)) {
          if (u.hp > 0 && u.y < 0.8 && Math.hypot(u.x - f.x, u.z - f.z) <= f.radius + u.type.def.radius * 0.5) this.ignite(u, f.burn);
        }
      }
      if (f.left > 0) return true;
      g.scene.remove(f.mesh); f.mesh.material.dispose();
      return false;
    });
    for (const u of this.burning) {
      const b = u.burn;
      if (!b || u.hp <= 0) { u.burn = null; this.burning.delete(u); continue; }
      b.left -= dt; b.tick -= dt; b.flame -= dt;
      if (b.flame <= 0) { b.flame = FLAME_EVERY; g.fx.burst(u.x, 0.6 + u.y + Math.random() * 0.8, u.z, 1, { color: [1, 0.5, 0.12], speed: 1, up: 2.5 }); }
      if (b.tick <= 0 && u.state !== 'air') { b.tick += b.every; g.killSource = 'burn'; g.horde.damage(u, b.damage, 0, 0, 0, 0); } // 被挑在空中時落地再扣
      if (b.left <= 0) { u.burn = null; this.burning.delete(u); }
    }
  }

  update(dt) {
    const g = this.game;
    this.updateFire(dt);
    for (const s of this.list) {
      if (!s.alive) continue;
      const sp = s.spec;
      const step = sp.speed * dt;
      s.x += s.dx * step; s.z += s.dz * step; s.dist += step;
      s.obj.position.set(s.x, s.y, s.z);
      const look = LOOKS[s.kind];
      if (look.roll) s.obj.rotation.z += dt * 8;
      if (look.spin) s.obj.children[0].rotation.z += dt * look.spin;
      if (look.trail && Math.random() < 0.6) g.fx.burst(s.x, s.y, s.z, 1, { color: look.trail, speed: 1.2, up: 0.6 });
      if (this.collide(s)) continue;
      if (s.dist >= sp.range) {
        if (sp.blast) this.explode(s);
        else this.kill(s);
        if (sp.fire) this.burnGround(s.x, s.z, sp);
      }
    }
  }

  kill(s) { s.alive = false; s.obj.visible = false; }

  // 回傳 true 表示這一發已經消失
  collide(s) {
    const g = this.game, sp = s.spec;
    const r = sp.radius ?? 0.5;
    const base = s.y - 1; // 子彈在胸口高度，換成「腳底」高度來比
    const near = g.horde.near(s.x, s.z, r + 0.8, this._near);
    let hits = 0;
    g.killSource = s.air ? 'air' : 'shot';
    for (const u of near) {
      if (u.hp <= 0 || s.hit.has(u)) continue;
      if (Math.hypot(u.x - s.x, u.z - s.z) > r + u.type.def.radius) continue;
      if (Math.abs(u.y - base) > 1.6) continue;
      if (sp.blast) { this.explode(s); return true; }
      s.hit.add(u);
      const up = sp.juggle && (u.state === 'air' || u.y > 0.3) ? Math.max(sp.launch ?? 0, sp.juggle) : (sp.launch ?? 0);
      g.horde.damage(u, sp.damage, s.dx, s.dz, sp.knock ?? 3, up);
      if (sp.burn) this.ignite(u, sp.burn);
      hits++;
      if (--s.pierce <= 0) break;
    }
    const c = g.captain;
    if (c.alive && c.hp > 0 && !s.hit.has(c) && s.y < 4.5 && Math.hypot(c.position.x - s.x, c.position.z - s.z) < r + c.radius) {
      if (sp.blast) { this.explode(s); return true; }
      s.hit.add(c);
      hits += c.strike(s.x, s.z, 0, Math.PI * 2, r + c.radius + 0.2, sp.damage * 2, { knock: sp.knock ?? 3 });
      s.pierce--;
    }
    if (hits) {
      s.volley.hits += hits;
      g.record?.('shotBest', s.volley.hits);
      g.onShotHits(hits, sp.hitstop ?? 0.03);
      g.fx.burst(s.x, s.y, s.z, 4, { color: [1, 0.9, 0.6], speed: 5 });
    }
    if (s.pierce <= 0) {
      this.kill(s);
      if (sp.fire) this.burnGround(s.x, s.z, sp);
      return true;
    }
    return false;
  }

  explode(s) {
    const g = this.game, sp = s.spec;
    const opt = s.air ? { y: s.y - 1, yReach: 2.6 } : {};
    g.killSource = s.air ? 'air' : 'shot';
    const hits = g.horde.strike(s.x, s.z, 0, Math.PI * 2, sp.blast, sp.damage, { knock: sp.knock ?? 6, launch: sp.launch ?? 0, juggle: sp.juggle ?? 0, ...opt })
      + g.captain.strike(s.x, s.z, 0, Math.PI * 2, sp.blast, sp.damage * 2, { knock: sp.knock ?? 6 });
    g.fx.ring(s.x, s.z, sp.blast, { color: sp.kind === 'arrow' ? 0xffe9a8 : 0xff7a2a, life: 0.3 });
    g.fx.burst(s.x, s.y, s.z, sp.kind === 'bigfire' ? 22 : 12, { color: [1, 0.55, 0.2], speed: 8, up: 4 });
    g.fx.addShake(sp.kind === 'bigfire' ? 0.45 : 0.22);
    g.sfx.blast();
    if (hits) { s.volley.hits += hits; g.record?.('shotBest', s.volley.hits); g.onShotHits(hits, sp.hitstop ?? 0.05); }
    this.kill(s);
  }
}
