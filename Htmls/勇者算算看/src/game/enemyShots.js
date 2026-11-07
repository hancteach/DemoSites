// 敵人丟出來的東西（跑酷版），和陷阱一樣「每個人各自判斷」：碰到的夥伴可能倒下（trapKillChance）；英雄有夥伴保護，只剩英雄時才扣血。
//   lane  直線（箭、飛鏢、火球）：從敵人那裡沿著一條直線往隊伍飛（+z），預警線由出手的敵人先畫，左右閃就躲得掉
//   lob   拋物線（火焰彈、毒液）：先在落點畫紅圈，落地時圈裡的人被打到；pool 落地留下毒池
//   pool  毒池：留在路上，走過去的人會被打到（同一灘毒同一個人只算一次）
// spec：model（沒匯入就畫 color 色的球，大小 size）、modelScale、modelRotation、modelGlow、spin、speed、width、range、color
import * as THREE from 'three';

const LOB_PEAK = 3.4;
const SHOT_HEIGHT = 1;
const WARN_COLOR = 0xff3b2f;

const circleGeometry = new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2);

export class EnemyShots {
  constructor(game) {
    this.game = game;
    this.lanes = [];
    this.lobs = [];
    this.pools = [];
    this.prefabs = new Map();
    this.ball = new THREE.SphereGeometry(1, 12, 8);
  }

