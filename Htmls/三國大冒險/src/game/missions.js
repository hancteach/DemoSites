// 任務波（2026-11-12）：關卡 waves 的一波寫 "objective"，這一波就不是「打完敵人」而是完成任務。
// 任務還沒完成時，"reinforce": true 的波會一直從 spawns 補兵；任務完成時場上小兵潰散（守將還要打倒）。
//   burn    燒毀建築：{ type: "burn", targets: [{ id: 建築 id（關卡 props 的 id）, name, hp }] }
//   capture 佔領旗台：{ type: "capture", name, at: [x, z], radius, time 站滿幾秒 }
//   mount   騎上馬（第 7 關）：{ type: "mount", rout: false }，馬的位置寫在關卡的 ride
//   breach  衝破關門（第 7 關）：{ type: "breach", name, z, hp }，橫跨整條路的木柵門，騎馬撞也算一下
//   escort  護送糧車：{ type: "escort", model, horse, path: [[x, z]...], speed, near 玩家離幾公尺內才走, hp,
//                      ambush: [{ at: 0～1 走到全程幾成, banner, from: [[x, z]...], spawns: [{ enemy, count }] }] }
// 每種任務提供：update(dt)、done、failed（失敗原因）、label（畫面上方的目標文字）、targets／hit（打得壞的東西）、
//               targetFor(enemy)（敵人要追誰）、onSpawn(enemy)、dispose()（重新開始時把場景還原）
import * as THREE from 'three';
import { Horse } from './mount.js';

const std = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide });

// 頭上的長條（耐久、佔領進度）：兩張面向鏡頭的 sprite
function makeBar(width, color) {
  const group = new THREE.Group();
  const mat = (c) => new THREE.SpriteMaterial({ color: c, depthTest: false, depthWrite: false, transparent: true });
  const back = new THREE.Sprite(mat(0x14090a)), fill = new THREE.Sprite(mat(color));
  back.scale.set(width + 0.12, 0.3, 1);
  fill.scale.set(width, 0.2, 1);
  back.renderOrder = 18; fill.renderOrder = 19;
  group.add(back, fill);
  return {
    group,
    set(frac) {
      const f = Math.max(0, Math.min(1, frac));
      fill.scale.x = Math.max(0.001, width * f);
      fill.position.x = -(width * (1 - f)) / 2;
    },
    color(c) { fill.material.color.set(c); },
    dispose() { back.material.dispose(); fill.material.dispose(); },
  };
}

// 旗子：canvas 畫陣營色＋字（和營寨的軍旗一樣）
function makeFlag() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 192;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.9, 8, 1).translate(0.65, 0, 0), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
  const set = (color, text) => {
    const g = canvas.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 128, 192);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, 0, 128, 14); g.fillRect(0, 178, 128, 14);
    g.fillStyle = '#ffffff'; g.font = 'bold 96px "Microsoft JhengHei","Noto Sans TC",serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 64, 100);
    tex.needsUpdate = true;
  };
  return { flag, set, dispose() { tex.dispose(); flag.geometry.dispose(); flag.material.dispose(); } };
}

