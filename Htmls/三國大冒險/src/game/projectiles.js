// 飛行道具：刀波、箭、火球共用。差別都在 spec（數值來自 characters.json 與 items.json）：
// { visual, model, modelScale, speed, range, width, color, pierce, blast }
// model：用已匯入的模型當外觀（正面朝 +Z，不是的話用 modelRotation 轉，度）；沒匯入時退回 visual 畫的形狀。
// modelScale 模型大小；modelGlow 自發光強度（火這類不受場景光影響的東西）。
// muzzle：發射點 { side 往角色左手邊, height 高度, ahead 往前 }，沒寫就從身體中央、0.9 公尺高。
// pierce：穿過敵人一路打到底；blast：命中或飛到底時爆炸的半徑；burn：被爆炸打到的敵人著火。
// cycle：每次攻擊輪流換一種外觀（忍者：苦無、飛鏢），每項蓋過 shot 的欄位；spin：模型繞自己的面旋轉（度／秒，飛鏢用）。
// fire：命中或飛到底時地上著火 { radius, duration, color }，敵人踩到就燃燒（用 burn 的數值，日本巫女的火焰箭）。
import * as THREE from 'three';

const FADE_DISTANCE = 3;
const BLAST_SHAKE = 0.3;
const FIRE_MAX = 14;          // 地上的火最多同時幾塊，穿透箭一路點火也不會太多
const FIRE_FLAME_EVERY = 0.12;
const FIRE_FADE = 0.6;
const fireGeometry = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);

