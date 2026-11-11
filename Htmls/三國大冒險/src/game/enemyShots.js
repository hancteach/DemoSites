// 敵人的飛行道具：直線（箭、飛鏢、毒液）、拋物線（火焰彈、毒液球）與地上的毒池。
// 只打玩家（不誤傷自己人），直線的撞到場景物件就停。都有預警：直線由出手的敵人先畫瞄準線，
// 拋物線在落點畫紅圈（出手前就畫，飛行中越來越亮），毒池本身就看得到。
// spec 欄位（characters.json 的 ability.shot 或 Boss 招式的 shot）：
//   model 模型 id（沒匯入就畫一顆 color 色的球）、modelScale、modelRotation（度）、modelGlow、spin 每秒自轉圈數
//   speed、range、width 命中半徑、damage、height 飛行高度、color
//   拋物線另有 flight 飛行秒數、radius 爆炸半徑、pool 落地留下毒池 { radius, duration, color }
//   攻城關卡（2026-11-11）：peak 拋物線最高點（沒寫 3.4，箭用小一點比較平）、orient 模型頭朝飛行方向（箭）、
//   rubble 落在地面時留下擋路的碎石。高度都跟著地面走：從城牆頂丟到牆下、或落在牆頂都可以
import * as THREE from 'three';

