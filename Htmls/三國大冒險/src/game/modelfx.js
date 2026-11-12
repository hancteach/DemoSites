// 特效模型（素材庫 02_模型/09_特效，2026-11-12 晚）：都是靜態模型（寬約 1 公尺、底部貼地），
// 這裡用程式放大、旋轉、上升、淡入淡出，看起來才像特效。用在：
//   地裂岩石 重砸落地、旋風暴風 旋風斬、劍氣／刀氣 劍氣斬（藍藥水，projectiles 的 model）、烈焰燃燒 火計清場與火球爆炸、
//   治療光環 補血、防禦護盾 受傷後的無敵時間、戰場煙霧 隱身、閃電雷擊 張角的雷火、落雷／戰場箭雨／毒霧瘴氣／寒冰 關卡陷阱（hazards.js）。
// spawn(id, x, z, 選項) 回傳 handle；life 寫 Infinity 的要自己 handle.stop()。模型還沒匯入時什麼都不做（回傳 null）。
import * as THREE from 'three';

export const FX_MODELS = ['刀氣', '劍氣', '地裂岩石', '寒冰', '戰場煙霧', '戰場箭雨', '旋風暴風', '毒霧瘴氣', '治療光環', '烈焰燃燒', '落雷', '閃電雷擊', '防禦護盾'];

// 每種特效的外觀預設：glow 用貼圖自發光（不受場景光影響，像光）、additive 加亮混色（光環、護盾、閃電）
const LOOK = {
  旋風暴風: { glow: 0.6, opacity: 0.75 },
  治療光環: { glow: 1.2, additive: true },
  防禦護盾: { basic: true, additive: true, opacity: 0.22, front: true },   // 球殼很多層：加亮混色、只畫正面，才看得到裡面的人
  閃電雷擊: { glow: 1.6, additive: true },
  落雷: { glow: 1.2 },
  烈焰燃燒: { glow: 1.3 },
  寒冰: { glow: 0.35 },
  毒霧瘴氣: { glow: 0.5, opacity: 0.8 },
  戰場煙霧: { glow: 0.4, opacity: 0.85 },
  劍氣: { glow: 0.5 },
  刀氣: { glow: 0.55 },
};

export class ModelFx {
  constructor(game) {
    this.game = game;
    this.live = [];
    this.pool = new Map();   // id → 用完的 object（重複利用，不要每次都 clone）
    this.base = new Map();   // id → { scale, offset, height }：寬度正規化成 1 公尺、置中、底部貼地
  }

  has(id) { return this.game.assets.loaded.has(id); }

  // 模型的大小資訊（寬 1 公尺時的高度），給 projectiles 算 modelScale 用
  info(id) {
    if (!this.base.has(id)) {
      const scene = this.game.assets.loaded.get(id).scene;
      const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const s = 1 / Math.max(size.x, size.z, 1e-3);
      this.base.set(id, { scale: s, offset: new THREE.Vector3(-c.x * s, -box.min.y * s, -c.z * s), height: size.y * s, length: size.z * s, width: size.x * s });
    }
    return this.base.get(id);
  }