// ---------------------------------------------------------------- 燒毀建築
class BurnObjective {
  constructor(game, def) {
    this.game = game;
    this.list = def.targets.map((t) => {
      const b = game.level.named.get(t.id);
      if (!b) throw new Error(`關卡裡找不到建築「${t.id}」（props 要寫 "id"）`);
      const entry = { b, name: t.name ?? t.id, hp: t.hp ?? 8, max: t.hp ?? 8, burning: 0, shake: 0, segments: [] };
      // 攻擊判定用的圓：沿著房子的碰撞圓，外面多 0.3 公尺，站在牆邊就砍得到
      entry.segments = (b.circles.length ? b.circles : [{ x: b.x, z: b.z, r: Math.min(b.w, b.d) / 2 }])
        .map((c) => ({ position: { x: c.x, y: 0, z: c.z }, radius: c.r + 0.3, owner: entry, solid: false }));
      // 地上紅圈：還沒燒的目標
      const R = Math.max(b.w, b.d) / 2 + 0.7;
      entry.ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.3, R, 48).rotateX(-Math.PI / 2), std(0xff5a3c));
      entry.ring.position.set(b.x, 0.05, b.z);
      game.scene.add(entry.ring);
      entry.bar = makeBar(2.4, 0xffb020);
      entry.bar.group.position.set(b.x, b.height + 1.1, b.z);
      entry.bar.set(1);
      game.scene.add(entry.bar.group);
      entry.colors = b.materials.map((m) => m.color.clone());
      return entry;
    });
    this.time = 0;
    this.fireModel = def.fire ?? '火計大火';
  }

  get failed() { return null; }
  get burned() { return this.list.filter((e) => e.hp <= 0).length; }
  get done() { return this.burned === this.list.length; }
  get label() { return `燒毀${this.list[0].name.replace(/[東西南北中]/g, '')} ${this.burned} / ${this.list.length}`; }
  get targets() { return this.list.filter((e) => e.hp > 0).flatMap((e) => e.segments); }

  hit(segment, swing) {
    const e = segment.owner, { game } = this;
    if (e.hp <= 0 || swing?.has(e)) return false;
    swing?.add(e);
    e.hp -= 1;
    e.shake = 0.25;
    e.bar.set(e.hp / e.max);
    const { x, z } = segment.position;
    game.fx.sparks(x, 1, z);
    game.fx.flame(x, 0.6, z, 6);
    game.fx.shake(0.12);
    game.sfx.hit();
    if (e.hp > 0) { game.fx.floatText(x, 2.4, z, `再 ${e.hp} 下`, '#ffd27a'); return true; }
    this.ignite(e);
    return true;
  }

  ignite(e) {
    const { game } = this, { b } = e;
    e.burning = 0.001;
    game.scene.remove(e.ring, e.bar.group);
    if (game.assets.loaded.has(this.fireModel)) {   // 火堆模型：放在屋子中段，從牆裡冒出來
      const fire = game.assets.instantiate(this.fireModel).scene;
      const box = new THREE.Box3().setFromObject(fire), size = box.getSize(new THREE.Vector3());
      const s = (Math.max(b.w, b.d) * 1.05) / Math.max(size.x, size.z);
      fire.scale.setScalar(s);
      fire.position.set(b.x, b.height * 0.35, b.z);
      fire.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material.emissive?.set(0x661800); } });
      game.scene.add(fire);
      e.fire = fire;
    }
    e.light = new THREE.PointLight(0xff7a2a, 0, 12, 1.6);
    e.light.position.set(b.x, b.height + 0.5, b.z);
    game.scene.add(e.light);
    game.hud.banner(this.done ? `${e.name}燒起來了！全部燒毀！` : `${e.name}燒起來了！還有 ${this.list.length - this.burned} 座`, 2, '#ff7a2a');
    game.fx.burst(b.x, b.height * 0.6, b.z, 40, '#ff7a2a', 6);
    game.fx.shake(0.5);
    game.sfx.blast();
    game.score += 80;
    game.hud.setScore(game.score);
  }

  update(dt) {
    this.time += dt;
    for (const e of this.list) {
      const { b } = e;
      if (e.hp > 0) {
        e.ring.material.opacity = 0.45 + Math.sin(this.time * 5) * 0.25;
        if (e.shake > 0) { e.shake -= dt; b.object.rotation.z = Math.sin(e.shake * 70) * 0.02; } else b.object.rotation.z = 0;
        continue;
      }
      e.burning += dt;
      const k = Math.min(1, e.burning / 2.5);   // 2.5 秒內燒黑
      b.materials.forEach((m, i) => m.color.copy(e.colors[i]).multiplyScalar(1 - 0.72 * k));
      e.light.intensity = 30 + Math.sin(this.time * 13 + b.x) * 8;
      // 火星與黑煙：在屋頂範圍內隨機
      const rx = b.x + (Math.random() - 0.5) * b.w * 0.8, rz = b.z + (Math.random() - 0.5) * b.d * 0.8;
      this.game.fx.flame(rx, b.height * (0.4 + Math.random() * 0.6), rz, 3);
      if (Math.random() < 0.25) this.game.fx.dust(rx, b.height + 0.3, rz, 2);
    }
  }

  dispose() {
    const { scene } = this.game;
    for (const e of this.list) {
      scene.remove(e.ring, e.bar.group);
      e.ring.geometry.dispose(); e.ring.material.dispose(); e.bar.dispose();
      if (e.fire) scene.remove(e.fire);
      if (e.light) { scene.remove(e.light); e.light.dispose(); }
      e.b.materials.forEach((m, i) => m.color.copy(e.colors[i]));   // 重新開始時房子恢復原狀
      e.b.object.rotation.z = 0;
    }
  }
}

