// 敵人丟出來的東西（塔防版）：
//   fire  追蹤彈（箭、飛鏢、毒液、火球）打擋路的騎士兵或英雄
//   lob   拋物線（火焰彈）只是外觀，落點的效果（塔暈眩）由丟的人用 game.warnArea 處理，預警圈也是它畫的
//   pool  地上的毒池：站在裡面的騎士兵、英雄每秒扣血（敵人不受影響）
// spec：model（沒匯入就畫 color 色的球，大小 size）、modelScale、modelRotation、modelGlow、spin、speed、color
import * as THREE from 'three';

const HIT_DISTANCE = 0.45;
const LOB_PEAK = 3.4;
const POOL_HEIGHT = 0.06;
const POOL_FADE = 1;
const POOL_TICK = 1;

const circleGeometry = new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2);

export class EnemyShots {
  constructor(game) {
    this.game = game;
    this.shots = [];
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
    mesh.scale.setScalar(spec.size ?? 0.22);
    mesh.userData.own = true;
    return mesh;
  }

  dispose(object) {
    this.game.scene.remove(object);
    if (object.userData.own) object.material.dispose();
  }

  fire(from, target, spec, damage, source) {
    const object = this.makeObject(spec);
    object.position.set(from.x, from.y, from.z);
    this.game.scene.add(object);
    this.shots.push({ object, target, spec, damage, source, last: { x: target.position.x, z: target.position.z } });
  }

  lob(from, to, spec, flight) {
    const object = this.makeObject(spec);
    object.position.set(from.x, from.y, from.z);
    this.game.scene.add(object);
    this.lobs.push({ object, from: { ...from }, to: { ...to }, spec, flight, time: 0 });
  }

  pool(x, z, def) {
    const mesh = new THREE.Mesh(circleGeometry, new THREE.MeshBasicMaterial({ color: def.color ?? '#7ddc4a', transparent: true, opacity: 0.55, depthWrite: false }));
    mesh.position.set(x, POOL_HEIGHT, z);
    mesh.scale.set(def.radius, 1, def.radius);
    this.game.scene.add(mesh);
    this.pools.push({ mesh, def, x, z, life: def.duration, tick: 0, bubble: 0 });
  }

  update(dt) {
    const { game } = this;
    const { fx } = game;

    this.shots = this.shots.filter((shot) => {
      const { object, target, spec } = shot;
      if (target.canBlock) shot.last = { x: target.position.x, z: target.position.z }; // 目標倒下就飛到最後看到的位置
      const dx = shot.last.x - object.position.x, dz = shot.last.z - object.position.z, dy = 1 - object.position.y;
      const dist = Math.hypot(dx, dz);
      const step = spec.speed * dt;
      if (spec.spin) object.rotation.y += spec.spin * Math.PI * 2 * dt;
      else object.rotation.y = Math.atan2(dx, dz);
      if (spec.trail) fx.burst(object.position.x, object.position.y, object.position.z, 1, spec.color, 0.5);
      if (dist > Math.max(step, HIT_DISTANCE)) {
        object.position.x += (dx / dist) * step;
        object.position.z += (dz / dist) * step;
        object.position.y += dy * Math.min(1, step / dist);
        return true;
      }
      if (target.canBlock) target.takeDamage(shot.damage, shot.source);
      fx.burst(object.position.x, 1, object.position.z, 8, spec.color ?? '#ffffff', 3);
      this.dispose(object);
      return false;
    });

    this.lobs = this.lobs.filter((lob) => {
      lob.time += dt;
      const t = Math.min(1, lob.time / lob.flight);
      const { from, to, object, spec } = lob;
      object.position.set(from.x + (to.x - from.x) * t, from.y * (1 - t) + LOB_PEAK * 4 * t * (1 - t), from.z + (to.z - from.z) * t);
      if (spec.spin) object.rotation.y += spec.spin * Math.PI * 2 * dt;
      fx.burst(object.position.x, object.position.y, object.position.z, 1, spec.color, 0.5);
      if (t < 1) return true;
      this.dispose(object);
      return false;
    });

    this.pools = this.pools.filter((pool) => {
      pool.life -= dt;
      pool.tick -= dt;
      pool.bubble -= dt;
      pool.mesh.material.opacity = 0.55 * Math.min(1, pool.life / POOL_FADE);
      if (pool.bubble <= 0) {
        pool.bubble = 0.2;
        const a = Math.random() * Math.PI * 2, r = Math.random() * pool.def.radius;
        fx.burst(pool.x + Math.cos(a) * r, 0.15, pool.z + Math.sin(a) * r, 1, pool.def.color, 0.8);
      }
      if (pool.tick <= 0 && pool.life > POOL_FADE * 0.5) {
        pool.tick = POOL_TICK;
        for (const b of game.blockers()) {
          if (Math.hypot(b.position.x - pool.x, b.position.z - pool.z) <= pool.def.radius + b.radius * 0.5) b.takeDamage(game.enemyDamage(pool.def.damage ?? 1), null);
        }
      }
      if (pool.life > 0) return true;
      game.scene.remove(pool.mesh);
      pool.mesh.material.dispose();
      return false;
    });
  }

  clear() {
    for (const s of this.shots) this.dispose(s.object);
    for (const l of this.lobs) this.dispose(l.object);
    for (const p of this.pools) { this.game.scene.remove(p.mesh); p.mesh.material.dispose(); }
    this.shots = [];
    this.lobs = [];
    this.pools = [];
  }
}
