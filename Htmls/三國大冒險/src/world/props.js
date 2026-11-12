// 場景物件產生器：關卡 JSON 的 "type" 對應這裡的函式。
// 之後有 3D 模型時，關卡寫 "type": "model:模型id" 就會改用模型（見 level.js），不必改這裡。
// 每個產生器回傳 { object, collider, light? }；collider 是碰撞半徑，0 代表可穿過。
import * as THREE from 'three';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra });
const MAT = {
  stone: mat(0x7c8496),
  stoneDark: mat(0x535a6c),
  stoneLight: mat(0xa2a8b5),
  wood: mat(0x3d2c24),
  iron: mat(0x2d2f38, { metalness: 0.5, roughness: 0.6 }),
  moss: mat(0x47613a),
  flame: new THREE.MeshBasicMaterial({ color: 0xffa93a }),
  flameCore: new THREE.MeshBasicMaterial({ color: 0xfff0a8 }),
  glowCap: new THREE.MeshStandardMaterial({ color: 0x36d6c0, emissive: 0x22c4ae, emissiveIntensity: 1.4, flatShading: true }),
  glowStem: new THREE.MeshStandardMaterial({ color: 0xcfeee4, emissive: 0x4da898, emissiveIntensity: 0.6, flatShading: true }),
  water: new THREE.MeshStandardMaterial({ color: 0x4f8fd0, emissive: 0x2a5ea8, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.2 }),
  pine: mat(0x2c5a3a),
  pineLight: mat(0x3f7a48),
  plank: mat(0x7a5a3a),
  crystal: new THREE.MeshStandardMaterial({ color: 0xb79bff, emissive: 0x7a4fe0, emissiveIntensity: 1.1, flatShading: true, roughness: 0.3 }),
  lava: new THREE.MeshBasicMaterial({ color: 0xe8420c, toneMapped: false }),
};

function mesh(geometry, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function group(...children) {
  const g = new THREE.Group();
  g.add(...children);
  return g;
}

function tombstone({ variant = 0 }) {
  const base = mesh(new THREE.BoxGeometry(1.25, 0.2, 0.7), MAT.stoneDark, 0, 0.1, 0);
  let body;
  if (variant === 0) {
    body = group(
      mesh(new THREE.BoxGeometry(0.95, 1.0, 0.24), MAT.stone, 0, 0.7, 0),
      mesh(new THREE.CylinderGeometry(0.475, 0.475, 0.24, 12, 1, false, 0, Math.PI), MAT.stone, 0, 1.2, 0).rotateX(Math.PI / 2).rotateY(Math.PI / 2),
    );
  } else if (variant === 1) {
    body = group(
      mesh(new THREE.BoxGeometry(0.26, 1.55, 0.24), MAT.stoneLight, 0, 0.95, 0),
      mesh(new THREE.BoxGeometry(0.95, 0.26, 0.24), MAT.stoneLight, 0, 1.2, 0),
    );
  } else {
    body = group(mesh(new THREE.BoxGeometry(0.85, 1.1, 0.26), MAT.stoneDark, 0, 0.72, 0).rotateZ(0.14));
  }
  const dirt = mesh(new THREE.BoxGeometry(1.0, 0.1, 1.6), MAT.moss, 0, 0.05, 1.1, false);
  return { object: group(base, body, dirt), collider: 0.65 };
}

function deadTree() {
  const trunk = mesh(new THREE.CylinderGeometry(0.2, 0.38, 2.6, 6), MAT.wood, 0, 1.3, 0);
  const branch = (x, y, z, rz, rx, len) => {
    const b = mesh(new THREE.CylinderGeometry(0.05, 0.14, len, 5), MAT.wood, x, y, z);
    b.rotation.set(rx, 0, rz);
    return b;
  };
  return {
    object: group(trunk,
      branch(0.55, 2.7, 0, -0.9, 0, 1.6), branch(-0.5, 3.0, 0.15, 0.8, 0.3, 1.5),
      branch(0.1, 3.3, -0.3, 0.1, -0.5, 1.5), branch(-0.5, 2.1, -0.2, 1.1, -0.2, 1.2),
      branch(1.05, 3.5, 0, -0.2, 0.3, 0.7)),
    collider: 0.6,
  };
}

function rock() {
  return { object: group(mesh(new THREE.DodecahedronGeometry(0.8, 0), MAT.stoneDark, 0, 0.45, 0).rotateY(0.6)), collider: 0.8 };
}

function torch() {
  const pole = mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.4, 6), MAT.iron, 0, 1.2, 0);
  const bowl = mesh(new THREE.CylinderGeometry(0.3, 0.14, 0.26, 7), MAT.iron, 0, 2.45, 0);
  const flame = mesh(new THREE.ConeGeometry(0.24, 0.62, 7), MAT.flame, 0, 2.86, 0, false);
  const core = mesh(new THREE.ConeGeometry(0.12, 0.34, 6), MAT.flameCore, 0, 2.76, 0, false);
  const light = new THREE.PointLight(0xffa048, 15, 12, 1.8);
  light.position.set(0, 2.9, 0);
  return { object: group(pole, bowl, flame, core, light), collider: 0.35, light, flame };
}