// ---------------------------------------------------------------- 佔領旗台
class CaptureObjective {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.name = def.name ?? '旗台';
    this.at = def.at;
    this.radius = def.radius ?? 3.2;
    this.need = def.time ?? 8;
    this.progress = 0;
    this.time = 0;
    const [x, z] = def.at, R = this.radius;
    const root = this.root = new THREE.Group();
    root.position.set(x, 0, z);
    this.edge = new THREE.Mesh(new THREE.RingGeometry(R - 0.25, R, 64).rotateX(-Math.PI / 2), std(game.factionColor(game.enemyFaction)));
    this.edge.position.y = 0.05;
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(R - 0.3, 64).rotateX(-Math.PI / 2), std(game.factionColor(game.factionId)));
    this.fill.position.y = 0.04;
    this.fill.material.opacity = 0.35;
    this.fill.scale.setScalar(0.001);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.4, 6), new THREE.MeshStandardMaterial({ color: 0x4a3526 }));
    pole.position.y = 2.2;
    pole.castShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.35, 8), new THREE.MeshStandardMaterial({ color: 0x8c8372, flatShading: true }));
    base.position.y = 0.17;
    this.banner = makeFlag();
    this.banner.flag.position.set(0.08, 3.3, 0);
    const ef = game.factions.factions[game.enemyFaction];
    this.banner.set(ef.color, ef.banner);
    this.bar = makeBar(2.6, game.factionColor(game.factionId));
    this.bar.group.position.y = 5;
    this.bar.set(0);
    root.add(this.edge, this.fill, pole, base, this.banner.flag, this.bar.group);
    game.scene.add(root);
    this.collider = { x, z, r: 0.75 };
    game.level.colliders.push(this.collider);
    this.done = false;
  }

  get failed() { return null; }
  get targets() { return []; }
  get label() {
    const pct = Math.floor(this.progress * 100);
    if (this.contested) return `佔領${this.name} ${pct}%　敵兵在旗台裡！`;
    return this.inside ? `佔領${this.name} ${pct}%　守住旗台！` : `走進${this.name}的旗台　${pct}%`;
  }

  update(dt) {
    const { game } = this, [x, z] = this.at, R = this.radius;
    this.time += dt;
    this.banner.flag.rotation.y = Math.sin(this.time * 1.9) * 0.2;
    if (this.done) return;
    const p = game.player.position;
    this.inside = Math.hypot(p.x - x, p.z - z) < R && game.player.state !== 'dead';
    const enemiesIn = game.enemies.filter((e) => e.alive && Math.hypot(e.position.x - x, e.position.z - z) < R).length;
    this.contested = this.inside && enemiesIn > 0;
    if (this.inside && !enemiesIn) this.progress += dt / this.need;
    else if (!this.inside && enemiesIn) this.progress -= dt / (this.need * 2);   // 敵兵站著會慢慢搶回去
    this.progress = Math.max(0, Math.min(1, this.progress));
    if (this.contested && !this.toldContest) { this.toldContest = true; game.hud.toast('旗台裡有敵兵就不會前進，先打倒他們！', '#ffd27a'); }
    this.fill.scale.setScalar(Math.max(0.001, this.progress));
    this.bar.set(this.progress);
    this.edge.material.opacity = this.inside ? 0.95 : 0.55 + Math.sin(this.time * 5) * 0.3;
    if (this.inside && Math.random() < 0.3) game.fx.burst(x + (Math.random() - 0.5) * R * 1.4, 0.1, z + (Math.random() - 0.5) * R * 1.4, 1, game.factionColor(game.factionId), 1.5);
    if (this.progress >= 1) {
      this.done = true;
      const pf = game.factions.factions[game.factionId];
      this.banner.set(pf.color, pf.banner);
      this.edge.material.color.set(pf.color);
      this.root.remove(this.bar.group);
      game.hud.banner(`佔領${this.name}！`, 2, pf.color);
      game.fx.burst(x, 3, z, 40, pf.color, 6);
      game.sfx.pickup();
      game.score += 100;
      game.hud.setScore(game.score);
    }
  }

  // 旗台留在場上（攻下的插著我軍的旗），重新開始時才拿掉
  dispose() {
    const { game } = this;
    game.scene.remove(this.root);
    const i = game.level.colliders.indexOf(this.collider);
    if (i >= 0) game.level.colliders.splice(i, 1);
    this.root.traverse((o) => { o.geometry?.dispose(); if (o.isMesh) o.material.dispose(); });
    this.banner.dispose(); this.bar.dispose();
  }
}

