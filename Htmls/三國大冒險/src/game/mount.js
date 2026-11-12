// 騎馬（2026-11-12，第 7 關「長坂坡突圍」）：馬是綁骨動作工坊做的馬匹模型（赤兔馬、的盧馬），
// 背上有 MountSocket 骨頭（馬鞍）。騎上去時馬掛在騎士的 root 底下（一起移動、轉向），騎士的模型往上移到馬鞍，
// 動作換成騎乘動作：待機／走／跑＝RideIdle、各種攻擊＝RideAttack；馬依照移動速度播 Idle／Walk／Run，跳的時候播 Jump。
// 沒有騎乘動作的武將（綁骨時還沒有這兩段）借「騎兵」的 RideIdle／RideAttack：大家的骨頭名稱一樣，
// 只有 Hips 的位置要依身材換算（retargetRideClips）。
// 馬的數值在 data/mounts.json：scale 大小、speed 騎乘時的速度、hp 被打幾下會被打下馬。
import * as THREE from 'three';

const RIDE_CLIPS = ['RideIdle', 'RideAttack'];
const ATTACK_NAMES = /^(Attack|Thrust|Launcher|AirAttack|Plunge)/;
const SEAT_LIFT = 0.04;   // 坐在馬鞍上面一點，不陷進馬背

// 把「騎兵」的騎乘動作換算給別的模型：轉動照抄，Hips 位置依兩個模型 Hips 的高度比例換算
export function retargetRideClips(sourceClips, sourceRest, targetRest) {
  const ratio = targetRest.y / sourceRest.y;
  return sourceClips.map((clip) => {
    const tracks = clip.tracks.map((track) => {
      if (track.name !== 'Hips.position') return track;
      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i += 3) {
        values[i] = targetRest.x + (values[i] - sourceRest.x);
        values[i + 1] = targetRest.y + (values[i + 1] - sourceRest.y) * ratio;
        values[i + 2] = targetRest.z + (values[i + 2] - sourceRest.z);
      }
      return new THREE.VectorKeyframeTrack(track.name, Array.from(track.times), Array.from(values));
    });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  });
}

// 這個角色有沒有騎乘動作；沒有就向「騎兵」借（main.js 載入時準備好 game.rideSource）
export function ensureRideClips(game, actor) {
  if (RIDE_CLIPS.every((n) => actor.clips.has(n))) return true;
  const src = game.rideSource;
  const hips = actor.model.getObjectByName('Hips');
  if (!src || !hips) return false;
  for (const clip of retargetRideClips(src.clips, src.rest, hips.position)) actor.clips.set(clip.name, clip);
  return true;
}

// 播動作時，騎在馬上的人換成騎乘動作
export function rideName(name) {
  if (ATTACK_NAMES.test(name)) return 'RideAttack';
  if (name === 'Death') return 'Death';
  return 'RideIdle';
}

export class Horse {
  constructor(game, id, cfg = {}) {
    this.game = game;
    this.id = id;
    this.cfg = cfg;
    const inst = game.assets.instantiate(id);
    this.root = new THREE.Group();
    this.model = inst.scene;
    this.model.scale.setScalar(cfg.scale ?? 1);
    this.root.add(this.model);
    this.materials = inst.materials;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = new Map(inst.clips.map((c) => [c.name, c]));
    this.socket = this.model.getObjectByName('MountSocket');
    this.maxHp = cfg.hp ?? 6;
    this.hp = this.maxHp;
    this.current = null;
    this.currentName = '';
    this.last = null;
    this.speed = 0;
    this.play('Idle');
  }

  play(name, { once = false, fade = 0.18, speed = 1 } = {}) {
    if (!once && name === this.currentName) { if (this.current) this.current.timeScale = speed; return; }
    const clip = this.clips.get(name);
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
    next.clampWhenFinished = once;
    next.timeScale = speed;
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    this.current = next;
    this.currentName = name;
  }

  // 馬鞍在 parent（騎士的 root）座標裡的位置
  seatIn(parent, out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    this.socket.getWorldPosition(out);
    return parent.worldToLocal(out);
  }

