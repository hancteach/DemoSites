// 模型：載入（同一個模型只下載一次）、複製一份會動的角色、統一高度、播動作、做頭像、投射物外觀。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const D2R = Math.PI / 180;
const loader = new GLTFLoader();
const cache = new Map();
const url = (name) => `assets/models/${encodeURIComponent(name)}/${encodeURIComponent(name)}.glb`;

export function loadGltf(name) {
  if (!cache.has(name)) {
    cache.set(name, loader.loadAsync(url(name)).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      gltf.userData.height = Math.max(0.1, box.max.y - box.min.y);
      gltf.userData.bottom = box.min.y;
      return gltf;
    }));
  }
  return cache.get(name);
}

// 會動的角色（主角、敵人共用）：root 放在地上、面向用 root.rotation.y（模型正面朝 +Z）
export class Actor {
  constructor(gltf, height) {
    this.root = new THREE.Group();
    this.model = cloneSkinned(gltf.scene);
    const s = height / gltf.userData.height;
    this.model.scale.setScalar(s);
    this.model.position.y = -gltf.userData.bottom * s;
    this.materials = [];
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (o.isSkinnedMesh) o.frustumCulled = false;
      o.material = o.material.clone();
      this.materials.push(o.material);
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = new Map(gltf.animations.map((c) => [c.name, c]));
    this.current = null;
    this.flashT = 0;
    this.flashColor = new THREE.Color();
    this.mixer.addEventListener('finished', (e) => { if (e.action === this.current && this.after) this.play(this.after); });
  }

  has(name) { return this.clips.has(name); }

  // once：播一次，播完回到 after（預設 Idle）；hold：播完停在最後一格（倒下）
  play(name, { once = false, hold = false, after = 'Idle', speed = 1, fade = 0.15 } = {}) {
    if (!this.clips.has(name)) name = this.clips.has('Idle') ? 'Idle' : [...this.clips.keys()][0];
    if (!name) return;
    const next = this.mixer.clipAction(this.clips.get(name));
    if (this.current === next && !once) return;
    next.reset();
    next.timeScale = speed;
    next.setLoop(once || hold ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once || hold;
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
    this.after = once && !hold ? after : null;
  }

  // 被打到閃一下顏色
  flash(color = 0xff4040, time = 0.18) { this.flashColor.set(color); this.flashT = time; this.flashTime = time; }

  update(dt) {
    this.mixer.update(dt);
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT / (this.flashTime || 1);
      for (const m of this.materials) if (m.emissive) { m.emissive.copy(this.flashColor); m.emissiveIntensity = k * 0.9; }
      if (this.flashT === 0) this.applyGlow();
    }
  }

  // 一直亮著的光（必殺技準備好、這次彈射加強），amount 0 就是關掉
  setGlow(color, amount) { this.glowColor = color; this.glowAmount = amount; if (this.flashT <= 0) this.applyGlow(); }
  applyGlow() {
    for (const m of this.materials) if (m.emissive) { m.emissive.set(this.glowColor ?? 0x000000); m.emissiveIntensity = this.glowAmount ?? 0; }
  }
}

export async function makeActor(name, height) {
  return new Actor(await loadGltf(name), height);
}

// 投射物外觀（模型正面要朝 +Z；rot 是把原始模型轉正的角度，和英雄無雙斬一樣）
export const LOOKS = {
  arrow: { model: '弓箭', scale: 1.5, rot: [0, 0, 0], glow: 0 },
  fire: { model: '火球', scale: 1.1, rot: [-90, 0, 0], glow: 0.9 },
  shuriken: { model: '角色武器_忍者_飛鏢', scale: 1.0, rot: [90, 0, 0], glow: 0, spin: 16 },
  firearrow: { model: '角色武器_日本巫女_火焰箭', scale: 1.5, rot: [0, 90, 0], glow: 0.6 },
};

const prefabs = new Map();
export async function loadLooks() {
  await Promise.all(Object.entries(LOOKS).map(async ([kind, look]) => {
    const gltf = await loadGltf(look.model);
    const inner = gltf.scene.clone();
    inner.rotation.set(...look.rot.map((d) => d * D2R));
    inner.traverse((o) => {
      if (!o.isMesh || !look.glow) return;
      o.material = o.material.clone();
      o.material.emissive?.setHex(0xffffff);
      o.material.emissiveMap = o.material.map;
      o.material.emissiveIntensity = look.glow;
    });
    const g = new THREE.Group();
    g.add(inner);
    g.scale.setScalar(look.scale);
    prefabs.set(kind, g);
  }));
}
export function makeLook(kind) {
  const p = prefabs.get(kind);
  return p ? p.clone() : null;
}

// 道具（紅藥水、金幣）：不會動的模型，統一高度
export async function makeProp(name, height) {
  const gltf = await loadGltf(name);
  const m = gltf.scene.clone();
  const s = height / gltf.userData.height;
  m.scale.setScalar(s);
  m.position.y = -gltf.userData.bottom * s;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

// 頭像：用一個小的離屏畫布把角色的 Idle 第一格拍下來（每個角色只拍一次）
let shot = null;
const portraits = new Map();
export function portrait(model) {
  if (!portraits.has(model)) {
    portraits.set(model, loadGltf(model).then((gltf) => {
      if (!shot) {
        const canvas = document.createElement('canvas');
        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(160, 160, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 4, 5); scene.add(sun);
        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
        shot = { canvas, renderer, scene, camera };
      }
      const actor = new Actor(gltf, 1.7);
      actor.play('Idle');
      actor.update(0.3);
      actor.root.rotation.y = 0.35;
      shot.scene.add(actor.root);
      shot.camera.position.set(0, 1.25, 3.6);
      shot.camera.lookAt(0, 1.0, 0);
      shot.renderer.render(shot.scene, shot.camera);
      const data = shot.canvas.toDataURL('image/png');
      shot.scene.remove(actor.root);
      return data;
    }));
  }
  return portraits.get(model);
}
