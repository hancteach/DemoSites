// 攻城關卡的場景（2026-11-11）：兩側城牆夾著一條通道，盡頭是城門。關卡 JSON 有 "siege" 就用這個代替外牆。
// 座標：通道沿 -Z 往前；城牆從 z = south 往北到場地盡頭；城門正面在 z = gate。
//   siege: { height 牆高, half 通道半寬, south 城牆南端, gate 城門正面, ladders: [{ side: "west"|"east"|"gate", z 或 x }] }
// 回傳 { object, platforms（城牆頂：可以站的高台）, ladders（梯子的上下端點）, setBanner（城門上的帥旗） }
import * as THREE from 'three';

const TILE = 2.2;          // 一張磚牆貼圖鋪幾公尺
const EDGE = 0.75;         // 梯子上端離牆邊多遠（要比垛口厚）
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...extra });

function brickTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#6f685f';
  g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col < 4; col++) {
      const v = 150 + rand() * 38;
      g.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
      g.fillRect(col * 64 + (row % 2 ? 32 : 0) + 2, row * 32 + 2, 60, 28);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

// 方塊的貼圖座標改成「每 TILE 公尺鋪一張」，大牆和小垛口的磚才會一樣大
function tiledBox(w, h, d) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const uv = geometry.attributes.uv;
  const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // +x -x +y -y +z -z
  for (let face = 0; face < 6; face++) {
    for (let i = 0; i < 4; i++) {
      const n = face * 4 + i;
      uv.setXY(n, uv.getX(n) * sizes[face][0] / TILE, uv.getY(n) * sizes[face][1] / TILE);
    }
  }
  return geometry;
}

function box(parent, geometry, material, x, y, z, shadow = true) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// 梯子的上下端點。dx、dz 是「往牆的方向」
export function ladderPoints(siege, arena) {
  const { height: H, half: P, gate: G } = siege;
  return (siege.ladders ?? []).map((l) => {
    if (l.side === 'gate') return { side: l.side, dx: 0, dz: -1, top: H, face: [l.x, G], base: [l.x, G + 0.5], head: [l.x, G - EDGE] };
    const s = l.side === 'west' ? -1 : 1;
    return { side: l.side, dx: s, dz: 0, top: H, face: [s * P, l.z], base: [s * (P - 0.5), l.z], head: [s * (P + EDGE), l.z] };
  });
}