function glowMushroom() {
  const m = (x, z, s) => group(
    mesh(new THREE.CylinderGeometry(0.06 * s, 0.09 * s, 0.34 * s, 6), MAT.glowStem, x, 0.17 * s, z, false),
    mesh(new THREE.SphereGeometry(0.24 * s, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), MAT.glowCap, x, 0.32 * s, z, false),
  );
  const light = new THREE.PointLight(0x35e0c8, 4, 5, 2);
  light.position.y = 0.6;
  return { object: group(m(0, 0, 1.3), m(0.34, 0.18, 0.8), m(-0.28, 0.26, 1), light), collider: 0 };
}

// 中央噴水池＋騎士雕像底座：場地的視覺重心，也讓玩家能繞著跑
function statue() {
  const rim = mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.55, 12), MAT.stone, 0, 0.27, 0);
  const water = mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.08, 16), MAT.water, 0, 0.54, 0, false);
  const pedestal = mesh(new THREE.CylinderGeometry(0.75, 1.0, 1.1, 8), MAT.stoneLight, 0, 1.05, 0);
  const pillar = mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.5, 8), MAT.stone, 0, 2.3, 0);
  const orb = mesh(new THREE.IcosahedronGeometry(0.5, 1), MAT.water, 0, 3.4, 0);
  const light = new THREE.PointLight(0x6fb4ff, 20, 13, 1.7);
  light.position.y = 3.4;
  return { object: group(rim, water, pedestal, pillar, orb, light), collider: 2.6, orb };
}

// 北邊的小陵墓：有門和階梯，暗示骷髏的來處
function crypt() {
  const body = mesh(new THREE.BoxGeometry(5, 3, 4), MAT.stoneDark, 0, 1.5, 0);
  const roofGeo = new THREE.CylinderGeometry(0.01, 3.9, 1.5, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  const roof = mesh(roofGeo, MAT.stone, 0, 3.75, 0);
  roof.scale.set(1, 1, 0.82);
  const door = mesh(new THREE.BoxGeometry(1.6, 2.1, 0.12), MAT.iron, 0, 1.05, 2.03);
  const stepA = mesh(new THREE.BoxGeometry(3, 0.2, 0.8), MAT.stone, 0, 0.1, 2.4);
  const col = (x) => mesh(new THREE.CylinderGeometry(0.22, 0.26, 3, 7), MAT.stoneLight, x, 1.5, 2.1);
  return { object: group(body, roof, door, stepA, col(-1.5), col(1.5)), collider: 3.3 };
}

function pineTree() {
  const trunk = mesh(new THREE.CylinderGeometry(0.2, 0.32, 1.4, 6), MAT.wood, 0, 0.7, 0);
  const layer = (y, r, h, material) => mesh(new THREE.ConeGeometry(r, h, 7), material, 0, y, 0);
  return { object: group(trunk, layer(1.9, 1.5, 1.8, MAT.pine), layer(2.9, 1.2, 1.6, MAT.pineLight), layer(3.8, 0.85, 1.4, MAT.pine)), collider: 0.65 };
}

function bush() {
  return {
    object: group(
      mesh(new THREE.IcosahedronGeometry(0.72, 0), MAT.pineLight, 0, 0.5, 0),
      mesh(new THREE.IcosahedronGeometry(0.5, 0), MAT.pine, 0.55, 0.38, 0.2),
      mesh(new THREE.IcosahedronGeometry(0.46, 0), MAT.pine, -0.5, 0.34, -0.15),
    ),
    collider: 0.75,
  };
}

function crate() {
  const box = mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), MAT.plank, 0, 0.65, 0);
  const band = (y) => mesh(new THREE.BoxGeometry(1.36, 0.14, 1.36), MAT.wood, 0, y, 0);
  return { object: group(box, band(0.2), band(1.1)), collider: 0.9 };
}

