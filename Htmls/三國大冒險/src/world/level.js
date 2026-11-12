// 關卡：讀 data/levels/*.json，組出地面、外牆、物件、燈光與碰撞。
import * as THREE from 'three';
import { PROP_BUILDERS, buildStronghold, buildWalls } from './props.js';
import { buildFortress } from './fortress.js';

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

// 沙場：圓形石台，上面鋪沙、畫兩圈線，邊緣一圈紅色提醒「再出去就掉下去」
function buildRing(R, drop, colors = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const g = canvas.getContext('2d');
  const rand = seeded(20261111);
  g.fillStyle = colors.sand ?? '#d9bf8a';
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 9000; i++) {
    const v = 150 + rand() * 70;
    g.fillStyle = `rgba(${v + 40},${v + 10},${v - 50},0.35)`;
    g.fillRect(rand() * 1024, rand() * 1024, 2 + rand() * 6, 2 + rand() * 6);
  }
  const circle = (r, width, color) => { g.strokeStyle = color; g.lineWidth = width; g.beginPath(); g.arc(512, 512, (r / R) * 512, 0, Math.PI * 2); g.stroke(); };
  circle(R - 0.5, 46, colors.edge ?? 'rgba(190,40,30,0.85)');
  circle(R - 1.15, 8, 'rgba(255,240,210,0.9)');
  circle(R * 0.45, 10, 'rgba(120,80,40,0.55)');
  circle(1.2, 10, 'rgba(120,80,40,0.55)');
  const top = new THREE.CanvasTexture(canvas);
  top.colorSpace = THREE.SRGBColorSpace;
  top.anisotropy = 4;
  const side = new THREE.MeshStandardMaterial({ color: colors.stone ?? 0x8c8372, roughness: 0.95, flatShading: true });
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.93, drop, 72, 1), [side, new THREE.MeshStandardMaterial({ map: top, roughness: 1 }), side]);
  stage.position.y = -drop / 2;
  stage.receiveShadow = true;
  stage.castShadow = true;
  const group = new THREE.Group();
  group.add(stage);
  // 邊上八根旗桿（裝飾，立在台子外緣下方一點，不擋路）
  const pole = new THREE.CylinderGeometry(0.08, 0.1, 3.4, 6), cloth = new THREE.BoxGeometry(0.9, 0.6, 0.04);
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3526 }), red = new THREE.MeshStandardMaterial({ color: colors.flag ?? 0xb3261e });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, x = Math.sin(a) * (R + 0.35), z = Math.cos(a) * (R + 0.35);
    const p = new THREE.Mesh(pole, wood); p.position.set(x, 0.9, z); p.castShadow = true;
    const f = new THREE.Mesh(cloth, red); f.position.set(x + Math.cos(a) * 0.5, 2.2, z - Math.sin(a) * 0.5); f.rotation.y = a;
    group.add(p, f);
  }
  return group;
}

// 長方形底面（寬 w、深 d，繞 y 轉 rot 弧度）用一排圓蓋住：圓的半徑＝短邊一半，沿長邊每半個半徑一個
export function boxCircles(x, z, w, d, rot) {
  const long = Math.max(w, d), r = Math.min(w, d) / 2;
  const [ax, az] = w >= d ? [Math.cos(rot), -Math.sin(rot)] : [Math.sin(rot), Math.cos(rot)];   // 長邊方向（模型的 x 軸或 z 軸轉到世界）
  const span = long / 2 - r, n = Math.max(1, Math.ceil(span * 2 / Math.max(r * 0.75, 0.3)) + 1);
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : -span + (2 * span * i) / (n - 1);
    return { x: x + ax * t, z: z + az * t, r };
  });
}

