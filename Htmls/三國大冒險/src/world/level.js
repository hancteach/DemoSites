// 關卡：讀 data/levels/*.json，組出地面、外牆、物件、燈光與碰撞。
import * as THREE from 'three';
import { PROP_BUILDERS, buildStronghold, buildWalls } from './props.js';

// 固定亂數種子，每次進遊戲地面都長一樣
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// 月光墓園的地面；其他關卡在 theme.ground 寫自己的顏色與道路
const DEFAULT_GROUND = { base: '#2f4a38', speck: [0.7, 1.25, 0.75], stone: [0, 3, 12], stoneBase: 70, plaza: 8.2 };

function paintGround({ halfWidth: W, halfDepth: D }, groundTheme) {
  const { base, speck, stone, stoneBase, plaza = 0, paths, tiles } = { ...DEFAULT_GROUND, plaza: groundTheme ? 0 : DEFAULT_GROUND.plaza, ...groundTheme };
  const scale = 40; // 每公尺幾像素
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(4096, W * 2 * scale);
  canvas.height = Math.min(4096, D * 2 * scale);
  const g = canvas.getContext('2d');
  const sx = canvas.width / (W * 2), sz = canvas.height / (D * 2);
  const px = (x) => (x + W) * sx, pz = (z) => (z + D) * sz;
  const rand = seeded(20261102);

  g.fillStyle = base;
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 16000; i++) {
    const shade = 40 + rand() * 40;
    g.fillStyle = `rgba(${shade * speck[0]},${shade * speck[1]},${shade * speck[2]},0.5)`;
    g.fillRect(rand() * canvas.width, rand() * canvas.height, 2 + rand() * 7, 2 + rand() * 7);
  }

  // 石板路：中央廣場往三個大門
  const cobble = (x, z, w, h) => {
    const v = stoneBase + rand() * 34;
    g.fillStyle = `rgb(${v + stone[0]},${v + stone[1]},${v + stone[2]})`;
    g.beginPath();
    g.roundRect(px(x) - (w * sx) / 2, pz(z) - (h * sz) / 2, w * sx, h * sz, 5);
    g.fill();
  };
  const path = (x0, z0, x1, z1, width) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
    const rows = Math.ceil(width / 0.62);
    for (let t = 0; t < len; t += 0.62) {
      for (let r = 0; r < rows; r++) {
        if (rand() < 0.05) continue; // 缺幾塊比較有廢墟感
        const o = -width / 2 + (r + 0.5) * (width / rows) + (t % 1.24 ? 0.14 : -0.14);
        cobble(x0 + ((x1 - x0) * t) / len + nx * o, z0 + ((z1 - z0) * t) / len + nz * o, 0.54, 0.54);
      }
    }
  };
  if (tiles) { // 地牢：整片石板
    const size = 1.9;
    for (let x = -W + size / 2; x < W; x += size) {
      for (let z = -D + size / 2; z < D; z += size) cobble(x, z, size - 0.1, size - 0.1);
    }
  }
  const roads = paths ?? (groundTheme ? [] : [[0, -D, 0, 0, 4.6], [-W, 0, W, 0, 4.6]]);
  for (const road of roads) path(...road);
  for (let r = 0.4; r < plaza; r += 0.62) {
    const n = Math.floor((Math.PI * 2 * r) / 0.62);
    for (let i = 0; i < n; i++) {
      if (rand() < 0.04) continue;
      const a = (i / n) * Math.PI * 2 + r;
      cobble(Math.cos(a) * r, Math.sin(a) * r, 0.55, 0.55);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createGround(arena, theme) {
  const { halfWidth: W, halfDepth: D } = arena;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), new THREE.MeshStandardMaterial({ map: paintGround(arena, theme?.ground), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: theme?.outside ?? 0x16201f, roughness: 1 }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.02;
  return [ground, outside];
}

export class Level {
  constructor(game, data) {
    this.data = data;
    this.arena = data.arena;
    this.group = new THREE.Group();
    this.colliders = []; // { x, z, r }
    this.flickers = [];
    this.orbs = [];
    this.group.add(...createGround(data.arena, data.theme), buildWalls(data.arena, data.theme?.wall));
    for (const prop of data.props) this.addProp(game, prop);
    // 據點（營寨）：柵欄、帳篷、軍旗。旗子顏色在開戰時依敵軍陣營換，攻下後換成玩家陣營
    this.strongholds = new Map();
    for (const sh of data.strongholds ?? []) {
      const built = buildStronghold(sh);
      this.group.add(built.object);
      this.colliders.push(...built.colliders);
      this.strongholds.set(sh.id, { ...built, def: sh, attacking: false });
    }
    game.scene.add(this.group);
    this.game = game;
    this.time = 0;
  }

  // 換關時清掉場景。共用材質釋放後下次使用會自動重建，不必區分
  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.map?.dispose();
      obj.material?.dispose();
    });
  }

  static modelIds(data) {
    return data.props.filter((p) => p.type.startsWith('model:')).map((p) => p.type.slice(6));
  }

  addProp(game, prop) {
    const [x, z] = prop.at;
    let built;
    if (prop.type.startsWith('model:')) {
      built = { object: game.assets.instantiate(prop.type.slice(6)).scene, collider: prop.collider ?? 0.8 };
    } else {
      const builder = PROP_BUILDERS[prop.type];
      if (!builder) throw new Error(`關卡裡有未知的物件類型「${prop.type}」`);
      built = builder(prop);
    }
    const scale = prop.scale ?? 1;
    built.object.position.set(x, 0, z);
    built.object.rotation.y = THREE.MathUtils.degToRad(prop.rot ?? 0);
    built.object.scale.setScalar(scale);
    this.group.add(built.object);
    if (built.collider > 0) this.colliders.push({ x, z, r: built.collider * scale });
    if (built.flame) this.flickers.push({ light: built.light, flame: built.flame, base: built.light.intensity, phase: Math.random() * 10 });
    if (built.orb) this.orbs.push(built.orb);
  }

  // 把圓形角色推出場景物件與場地邊界
  constrain(position, radius) {
    for (const c of this.colliders) {
      const dx = position.x - c.x;
      const dz = position.z - c.z;
      const min = c.r + radius;
      const dist2 = dx * dx + dz * dz;
      if (dist2 >= min * min) continue;
      const dist = Math.sqrt(dist2) || 0.001;
      position.x = c.x + (dx / dist) * min;
      position.z = c.z + (dz / dist) * min;
    }
    const margin = 0.6 + radius;
    position.x = THREE.MathUtils.clamp(position.x, -this.arena.halfWidth + margin, this.arena.halfWidth - margin);
    position.z = THREE.MathUtils.clamp(position.z, -this.arena.halfDepth + margin, this.arena.halfDepth - margin);
  }

  update(dt) {
    this.time += dt;
    for (const f of this.flickers) {
      const n = Math.sin(this.time * 11 + f.phase) * 0.5 + Math.sin(this.time * 23 + f.phase * 2) * 0.5;
      f.light.intensity = f.base * (1 + n * 0.14);
      f.flame.scale.y = 1 + n * 0.16;
    }
    for (const orb of this.orbs) {
      orb.position.y = 3.4 + Math.sin(this.time * 1.6) * 0.14;
      orb.rotation.y += dt * 0.7;
    }
    for (const sh of this.strongholds.values()) {
      sh.flag.rotation.z = Math.sin(this.time * 2.3 + sh.center[0]) * 0.05;   // 旗子微微飄
      sh.flag.scale.x = 1 + Math.sin(this.time * 3.1 + sh.center[1]) * 0.04;
      sh.ring.material.opacity = sh.attacking ? 0.35 + Math.sin(this.time * 5) * 0.2 : 0;
    }
  }

  // 據點：換旗子（顏色、字）、標示正在進攻
  setStronghold(id, { color, text, attacking } = {}) {
    const sh = this.strongholds.get(id);
    if (!sh) return;
    if (color) sh.setBanner(color, text);
    if (attacking !== undefined) sh.attacking = attacking;
  }

  // 繞過營寨：敵人沒有尋路，直直走會卡在柵欄外面（實測兩個刀兵卡在本陣西側 150 秒，這波結束不了）。
  // 從 from 走向 to 的直線若穿過某座營寨，改走向營寨旁邊的繞行點；人在營寨裡面就先走到門口。回傳 [mx, mz] 或 null（不用繞）
  steer(from, to) {
    for (const sh of this.strongholds.values()) {
      const [cx, cz] = sh.center, R = sh.radius, around = R + 1.6;
      const doorX = cx + Math.sin(sh.open) * (R + 1.5), doorZ = cz + Math.cos(sh.open) * (R + 1.5);
      const inFrom = Math.hypot(from.x - cx, from.z - cz) < R - 0.2, inTo = Math.hypot(to.x - cx, to.z - cz) < R - 0.2;
      if (inFrom && inTo) continue;
      if (inFrom || inTo) {   // 一個在營裡、一個在營外：經過門口（已經在門口附近就直走）
        if (Math.hypot(from.x - doorX, from.z - doorZ) < 1.6) continue;
        if (inTo && this.blocked(from, { x: doorX, z: doorZ }, sh) === false) { const d = Math.hypot(doorX - from.x, doorZ - from.z); return [(doorX - from.x) / d, (doorZ - from.z) / d]; }
        if (inFrom) { const d = Math.hypot(doorX - from.x, doorZ - from.z); return [(doorX - from.x) / d, (doorZ - from.z) / d]; }
      }
      if (!this.blocked(from, to, sh)) continue;
      const ux = to.x - from.x, uz = to.z - from.z, len = Math.hypot(ux, uz) || 1;
      const nx = -uz / len, nz = ux / len;                       // 前進方向的左手邊
      const side = (cx - from.x) * nx + (cz - from.z) * nz > 0 ? -1 : 1;   // 營寨在左邊就從右邊繞
      const wx = cx + nx * side * around, wz = cz + nz * side * around;
      const d = Math.hypot(wx - from.x, wz - from.z) || 1;
      return [(wx - from.x) / d, (wz - from.z) / d];
    }
    return null;
  }

  // 直線 from→to 會不會穿過營寨（柵欄外再留 0.9 公尺）
  blocked(from, to, sh) {
    const [cx, cz] = sh.center, r = sh.radius + 0.9;
    const ux = to.x - from.x, uz = to.z - from.z, len2 = ux * ux + uz * uz || 1;
    const t = ((cx - from.x) * ux + (cz - from.z) * uz) / len2;
    if (t <= 0 || t >= 1) return false;
    return Math.hypot(from.x + ux * t - cx, from.z + uz * t - cz) < r;
  }

  // 據點出兵的位置：營寨門口外面一排（不放在柵欄裡：弓兵、策士會往後退，退進柵欄裡箭被擋住、近戰也打不到，會僵住）
  strongholdPoints(id) {
    const sh = this.strongholds.get(id);
    if (!sh) return [];
    const [cx, cz] = sh.center, out = sh.radius + 1.2;
    const fx = Math.sin(sh.open), fz = Math.cos(sh.open);   // 門的方向
    return [-2, -1, 0, 1, 2].map((i) => [cx + fx * out + fz * i * 1.2, cz + fz * out - fx * i * 1.2]);
  }
}
