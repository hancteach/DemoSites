// 彈射的物理：只在地面（x, z）上算，角色、敵人、道具都當成圓。
// 不碰 Three.js，所以機器人測試可以複製一份狀態先「試射」看看會撞幾下。
export const FRICTION = { decel: 3, drag: 0.45, stop: 0.5 };
export const MAX_SPEED = 30; // 拉滿彈出去的速度（公尺／秒），再乘角色的 power

// ball：{ x, z, vx, vz, r, pierce, inside: Set, touched: Set }
// world：{ w, d, enemies: [{ x, z, r, alive }], allies: [...], items: [...] }
// events：撞到東西會推進去 { type: 'wall'|'hit'|'ally'|'item', target, x, z }
// 回傳 true＝還在動
export function stepBall(ball, dt, world, events) {
  const speed = Math.hypot(ball.vx, ball.vz);
  const steps = Math.max(1, Math.ceil((speed * dt) / (ball.r * 0.5))); // 一小步不超過半徑的一半，才不會穿過去
  const h = dt / steps;
  const hw = world.w / 2 - ball.r, hd = world.d / 2 - ball.r;
  for (let s = 0; s < steps; s++) {
    ball.x += ball.vx * h; ball.z += ball.vz * h;
    if (ball.x < -hw) { ball.x = -hw; ball.vx = Math.abs(ball.vx); events.push({ type: 'wall', x: ball.x - ball.r, z: ball.z }); }
    if (ball.x > hw) { ball.x = hw; ball.vx = -Math.abs(ball.vx); events.push({ type: 'wall', x: ball.x + ball.r, z: ball.z }); }
    if (ball.z < -hd) { ball.z = -hd; ball.vz = Math.abs(ball.vz); events.push({ type: 'wall', x: ball.x, z: ball.z - ball.r }); }
    if (ball.z > hd) { ball.z = hd; ball.vz = -Math.abs(ball.vz); events.push({ type: 'wall', x: ball.x, z: ball.z + ball.r }); }
    ball.onIce = false;
    if (world.obstacles && obstacles(ball, world.obstacles, events)) continue; // 進了傳送點：這一小步不再檢查別的
    for (const e of world.enemies) {
      if (!e.alive) { ball.inside.delete(e); continue; }
      const dx = ball.x - e.x, dz = ball.z - e.z, rr = ball.r + e.r, d2 = dx * dx + dz * dz;
      const inside = d2 < rr * rr;
      if (ball.pierce) {
        // 貫穿型：進去的那一刻打一下，出來之後再進去才算下一下
        if (inside && !ball.inside.has(e)) { ball.inside.add(e); events.push({ type: 'hit', target: e, x: ball.x, z: ball.z }); }
        else if (!inside) ball.inside.delete(e);
      } else if (inside) {
        // 反彈型：推到圓外面，速度沿法線反射
        const d = Math.sqrt(d2) || 0.001, nx = dx / d, nz = dz / d;
        ball.x = e.x + nx * rr; ball.z = e.z + nz * rr;
        const dot = ball.vx * nx + ball.vz * nz;
        if (dot < 0) { ball.vx -= 2 * dot * nx; ball.vz -= 2 * dot * nz; }
        events.push({ type: 'hit', target: e, x: e.x + nx * e.r, z: e.z + nz * e.r });
      }
    }
    for (const a of world.allies) {
      if (!a.alive || ball.touched.has(a)) continue;
      const rr = ball.r + a.r;
      if ((ball.x - a.x) ** 2 + (ball.z - a.z) ** 2 < rr * rr) { ball.touched.add(a); events.push({ type: 'ally', target: a, x: a.x, z: a.z }); }
    }
    for (const it of world.items) {
      if (it.taken) continue;
      const rr = ball.r + it.r;
      if ((ball.x - it.x) ** 2 + (ball.z - it.z) ** 2 < rr * rr) { it.taken = true; events.push({ type: 'item', target: it, x: it.x, z: it.z }); }
    }
  }
  // 摩擦：固定減速＋和速度成正比的阻力
  const sp = Math.hypot(ball.vx, ball.vz);
  ball.age = (ball.age ?? 0) + dt;
  const k = (ball.age > LONG_TIME ? 3 : 1) * (ball.onIce ? ICE_FRICTION : 1);
  const next = sp - (FRICTION.decel + FRICTION.drag * sp) * k * dt;
  if (next < FRICTION.stop) { ball.vx = 0; ball.vz = 0; return false; }
  ball.vx *= next / sp; ball.vz *= next / sp;
  return true;
}