// ---------------------------------------------------------------- 護送糧車
const CART_RADIUS = 1.3;
const BLOCK_DISTANCE = 2.4;   // 敵兵在糧車前面這麼近，糧車就停下來

class EscortObjective {
  constructor(game, def, director) {
    this.game = game;
    this.def = def;
    this.director = director;
    this.path = def.path;
    this.lengths = [];
    for (let i = 1; i < this.path.length; i++) this.lengths.push(Math.hypot(this.path[i][0] - this.path[i - 1][0], this.path[i][1] - this.path[i - 1][1]));
    this.total = this.lengths.reduce((a, b) => a + b, 0);
    this.s = 0;
    this.hp = this.max = def.hp ?? 20;
    this.speed = def.speed ?? 1.7;
    this.near = def.near ?? 6;
    this.ambush = [...(def.ambush ?? [])].sort((a, b) => a.at - b.at);
    this.root = new THREE.Group();
    this.body = new THREE.Group();   // 車＋馬（會轉向）
    this.root.add(this.body);
    const fit = (id, size) => {
      const obj = game.assets.instantiate(id).scene;
      const box = new THREE.Box3().setFromObject(obj), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const s = size / Math.max(sz.x, sz.z);
      obj.scale.setScalar(s);
      obj.position.set(-c.x * s, -box.min.y * s, -c.z * s);
      const holder = new THREE.Group();
      holder.add(obj);
      return holder;
    };
    // 模型都是朝 +Z（鏡頭）擺的：馬放在車的 -Z 那一頭，整組朝 -Z 前進
    const cart = fit(def.model, 3.2);
    this.body.add(cart);
    if (def.horse && game.assets.loaded.has(def.horse)) {
      // 綁骨的馬（mounts.json 有設定）：會走路、停下來待機（2026-11-12 晚，輕型馱馬）；靜態模型就照大小擺上去
      const cfg = game.mounts?.[def.horse];
      if (cfg && game.assets.loaded.get(def.horse).animations?.length) {
        this.horseAnim = new Horse(game, def.horse, cfg);
        this.horse = this.horseAnim.root;
      } else this.horse = fit(def.horse, 2.5);
      this.horse.position.z = -2.6;
      this.horse.rotation.y = Math.PI;   // 馬頭朝前進方向
      this.body.add(this.horse);
    }
    this.materials = [];
    this.body.traverse((o) => { if (o.isMesh) this.materials.push(o.material); });
    this.bar = makeBar(2.6, 0x4ade80);
    this.bar.group.position.y = 3.6;
    this.bar.set(1);
    this.root.add(this.bar.group);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(this.near - 0.15, this.near, 64).rotateX(-Math.PI / 2), std(0xffd27a));
    this.ring.position.y = 0.05;
    this.ring.material.opacity = 0.25;
    this.root.add(this.ring);
    game.scene.add(this.root);
    this.colliders = [{ x: 0, z: 0, r: CART_RADIUS }, { x: 0, z: 0, r: 0.8 }];   // 車、馬
    game.level.colliders.push(...this.colliders);
    this.target = { position: new THREE.Vector3(), radius: CART_RADIUS, state: 'alive', hidden: false, takeDamage: (n) => this.damage(n) };
    this.place();
    this.flash = 0;
    this.done = false;
    this.failed = null;
    this.moving = false;
  }

  get progress() { return this.s / this.total; }
  get targets() { return []; }
  get label() {
    const pct = Math.floor(this.progress * 100);
    const state = this.blocked ? '敵兵擋路！' : this.moving ? '前進中' : '回到糧車旁邊才會走';
    return `護送糧車 ${pct}%　${state}　糧車 ${Math.max(0, this.hp)} / ${this.max}`;
  }

  // 依走過的距離 s 算出位置與方向
  pointAt(s) {
    let left = Math.max(0, Math.min(this.total, s));
    for (let i = 0; i < this.lengths.length; i++) {
      const L = this.lengths[i];
      if (left <= L || i === this.lengths.length - 1) {
        const [x0, z0] = this.path[i], [x1, z1] = this.path[i + 1], t = L ? Math.min(1, left / L) : 0;
        return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, dx: (x1 - x0) / (L || 1), dz: (z1 - z0) / (L || 1) };
      }
      left -= L;
    }
    return { x: this.path[0][0], z: this.path[0][1], dx: 0, dz: -1 };
  }

  place() {
    const p = this.pointAt(this.s);
    this.root.position.set(p.x, 0, p.z);
    const yaw = Math.atan2(-p.dx, -p.dz);   // 車頭（-Z）朝前進方向
    this.body.rotation.y += (yaw - this.body.rotation.y) * 0.2;
    this.target.position.set(p.x, 0, p.z);
    const fx = -Math.sin(this.body.rotation.y), fz = -Math.cos(this.body.rotation.y);
    this.colliders[0].x = p.x; this.colliders[0].z = p.z;
    this.colliders[1].x = p.x + fx * 2.6; this.colliders[1].z = p.z + fz * 2.6;
    this.front = { x: p.x + fx * 2.2, z: p.z + fz * 2.2 };
  }

  damage(n) {
    if (this.hp <= 0 || this.done) return;
    const { game } = this, { x, z } = this.root.position;
    this.hp -= n;
    this.flash = 0.18;
    this.bar.set(this.hp / this.max);
    this.bar.color(this.hp / this.max > 0.5 ? 0x4ade80 : this.hp / this.max > 0.25 ? 0xffb020 : 0xe5484d);
    game.fx.sparks(x, 1.2, z);
    game.fx.floatText(x, 3, z, `-${n}`, '#ff6b5a');
    game.sfx.hit();
    if (!this.toldHit) { this.toldHit = true; game.hud.toast('敵兵在搶糧車！快去保護！', '#ff6b5a'); }
    if (this.hp <= 0) this.failed = '糧車被敵軍搶走了…';
  }

  // 「搶」字的小兵（近戰）去打糧車；離玩家比較近時還是打玩家
  targetFor(enemy) {
    if (!enemy.raider || this.done || this.hp <= 0) return null;
    const e = enemy.position, c = this.target.position, p = this.game.player.position;
    const d = Math.hypot(e.x - c.x, e.z - c.z);
    if (d >= Math.hypot(e.x - p.x, e.z - p.z) + 3) return null;
    // 小兵被車身擋在車外，車的中心永遠走不到「攻擊距離」：改成追車身上離他最近的一點
    const t = enemy.cartTarget ??= { position: new THREE.Vector3(), radius: 0.3, state: 'alive', hidden: false, takeDamage: (n) => this.damage(n) };
    const k = Math.min(d, CART_RADIUS * 0.8) / (d || 1);
    t.position.set(c.x + (e.x - c.x) * k, 0, c.z + (e.z - c.z) * k);
    return t;
  }

  onSpawn(enemy) {
    if (enemy.def.boss || enemy.def.ability || this.done) return;
    if (Math.random() < (this.def.raiders ?? 0.6)) {
      enemy.raider = true;
      this.game.fx.floatText(enemy.position.x, 2.4, enemy.position.z, '搶糧！', '#ff6b5a');
    }
  }

  update(dt) {
    const { game } = this;
    if (this.flash > 0) {
      this.flash -= dt;
      for (const m of this.materials) m.emissive?.setRGB(this.flash > 0 ? 0.6 : 0, 0, 0);
    }
    if (this.done || this.failed) return;
    const p = game.player.position, c = this.root.position;
    const close = Math.hypot(p.x - c.x, p.z - c.z) < this.near && game.player.state !== 'dead';
    this.blocked = game.enemies.some((e) => e.alive && Math.hypot(e.position.x - this.front.x, e.position.z - this.front.z) < BLOCK_DISTANCE);
    this.moving = close && !this.blocked;
    this.ring.material.opacity = close ? 0.15 : 0.5 + Math.sin(game.level.time * 5) * 0.25;   // 走遠了：圈圈閃，提醒回來
    if (this.moving) {
      this.s += this.speed * dt;
      if (Math.random() < 0.2) game.fx.dust(c.x, 0.2, c.z, 1);
    }
    this.place();
    this.horseAnim?.animate(dt, this.front);
    while (this.ambush.length && this.progress >= this.ambush[0].at) this.director.ambush(this.ambush.shift());
    if (this.s >= this.total) {
      this.done = true;
      this.ring.visible = false;
      game.hud.banner(this.def.arrive ?? '糧車平安到達！', 2, '#4ade80');
      game.sfx.pickup();
      game.score += 150 + this.hp * 10;
      game.hud.setScore(game.score);
    }
  }

  dispose() {
    const { game } = this;
    game.scene.remove(this.root);
    for (const c of this.colliders) { const i = game.level.colliders.indexOf(c); if (i >= 0) game.level.colliders.splice(i, 1); }
    this.ring.geometry.dispose(); this.ring.material.dispose(); this.bar.dispose();
  }
}