function minecart() {
  const body = mesh(new THREE.BoxGeometry(1.5, 0.8, 2.1), MAT.iron, 0, 0.75, 0);
  const ore = mesh(new THREE.DodecahedronGeometry(0.62, 0), MAT.stoneDark, 0, 1.22, 0);
  const wheel = (x, z) => mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 10).rotateZ(Math.PI / 2), MAT.wood, x, 0.3, z);
  return { object: group(body, ore, wheel(-0.8, -0.7), wheel(0.8, -0.7), wheel(-0.8, 0.7), wheel(0.8, 0.7)), collider: 1.2 };
}

function crystal() {
  const shard = (x, z, h, r, tilt) => mesh(new THREE.ConeGeometry(r, h, 5), MAT.crystal, x, h / 2, z).rotateZ(tilt);
  const light = new THREE.PointLight(0xb07bff, 7, 8, 1.9);
  light.position.y = 1.4;
  return { object: group(shard(0, 0, 2.2, 0.42, 0), shard(0.42, 0.14, 1.3, 0.28, -0.3), shard(-0.4, 0.2, 1.1, 0.26, 0.34), light), collider: 0.7 };
}

function woodPost() {
  const post = mesh(new THREE.BoxGeometry(0.34, 3, 0.34), MAT.plank, 0, 1.5, 0);
  const beam = mesh(new THREE.BoxGeometry(1.8, 0.28, 0.36), MAT.wood, 0, 2.9, 0);
  return { object: group(post, beam), collider: 0.4 };
}

function pillar() {
  return {
    object: group(
      mesh(new THREE.CylinderGeometry(0.85, 1, 0.4, 8), MAT.stoneDark, 0, 0.2, 0),
      mesh(new THREE.CylinderGeometry(0.6, 0.68, 1.5, 8), MAT.stone, 0, 1.15, 0),
      mesh(new THREE.CylinderGeometry(0.92, 0.7, 0.3, 8), MAT.stoneDark, 0, 2.05, 0),
    ),
    collider: 1,
  };
}

function lavaPool({ radius = 2 }) {
  const rim = mesh(new THREE.CylinderGeometry(radius + 0.25, radius + 0.4, 0.26, 14), MAT.stoneDark, 0, 0.13, 0);
  const lava = mesh(new THREE.CylinderGeometry(radius, radius, 0.06, 18), MAT.lava, 0, 0.27, 0, false);
  const light = new THREE.PointLight(0xff6a2a, 10, radius * 5, 1.8);
  light.position.y = 1.2;
  return { object: group(rim, lava, light), collider: radius + 0.3 };
}

/* ---------- 三國場景物件（2026-11-09） ---------- */
const SG = {
  leaf: mat(0x4f7d32), leafLight: mat(0x6a9a3e), bark: mat(0x5a4330),
  drum: mat(0x8c2f22), drumSkin: mat(0xe8d6b0), log: mat(0x8a6a44), logDark: mat(0x6b5134),
  canvas: mat(0xe4d8bc), canvasDark: mat(0xc9b993), blade: mat(0xb9c2cc, { metalness: 0.6, roughness: 0.4 }),
};