// 機關（stages.json 的 obstacles）：
//   pillar 圓柱、block 方塊：撞到反彈
//   bumper 彈跳墊：撞到反彈並加速（像彈珠台）
//   trap 陷阱：經過扣血（每次彈射每個陷阱只算一次）
//   pad 加速板：經過速度變快（每次彈射只算一次）
//   ice 冰面：在上面摩擦只剩 1/4，跑更遠
//   portal 傳送點：中心碰到就從配對的另一個出來，方向速度不變；離開出口才會再被傳送
// 回傳 true＝剛被傳送
const BUMPER_MAX = MAX_SPEED * 1.25;
const BUMPER_TIMES = 3;
const ICE_FRICTION = 0.25; // 冰面上的摩擦倍率
const LONG_TIME = 7; // 一次彈射超過幾秒，摩擦變 3 倍（保險：一定會停下來）
function bounceCircle(ball, cx, cz, rr) {
  const dx = ball.x - cx, dz = ball.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2) || 0.001, nx = dx / d, nz = dz / d;
  ball.x = cx + nx * rr; ball.z = cz + nz * rr;
  const dot = ball.vx * nx + ball.vz * nz;
  if (dot < 0) { ball.vx -= 2 * dot * nx; ball.vz -= 2 * dot * nz; }
  return { nx, nz };
}
function obstacles(ball, list, events) {
  ball.used ??= new Set();
  if (ball.portalLock && Math.hypot(ball.x - ball.portalLock.x, ball.z - ball.portalLock.z) > ball.portalLock.r + ball.r) ball.portalLock = null;
  for (const o of list) {
    switch (o.type) {
      case 'pillar':
      case 'bumper': {
        const n = bounceCircle(ball, o.x, o.z, o.r + ball.r);
        if (!n) break;
        // 彈跳墊每次彈射最多加速 3 次（否則在彈跳墊和牆之間直直來回彈，加速比摩擦快，會永遠停不下來）
        ball.bumps ??= new Map();
        const times = ball.bumps.get(o) ?? 0;
        if (o.type === 'bumper' && times < BUMPER_TIMES) {
          ball.bumps.set(o, times + 1);
          const sp = Math.hypot(ball.vx, ball.vz), want = Math.min(BUMPER_MAX, sp * (o.boost ?? 1.15) + 6);
          ball.vx *= want / (sp || 1); ball.vz *= want / (sp || 1);
        }
        events.push({ type: o.type, target: o, x: o.x + n.nx * o.r, z: o.z + n.nz * o.r });
        break;
      }
      case 'block': {
        // 方塊：找方塊上離圓心最近的點，太近就沿那個方向推出去並反射
        const hw = o.w / 2, hd = o.d / 2;
        const px = Math.max(o.x - hw, Math.min(ball.x, o.x + hw)), pz = Math.max(o.z - hd, Math.min(ball.z, o.z + hd));
        let dx = ball.x - px, dz = ball.z - pz, d = Math.hypot(dx, dz);
        if (d >= ball.r) break;
        if (d < 1e-6) { // 圓心跑進方塊裡：往最近的邊推
          const ox = hw - Math.abs(ball.x - o.x), oz = hd - Math.abs(ball.z - o.z);
          if (ox < oz) { dx = Math.sign(ball.x - o.x) || 1; dz = 0; } else { dx = 0; dz = Math.sign(ball.z - o.z) || 1; }
          d = 1;
        }
        const nx = dx / d, nz = dz / d;
        ball.x = px + nx * ball.r; ball.z = pz + nz * ball.r;
        const dot = ball.vx * nx + ball.vz * nz;
        if (dot < 0) { ball.vx -= 2 * dot * nx; ball.vz -= 2 * dot * nz; }
        events.push({ type: 'block', target: o, x: px, z: pz });
        break;
      }
      case 'trap':
      case 'pad': {
        if (ball.used.has(o)) break;
        if ((ball.x - o.x) ** 2 + (ball.z - o.z) ** 2 < (o.r + ball.r * 0.4) ** 2) {
          ball.used.add(o);
          if (o.type === 'pad') { const k = o.boost ?? 1.35; ball.vx *= k; ball.vz *= k; }
          events.push({ type: o.type, target: o, x: ball.x, z: ball.z });
        }
        break;
      }
      case 'ice': {
        // 冰面：在上面摩擦很小（每次彈射第一次踩到發一次事件，給特效用）
        if ((ball.x - o.x) ** 2 + (ball.z - o.z) ** 2 < o.r * o.r) {
          ball.onIce = true;
          if (!ball.used.has(o)) { ball.used.add(o); events.push({ type: 'ice', target: o, x: ball.x, z: ball.z }); }
        }
        break;
      }
      case 'portal': {
        if (ball.portalLock === o || !o.to) break;
        if ((ball.x - o.x) ** 2 + (ball.z - o.z) ** 2 < (o.r * 0.75) ** 2) {
          events.push({ type: 'portal', target: o, x: o.x, z: o.z });
          ball.x = o.to.x; ball.z = o.to.z;
          ball.portalLock = o.to;
          ball.inside?.clear();
          return true;
        }
        break;
      }
      default: break;
    }
  }
  return false;
}