// ---------------------------------------------------------------- 上馬（2026-11-12 長坂坡突圍）
// { type: "mount", rout: false }：玩家騎上關卡 ride 設定的那匹馬就完成（rout:false＝完成後小兵不潰散，要打完）
class MountObjective {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.failed = null;
    this.rout = def.rout ?? false;
  }
  get done() { return Boolean(this.game.player.mount); }
  get targets() { return []; }
  get label() { return `走到${this.game.player.horse?.id ?? this.game.levelData.ride?.horse ?? '馬'}旁邊騎上去`; }
  get doneLabel() { return '上馬了！打倒剩下的敵兵'; }
  update() {}
  dispose() {}
}

// ---------------------------------------------------------------- 衝破關門
// { type: "breach", name, z, hp }：橫在路上的木柵關門（整個寬度都擋住），打 hp 下（騎馬撞也算）才倒
const GATE_SEGMENT = 1.5;

function buildGate(width, height = 3.2) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.9, flatShading: true });
  const log = new THREE.CylinderGeometry(0.2, 0.22, height, 7), tip = new THREE.ConeGeometry(0.22, 0.45, 7);
  for (let x = -width / 2 + 0.22; x <= width / 2 - 0.2; x += 0.44) {
    const h = height * (0.92 + ((x * 7.3) % 1 + 1) % 1 * 0.12);
    const m = new THREE.Mesh(log, wood);
    m.scale.y = h / height;
    m.position.set(x, h / 2, 0);
    m.castShadow = true;
    const t = new THREE.Mesh(tip, dark);
    t.position.set(x, h + 0.2, 0);
    g.add(m, t);
  }
  for (const y of [0.8, height - 0.6]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width, 0.22, 0.3), dark);
    beam.position.set(0, y, 0.25);
    beam.castShadow = true;
    g.add(beam);
  }
  return g;
}

