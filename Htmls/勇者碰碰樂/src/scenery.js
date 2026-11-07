// 場景布景（場地外面的樹、帳篷、墓碑、岩漿…）與場地上的機關外觀（石柱、彈跳墊、陷阱、加速板、黑洞傳送點）。
// 全部用簡單的幾何形狀拼出來（不用下載模型），同一種形狀與材質共用，數量多也不太吃效能。
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
const KIT = {
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
const DECOR = {
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

export class Scenery {
  constructor(game) {
    this.game = game;
    this.decor = new THREE.Group();
    game.scene.add(this.decor);
    this.animated = [];
  }

  // 在場地外面擺布景（同一關每次都長一樣）
  build(theme, board) {
    this.decor.clear();
    this.animated = [];
    const kit = DECOR[theme] ?? DECOR.goblin;
    const names = Object.keys(kit), total = names.reduce((s, n) => s + kit[n], 0);
    const rand = rng([...theme].reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
    const hw = board.w / 2 + 1.2, hd = board.d / 2 + 1.2;
    const placed = [];
    for (let tries = 0; tries < 900 && placed.length < 95; tries++) {
      const x = (rand() - 0.5) * 50, z = (rand() - 0.5) * 44;
      if (Math.abs(x) < hw && Math.abs(z) < hd) continue;
      // 靠近場地的地方密一點，遠的地方稀一點
      const far = Math.max(Math.abs(x) - hw, Math.abs(z) - hd);
      if (rand() < far / 26) continue;
      if (placed.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 2.6)) continue;
      let r = rand() * total, name = names[0];
      for (const n of names) { r -= kit[n]; if (r <= 0) { name = n; break; } }
      const s = 0.8 + rand() * 0.7;
      const obj = KIT[name](s);
      obj.position.set(x, 0, z);
      obj.rotation.y += rand() * Math.PI * 2;
      obj.userData.phase = rand() * 10;
      this.decor.add(obj);
      if (obj.userData.flicker || obj.userData.glow) this.animated.push(obj);
      placed.push([x, z]);
    }
  }

  update(time) {
    for (const o of this.animated) {
      const t = time + o.userData.phase;
      for (const f of o.userData.flicker ?? []) { const k = 0.85 + 0.2 * Math.sin(t * 13) * Math.sin(t * 7.3); f.scale.y = f.userData.base ??= f.scale.y; f.scale.y = f.userData.base * k; }
      if (o.userData.glow) o.userData.glow.material.emissiveIntensity = (o.userData.glow.material.userData.base ??= o.userData.glow.material.emissiveIntensity) * (0.8 + 0.25 * Math.sin(t * 2.2));
    }
  }
}

// ===== 機關外觀 =====
const spiralTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, '#000000'); grad.addColorStop(0.35, '#120022'); grad.addColorStop(1, '#ffffff00');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#ffffff'; g.lineWidth = 5;
  for (let arm = 0; arm < 3; arm++) {
    g.beginPath();
    for (let t = 0; t < 1; t += 0.02) { const a = arm * 2.09 + t * 5, r = 10 + t * 52; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
    g.globalAlpha = 0.55; g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

const PILLAR_LOOK = {
  goblin: { color: '#7a5a34', top: '#a07a48' },   // 樹樁
  forest: { color: '#6b4a2b', top: '#4f8f44', tree: true },
  graveyard: { color: '#8a90a2', top: '#a0a6b8' },
  swamp: { color: '#c8c0a8', top: '#d8d0b8' },
  volcano: { color: '#3a302c', top: '#ff6a2a', rock: true },
  cave: { color: '#6a6676', top: '#5ad8ff', rock: true },
  snow: { color: '#a8d8f0', top: '#e8f6ff' },
  fortress: { color: '#8a6a44', top: '#a07a48' },
  ruins: { color: '#b8aed0', top: '#c8bee0' },
  dragon: { color: '#2e2420', top: '#ff6a2a', rock: true },
};
const TRAP_LOOK = {
  spikes: { color: '#9aa0aa', ground: '#5a4a40' },
  poison: { color: '#8be04e', ground: '#3a6a2a' },
  lava: { color: '#ff5a1a', ground: '#5a1a0a' },
  curse: { color: '#c080ff', ground: '#2a1a40' },
};
export const PORTAL_COLORS = ['#b46bff', '#3ad0ff', '#ff5ab0'];

export function makeObstacle(o, theme) {
  const g = new THREE.Group();
  g.position.set(o.x, 0, o.z);
  switch (o.type) {
    case 'pillar': {
      const L = PILLAR_LOOK[theme] ?? PILLAR_LOOK.goblin;
      if (L.rock) {
        g.add(part('dodeca', L.color, [0, o.r * 0.7, 0], [o.r * 1.05, o.r * 0.9, o.r * 1.05]));
        g.add(part('dodeca', L.top, [0, o.r * 1.35, 0], [o.r * 0.35, o.r * 0.25, o.r * 0.35], { emissive: 0.9 }));
      } else {
        g.add(part('cyl', L.color, [0, 0.55, 0], [o.r, 1.1, o.r]));
        g.add(part(L.tree ? 'ico' : 'cyl', L.top, [0, L.tree ? 1.9 : 1.13, 0], L.tree ? [o.r * 1.5, o.r * 1.3, o.r * 1.5] : [o.r * 0.92, 0.06, o.r * 0.92]));
      }
      break;
    }
    case 'block': {
      const col = theme === 'graveyard' ? '#8a90a2' : theme === 'volcano' ? '#4a3a34' : theme === 'fortress' ? '#9a8a6a' : '#8a6a44';
      g.add(part('box', col, [0, 0.55, 0], [o.w, 1.1, o.d]));
      g.add(part('box', theme === 'graveyard' ? '#a0a6b8' : '#a07a48', [0, 1.14, 0], [o.w + 0.1, 0.1, o.d + 0.1])); // 上面一圈邊
      break;
    }
    case 'bumper': {
      g.add(part('cyl', '#3a4670', [0, 0.25, 0], [o.r, 0.5, o.r]));
      const top = part('cyl', '#ffcf4a', [0, 0.55, 0], [o.r * 0.82, 0.18, o.r * 0.82], { emissive: 0.6, flat: false });
      const ring = part('torus', '#ff7a3a', [0, 0.5, 0], [o.r, 1, o.r], { emissive: 0.8, flat: false });
      g.add(top, ring);
      g.userData.pulse = top;
      break;
    }
    case 'trap': {
      const L = TRAP_LOOK[o.look] ?? TRAP_LOOK.spikes;
      g.add(part('disk', L.ground, [0, 0.03, 0], [o.r, 1, o.r], { opacity: 0.85 }));
      if (o.look === 'spikes' || !o.look) {
        for (let i = 0; i < 9; i++) {
          const a = i * 2.4, d = i === 0 ? 0 : o.r * (0.35 + (i % 2) * 0.3);
          g.add(part('cone', L.color, [Math.cos(a) * d, 0.28, Math.sin(a) * d], [0.14, 0.55, 0.14]));
        }
      } else {
        const pool = part('disk', L.color, [0, 0.05, 0], [o.r * 0.85, 1, o.r * 0.85], { emissive: 0.7, flat: false, opacity: 0.9 });
        g.add(pool);
        g.userData.glow = pool;
        for (let i = 0; i < 4; i++) g.add(part('sphere', L.color, [Math.cos(i * 1.7) * o.r * 0.45, 0.08, Math.sin(i * 1.7) * o.r * 0.45], [0.12, 0.06, 0.12], { emissive: 0.9 }));
      }
      break;
    }
    case 'ice': {
      const ice = new THREE.Mesh(geo.disk, new THREE.MeshStandardMaterial({ color: '#cfeeff', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.75, emissive: new THREE.Color('#9fd8ff'), emissiveIntensity: 0.25 }));
      ice.scale.setScalar(o.r);
      ice.position.y = 0.04;
      g.add(ice);
      for (let i = 0; i < 5; i++) g.add(part('box', '#ffffff', [Math.cos(i * 2.5) * o.r * 0.55, 0.06, Math.sin(i * 2.5) * o.r * 0.55], [o.r * 0.35, 0.01, 0.05], { emissive: 0.6 }));
      break;
    }
    case 'pad': {
      g.add(part('disk', '#2f8a4a', [0, 0.03, 0], [o.r, 1, o.r]));
      const arrows = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const c = part('cone4', '#f4fbff', [0, 0.06, 0], [o.r * 0.32, 0.05, o.r * 0.32], { emissive: 0.9 });
        c.rotation.y = Math.PI / 4;
        const holder = new THREE.Group();
        holder.rotation.y = (i / 3) * Math.PI * 2;
        c.position.z = o.r * 0.55;
        c.rotation.x = Math.PI / 2;
        holder.add(c);
        arrows.add(holder);
      }
      g.add(arrows, part('torus', '#f4fbff', [0, 0.05, 0], [o.r * 0.95, 0.4, o.r * 0.95], { emissive: 0.6, flat: false }));
      g.userData.spin = arrows;
      break;
    }
    case 'portal': {
      const color = PORTAL_COLORS[o.pair ?? 0];
      const disk = new THREE.Mesh(geo.disk, new THREE.MeshBasicMaterial({ map: spiralTex, color, transparent: true, depthWrite: false }));
      disk.scale.setScalar(o.r * 1.25);
      disk.position.y = 0.06;
      const core = part('disk', '#000000', [0, 0.07, 0], [o.r * 0.45, 1, o.r * 0.45]);
      core.material = new THREE.MeshBasicMaterial({ color: '#05000a' });
      const ring = part('torus', color, [0, 0.12, 0], [o.r, 0.6, o.r], { emissive: 1.2, flat: false });
      g.add(disk, core, ring);
      g.userData.swirl = disk;
      g.userData.ring = ring;
      break;
    }
    default: break;
  }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = o.type === 'pillar' || o.type === 'block' || o.type === 'bumper'; m.receiveShadow = true; } });
  return g;
}

export function animateObstacle(o, time, dt) {
  const u = o.mesh?.userData;
  if (!u) return;
  if (u.swirl) { u.swirl.rotation.y -= dt * 2.4; const k = 1 + 0.06 * Math.sin(time * 4 + o.x); u.ring.scale.set(o.r * k, 0.6, o.r * k); }
  if (u.spin) u.spin.rotation.y += dt * 1.5;
  if (u.glow) u.glow.material.emissiveIntensity = 0.55 + 0.25 * Math.sin(time * 3 + o.z);
  if (u.pulse) { o.pulseT = Math.max(0, (o.pulseT ?? 0) - dt); const k = 1 + o.pulseT * 1.4; u.pulse.scale.set(o.r * 0.82 * k, 0.18, o.r * 0.82 * k); }
}