// 彈射開始時：站在陷阱、加速板上不算，站在傳送點上不會馬上被傳送
export function prepareBall(ball, list = []) {
  ball.used = new Set();
  ball.portalLock = null;
  ball.bumps = new Map();
  ball.age = 0;
  for (const o of list) {
    const d = Math.hypot(ball.x - o.x, ball.z - o.z);
    if ((o.type === 'trap' || o.type === 'pad') && d < o.r + ball.r * 0.4) ball.used.add(o);
    if (o.type === 'portal' && d < o.r + ball.r) ball.portalLock = o;
  }
  return ball;
}

// 試射：照同樣的規則跑完，回傳會撞到幾下敵人、碰到幾位隊友（敵人不會死，所以是估計）
export function simulate(start, world, maxTime = 8) {
  const ball = prepareBall({ ...start, inside: new Set(), touched: new Set() }, world.obstacles);
  const items = world.items.map((it) => ({ ...it }));
  const w = { ...world, items };
  const events = [];
  let t = 0;
  while (t < maxTime && stepBall(ball, 1 / 60, w, events)) t += 1 / 60;
  const count = (type) => events.filter((e) => e.type === type).length;
  return { hits: count('hit'), allies: count('ally'), walls: count('wall'), traps: count('trap'), portals: count('portal'), bumpers: count('bumper'), pads: count('pad'),
    blocks: count('pillar') + count('block'), end: [ball.x, ball.z], time: t };
}

// 瞄準線：從 (x, z) 往 (dx, dz) 走，碰牆反射，回傳折線（只算牆，最多 bounces 次）
export function guidePath(x, z, dx, dz, length, r, w, d, bounces = 2) {
  const pts = [[x, z]];
  const hw = w / 2 - r, hd = d / 2 - r;
  let left = length;
  for (let i = 0; i <= bounces && left > 0; i++) {
    let tx = Infinity, tz = Infinity;
    if (dx > 0) tx = (hw - x) / dx; else if (dx < 0) tx = (-hw - x) / dx;
    if (dz > 0) tz = (hd - z) / dz; else if (dz < 0) tz = (-hd - z) / dz;
    const t = Math.min(tx, tz, left);
    x += dx * t; z += dz * t; left -= t;
    pts.push([x, z]);
    if (t === tx) dx = -dx;
    if (t === tz) dz = -dz;
  }
  return pts;
}