  makeObject(spec) {
    const { assets } = this.game;
    if (spec.model && assets.loaded.has(spec.model)) {
      const key = `${spec.model}|${spec.modelRotation ?? ''}|${spec.modelGlow ?? ''}`;
      if (!this.prefabs.has(key)) {
        const { scene, materials } = assets.instantiate(spec.model);
        if (spec.modelRotation) scene.rotation.set(...spec.modelRotation.map(THREE.MathUtils.degToRad));
        if (spec.modelGlow) for (const m of materials) { m.emissive.setHex(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = spec.modelGlow; }
        const prefab = new THREE.Group();
        prefab.add(scene);
        this.prefabs.set(key, prefab);
      }
      const object = this.prefabs.get(key).clone();
      object.scale.setScalar(spec.modelScale ?? 1);
      return object;
    }
    const mesh = new THREE.Mesh(this.ball, new THREE.MeshBasicMaterial({ color: spec.color ?? '#ffffff' }));
    mesh.scale.setScalar(spec.size ?? 0.24);
    mesh.userData.own = true;
    return mesh;
  }

  dispose(object) {
    this.game.scene.remove(object);
    if (object.userData.own) object.material?.dispose();
  }

  // 畫出來的人逐一判斷：test(位置) 成立就算打到（每個 hitSet 同一個人只算一次）
  hitMembers(test, hitSet, def) {
    const { game } = this;
    if (game.state !== 'playing') return;
    for (const m of [...game.crowd.members]) {
      const a = m.actor;
      if (!a || hitSet.has(m) || !test(a.position)) continue;
      // 夥伴會保護英雄：還有夥伴時，敵人的這些攻擊只打夥伴；只剩英雄才打英雄（否則箭都瞄準英雄，英雄一下就倒，整局就輸了）
      if (m.hero && game.crowd.count > 1) { a.flash(0xffffff); continue; }
      hitSet.add(m);
      const chance = (def.kill ?? game.settings.trapKillChance ?? 1) * (game.difficulty.shotKillMult ?? 1); // 簡單模式比較少倒
      if (m.hero || Math.random() < chance) game.trapMember(m, def);
      else a.flash(0xff6060);
    }
  }

  lane(x, z, spec) {
    const object = this.makeObject(spec);
    object.position.set(x, spec.height ?? SHOT_HEIGHT, z);
    this.game.scene.add(object);
    this.lanes.push({ object, spec, x, z, traveled: 0, hit: new Set() });
  }

  warnCircle(x, z, radius) {
    const mesh = new THREE.Mesh(circleGeometry, new THREE.MeshBasicMaterial({ color: WARN_COLOR, transparent: true, opacity: 0.18, depthWrite: false }));
    mesh.position.set(x, 0.07, z);
    mesh.scale.set(radius, 1, radius);
    this.game.scene.add(mesh);
    return mesh;
  }

  // delay 秒後才從 owner 手上丟出去（期間 owner 倒下就取消）；紅圈一開始就出現
  lob(owner, target, spec, delay = 0) {
    this.lobs.push({ owner, target: { ...target }, spec, delay, time: 0, total: delay + spec.flight, warn: this.warnCircle(target.x, target.z, spec.radius), object: null });
  }

  pool(x, z, def) {
    const mesh = new THREE.Mesh(circleGeometry, new THREE.MeshBasicMaterial({ color: def.color ?? '#7ddc4a', transparent: true, opacity: 0.55, depthWrite: false }));
    mesh.position.set(x, 0.06, z);
    mesh.scale.set(def.radius, 1, def.radius);
    this.game.scene.add(mesh);
    this.pools.push({ mesh, def, x, z, life: def.duration, bubble: 0, hit: new Set() });
  }

  update(dt) {
    const { game } = this;
    const { fx, crowd } = game;
    const back = -crowd.d + crowd.depth + 4; // 隊伍最後面再往後一點

    this.lanes = this.lanes.filter((s) => {
      const step = s.spec.speed * dt;
      s.z += step;
      s.traveled += step;
      s.object.position.z = s.z;
      if (s.spec.spin) s.object.rotation.y += s.spec.spin * Math.PI * 2 * dt;
      if (s.spec.trail) fx.burst(s.x, s.object.position.y, s.z, 1, s.spec.color, 0.5);
      const half = s.spec.width ?? 0.4;
      this.hitMembers((p) => Math.abs(p.x - s.x) <= half + 0.3 && Math.abs(p.z - s.z) <= 0.7, s.hit, s.spec);
      if (s.z < back && s.traveled < (s.spec.range ?? 60)) return true;
      this.dispose(s.object);
      return false;
    });

    this.lobs = this.lobs.filter((l) => {
      l.time += dt;
      l.warn.material.opacity = 0.16 + 0.42 * Math.min(1, l.time / l.total);
      if (!l.object) {
        if (l.time < l.delay) {
          if (l.owner.alive) return true;
          game.scene.remove(l.warn); l.warn.material.dispose(); // 還沒丟就被打倒：取消
          return false;
        }
        const o = l.owner.position;
        l.from = { x: o.x, y: o.y + SHOT_HEIGHT * (l.owner.def.scale ?? 1), z: o.z };
        l.object = this.makeObject(l.spec);
        game.scene.add(l.object);
      }
      const t = Math.min(1, (l.time - l.delay) / l.spec.flight);
      const { from, target } = l;
      l.object.position.set(from.x + (target.x - from.x) * t, from.y * (1 - t) + LOB_PEAK * 4 * t * (1 - t), from.z + (target.z - from.z) * t);
      if (l.spec.spin) l.object.rotation.y += l.spec.spin * Math.PI * 2 * dt;
      fx.burst(l.object.position.x, l.object.position.y, l.object.position.z, 1, l.spec.color, 0.5);
      if (t < 1) return true;
      this.dispose(l.object);
      game.scene.remove(l.warn); l.warn.material.dispose();
      fx.blastRing(target.x, target.z, l.spec.radius, l.spec.color);
      fx.burst(target.x, 0.4, target.z, 22, l.spec.color, 4);
      game.sfx.blast();
      this.hitMembers((p) => Math.hypot(p.x - target.x, p.z - target.z) <= l.spec.radius, new Set(), l.spec);
      if (l.spec.pool) this.pool(target.x, target.z, l.spec.pool);
      return false;
    });

    this.pools = this.pools.filter((p) => {
      p.life -= dt;
      p.bubble -= dt;
      p.mesh.material.opacity = 0.55 * Math.min(1, p.life);
      if (p.bubble <= 0) {
        p.bubble = 0.2;
        const a = Math.random() * Math.PI * 2, r = Math.random() * p.def.radius;
        fx.burst(p.x + Math.cos(a) * r, 0.15, p.z + Math.sin(a) * r, 1, p.def.color, 0.8);
      }
      if (p.life > 0.5) this.hitMembers((q) => Math.hypot(q.x - p.x, q.z - p.z) <= p.def.radius, p.hit, p.def);
      if (p.life > 0 && p.z < back + 10) return true;
      game.scene.remove(p.mesh);
      p.mesh.material.dispose();
      return false;
    });
  }

  clear() {
    for (const s of this.lanes) this.dispose(s.object);
    for (const l of this.lobs) { if (l.object) this.dispose(l.object); this.game.scene.remove(l.warn); l.warn.material.dispose(); }
    for (const p of this.pools) { this.game.scene.remove(p.mesh); p.mesh.material.dispose(); }
    this.lanes = [];
    this.lobs = [];
    this.pools = [];
  }
}
