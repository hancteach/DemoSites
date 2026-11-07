// 捲動的世界：地面一段一段（每段 8 公尺）在前面產生、跑到後面就移除；路兩旁擺布景，走到不同距離換主題（草原→森林→墓園…）。
// 布景零件、主題顏色從《勇者碰碰樂》的 scenery.js 搬來，全部用簡單幾何形狀拼（不用下載模型），同一種形狀與材質共用。
import * as THREE from 'three';

// ===== 各關主題：天空、霧、光線、地板 =====
export const THEMES = {
  goblin: { sky: '#9fc8e8', fog: '#b9d6ea', hemi: ['#fff6e0', '#5a6a3a', 1.6], sun: 2.1, ground: '#86b35c', outside: '#6f9a48', speck: '#5f8a3c' },
  forest: { sky: '#8fb8a8', fog: '#a8cbbb', hemi: ['#e8fff0', '#3d5a36', 1.5], sun: 1.8, ground: '#63a056', outside: '#4b8a42', speck: '#3f7a38' },
  graveyard: { sky: '#2a3150', fog: '#3a4266', hemi: ['#b8c8ff', '#2a2e40', 1.3], sun: 1.3, ground: '#6c7590', outside: '#4a5068', speck: '#565d78' },
  swamp: { sky: '#6f8a6a', fog: '#7f9a78', hemi: ['#e8ffd8', '#3a4a2a', 1.4], sun: 1.6, ground: '#6e8f58', outside: '#4c6a3c', speck: '#5a7a46' },
  volcano: { sky: '#4a2a28', fog: '#6a3a2e', hemi: ['#ffd8b8', '#4a2418', 1.5], sun: 1.8, ground: '#8f6e5c', outside: '#3e2a24', speck: '#6a4a3c' },
  cave: { sky: '#1a1824', fog: '#24202e', hemi: ['#c8d8ff', '#2a2430', 1.4], sun: 1.3, ground: '#5e5c6a', outside: '#2e2a36', speck: '#46424e' },
  snow: { sky: '#b8d0e8', fog: '#d8e6f2', hemi: ['#ffffff', '#8a9ab0', 1.6], sun: 1.9, ground: '#dde6ee', outside: '#eef4f8', speck: '#c4d2de' },
  fortress: { sky: '#d8b888', fog: '#e0c8a0', hemi: ['#fff0d8', '#6a5a3a', 1.6], sun: 2.0, ground: '#a08e6c', outside: '#8a7a58', speck: '#7a6a4a' },
  ruins: { sky: '#3a2e52', fog: '#4a3e66', hemi: ['#e8d8ff', '#3a2e4a', 1.4], sun: 1.5, ground: '#7c6c8c', outside: '#4e4460', speck: '#62567a' },
  dragon: { sky: '#2e1814', fog: '#4a2418', hemi: ['#ffc8a8', '#3a1a10', 1.5], sun: 1.7, ground: '#6e4e42', outside: '#2e1c16', speck: '#4e342a' },
};

const geo = {
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cylLow: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 8),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  ico: new THREE.IcosahedronGeometry(1, 0),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  half: new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  disk: new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2),
  octa: new THREE.OctahedronGeometry(1, 0),
  torus: new THREE.TorusGeometry(1, 0.16, 8, 32).rotateX(Math.PI / 2),
};
const mats = new Map();
function mat(color, { emissive = 0, flat = true, opacity = 1 } = {}) {
  const key = `${color}|${emissive}|${opacity}`;
  if (!mats.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: flat });
    if (emissive) { m.emissive = new THREE.Color(color); m.emissiveIntensity = emissive; }
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
    mats.set(key, m);
  }
  return mats.get(key);
}
function part(g, color, [x, y, z], [sx, sy, sz], opt) {
  const m = new THREE.Mesh(geo[g], mat(color, opt));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}
function group(...parts) { const g = new THREE.Group(); for (const p of parts) g.add(p); return g; }