  // 依照實際移動的速度選動作（world：這一格的世界座標）
  animate(dt, world, { air = false, loose = false } = {}) {
    if (this.last && dt > 0) {
      const v = Math.hypot(world.x - this.last.x, world.z - this.last.z) / dt;
      this.speed += (v - this.speed) * Math.min(1, dt * 10);
    }
    this.last = { x: world.x, z: world.z };
    if (this.special > 0) this.special -= dt;   // 人立嘶鳴、受擊播完前不換動作
    else if (air) this.play('Jump', { speed: 1.1 });
    else if (this.speed > 4.2) this.play('Run', { speed: Math.min(1.5, this.speed / 8) });
    else if (this.speed > 0.4) this.play('Walk', { speed: Math.max(0.7, this.speed / 2.2) });
    else this.play('Idle');
    this.mixer.update(dt);
  }

  oneShot(name, speed = 1) {
    if (!this.clips.has(name)) return;
    this.play(name, { once: true, fade: 0.08, speed });
    this.special = this.clips.get(name).duration / speed;
  }

  flash(color = 0xff5533) {
    for (const m of this.materials) { m.emissive.setHex(color); m.emissiveIntensity = 1.2; }
    this.flashTime = 0.13;
  }

  updateFlash(dt) {
    if (!(this.flashTime > 0)) return;
    this.flashTime -= dt;
    if (this.flashTime <= 0) for (const m of this.materials) m.emissiveIntensity = 0;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.parent?.remove(this.root);
    for (const m of this.materials) m.dispose();
  }
}

// 騎上馬：馬掛在騎士 root 底下，騎士模型移到馬鞍上（scale：騎士比一般人大時，馬也跟著放大）
export function mountActor(actor, horse) {
  actor.mount = horse;
  const s = actor.def.scale ?? 1;
  horse.root.position.set(0, 0, 0);
  horse.root.rotation.set(0, 0, 0);
  horse.root.scale.setScalar(s);
  actor.root.add(horse.root);
  horse.last = null;
  horse.speed = 0;
  actor.mixer.stopAllAction();   // 不要和原本的動作混在一起量（交叉淡入時骨盆還在站姿的高度）
  actor.current = null;
  actor.currentName = '';
  actor.play('RideIdle');
  actor.mixer.update(0.001);
  actor.model.position.set(0, 0, 0);
  actor.root.updateMatrixWorld(true);
  const hips = actor.model.getObjectByName('Hips');
  const seated = hips ? actor.root.worldToLocal(hips.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(0, 0.45 * s, 0);
  actor.seatBase = horse.seatIn(actor.root);
  actor.seatOffset = new THREE.Vector3(0, actor.seatBase.y - seated.y + SEAT_LIFT, actor.seatBase.z - seated.z);
  actor.model.position.copy(actor.seatOffset);
}

// 下馬：馬從騎士身上拿下來，放到 world 的 (x, z)（玩家被打下馬時馬跑到旁邊）；回傳那匹馬
export function dismountActor(actor) {
  const horse = actor.mount;
  if (!horse) return null;
  actor.mount = null;
  actor.model.position.set(0, 0, 0);
  actor.currentName = '';
  const world = new THREE.Vector3();
  horse.root.getWorldPosition(world);
  const yaw = actor.root.rotation.y;
  actor.root.remove(horse.root);
  horse.root.scale.setScalar(1);
  horse.root.position.copy(world);
  horse.root.rotation.set(0, yaw, 0);
  actor.game.scene.add(horse.root);
  horse.last = null;
  return horse;
}

// 每一格：馬依速度播動作，騎士跟著馬鞍上下起伏
export function updateRider(actor, dt, opts) {
  const horse = actor.mount;
  if (!horse) return;
  horse.animate(dt, actor.root.position, opts);
  horse.updateFlash(dt);
  const seat = horse.seatIn(actor.root);
  actor.model.position.set(actor.seatOffset.x, actor.seatOffset.y + (seat.y - actor.seatBase.y), actor.seatOffset.z + (seat.z - actor.seatBase.z));
}