// 闊葉樹：野外、街道邊
function roundTree() {
  const trunk = mesh(new THREE.CylinderGeometry(0.22, 0.34, 1.8, 7), SG.bark, 0, 0.9, 0);
  const crown = (x, y, z, r, m) => mesh(new THREE.IcosahedronGeometry(r, 0), m, x, y, z);
  return { object: group(trunk, crown(0, 2.5, 0, 1.35, SG.leaf), crown(0.7, 2.2, 0.3, 0.9, SG.leafLight), crown(-0.6, 2.9, -0.2, 0.85, SG.leafLight)), collider: 0.7 };
}

// 戰鼓：鼓架上一面大鼓
function warDrum() {
  const drum = mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.7, 14).rotateX(Math.PI / 2), SG.drum, 0, 1.15, 0);
  const skinA = mesh(new THREE.CircleGeometry(0.72, 14), SG.drumSkin, 0, 1.15, 0.36);
  const skinB = mesh(new THREE.CircleGeometry(0.72, 14), SG.drumSkin, 0, 1.15, -0.36).rotateY(Math.PI);
  const leg = (x) => mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), SG.logDark, x, 0.6, 0);
  return { object: group(drum, skinA, skinB, leg(-0.7), leg(0.7)), collider: 0.85 };
}

// 兵器架：幾支長槍靠在橫木上
function weaponRack() {
  const bar = mesh(new THREE.BoxGeometry(1.8, 0.1, 0.1), SG.logDark, 0, 1.3, 0);
  const post = (x) => mesh(new THREE.BoxGeometry(0.12, 1.4, 0.12), SG.logDark, x, 0.7, 0);
  const spear = (x, tilt) => group(
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 5), SG.log, 0, 1.05, 0),
    mesh(new THREE.ConeGeometry(0.07, 0.3, 5), SG.blade, 0, 2.2, 0),
  ).translateX(x).rotateZ(tilt);
  return { object: group(bar, post(-0.85), post(0.85), spear(-0.5, 0.06), spear(-0.1, -0.04), spear(0.3, 0.05), spear(0.65, -0.03)), collider: 0.8 };
}

// 河（2026-11-12，護送關的渡口）：一大片水面，放在場地外面（可以走的範圍外），碰撞 0
function river({ w = 60, d = 12 }) {
  const water = mesh(new THREE.PlaneGeometry(w, d), RIVER, 0, 0.03, 0, false);
  water.rotation.x = -Math.PI / 2;
  const bank = mesh(new THREE.BoxGeometry(w, 0.25, 0.6), mat(0x6b5a40), 0, 0.05, d / 2, false);
  return { object: group(water, bank), collider: 0 };
}
const RIVER = new THREE.MeshStandardMaterial({ color: 0x3d7fb8, emissive: 0x123a66, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.1 });

// 拒馬列（2026-11-12，第 7 關）：一排矮的拒馬，騎馬或走路都要跳過去（low＝跳起來不擋）。length 公尺長，沿 x 擺
function lowFence({ length = 10 }) {
  const g = new THREE.Group();
  const beam = mesh(new THREE.CylinderGeometry(0.14, 0.14, length, 8).rotateZ(Math.PI / 2), FENCE.wood, 0, 0.55, 0);
  g.add(beam);
  const spike = new THREE.CylinderGeometry(0.03, 0.09, 1.4, 6);
  const n = Math.max(3, Math.round(length / 0.9));
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + 0.3 + (i * (length - 0.6)) / (n - 1);
    for (const a of [0.75, -0.75]) {
      const s = mesh(spike, FENCE.tip, x, 0.55, 0);
      s.rotation.x = a;
      g.add(s);
    }
  }
  const circles = [];
  for (let x = -length / 2 + 0.5; x <= length / 2 - 0.45; x += 0.9) circles.push([x, 0, 0.55]);
  return { object: g, collider: 0, circles, length, low: true };
}
const FENCE = { wood: mat(0x7a5230), tip: mat(0x4a3220) };