// ===== 布景零件（s 是隨機大小）=====
export const KIT = {
  pine: (s) => group(part('cyl', '#6b4a2b', [0, 0.5 * s, 0], [0.18 * s, s, 0.18 * s]), part('cone', '#3f7a3a', [0, 1.5 * s, 0], [0.9 * s, 1.5 * s, 0.9 * s]), part('cone', '#4f8f44', [0, 2.3 * s, 0], [0.65 * s, 1.2 * s, 0.65 * s])),
  roundTree: (s) => group(part('cyl', '#6b4a2b', [0, 0.7 * s, 0], [0.22 * s, 1.4 * s, 0.22 * s]), part('ico', '#4c9a48', [0, 2.0 * s, 0], [1.1 * s, 1.0 * s, 1.1 * s]), part('ico', '#5fae52', [0.4 * s, 2.5 * s, 0.2 * s], [0.7 * s, 0.6 * s, 0.7 * s])),
  rock: (s) => { const r = part('dodeca', '#8a8a86', [0, 0.3 * s, 0], [0.7 * s, 0.5 * s, 0.6 * s]); r.rotation.y = s * 7; return group(r); },
  darkRock: (s) => { const r = part('dodeca', '#3a302c', [0, 0.45 * s, 0], [0.9 * s, 0.8 * s, 0.8 * s]); r.rotation.y = s * 5; return group(r, part('dodeca', '#4a3a34', [0.6 * s, 0.25 * s, 0.3 * s], [0.45 * s, 0.4 * s, 0.4 * s])); },
  bush: (s) => group(part('ico', '#4a8a40', [0, 0.35 * s, 0], [0.6 * s, 0.45 * s, 0.6 * s]), part('ico', '#5a9a4a', [0.4 * s, 0.3 * s, 0.2 * s], [0.4 * s, 0.35 * s, 0.4 * s])),
  darkBush: (s) => group(part('ico', '#3a4a40', [0, 0.35 * s, 0], [0.6 * s, 0.45 * s, 0.6 * s])),
  tent: (s) => { const t = group(part('cone4', '#b8743a', [0, 0.8 * s, 0], [1.2 * s, 1.6 * s, 1.2 * s]), part('cone4', '#7a3a22', [0, 1.62 * s, 0], [0.2 * s, 0.3 * s, 0.2 * s])); t.rotation.y = Math.PI / 4; return t; },
  campfire: (s) => {
    const g = group(part('cyl', '#5a3a22', [0, 0.1, 0], [0.12, 0.9 * s, 0.12]), part('cyl', '#5a3a22', [0, 0.1, 0], [0.12, 0.9 * s, 0.12]),
      part('cone', '#ff8a2a', [0, 0.45 * s, 0], [0.35 * s, 0.8 * s, 0.35 * s], { emissive: 1.2 }), part('cone', '#ffd04a', [0, 0.35 * s, 0], [0.18 * s, 0.5 * s, 0.18 * s], { emissive: 1.4 }));
    g.children[0].rotation.z = Math.PI / 2; g.children[1].rotation.x = Math.PI / 2;
    g.userData.flicker = [g.children[2], g.children[3]];
    return g;
  },
  fence: (s) => group(part('box', '#7a5a34', [-0.6, 0.45, 0], [0.14, 0.9, 0.14]), part('box', '#7a5a34', [0.6, 0.45, 0], [0.14, 0.9, 0.14]), part('box', '#8a6a3e', [0, 0.6, 0], [1.4, 0.12, 0.08]), part('box', '#8a6a3e', [0, 0.3, 0], [1.4, 0.12, 0.08])),
  mushroom: (s) => group(part('cyl', '#efe6d0', [0, 0.25 * s, 0], [0.12 * s, 0.5 * s, 0.12 * s]), part('half', '#d8402e', [0, 0.48 * s, 0], [0.4 * s, 0.3 * s, 0.4 * s])),
  glowMushroom: (s) => { const g = group(part('cyl', '#cfe8e0', [0, 0.3 * s, 0], [0.1 * s, 0.6 * s, 0.1 * s]), part('half', '#5af0d8', [0, 0.58 * s, 0], [0.38 * s, 0.26 * s, 0.38 * s], { emissive: 0.9 })); g.userData.glow = g.children[1]; return g; },
  flowers: (s) => group(...[0, 1, 2, 3, 4].map((i) => part('sphere', ['#ff7aa8', '#ffd84a', '#ffffff', '#b88aff', '#ff9a4a'][i], [Math.cos(i * 1.3) * 0.5 * s, 0.12, Math.sin(i * 1.3) * 0.5 * s], [0.12, 0.1, 0.12]))),
  deadTree: (s) => {
    const g = group(part('cylLow', '#5a4a40', [0, 0.9 * s, 0], [0.16 * s, 1.8 * s, 0.16 * s]), part('cylLow', '#5a4a40', [0.35 * s, 1.5 * s, 0], [0.07 * s, 0.9 * s, 0.07 * s]), part('cylLow', '#5a4a40', [-0.3 * s, 1.25 * s, 0.1 * s], [0.06 * s, 0.7 * s, 0.06 * s]));
    g.children[1].rotation.z = -0.8; g.children[2].rotation.z = 0.9;
    return g;
  },
  burntTree: (s) => { const g = KIT.deadTree(s); g.traverse((o) => { if (o.isMesh) o.material = mat('#2a1e1a'); }); return g; },
  gravestone: (s) => group(part('box', '#9aa0b0', [0, 0.45 * s, 0], [0.7 * s, 0.9 * s, 0.22 * s]), part('cyl', '#9aa0b0', [0, 0.9 * s, 0], [0.35 * s, 0.22 * s, 0.35 * s])),
  cross: (s) => group(part('box', '#8a8f9e', [0, 0.6 * s, 0], [0.16 * s, 1.2 * s, 0.16 * s]), part('box', '#8a8f9e', [0, 0.85 * s, 0], [0.6 * s, 0.14 * s, 0.14 * s])),
  lantern: (s) => { const g = group(part('cyl', '#3a3a44', [0, 0.7, 0], [0.06, 1.4, 0.06]), part('box', '#ffd27a', [0, 1.5, 0], [0.28, 0.34, 0.28], { emissive: 1.3 })); g.userData.flicker = [g.children[1]]; return g; },
  reeds: (s) => group(...[0, 1, 2, 3, 4, 5].map((i) => { const m = part('cylLow', i % 2 ? '#8aa04a' : '#a8b85a', [Math.cos(i * 2.1) * 0.3, 0.5 * s, Math.sin(i * 2.1) * 0.3], [0.04, (0.8 + (i % 3) * 0.3) * s, 0.04]); m.rotation.z = (i - 2.5) * 0.08; return m; })),
  pond: (s) => group(part('disk', '#3a7a8a', [0, 0.02, 0], [1.4 * s, 1, 1.0 * s], { emissive: 0.15 }), part('disk', '#5aa0a8', [0.3 * s, 0.03, -0.2 * s], [0.5 * s, 1, 0.35 * s], { emissive: 0.2 })),
  brokenPillar: (s) => group(part('cyl', '#c8c0a8', [0, 0.6 * s, 0], [0.4 * s, 1.2 * s, 0.4 * s]), part('box', '#b8b098', [0.7 * s, 0.15, 0.3 * s], [0.5 * s, 0.3, 0.4 * s])),
  lavaPool: (s) => { const g = group(part('disk', '#ff5a1a', [0, 0.03, 0], [1.5 * s, 1, 1.1 * s], { emissive: 1.1, flat: false })); g.userData.glow = g.children[0]; return g; },
  stalagmite: (s) => group(part('cone', '#6a6676', [0, 0.9 * s, 0], [0.45 * s, 1.8 * s, 0.45 * s]), part('cone', '#7a7686', [0.5 * s, 0.5 * s, 0.2 * s], [0.25 * s, 1.0 * s, 0.25 * s])),
  blueCrystal: (s) => { const g = group(part('octa', '#5ad8ff', [0, 0.7 * s, 0], [0.3 * s, 0.8 * s, 0.3 * s], { emissive: 0.9 }), part('octa', '#8ae8ff', [-0.3 * s, 0.4 * s, 0.2 * s], [0.18 * s, 0.45 * s, 0.18 * s], { emissive: 0.9 })); g.userData.glow = g.children[0]; return g; },
  snowPine: (s) => group(part('cyl', '#6b4a2b', [0, 0.5 * s, 0], [0.18 * s, s, 0.18 * s]), part('cone', '#3f6a4a', [0, 1.5 * s, 0], [0.9 * s, 1.5 * s, 0.9 * s]), part('cone', '#f4f8fc', [0, 2.2 * s, 0], [0.6 * s, 1.0 * s, 0.6 * s])),
  snowRock: (s) => { const r = part('dodeca', '#e8eef4', [0, 0.3 * s, 0], [0.7 * s, 0.45 * s, 0.6 * s]); r.rotation.y = s * 3; return group(r); },
  iceCrystal: (s) => { const g = group(part('octa', '#bfe8ff', [0, 0.8 * s, 0], [0.32 * s, 0.9 * s, 0.32 * s], { emissive: 0.5 })); g.userData.glow = g.children[0]; return g; },
  snowman: (s) => group(part('sphere', '#ffffff', [0, 0.45 * s, 0], [0.5 * s, 0.45 * s, 0.5 * s]), part('sphere', '#ffffff', [0, 1.05 * s, 0], [0.34 * s, 0.32 * s, 0.34 * s]), part('cone', '#ff8a2a', [0, 1.05 * s, 0.35 * s], [0.06 * s, 0.25 * s, 0.06 * s]), part('cyl', '#2a2a30', [0, 1.42 * s, 0], [0.22 * s, 0.25 * s, 0.22 * s])),
  tower: (s) => group(part('cyl', '#9a8a6a', [0, 1.4 * s, 0], [0.8 * s, 2.8 * s, 0.8 * s]), part('cone', '#a8442e', [0, 3.3 * s, 0], [1.0 * s, 1.0 * s, 1.0 * s])),
  banner: (s) => group(part('cyl', '#5a4a3a', [0, 1.2 * s, 0], [0.05, 2.4 * s, 0.05]), part('box', '#c0402e', [0.32 * s, 1.95 * s, 0], [0.6 * s, 0.7 * s, 0.04])),
  barrel: (s) => group(part('cyl', '#8a5a32', [0, 0.45 * s, 0], [0.38 * s, 0.9 * s, 0.38 * s]), part('cyl', '#4a3a2a', [0, 0.65 * s, 0], [0.4 * s, 0.06, 0.4 * s])),
  crate: (s) => { const b = part('box', '#a07a48', [0, 0.35 * s, 0], [0.7 * s, 0.7 * s, 0.7 * s]); b.rotation.y = s; return group(b); },
  torch: (s) => { const g = group(part('cyl', '#4a3a2a', [0, 0.7, 0], [0.07, 1.4, 0.07]), part('cone', '#ff9a2a', [0, 1.6, 0], [0.16, 0.4, 0.16], { emissive: 1.3 })); g.userData.flicker = [g.children[1]]; return g; },
  column: (s) => group(part('cyl', '#b8aed0', [0, 1.1 * s, 0], [0.38 * s, 2.2 * s, 0.38 * s]), part('box', '#a89ec0', [0, 2.25 * s, 0], [0.95 * s, 0.2 * s, 0.95 * s])),
  arch: (s) => group(part('box', '#a89ec0', [-0.8 * s, 1 * s, 0], [0.4 * s, 2 * s, 0.4 * s]), part('box', '#a89ec0', [0.8 * s, 1 * s, 0], [0.4 * s, 2 * s, 0.4 * s]), part('box', '#b8aed0', [0, 2.1 * s, 0], [2.1 * s, 0.35 * s, 0.45 * s])),
  purpleCrystal: (s) => { const g = group(part('octa', '#c080ff', [0, 0.7 * s, 0], [0.3 * s, 0.8 * s, 0.3 * s], { emissive: 0.9 }), part('octa', '#e0b0ff', [0.3 * s, 0.4 * s, -0.1 * s], [0.18 * s, 0.4 * s, 0.18 * s], { emissive: 0.9 })); g.userData.glow = g.children[0]; return g; },
  runeStone: (s) => group(part('box', '#6a6080', [0, 0.6 * s, 0], [0.6 * s, 1.2 * s, 0.3 * s]), part('box', '#c080ff', [0, 0.7 * s, 0.16 * s], [0.25 * s, 0.4 * s, 0.02], { emissive: 1 })),
  bones: (s) => { const g = group(part('cyl', '#e8e0d0', [0, 0.1, 0], [0.07, 1.2 * s, 0.07]), part('cyl', '#e8e0d0', [0.2, 0.1, 0.1], [0.07, 0.9 * s, 0.07]), part('sphere', '#e8e0d0', [-0.5 * s, 0.18, 0], [0.22 * s, 0.18 * s, 0.2 * s])); g.children[0].rotation.z = Math.PI / 2; g.children[1].rotation.x = Math.PI / 2; g.children[1].rotation.z = 0.6; return g; },
  crystal: (s) => { const g = group(part('octa', '#ff6a3a', [0, 0.7 * s, 0], [0.3 * s, 0.8 * s, 0.3 * s], { emissive: 0.8 }), part('octa', '#ffa05a', [0.35 * s, 0.4 * s, 0.1 * s], [0.18 * s, 0.45 * s, 0.18 * s], { emissive: 0.8 })); g.userData.glow = g.children[0]; return g; },
};