class BreachObjective {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.name = def.name ?? '關門';
    this.hp = this.max = def.hp ?? 8;
    this.failed = null;
    const W = game.level.arena.halfWidth;
    this.object = buildGate(W * 2);
    this.object.position.set(0, 0, def.z);
    game.scene.add(this.object);
    const n = Math.ceil((W * 2) / GATE_SEGMENT);
    this.colliders = [];
    this.segments = [];
    for (let i = 0; i < n; i++) {
      const x = -W + ((i + 0.5) * W * 2) / n;
      const c = { x, z: def.z, r: 0.9 };
      game.level.colliders.push(c);
      this.colliders.push(c);
      this.segments.push({ position: { x, y: 0, z: def.z }, radius: 0.9, owner: this, solid: true });
    }
    this.bar = makeBar(3, 0xffb020);
    this.bar.group.position.set(0, 4.3, def.z);
    this.bar.set(1);
    this.bar.group.visible = false;   // 變成目前的目標才顯示（activate）
    game.scene.add(this.bar.group);
    this.shake = 0;
    this.fall = -1;
  }

  get done() { return this.hp <= 0; }
  get targets() { return this.hp > 0 ? this.segments : []; }
  get label() { return `衝破${this.name}　還要打 ${this.hp} 下`; }
  // 還不是目前的目標時（前面還有別的波）不顯示耐久條；變成目標時才出現
  activate() { this.bar.group.visible = true; }
  get doneLabel() { return `衝破${this.name}了！`; }

  hit(segment, swing) {
    const { game } = this;
    if (this.hp <= 0 || swing?.has(this)) return false;
    swing?.add(this);
    this.hp -= 1;
    this.shake = 0.25;
    this.bar.set(this.hp / this.max);
    const { x, z } = segment.position;
    game.fx.sparks(x, 1.2, z);
    game.fx.dust(x, 0.6, z, 8);
    game.sfx.hit();
    if (this.hp > 0) { game.fx.floatText(x, 2.6, z, `再 ${this.hp} 下`, '#ffd27a'); return true; }
    for (const c of this.colliders) { const i = game.level.colliders.indexOf(c); if (i >= 0) game.level.colliders.splice(i, 1); }
    game.scene.remove(this.bar.group);
    this.fall = 0;
    game.hud.banner(`衝破${this.name}！`, 1.8, '#ffd27a');
    for (const s of this.segments) game.fx.dust(s.position.x, 0.8, s.position.z, 8);
    game.fx.shake(0.5);
    game.sfx.blast();
    game.score += 60;
    game.hud.setScore(game.score);
    return true;
  }

  update(dt) {
    if (this.shake > 0) { this.shake -= dt; this.object.rotation.x = Math.sin(this.shake * 70) * 0.03; }
    if (this.fall >= 0 && this.fall < 1) {   // 往北倒下、沉進地裡
      this.fall = Math.min(1, this.fall + dt * 1.6);
      this.object.rotation.x = -this.fall * 1.45;
      this.object.position.y = -this.fall * 0.3;
    }
  }

  // 衝破的關門倒在地上留著（重新開始時才拿掉）
  dispose() {
    const { game } = this;
    game.scene.remove(this.object, this.bar.group);
    for (const c of this.colliders) { const i = game.level.colliders.indexOf(c); if (i >= 0) game.level.colliders.splice(i, 1); }
    this.object.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.bar.dispose();
  }
}

export function createObjective(game, def, director) {
  if (def.type === 'burn') return new BurnObjective(game, def);
  if (def.type === 'capture') return new CaptureObjective(game, def);
  if (def.type === 'escort') return new EscortObjective(game, def, director);
  if (def.type === 'mount') return new MountObjective(game, def);
  if (def.type === 'breach') return new BreachObjective(game, def);
  throw new Error(`不認得的任務類型「${def.type}」`);
}