export function buildFortress(data) {
  const { siege, arena } = data;
  const { height: H, half: P, south: S, gate: G } = siege;
  const { halfWidth: W, halfDepth: D } = arena;
  const root = new THREE.Group();
  const brick = std(0xffffff, { map: brickTexture() });
  const wood = std(0x6b4526), dark = std(0x33291f), iron = std(0x3a3d46, { metalness: 0.5, roughness: 0.6 });
  const ladders = ladderPoints(siege, arena);
  const nearLadder = (side, along) => ladders.some((l) => l.side === side && Math.abs((side === 'gate' ? l.face[0] : l.face[1]) - along) < 1.05);

  // 城牆本體：西牆、東牆、城門段
  const wallLen = S + D, wallZ = (S - D) / 2, thick = W - P;
  for (const s of [-1, 1]) box(root, tiledBox(thick, H, wallLen), brick, s * (P + thick / 2), H / 2, wallZ);
  box(root, tiledBox(P * 2, H, G + D), brick, 0, H / 2, (G - D) / 2);
  // 城門（木門＋門釘＋門楣）
  box(root, new THREE.BoxGeometry(3.4, 3.9, 0.3), wood, 0, 1.95, G + 0.16);
  box(root, new THREE.BoxGeometry(0.08, 3.9, 0.34), dark, 0, 1.95, G + 0.17, false);
  box(root, tiledBox(4.2, 0.5, 0.5), brick, 0, 4.15, G + 0.22);
  const stud = new THREE.SphereGeometry(0.09, 8, 6);
  for (let ix = 0; ix < 4; ix++) for (let iy = 0; iy < 4; iy++) box(root, stud, iron, -1.35 + ix * 0.9 + (ix > 1 ? 0 : 0), 0.6 + iy * 0.9, G + 0.33, false);

  // 垛口：內側牆邊一格一格（梯子的地方留缺口），用 InstancedMesh 一次畫完
  const spots = [];
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'west' : 'east';
    for (let z = S - 0.7; z > G - 0.2; z -= 1.5) if (!nearLadder(side, z)) spots.push([s * (P + 0.27), z, 0]);
    for (let x = P + 0.8; x < W - 0.4; x += 1.5) spots.push([s * x, S - 0.27, 1]);            // 南面
  }
  for (let x = -P + 0.75; x < P; x += 1.5) if (!nearLadder('gate', x)) spots.push([x, G - 0.27, 1]);
  const merlons = new THREE.InstancedMesh(tiledBox(0.54, 0.85, 0.95), brick, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  spots.forEach(([x, z, rotated], i) => merlons.setMatrixAt(i, m4.compose(new THREE.Vector3(x, H + 0.42, z), rotated ? turn : q, new THREE.Vector3(1, 1, 1))));
  merlons.castShadow = merlons.receiveShadow = true;
  root.add(merlons);
  // 外側與北面的矮牆
  for (const s of [-1, 1]) box(root, tiledBox(0.5, 1.1, wallLen), brick, s * (W - 0.25), H + 0.55, wallZ);
  box(root, tiledBox(W * 2, 1.1, 0.5), brick, 0, H + 0.55, -D + 0.25);

  // 梯子：兩根直桿＋橫木，貼在牆面
  const rail = new THREE.BoxGeometry(0.12, H + 0.9, 0.12);
  for (const l of ladders) {
    const sideX = Math.abs(l.dz), sideZ = Math.abs(l.dx);         // 沿牆面的方向
    const fx = l.face[0] - l.dx * 0.16, fz = l.face[1] - l.dz * 0.16;
    for (const o of [-0.45, 0.45]) box(root, rail, wood, fx + sideX * o, (H + 0.9) / 2, fz + sideZ * o);
    const rung = new THREE.BoxGeometry(sideX ? 0.9 : 0.08, 0.08, sideZ ? 0.9 : 0.08);
    for (let y = 0.4; y < H + 0.7; y += 0.42) box(root, rung, wood, fx, y, fz, false);
  }

  // 牆面掛的布條（裝飾）
  const cloth = std(0x9c1f1a, { side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    for (let z = S - 4; z > G + 3; z -= 9) {
      if (nearLadder(s < 0 ? 'west' : 'east', z) || nearLadder(s < 0 ? 'west' : 'east', z + 1) || nearLadder(s < 0 ? 'west' : 'east', z - 1)) continue;
      box(root, new THREE.BoxGeometry(0.05, 2.4, 1.2), cloth, s * (P - 0.04), H - 2.1, z, false);
    }
  }

  // 城門上的帥旗（開戰時是敵軍的，攻下後換成玩家陣營）
  const fz = -D + 1.6;
  box(root, new THREE.CylinderGeometry(0.08, 0.1, 5.2, 6), dark, 0, H + 2.6, fz);
  const canvas = document.createElement('canvas');
  canvas.width = 192; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.8, 8, 1).translate(1.35, 0, 0), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(0.08, H + 4.1, fz);
  flag.castShadow = true;
  root.add(flag);
  const setBanner = (color, text) => {
    const g = canvas.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 192, 128);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, 0, 192, 10); g.fillRect(0, 118, 192, 10);
    g.fillStyle = '#ffffff'; g.font = 'bold 88px "Microsoft JhengHei","Noto Sans TC",serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 96, 68);
    tex.needsUpdate = true;
  };
  setBanner('#8a8f98', '帥');

  // 可以站的高台：東西牆頂＋城門頂（城門頂橫跨整個寬度，和兩側牆頂相連）
  const platforms = [
    { x0: -W, x1: -P, z0: -D, z1: S, top: H },
    { x0: P, x1: W, z0: -D, z1: S, top: H },
    { x0: -W, x1: W, z0: -D, z1: G, top: H },
  ];
  return { object: root, platforms, ladders, flag, setBanner };
}

// 拒馬：一根橫木＋交叉的尖木樁，橫在通道上
export function buildBarricade(width) {
  const wood = std(0x7a5230), tip = std(0x4a3220);
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, width, 8).rotateZ(Math.PI / 2), wood);
  beam.position.y = 0.75;
  beam.castShadow = true;
  g.add(beam);
  const spike = new THREE.CylinderGeometry(0.03, 0.1, 2.1, 6);
  const n = Math.max(3, Math.round(width / 1.0));
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + 0.5 + (i * (width - 1)) / (n - 1);
    for (const a of [0.7, -0.7]) {
      const s = new THREE.Mesh(spike, tip);
      s.position.set(x, 0.75, 0);
      s.rotation.x = a;
      s.castShadow = true;
      g.add(s);
    }
  }
  return g;
}

// 落石碎堆
export function buildRubble() {
  const stone = std(0x8d877c, { flatShading: true });
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const r = 0.3 + Math.random() * 0.22;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stone);
    m.position.set((Math.random() - 0.5) * 0.8, r * 0.7, (Math.random() - 0.5) * 0.8);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}