// 各關要放哪些零件、比例多少
export const DECOR = {
  goblin: { pine: 3, rock: 2, tent: 1.2, campfire: 0.6, fence: 0.9, bush: 1.2 },
  forest: { roundTree: 4, pine: 1.5, bush: 2, mushroom: 1.2, flowers: 1.6, rock: 0.8 },
  graveyard: { deadTree: 2, gravestone: 2.6, cross: 1.2, lantern: 0.8, rock: 1, darkBush: 0.8 },
  swamp: { reeds: 2.2, pond: 1.4, deadTree: 1, brokenPillar: 1, glowMushroom: 1.2, bush: 1 },
  volcano: { darkRock: 3, lavaPool: 1.5, crystal: 1.2, burntTree: 0.9, campfire: 0.5 },
  cave: { stalagmite: 3.5, blueCrystal: 1.6, darkRock: 1.5, glowMushroom: 1, bones: 0.5 },
  snow: { snowPine: 3.5, snowRock: 2, iceCrystal: 1.2, snowman: 0.5, deadTree: 0.6 },
  fortress: { tower: 0.7, banner: 1.2, barrel: 1.4, crate: 1.6, torch: 1, tent: 0.8, fence: 1.2, rock: 0.8 },
  ruins: { column: 1.8, arch: 0.6, brokenPillar: 1.2, purpleCrystal: 1.4, runeStone: 1, deadTree: 0.8 },
  dragon: { darkRock: 3, lavaPool: 1.6, bones: 1.2, crystal: 0.8, burntTree: 0.8 },
};

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export const LANE = 5.5;    // 角色能走的範圍：x 在 -5.5～5.5 之間
export const CHUNK = 8;     // 地面一段的長度（公尺）
const SIDE = 34;            // 地面往兩旁延伸多寬