const WARN_COLOR = 0xff3b2f;
const WARN_HEIGHT = 0.07;
const SHOT_HEIGHT = 1;
const LOB_PEAK = 3.4;
const POOL_HEIGHT = 0.05;
const POOL_FADE = 1;
const POOL_BUBBLE = 0.18;
const POOL_TOUCH = 0.35; // 腳踩進去多少才算

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

  // 模型外觀和玩家的飛行道具用同一套設定（modelRotation、modelGlow）
  makeObject(spec) {
    const { assets, projectiles } = this.game;
    if (spec.model && assets.loaded.has(spec.model)) {
      const key = `${spec.model}|${spec.modelRotation ?? ''}|${spec.modelGlow ?? ''}`;
      if (!this.prefabs.has(key)) this.prefabs.set(key, projectiles.makePrefab(spec));
      const object = this.prefabs.get(key).clone();
      object.scale.setScalar(spec.modelScale ?? 1);
      return object;
    }
    const material = new THREE.MeshBasicMaterial({ color: spec.color ?? '#ffffff' });
    const mesh = new THREE.Mesh(this.ball, material);
    mesh.scale.setScalar(spec.size ?? 0.22);
    mesh.userData.own = true; // 自己建的材質，移除時要釋放
    return mesh;
  }

  dispose(object) {
    this.game.scene.remove(object);
    if (object.userData.own) object.material.dispose();
  }

  // 開場先建好（第一發不卡）
  prepare(specs) {
    for (const spec of specs) if (spec?.model) this.dispose(this.makeObject(spec));
  }

  fire(x, z, dirX, dirZ, spec) {
    const object = this.makeObject(spec);
    const base = this.game.groundY(x, z);   // 從城牆頂射出的就在牆頂的高度飛
    object.position.set(x + dirX * 0.6, base + (spec.height ?? SHOT_HEIGHT), z + dirZ * 0.6);
    object.rotation.y = Math.atan2(dirX, dirZ);
    this.game.scene.add(object);
    this.shots.push({ object, spec, dirX, dirZ, traveled: 0, base });
  }

  warnCircle(x, z, radius) {
    const mesh = new THREE.Mesh(circleGeometry, new THREE.MeshBasicMaterial({ color: WARN_COLOR, transparent: true, opacity: 0.18, depthWrite: false }));
    mesh.position.set(x, WARN_HEIGHT + this.game.groundY(x, z), z);
    mesh.scale.set(radius, 1, radius);
    this.game.scene.add(mesh);
    return mesh;
  }

  // delay 秒後才從 owner 手上丟出去（期間 owner 倒下就取消）；落點的紅圈一開始就出現
  lob(owner, target, spec, delay = 0) {
    const warn = this.warnCircle(target.x, target.z, spec.radius);
    this.lobs.push({ owner, target: { x: target.x, y: this.game.groundY(target.x, target.z), z: target.z }, spec, delay, warn, time: 0, object: null, from: null, total: delay + spec.flight });
  }

  launch(lob) {
    const { owner } = lob;
    lob.from = { x: owner.position.x, y: owner.position.y + (lob.spec.height ?? SHOT_HEIGHT) * (owner.def.scale ?? 1), z: owner.position.z };
    lob.object = this.makeObject(lob.spec);
    lob.object.position.set(lob.from.x, lob.from.y, lob.from.z);
    this.game.scene.add(lob.object);
  }

  pool(x, z, def) {
    const material = new THREE.MeshBasicMaterial({ color: def.color ?? '#7ddc4a', transparent: true, opacity: 0.55, depthWrite: false });
    const mesh = new THREE.Mesh(circleGeometry, material);
    mesh.position.set(x, POOL_HEIGHT + this.game.groundY(x, z), z);
    mesh.scale.set(def.radius, 1, def.radius);
    this.game.scene.add(mesh);
    this.pools.push({ mesh, def, x, z, life: def.duration, bubble: 0 });
  }

  // y：這一擊所在的地面高度；玩家不在同一層（例如正在爬梯子、或在城牆另一層）就打不到
  hitsPlayer(x, z, reach, y = this.game.groundY(x, z)) {
    const { player } = this.game;
    if (Math.abs(player.position.y - y) > 1.4) return false;
    return player.state !== 'dead' && Math.hypot(player.position.x - x, player.position.z - z) <= reach + player.radius * 0.6;
  }

  update(dt) {
    const { game } = this;
    const { player, fx, level } = game;

    this.shots = this.shots.filter((shot) => {
      const { object, spec } = shot;
      const step = spec.speed * dt;
      object.position.x += shot.dirX * step;
      object.position.z += shot.dirZ * step;
      if (spec.spin) object.rotation.y += spec.spin * Math.PI * 2 * dt;
      shot.traveled += step;
      if (spec.trail) fx.burstRaw(object.position.x, object.position.y, object.position.z, 1, spec.color, 0.6);
      const { x, z } = object.position;
      const top = shot.base > 0.5;
      let done = shot.traveled >= spec.range || level.colliders.some((c) => !!c.top === top && Math.hypot(x - c.x, z - c.z) <= c.r)
        || level.heightAt(x, z) > shot.base + 0.5;   // 地面的箭射到城牆就停
      if (!done && this.hitsPlayer(x, z, spec.width, shot.base)) {
        const before = player.hp;
        player.takeDamage(spec.damage ?? 1);
        if (spec.push && player.hp < before) player.pushFrom(x - shot.dirX, z - shot.dirZ, spec.push);   // 大亂鬥：被射中會往後退
        fx.burstRaw(x, object.position.y, z, 10, spec.color ?? '#ffffff', 3);
        done = true;
      }
      if (done) this.dispose(object);
      return !done;
    });

    this.lobs = this.lobs.filter((lob) => {
      lob.time += dt;
      const { spec, warn } = lob;
      warn.material.opacity = 0.16 + 0.4 * Math.min(1, lob.time / lob.total);
      if (!lob.object) {
        if (lob.time < lob.delay) {
          if (lob.owner.alive) return true;
          game.scene.remove(warn); warn.material.dispose(); // 還沒丟出去就被打倒：取消
          return false;
        }
        this.launch(lob);
      }
      const t = Math.min(1, (lob.time - lob.delay) / spec.flight);
      const { from, target, object } = lob;
      const prev = spec.orient ? object.position.clone() : null;
      object.position.set(from.x + (target.x - from.x) * t, from.y * (1 - t) + target.y * t + (spec.peak ?? LOB_PEAK) * 4 * t * (1 - t), from.z + (target.z - from.z) * t);
      if (prev && prev.distanceToSquared(object.position) > 1e-6) object.lookAt(object.position.clone().multiplyScalar(2).sub(prev));   // 箭頭朝飛行方向
      if (spec.spin) object.rotation.y += spec.spin * Math.PI * 2 * dt;
      fx.burstRaw(object.position.x, object.position.y, object.position.z, 1, spec.color, 0.5);
      if (t < 1) return true;
      this.dispose(object);
      game.scene.remove(warn); warn.material.dispose();
      fx.blastRing(target.x, target.z, spec.radius, spec.color);
      fx.burst(target.x, 0.4, target.z, 22, spec.color, 4);
      game.sfx.blast();
      const struck = this.hitsPlayer(target.x, target.z, spec.radius, target.y);
      if (struck) player.takeDamage(spec.damage ?? 1);
      if (spec.pool) this.pool(target.x, target.z, spec.pool);
      if (spec.rubble && !struck && target.y < 0.5) game.waves?.addRubble?.(target.x, target.z);   // 落石留在地上擋路
      return false;
    });

    this.pools = this.pools.filter((pool) => {
      pool.life -= dt;
      pool.bubble -= dt;
      pool.mesh.material.opacity = 0.55 * Math.min(1, pool.life / POOL_FADE);
      if (pool.bubble <= 0) {
        pool.bubble = POOL_BUBBLE;
        const a = Math.random() * Math.PI * 2, r = Math.random() * pool.def.radius;
        fx.burst(pool.x + Math.cos(a) * r, 0.15, pool.z + Math.sin(a) * r, 1, pool.def.color, 0.8);
      }
      // 踩在毒池裡就扣血；玩家受傷後有無敵時間，所以不會一格扣一下
      if (pool.life > POOL_FADE * 0.5 && player.state !== 'dead' && Math.hypot(player.position.x - pool.x, player.position.z - pool.z) <= pool.def.radius + player.radius - POOL_TOUCH) {
        player.takeDamage(pool.def.damage ?? 1);
      }
      if (pool.life > 0) return true;
      game.scene.remove(pool.mesh);
      pool.mesh.material.dispose();
      return false;
    });
  }

  // 給測試機器人閃躲用：拋物線落點與毒池都是圓
  dangers() {
    return [
      ...this.lobs.map((l) => ({ x: l.target.x, z: l.target.z, r: l.spec.radius })),
      ...this.pools.map((p) => ({ x: p.x, z: p.z, r: p.def.radius })),
    ];
  }

  clear() {
    for (const shot of this.shots) this.dispose(shot.object);
    for (const lob of this.lobs) {
      if (lob.object) this.dispose(lob.object);
      this.game.scene.remove(lob.warn);
      lob.warn.material.dispose();
    }
    for (const pool of this.pools) { this.game.scene.remove(pool.mesh); pool.mesh.material.dispose(); }
    this.shots = [];
    this.lobs = [];
    this.pools = [];
  }
}
