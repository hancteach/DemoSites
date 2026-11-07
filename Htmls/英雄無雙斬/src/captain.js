// 敵將：用高面數模型（一般 SkinnedMesh），血多、有霸體（只有跳躍重擊、無雙會讓他踉蹌），
// 攻擊前地上先出現紅圈，躲開就不會被打。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export class Captain {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.alive = false;
    this.root = new THREE.Group();
    this.radius = def.radius;
  }

  async load() {
    this.gltf = await new GLTFLoader().loadAsync(`assets/models/${encodeURIComponent(this.def.model)}/${encodeURIComponent(this.def.model)}.glb`);
    this.model = cloneSkinned(this.gltf.scene);
    this.model.scale.setScalar(this.def.scale);
    this.materials = [];
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      o.material = o.material.clone();
      this.materials.push(o.material);
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = new Map(this.gltf.animations.map((c) => [c.name, c]));
    this.warn = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false }));
    this.warn.position.y = 0.04;
    this.game.scene.add(this.warn);
    this.root.visible = false;
    this.game.scene.add(this.root);
  }

  play(name, { once = false, speed = 1 } = {}) {
    if (!once && name === this.currentName) return;
    const next = this.mixer.clipAction(this.clips.get(name));
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
    next.clampWhenFinished = once;
    next.timeScale = speed;
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, 0.1, false);
    this.current = next;
    this.currentName = name;
  }

  get position() { return this.root.position; }

  spawn(x, z) {
    this.alive = true;
    this.hp = this.maxHp = this.def.hp;
    this.state = 'walk';
    this.t = 0;
    this.cd = 1.5;
    this.vx = this.vz = 0;
    this.flash = 0;
    this.dying = 0;
    this.root.position.set(x, 0, z);
    this.root.visible = true;
    this.model.position.y = 0;
    this.play('Walk');
  }

  hide() { this.alive = false; this.root.visible = false; this.warn.material.opacity = 0; }

  // 主角的攻擊打到敵將（扇形判定）
  strike(x, z, yaw, arc, range, damage, { knock = 0, stagger = false } = {}) {
    if (!this.alive || this.hp <= 0) return 0;
    const dx = this.position.x - x, dz = this.position.z - z, d = Math.hypot(dx, dz);
    if (d > range + this.radius) return 0;
    if (arc < Math.PI * 2 - 0.01 && d > 0.3) {
      let diff = Math.atan2(dx, dz) - yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > arc / 2 + 0.3) return 0;
    }
    this.hp -= damage;
    this.flash = 0.12;
    for (const m of this.materials) { m.emissive?.setHex(0xfff0c0); if (m.emissive) m.emissiveIntensity = 0.9; }
    this.vx += dx / (d || 1) * knock * 0.15; this.vz += dz / (d || 1) * knock * 0.15;
    this.game.fx.burst(this.position.x, 1.6, this.position.z, 8, { speed: 7 });
    if (this.hp <= 0) {
      this.state = 'dying'; this.t = 0;
      this.warn.material.opacity = 0;
      this.play('Death', { once: true });
      this.game.onCaptainDown(this);
    } else if (stagger && this.state !== 'stagger') {
      this.state = 'stagger'; this.t = 0;
      this.warn.material.opacity = 0;
      this.play('Hit', { once: true });
    }
    return 1;
  }

  update(dt) {
    if (!this.alive) return;
    this.mixer.update(dt);
    this.t += dt;
    if (this.flash > 0) { this.flash -= dt; if (this.flash <= 0) for (const m of this.materials) if (m.emissive) m.emissiveIntensity = 0; }
    const p = this.position;
    p.x += this.vx * dt; p.z += this.vz * dt;
    this.vx *= Math.exp(-6 * dt); this.vz *= Math.exp(-6 * dt);
    const hero = this.game.hero;
    const dx = hero.position.x - p.x, dz = hero.position.z - p.z, dist = Math.hypot(dx, dz) || 0.001;
    const d = this.def;

    if (this.state === 'dying') {
      if (this.t > 2.2) this.model.position.y -= dt * 1.2;
      if (this.t > 3.2) this.hide();
      return;
    }
    if (this.state === 'stagger') { if (this.t > 0.9) { this.state = 'walk'; this.t = 0; } return; }
    if (this.state === 'windup') {
      // 紅圈越來越亮，時間到才打下去
      const k = Math.min(1, this.t / d.windup);
      this.warn.material.opacity = 0.15 + k * 0.4;
      if (this.t >= d.windup) {
        this.state = 'swing'; this.t = 0;
        this.play('Attack', { once: true, speed: 1.6 });
      }
      return;
    }
    if (this.state === 'swing') {
      if (!this.struck && this.t >= 0.2) {
        this.struck = true;
        this.warn.material.opacity = 0;
        this.game.fx.ring(this.warn.position.x, this.warn.position.z, d.attackRadius, { color: 0xff5544 });
        this.game.fx.addShake(0.35);
        this.game.sfx.blast();
        const hx = hero.position.x - this.warn.position.x, hz = hero.position.z - this.warn.position.z;
        if (Math.hypot(hx, hz) < d.attackRadius + hero.radius) hero.takeDamage(d.damage, p.x, p.z, { big: true });
      }
      if (this.t > 0.7) { this.state = 'walk'; this.t = 0; this.cd = 1.4; }
      return;
    }
    this.cd -= dt;
    this.root.rotation.y = Math.atan2(dx, dz);
    if (dist < 2.6 && this.cd <= 0 && hero.alive) {
      this.state = 'windup'; this.t = 0; this.struck = false;
      // 紅圈落在敵將前方
      this.warn.position.set(p.x + dx / dist * 1.6, 0.04, p.z + dz / dist * 1.6);
      this.warn.scale.setScalar(d.attackRadius);
      this.play('Idle');
      return;
    }
    if (dist > 2.2) {
      p.x += dx / dist * d.speed * dt; p.z += dz / dist * d.speed * dt;
      this.play('Walk');
    } else this.play('Idle');
  }
}