  make(id) {
    const free = this.pool.get(id);
    if (free?.length) return free.pop();
    const { scene } = this.game.assets.instantiate(id);
    const look = LOOK[id] ?? {};
    if (look.basic) scene.traverse((m) => { if (m.isMesh) m.material = new THREE.MeshBasicMaterial({ map: m.material.map, color: m.material.color }); });
    const materials = [];
    scene.traverse((m) => { if (m.isMesh) materials.push(m.material); });
    for (const m of materials) {
      m.transparent = true;
      m.depthWrite = false;
      m.side = look.front ? THREE.FrontSide : THREE.DoubleSide;
      if (look.glow && m.emissive) { m.emissive.setHex(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = look.glow; }
      if (look.additive) m.blending = THREE.AdditiveBlending;
    }
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    const b = this.info(id);
    scene.scale.setScalar(b.scale);
    scene.position.copy(b.offset);
    const spinner = new THREE.Group();   // 繞 Y 轉（旋風）
    spinner.add(scene);
    const root = new THREE.Group();
    root.add(spinner);
    return { id, root, spinner, materials, opacity: look.opacity ?? 1 };
  }

  // 選項：size 寬（公尺）、height 改用高度決定大小、y 離地高度、life 秒（Infinity＝一直在）、grow [開始倍率, 結束倍率]、
  //       spin 每秒轉幾圈、rise 每秒上升、fall 從多高掉下來（箭雨、落雷）、yaw 朝向、follow 跟著誰（有 position 的物件）、
  //       fadeIn／fadeOut 淡入淡出秒數、opacity、pulse 呼吸（毒霧）
  spawn(id, x, z, opt = {}) {
    if (!this.has(id)) return null;
    const o = this.make(id);
    const b = this.info(id);
    const size = opt.height ? opt.height / b.height : opt.size ?? 2;
    const h = {
      o, x, z, size, t: 0,
      y: opt.y ?? 0, life: opt.life ?? 0.8, grow: opt.grow ?? [1, 1], spin: opt.spin ?? 0, rise: opt.rise ?? 0, fall: opt.fall ?? 0,
      follow: opt.follow ?? null, fadeIn: opt.fadeIn ?? 0.08, fadeOut: opt.fadeOut ?? 0.3, opacity: (opt.opacity ?? 1) * o.opacity, pulse: opt.pulse ?? 0,
      stopping: false,
      stop() { if (this.life === Infinity) { this.life = this.t + this.fadeOut; this.stopping = true; } },
      get alive() { return this.t < this.life; },
    };
    o.root.rotation.set(0, opt.yaw ?? Math.random() * Math.PI * 2, 0);
    o.spinner.rotation.set(0, 0, 0);
    this.game.scene.add(o.root);
    this.live.push(h);
    this.place(h, 0);
    return h;
  }

  place(h, dt) {
    const { o } = h;
    const p = h.follow?.position;
    const x = p ? p.x : h.x, z = p ? p.z : h.z;
    const ground = p ? p.y ?? 0 : this.game.fx.lift(x, z);
    const k = h.life === Infinity ? 1 : Math.min(1, h.t / Math.max(1e-3, h.life));
    const scale = h.size * (h.grow[0] + (h.grow[1] - h.grow[0]) * (1 - (1 - k) ** 2));
    o.root.scale.setScalar(scale);
    const fallLeft = h.fall ? Math.max(0, 1 - h.t / 0.18) : 0;   // 0.18 秒掉到地面
    o.root.position.set(x, ground + h.y + h.rise * h.t + h.fall * fallLeft, z);
    o.spinner.rotation.y += h.spin * Math.PI * 2 * dt;
    const fadeIn = Math.min(1, h.t / Math.max(1e-3, h.fadeIn));
    const fadeOut = h.life === Infinity ? 1 : Math.min(1, (h.life - h.t) / Math.max(1e-3, h.fadeOut));
    const pulse = h.pulse ? 1 - h.pulse * 0.5 * (1 + Math.sin(h.t * 3)) : 1;
    const a = Math.max(0, h.opacity * fadeIn * fadeOut * pulse);
    for (const m of o.materials) m.opacity = a;
  }

  update(dt) {
    this.live = this.live.filter((h) => {
      h.t += dt;
      if (h.t < h.life && !(h.follow && h.follow.removed)) { this.place(h, dt); return true; }
      this.release(h);
      return false;
    });
  }

  release(h) {
    h.t = h.life = 0;
    h.o.root.removeFromParent();
    if (!this.pool.has(h.o.id)) this.pool.set(h.o.id, []);
    this.pool.get(h.o.id).push(h.o);
  }

  // 換關、重新開始：全部收掉
  clear() {
    for (const h of this.live) this.release(h);
    this.live = [];
  }
}