// 地面貼圖：底色加上一些小點（每個主題做一次）
const texCache = new Map();
function speckTexture(base, speck, seed) {
  const key = `${base}|${speck}`;
  if (!texCache.has(key)) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    const rand = rng(seed);
    g.fillStyle = speck;
    for (let i = 0; i < 260; i++) { g.globalAlpha = 0.25 + rand() * 0.45; g.beginPath(); g.arc(rand() * 256, rand() * 256, 1 + rand() * 3.5, 0, Math.PI * 2); g.fill(); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    texCache.set(key, tex);
  }
  return texCache.get(key);
}
const groundMats = new Map();
function groundMat(theme, kind) {
  const key = `${theme}|${kind}`;
  if (!groundMats.has(key)) {
    const t = THEMES[theme];
    const base = kind === 'lane' ? t.ground : t.outside;
    const tex = speckTexture(base, t.speck, theme.length * 97 + (kind === 'lane' ? 1 : 2));
    groundMats.set(key, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  }
  return groundMats.get(key);
}
// 平面的 UV 依世界座標算（每 6 公尺貼一次），一段一段接起來看不出接縫
function plane(w, d, repeat = 6) {
  const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / repeat, uv.getY(i) * d / repeat);
  return g;
}
const sideGeo = plane(SIDE * 2, CHUNK);
const laneGeo = plane(LANE * 2 + 1.6, CHUNK);
const edgeGeo = new THREE.BoxGeometry(0.35, 0.12, CHUNK);

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map();
    this.animated = new Set();
    this.themes = [['goblin', 0]];
  }

  // 換關卡：清掉所有地面，themes 是 [[主題, 從第幾公尺開始], ...]
  start(themes) {
    for (const c of this.chunks.values()) this.group.remove(c);
    this.chunks.clear();
    this.animated.clear();
    this.themes = themes;
  }

  themeAt(d) {
    let t = this.themes[0][0];
    for (const [name, from] of this.themes) if (d >= from) t = name;
    return t;
  }

  // 依鏡頭位置補上前面的地面、移除後面的（near、far 是相對鏡頭中心的 z 範圍）
  update(cz, near, far, time) {
    const first = Math.floor(-(cz + near) / CHUNK) - 1;
    const last = Math.ceil(-(cz + far) / CHUNK) + 1;
    for (const [i, c] of this.chunks) {
      if (i < first - 1 || i > last + 1) { this.group.remove(c); this.chunks.delete(i); for (const o of c.userData.anim) this.animated.delete(o); }
    }
    for (let i = Math.max(first, -3); i <= last; i++) if (!this.chunks.has(i)) this.makeChunk(i);
    for (const o of this.animated) {
      const t = time + o.userData.phase;
      for (const f of o.userData.flicker ?? []) { f.userData.base ??= f.scale.y; f.scale.y = f.userData.base * (0.85 + 0.2 * Math.sin(t * 13) * Math.sin(t * 7.3)); }
      if (o.userData.glow) { const m = o.userData.glow.material; m.userData.base ??= m.emissiveIntensity; m.emissiveIntensity = m.userData.base * (0.8 + 0.25 * Math.sin(t * 2.2)); }
    }
  }

  // 第 i 段：從第 i*8 公尺到 (i+1)*8 公尺（z 是負的，越往前 z 越小）
  makeChunk(i) {
    const d0 = i * CHUNK;
    const theme = this.themeAt(d0 + CHUNK / 2);
    const g = new THREE.Group();
    g.position.z = -d0 - CHUNK / 2;
    g.userData.anim = [];
    const side = new THREE.Mesh(sideGeo, groundMat(theme, 'side'));
    side.receiveShadow = true;
    g.add(side);
    const lane = new THREE.Mesh(laneGeo, groundMat(theme, 'lane'));
    lane.position.y = 0.012;
    lane.receiveShadow = true;
    g.add(lane);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(edgeGeo, mat(THEMES[theme].speck));
      e.position.set(sx * (LANE + 0.95), 0.05, 0);
      g.add(e);
    }
    // 布景：靠近路的地方密一點
    const kit = DECOR[theme] ?? DECOR.goblin;
    const names = Object.keys(kit), total = names.reduce((s, n) => s + kit[n], 0);
    const rand = rng(i * 7919 + 13);
    const placed = [];
    for (let tries = 0; tries < 60 && placed.length < 14; tries++) {
      const dir = rand() < 0.5 ? -1 : 1;
      const x = dir * (LANE + 1.8 + Math.pow(rand(), 1.6) * 22);
      const z = (rand() - 0.5) * CHUNK;
      if (placed.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 3)) continue;
      let r = rand() * total, name = names[0];
      for (const n of names) { r -= kit[n]; if (r <= 0) { name = n; break; } }
      const obj = KIT[name](0.8 + rand() * 0.7);
      obj.position.set(x, 0, z);
      obj.rotation.y += rand() * Math.PI * 2;
      obj.userData.phase = rand() * 10;
      g.add(obj);
      if (obj.userData.flicker || obj.userData.glow) { g.userData.anim.push(obj); this.animated.add(obj); }
      placed.push([x, z]);
    }
    this.group.add(g);
    this.chunks.set(i, g);
  }
}