function makeVisuals() {
  // 月牙開口朝後、弧面朝前（+Z）
  const wave = new THREE.RingGeometry(0.75, 1.5, 24, 1, Math.PI * 0.14, Math.PI * 0.72);
  wave.rotateX(-Math.PI / 2);
  wave.rotateY(Math.PI);
  const arrow = new THREE.CylinderGeometry(0.02, 0.09, 1.5, 6);
  arrow.rotateX(Math.PI / 2);
  return {
    wave: { geometry: wave, blending: THREE.AdditiveBlending, scale: (width) => width, trail: 1, fades: true },
    arrow: { geometry: arrow, blending: THREE.NormalBlending, scale: () => 1, trail: 1, fades: false },
    fireball: { geometry: new THREE.SphereGeometry(1, 16, 12), blending: THREE.AdditiveBlending, scale: (width) => width, trail: 3, fades: false },
  };
}

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.visuals = makeVisuals();
    this.prefabs = new Map(); // 模型 id → 共用的原型，每發只複製節點，幾何與材質共用
    this.fires = [];
  }

  // 這個角色會射出的所有外觀（含輪流的、藍藥水加強的）
  static specsOf(def) {
    if (!def.shot) return [];
    const base = [def.shot, { ...def.shot, ...def.boost?.shot }];
    return base.flatMap((s) => (s.cycle ? s.cycle.map((c) => ({ ...s, ...c })) : [s]));
  }

  // 開場先建好並編譯，否則第一發會卡一下（發光材質要另外編譯著色器）
  prepare(def) {
    const { game } = this;
    const specs = Projectiles.specsOf(def).filter((s) => s.model && game.assets.loaded.has(s.model));
    const fresh = [...new Map(specs.filter((s) => !this.prefabs.has(s.model)).map((s) => [s.model, s])).values()];
    if (!fresh.length) return;
    for (const spec of fresh) {
      const prefab = this.makePrefab(spec);
      this.prefabs.set(spec.model, prefab);
      game.scene.add(prefab);
      prefab.traverse((o) => { if (o.material?.map) game.renderer.initTexture(o.material.map); });
    }
    game.renderer.compile(game.scene, game.camera);
    for (const spec of fresh) game.scene.remove(this.prefabs.get(spec.model));
  }

  makePrefab(spec) {
    const { scene, materials } = this.game.assets.instantiate(spec.model);
    if (spec.modelRotation) scene.rotation.set(...spec.modelRotation.map(THREE.MathUtils.degToRad));
    if (spec.modelGlow) {
      for (const m of materials) { m.emissive.setHex(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = spec.modelGlow; }
    }
    const prefab = new THREE.Group(); // 轉向放在內層，外層才能自由設定飛行方向
    prefab.add(scene);
    return prefab;
  }

  createObject(spec, visual) {
    const { assets } = this.game;
    if (spec.model && assets.loaded.has(spec.model)) {
      if (!this.prefabs.has(spec.model)) this.prefabs.set(spec.model, this.makePrefab(spec));
      const object = this.prefabs.get(spec.model).clone();
      object.scale.setScalar(spec.modelScale ?? 1);
      return object;
    }
    const material = new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: visual.blending });
    const mesh = new THREE.Mesh(visual.geometry, material);
    mesh.scale.setScalar(visual.scale(spec.width));
    return mesh;
  }

  fire(position, yaw, spec, swing) {
    const visual = this.visuals[spec.visual];
    const mesh = this.createObject(spec, visual);
    const { side = 0, height = 0.9, ahead = 0 } = spec.muzzle ?? {};
    const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
    mesh.position.set(position.x + forwardX * ahead + forwardZ * side, (position.y ?? 0) + height, position.z + forwardZ * ahead - forwardX * side);
    mesh.rotation.y = yaw;
    this.game.scene.add(mesh);
    this.list.push({ mesh, visual, spec, swing, dirX: Math.sin(yaw), dirZ: Math.cos(yaw), traveled: 0, vy: this.rise(position, yaw, spec, mesh.position.y) });
  }

  // 攻城關卡：瞄準方向上有不同高度的敵人（城牆上的弓兵、牆下的小兵）時，飛行道具往上／往下斜著飛過去。
  // 回傳每秒垂直速度；沒有高台的關卡一律 0（水平飛）
  rise(position, yaw, spec, startY) {
    const { game } = this;
    if (!game.level.platforms.length) return 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best = null, bestDist = spec.range ?? 12;
    for (const e of game.enemies) {
      if (!e.canBeHit) continue;
      const dx = e.position.x - position.x, dz = e.position.z - position.z, dist = Math.hypot(dx, dz);
      if (dist < 0.5 || dist > bestDist || (dx * fx + dz * fz) / dist < 0.97) continue;   // 前方約 14 度內最近的
      best = e; bestDist = dist;
    }
    if (!best || Math.abs(best.position.y - (position.y ?? 0)) < 0.5) return 0;
    return ((best.position.y + 1 - startY) * spec.speed) / bestDist;
  }

  // 地上著火：敵人踩進去就燃燒，玩家不會被自己的火燒到
  ignite(x, z, spec) {
    const { fire } = spec;
    if (this.fires.length >= FIRE_MAX) this.removeFire(this.fires.shift());
    const material = new THREE.MeshBasicMaterial({ color: fire.color ?? '#ff7a1a', transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(fireGeometry, material);
    mesh.position.set(x, 0.04 + this.game.groundY(x, z), z);
    mesh.scale.setScalar(fire.radius);
    this.game.scene.add(mesh);
    this.fires.push({ mesh, x, z, fire, burn: spec.burn, life: fire.duration, flame: 0 });
  }

  removeFire(f) {
    this.game.scene.remove(f.mesh);
    f.mesh.material.dispose();
  }

  updateFires(dt) {
    const { game } = this;
    this.fires = this.fires.filter((f) => {
      f.life -= dt;
      f.flame -= dt;
      f.mesh.material.opacity = 0.38 * Math.min(1, f.life / FIRE_FADE) * (0.85 + Math.sin(game.level.time * 13 + f.x) * 0.15);
      if (f.flame <= 0) {
        f.flame = FIRE_FLAME_EVERY;
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * f.fire.radius * 0.85;
        game.fx.flame(f.x + Math.cos(a) * r, 0.1, f.z + Math.sin(a) * r, 1);
      }
      if (f.burn) {
        for (const enemy of game.enemies) {
          if (!enemy.canBeHit || enemy.airborne || Math.abs(enemy.position.y - f.mesh.position.y) > 1) continue;
          if (Math.hypot(enemy.position.x - f.x, enemy.position.z - f.z) <= f.fire.radius + enemy.radius * 0.5) enemy.ignite(f.burn);
        }
      }
      if (f.life > 0) return true;
      this.removeFire(f);
      return false;
    });
  }

  remove(shot) {
    this.game.scene.remove(shot.mesh);
    shot.mesh.material?.dispose(); // 模型的材質是共用的，不能釋放
  }

  clear() {
    for (const shot of this.list) this.remove(shot);
    this.list = [];
    for (const f of this.fires) this.removeFire(f);
    this.fires = [];
  }

  // 爆炸範圍裡的敵人各算一下；同一次攻擊已經打過的不重複
  explode(shot) {
    const { game } = this;
    const { x, z } = shot.mesh.position;
    const { blast, color } = shot.spec;
    for (const chest of game.breakables) {
      if (Math.hypot(chest.position.x - x, chest.position.z - z) <= blast + chest.radius && this.near(shot, chest, 2)) game.hitBreakable(chest, shot.swing);
    }
    for (const enemy of game.enemies) {
      if (shot.swing.has(enemy) || !enemy.canBeHit || !this.near(shot, enemy, 2.4)) continue;
      if (Math.hypot(enemy.position.x - x, enemy.position.z - z) > blast + enemy.radius) continue;
      shot.swing.add(enemy);
      const damage = game.playerDamage(enemy);
      if (!game.damageEnemy(enemy, damage, x, z)) continue;
      if (!shot.spec.burn) continue;
      game.showDamage(enemy, damage);
      enemy.ignite(shot.spec.burn);
    }
    game.fx.blastRing(x, z, blast, color);
    game.fx.burstRaw(x, shot.mesh.position.y, z, 36, color, 5);
    game.fx.shake(BLAST_SHAKE);
    game.sfx.blast();
  }

  // 高度差太多就打不到（地面的箭打不到城牆頂的人，除非是斜著飛上去的）。會飛的敵人不看高度，和以前一樣
  near(shot, target, limit = 1.8) {
    if (target.def?.fly) return true;
    return Math.abs(target.position.y + 0.9 - shot.mesh.position.y) <= limit;
  }

  // 回傳 true 表示這發打完了
  collide(shot) {
    const { game } = this;
    const { mesh, spec, swing } = shot;
    for (const enemy of game.enemies) {
      if (swing.has(enemy) || !enemy.canBeHit || !this.near(shot, enemy)) continue;
      const dist = Math.hypot(enemy.position.x - mesh.position.x, enemy.position.z - mesh.position.z);
      if (dist > spec.width + enemy.radius) continue;
      if (spec.blast && !spec.pierce) return true; // 爆炸在 update 統一處理；會穿透的飛到底才炸
      swing.add(enemy);
      const damage = game.playerDamage(enemy);
      const landed = game.damageEnemy(enemy, damage, mesh.position.x - shot.dirX, mesh.position.z - shot.dirZ);
      if (landed && spec.burn) { game.showDamage(enemy, damage); enemy.ignite(spec.burn); }
      if (spec.fire && spec.pierce) this.ignite(enemy.position.x, enemy.position.z, spec); // 穿透箭一路點火
      game.sfx.hit();
      if (!spec.pierce) return true;
    }
    for (const chest of game.breakables) {
      if (swing.has(chest) || !this.near(shot, chest)) continue;
      if (Math.hypot(chest.position.x - mesh.position.x, chest.position.z - mesh.position.z) > spec.width + chest.radius) continue;
      if (spec.blast && !spec.pierce) return true;
      game.hitBreakable(chest, swing);
      if (!spec.pierce || chest.solid) return true;   // 拒馬連穿透的風刃也擋得住
    }
    // 攻城關卡：撞到城牆（比牆頂低超過一個垛口）就停
    return game.level.heightAt(mesh.position.x, mesh.position.z) - 1 > mesh.position.y;
  }

  update(dt) {
    const { game } = this;
    this.updateFires(dt);
    this.list = this.list.filter((shot) => {
      const { mesh, spec, visual } = shot;
      const step = spec.speed * dt;
      if (spec.spin && mesh.children[0]) mesh.children[0].rotation.z += THREE.MathUtils.degToRad(spec.spin) * dt;
      mesh.position.x += shot.dirX * step;
      mesh.position.z += shot.dirZ * step;
      mesh.position.y += shot.vy * dt;
      shot.traveled += step;
      if (visual.fades) mesh.material.opacity = 0.9 * Math.min(1, (spec.range - shot.traveled) / FADE_DISTANCE);
      game.fx.burstRaw(mesh.position.x, mesh.position.y, mesh.position.z, visual.trail, spec.color, 0.8);

      const hit = this.collide(shot);
      if (!hit && shot.traveled < spec.range) return true;
      if (spec.blast) this.explode(shot);
      if (spec.fire) this.ignite(mesh.position.x, mesh.position.z, spec);
      this.remove(shot);
      return false;
    });
  }
}