// 木橋（第 7 關的長坂橋）：橋面＋兩邊欄杆，可以走（碰撞 0），放在河上
function bridge({ length = 12, width = 5 }) {
  const g = new THREE.Group();
  const deck = mesh(new THREE.BoxGeometry(width, 0.3, length), mat(0x8a6a44), 0, 0.12, 0);
  g.add(deck);
  for (let z = -length / 2 + 0.3; z < length / 2; z += 0.9) g.add(mesh(new THREE.BoxGeometry(width + 0.2, 0.06, 0.12), mat(0x5e4630), 0, 0.29, z));
  for (const x of [-width / 2, width / 2]) {
    g.add(mesh(new THREE.BoxGeometry(0.14, 0.14, length), mat(0x5e4630), x, 1.0, 0));
    for (let z = -length / 2 + 0.2; z <= length / 2; z += 2) g.add(mesh(new THREE.BoxGeometry(0.2, 1, 0.2), mat(0x5e4630), x, 0.5, z));
  }
  return { object: g, collider: 0 };
}

export const PROP_BUILDERS = { lowFence, bridge, river, tombstone, deadTree, rock, torch, glowMushroom, statue, crypt, pineTree, bush, crate, minecart, crystal, woodPost, pillar, lavaPool, roundTree, warDrum, weaponRack };

// 據點（營寨）：木柵欄圍一圈（open 那一側留門）、中間帳篷、旁邊一支軍旗。
// open：門朝哪裡（度，0＝朝 +Z 也就是鏡頭那一側，90＝朝 +X）。軍旗的顏色與字由 setBanner 換。
// 回傳 { object, colliders: [{x,z,r}]（世界座標）, flag（會飄的旗面）, ring（進攻時發亮的地圈）, setBanner(color, text) }
export function buildStronghold({ at: [cx, cz], open = 0, radius = 4.2 }) {
  const root = new THREE.Group();
  root.position.set(cx, 0, cz);
  const colliders = [];
  const openRad = (open * Math.PI) / 180, gap = 0.75; // 門寬（弧度的一半）
  const logGeo = new THREE.CylinderGeometry(0.16, 0.18, 1.7, 6);
  const tipGeo = new THREE.ConeGeometry(0.18, 0.35, 6);
  const step = 0.36 / radius;
  for (let a = 0; a < Math.PI * 2; a += step) {
    const d = Math.atan2(Math.sin(a - openRad), Math.cos(a - openRad));
    if (Math.abs(d) < gap) continue;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius, h = 1.5 + ((a * 7) % 0.4); // 高低參差
    const log = mesh(logGeo, SG.log, x, h / 2, z);
    log.scale.y = h / 1.7;
    root.add(log, mesh(tipGeo, SG.logDark, x, h + 0.15, z));
  }
  // 碰撞：沿柵欄每 1.1 公尺一個圓（門口不放）
  for (let a = 0; a < Math.PI * 2; a += 1.1 / radius) {
    const d = Math.atan2(Math.sin(a - openRad), Math.cos(a - openRad));
    if (Math.abs(d) < gap + 0.12) continue;
    colliders.push({ x: cx + Math.sin(a) * radius, z: cz + Math.cos(a) * radius, r: 0.6 });
  }
  // 帳篷：在門的對面
  const back = openRad + Math.PI, tx = Math.sin(back) * radius * 0.45, tz = Math.cos(back) * radius * 0.45;
  const tent = group(
    mesh(new THREE.ConeGeometry(1.6, 2.2, 6), SG.canvas, 0, 1.1, 0),
    mesh(new THREE.CylinderGeometry(1.62, 1.62, 0.25, 6), SG.canvasDark, 0, 0.12, 0),
    mesh(new THREE.BoxGeometry(0.7, 1.1, 0.1), SG.logDark, 0, 0.55, 1.35),
  );
  tent.position.set(tx, 0, tz);
  tent.rotation.y = openRad;
  root.add(tent);
  colliders.push({ x: cx + tx, z: cz + tz, r: 1.5 });
  // 軍旗：帳篷旁邊，旗面是 canvas 畫的（顏色＋陣營字）
  const fx = Math.sin(back + 0.9) * radius * 0.55, fz = Math.cos(back + 0.9) * radius * 0.55;
  const pole = mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6), SG.logDark, fx, 2.1, fz);
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 192;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.9, 8, 1).translate(0.65, 0, 0), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(fx + 0.08, 3.1, fz);
  flag.rotation.y = openRad - Math.PI / 2;
  flag.castShadow = true;
  colliders.push({ x: cx + fx, z: cz + fz, r: 0.3 });
  // 地圈：進攻這個據點時發亮
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.35, radius + 0.35, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0, depthWrite: false }));
  ring.position.y = 0.04;
  root.add(pole, flag, ring);
  const setBanner = (color, text) => {
    const g = canvas.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 128, 192);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, 0, 128, 14); g.fillRect(0, 178, 128, 14); // 上下白邊
    g.fillStyle = '#ffffff'; g.font = 'bold 96px "Microsoft JhengHei","Noto Sans TC",serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 64, 100);
    tex.needsUpdate = true;
  };
  setBanner('#8a8f98', '兵');
  return { object: root, colliders, flag, ring, setBanner, center: [cx, cz], radius, open: openRad };
}