export class Level {
  constructor(game, data) {
    this.data = data;
    this.arena = data.arena;
    this.group = new THREE.Group();
    this.colliders = []; // { x, z, r }
    this.flickers = [];
    this.orbs = [];
    // 攻城關卡（data.siege）：外牆換成兩側城牆＋城門，牆頂是可以站的高台，用梯子上下
    this.platforms = [];   // { x0, x1, z0, z1, top }
    this.ladders = [];
    const grounds = createGround(data.arena, data.theme);
    this.group.add(...grounds);
    // 大亂鬥（data.brawl）：一座圓形的沙場高台，四周是低下去的地面；被打出邊緣就掉下去
    this.ring = null;
    if (data.brawl) {
      const { radius: R, drop = 5 } = data.brawl;
      this.ring = { radius: R, drop };
      grounds[0].position.y = -drop;
      grounds[1].position.y = -drop - 0.02;
      this.group.add(buildRing(R, drop, data.theme?.ring));
    } else if (data.siege) {
      this.fortress = buildFortress(data);
      this.platforms = this.fortress.platforms;
      this.ladders = this.fortress.ladders;
      this.group.add(this.fortress.object);
    } else this.group.add(buildWalls(data.arena, data.theme?.wall));
    this.buildings = [];   // 建築模型（擋住主角時變半透明、敵人會繞過去）
    this.named = new Map();
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
      for (const m of [obj.material].flat()) {   // 沙場的台子有三個材質（陣列）
        m?.map?.dispose();
        m?.dispose();
      }
    });
  }

  static modelIds(data) {
    const objectives = (data.waves ?? []).map((w) => w.objective ?? {});
    return [...data.props.filter((p) => p.type.startsWith('model:')).map((p) => p.type.slice(6)),
      ...objectives.flatMap((o) => [o.model, o.horse, o.type === 'burn' ? o.fire ?? '火計大火' : null])].filter(Boolean);
  }

  // 建築模型（2026-11-12）：prop 寫 size＝長邊幾公尺，模型自動縮放、置中、放在地上；
  // 碰撞用一排圓蓋住房子的底面（solid＝底面的幾成，0＝可以走過去，例如農田）。
  // 有 id 的建築記在 named，任務（燒糧倉）用得到
  addBuilding(game, prop) {
    const [x, z] = prop.at;
    const inner = game.assets.instantiate(prop.type.slice(6)).scene;
    const box = new THREE.Box3().setFromObject(inner), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const s = prop.size / Math.max(size.x, size.z);
    inner.scale.setScalar(s);
    inner.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    const object = new THREE.Group();
    object.add(inner);
    const rot = THREE.MathUtils.degToRad(prop.rot ?? 0);
    object.position.set(x, 0, z);
    object.rotation.y = rot;
    this.group.add(object);
    const w = size.x * s, d = size.z * s, height = size.y * s, solid = prop.solid ?? 0.8;
    const circles = solid > 0 ? boxCircles(x, z, w * solid, d * solid, rot) : [];
    this.colliders.push(...circles);
    const materials = [];
    inner.traverse((o) => { if (o.isMesh) materials.push(o.material); });
    const building = { id: prop.id, object, x, z, w, d, rot, height, circles, materials, fade: 1,
      center: [x, z], radius: Math.hypot(w, d) / 2 * Math.max(solid, 0.5), solid: solid > 0 };
    this.buildings.push(building);
    if (prop.id) this.named.set(prop.id, building);
  }

  addProp(game, prop) {
    const [x, z] = prop.at;
    let built;
    if (prop.type.startsWith('model:') && prop.size) { this.addBuilding(game, prop); return; }
    if (prop.type.startsWith('model:')) {
      built = { object: game.assets.instantiate(prop.type.slice(6)).scene, collider: prop.collider ?? 0.8 };
    } else {
      const builder = PROP_BUILDERS[prop.type];
      if (!builder) throw new Error(`關卡裡有未知的物件類型「${prop.type}」`);
      built = builder(prop);
    }
    const scale = prop.scale ?? 1;
    const floor = this.heightAt(x, z);   // 放在城牆頂的物件（戰鼓、兵器架）
    built.object.position.set(x, floor, z);
    built.object.rotation.y = THREE.MathUtils.degToRad(prop.rot ?? 0);
    built.object.scale.setScalar(scale);
    this.group.add(built.object);
    if (built.collider > 0) this.colliders.push({ x, z, r: built.collider * scale, top: floor > 0, low: built.low });
    if (built.circles) {   // 長條的物件（拒馬列）：一排碰撞圓，轉到物件的方向
      const rot = THREE.MathUtils.degToRad(prop.rot ?? 0), c = Math.cos(rot), s = Math.sin(rot);
      const circles = built.circles.map(([lx, lz, r]) => ({ x: x + (lx * c + lz * s) * scale, z: z + (-lx * s + lz * c) * scale, r: r * scale, low: built.low }));
      this.colliders.push(...circles);
      // 敵人繞路用（和房子一樣）：中心＋半徑
      const len = built.length * scale;
      this.buildings.push({ object: built.object, x, z, w: len, d: 1, rot, height: 0, circles, materials: [], fade: 1, center: [x, z], radius: len / 2, solid: true });
    }
    if (built.flame) this.flickers.push({ light: built.light, flame: built.flame, base: built.light.intensity, phase: Math.random() * 10 });
    if (built.orb) this.orbs.push(built.orb);
  }

  // 這個位置的地面高度：城牆頂是牆高，其他是 0。高度只看 (x, z)，所以特效、金幣、預警圈都能用它決定畫在哪一層
  heightAt(x, z) {
    for (const p of this.platforms) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return p.top;
    return 0;
  }

  // 站在高台上嗎（看 y，不看 x、z：衝刺一格可能超過牆邊，用 y 判斷才不會衝出去就掉下城牆）
  onTop(position) { return this.platforms.length > 0 && position.y > this.platforms[0].top * 0.5; }

  // 梯子：在梯子下端往牆走＝往上爬；在上端往外走＝往下爬。回傳 { ladder, up } 或 null
  ladderAt(position, move) {
    for (const l of this.ladders) {
      const toward = move.x * l.dx + move.z * l.dz;
      if (position.y < 0.5 && toward > 0.5 && Math.hypot(position.x - l.base[0], position.z - l.base[1]) < 0.95) return { ladder: l, up: true };
      if (position.y > l.top - 0.5 && toward < -0.5 && Math.hypot(position.x - l.head[0], position.z - l.head[1]) < 0.95) return { ladder: l, up: false };
    }
    return null;
  }

  // 高台：地面上的人被牆擋住（推出方塊外）；牆頂上的人留在牆頂（最近的一塊高台裡，離牆邊留垛口的厚度）
  constrainPlatforms(position, radius, top) {
    if (top) {
      const inset = radius + 0.3;
      let bx = position.x, bz = position.z, best = Infinity;
      for (const p of this.platforms) {
        const cx = THREE.MathUtils.clamp(position.x, p.x0 + inset, p.x1 - inset), cz = THREE.MathUtils.clamp(position.z, p.z0 + inset, p.z1 - inset);
        const d = (cx - position.x) ** 2 + (cz - position.z) ** 2;
        if (d < best) { best = d; bx = cx; bz = cz; }
      }
      position.x = bx; position.z = bz;
      return;
    }
    for (const p of this.platforms) {
      const nx = THREE.MathUtils.clamp(position.x, p.x0, p.x1), nz = THREE.MathUtils.clamp(position.z, p.z0, p.z1);
      const dx = position.x - nx, dz = position.z - nz, d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        position.x = nx + (dx / d) * radius; position.z = nz + (dz / d) * radius;
      } else {   // 已經在牆裡面：從最近的那一面推出去
        const out = [[position.x - p.x0, 'x', p.x0 - radius], [p.x1 - position.x, 'x', p.x1 + radius], [position.z - p.z0, 'z', p.z0 - radius], [p.z1 - position.z, 'z', p.z1 + radius]]
          .sort((a, b) => a[0] - b[0])[0];
        position[out[1]] = out[2];
      }
    }
  }

  // 把圓形角色推出場景物件與場地邊界。free：正在被打退／掉落中，沙場的邊緣不擋（才會掉下去）
  constrain(position, radius, free = false) {
    if (this.ring && !free) {
      const limit = this.ring.radius - radius - 0.15, d = Math.hypot(position.x, position.z);
      if (d > limit) { position.x *= limit / d; position.z *= limit / d; }
    }
    const top = this.onTop(position);
    if (this.platforms.length) this.constrainPlatforms(position, radius, top);
    for (const c of this.colliders) {
      if (!!c.top !== top) continue;   // 牆頂的東西不擋地面的人，反過來也是
      if (c.low && position.y > 0.5) continue;   // 低的障礙（拒馬）：跳起來就過得去
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
    if (this.fortress) this.fortress.flag.rotation.y = Math.sin(this.time * 1.7) * 0.22;   // 帥旗飄動
    if (this.buildings.length && this.game.player && (this.game.state === 'playing' || this.game.state === 'ending')) this.fadeBuildings(dt, this.game.player.position);
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
      return this.detour(from, to, cx, cz, around);
    }
    // 建築（2026-11-12）：直線穿過房子就從比較近的一側繞
    let best = null, bestT = Infinity;
    for (const b of this.buildings) {
      if (!b.solid) continue;
      const t = this.blockedAt(from, to, b);
      if (t !== null && t < bestT) { bestT = t; best = b; }
    }
    return best ? this.detour(from, to, best.center[0], best.center[1], best.radius + 1.4) : null;
  }

  detour(from, to, cx, cz, around) {
    const ux = to.x - from.x, uz = to.z - from.z, len = Math.hypot(ux, uz) || 1;
    const nx = -uz / len, nz = ux / len;                       // 前進方向的左手邊
    let side = (cx - from.x) * nx + (cz - from.z) * nz > 0 ? -1 : 1;   // 障礙物在左邊就從右邊繞
    // 那一側的繞行點在場地外（拒馬列靠牆那頭）就改走另一側，否則會卡在牆角
    const outside = (s) => Math.abs(cx + nx * s * around) > this.arena.halfWidth - 1 || Math.abs(cz + nz * s * around) > this.arena.halfDepth - 1;
    if (outside(side) && !outside(-side)) side = -side;
    const wx = cx + nx * side * around, wz = cz + nz * side * around;
    const d = Math.hypot(wx - from.x, wz - from.z) || 1;
    return [(wx - from.x) / d, (wz - from.z) / d];
  }

  // 同 blocked，回傳碰到的位置（0～1，越小越近），沒擋到回傳 null
  blockedAt(from, to, b) {
    const [cx, cz] = b.center, r = b.radius + 0.6;
    const ux = to.x - from.x, uz = to.z - from.z, len2 = ux * ux + uz * uz || 1;
    const t = ((cx - from.x) * ux + (cz - from.z) * uz) / len2;
    if (t <= 0 || t >= 1) return null;
    return Math.hypot(from.x + ux * t - cx, from.z + uz * t - cz) < r ? t : null;
  }

  // 鏡頭在南邊（+Z）往北看：主角後面（北邊）的房子不擋；主角前面（南邊）擋住的房子變半透明
  fadeBuildings(dt, p) {
    for (const b of this.buildings) {
      if (!b.materials.length) continue;
      const ahead = b.z - p.z, half = Math.max(b.w, b.d) / 2;
      const hide = ahead > -half * 0.3 && ahead < half + b.height * 1.3 && Math.abs(b.x - p.x) < half + 0.8;
      const target = hide ? 0.3 : 1;
      if (Math.abs(b.fade - target) < 0.01) continue;
      b.fade += (target - b.fade) * Math.min(1, dt * 8);
      if (Math.abs(b.fade - target) < 0.01) b.fade = target;
      for (const m of b.materials) {
        const see = b.fade < 0.99;
        if (m.transparent !== see) { m.transparent = see; m.depthWrite = !see; m.needsUpdate = true; }
        m.opacity = b.fade;
      }
    }
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