// 外牆：依 arena 設定沿四邊排列，gates 留缺口。wall 是關卡主題的牆面顏色
export function buildWalls(arena, wall) {
  const wallA = wall ? mat(wall.a) : MAT.stone;
  const wallB = wall ? mat(wall.b) : MAT.stoneDark;
  const gatePost = wall ? mat(wall.gate) : MAT.stoneLight;
  const walls = new THREE.Group();
  const { halfWidth: W, halfDepth: D, gates = [], lowSides = [] } = arena;
  const unit = 2.4;
  const box = new THREE.BoxGeometry(unit, 1, 1);
  const crenel = new THREE.BoxGeometry(0.9, 0.55, 1.1);
  const sides = [
    { name: 'north', from: [-W, -D], dir: [1, 0], len: W * 2 },
    { name: 'south', from: [-W, D], dir: [1, 0], len: W * 2 },
    { name: 'west', from: [-W, -D], dir: [0, 1], len: D * 2 },
    { name: 'east', from: [W, -D], dir: [0, 1], len: D * 2 },
  ];
  for (const side of sides) {
    if (arena.openSides?.includes(side.name)) continue;   // 沒有牆的一邊（渡口那側是河）
    const low = lowSides.includes(side.name); // 靠鏡頭那一邊要矮，才不會擋到角色
    const height = low ? 0.7 : 3.2;
    const count = Math.round(side.len / unit);
    const step = side.len / count;
    const rot = side.dir[0] ? 0 : Math.PI / 2;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) * step;
      const x = side.from[0] + side.dir[0] * t;
      const z = side.from[1] + side.dir[1] * t;
      const along = side.dir[0] ? x : z;
      if (gates.some((g) => g.side === side.name && Math.abs(along - g.at) < g.width / 2)) continue;
      const seg = mesh(box, i % 2 ? wallA : wallB, x, height / 2, z);
      seg.scale.set(step / unit + 0.01, height, 1);
      seg.rotation.y = rot;
      walls.add(seg);
      if (!low && i % 2 === 0) {
        const c = mesh(crenel, wallA, x, height + 0.27, z);
        c.rotation.y = rot;
        walls.add(c);
      }
    }
  }
  // 大門的柱子
  for (const g of gates) {
    for (const s of [-1, 1]) {
      const along = g.at + s * (g.width / 2 + 0.4);
      const x = g.side === 'west' ? -W : g.side === 'east' ? W : along;
      const z = g.side === 'north' ? -D : g.side === 'south' ? D : along;
      walls.add(mesh(new THREE.BoxGeometry(1.5, 4.6, 1.5), gatePost, x, 2.3, z));
    }
  }
  return walls;
}
