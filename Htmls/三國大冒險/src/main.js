// 遊戲主程式：把素材、關卡、角色組起來，跑主迴圈。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Assets, loadJson } from './core/assets.js';
import { Input } from './core/input.js';
import { Sfx } from './core/sfx.js';
import { Boss } from './game/boss.js';
import { Chests } from './game/chests.js';
import { Enemy } from './game/enemy.js';
import { EnemyShots } from './game/enemyShots.js';
import { Clones } from './game/clones.js';
import { Coins } from './game/coins.js';
import { Fx } from './game/fx.js';
import { Hazards } from './game/hazards.js';
import { Items } from './game/items.js';
import { Player } from './game/player.js';
import { Progress } from './game/progress.js';
import { Projectiles } from './game/projectiles.js';
import { Shop } from './game/shop.js';
import { Skills, pushAway } from './game/skills.js';
import { BrawlDirector } from './game/brawl.js';
import { Rival } from './game/rival.js';
import { SiegeDirector } from './game/siege.js';
import { WaveDirector } from './game/waves.js';
import { Hud } from './ui/hud.js';
import { renderPortraits } from './ui/portraits.js';

// 選將卡片的大頭照：assets/portraits/portraits.json（人物大頭照裁切工具輸出的清單）→ { 名稱: 圖片網址 }。沒有這個檔就用模型拍的頭像
async function loadCardArt() {
  try {
    const list = await loadJson('assets/portraits/portraits.json');
    return Object.fromEntries((list.items ?? []).map((it) => [it.name, `assets/portraits/${it.file.split('/').map(encodeURIComponent).join('/')}`]));
  } catch {
    return {};
  }
}

// 卡片上的攻擊方式小標籤
function attackStyle(def) {
  if (def.shot) return '遠程';
  return { dash: '突刺衝鋒', spin: '旋風斬', smash: '重砸' }[def.attack?.type] ?? (def.slash === 'cross' ? '十字斬' : '橫掃');
}
import { ShopPanel } from './ui/shopPanel.js';
import { TouchControls } from './ui/touch.js';
import { Level } from './world/level.js';
import { ShopStage } from './world/shopStage.js';

const CAMERA_OFFSET = new THREE.Vector3(0, 11.5, 9.8);
const CAMERA_LOOK_HEIGHT = 0.8;
const CAMERA_INSET = { x: 10, zMin: 8, zMax: 5 }; // 鏡頭不跑出場地，離邊界的距離
// 月光墓園的光線；其他關卡在 theme 寫自己的
const DEFAULT_THEME = { background: '#10162b', fog: '#10162b', fogNear: 32, fogFar: 58, hemiSky: '#7f97e0', hemiGround: '#232c22', hemiIntensity: 0.55, moon: '#bcd0ff', moonIntensity: 1.5 };
const HIT_STOP = 0.055;
const SEPARATION_PUSH = 0.5;
const SHOW_END_DELAY = 1.6;
const CROSS_GAP = 0.08; // 十字斬兩刀的間隔，做出「答、答」的節奏
const CROSS_ANGLE = Math.PI / 4;
const CROSS_COLOR = 0xd9c8ff;
const SELECT_SWAY = 0.45; // 選角時鏡頭只小幅擺動，角色才一直面向玩家
const AMBUSH_COLOR = '#c4b5fd';
const POTION_COLORS = { 綠藥水: '#4ade80', 紅藥水: '#f87171' };

// 有 base 的角色先沿用 base 的數值，自己寫的欄位再蓋上去。skill 是角色自己的，不繼承
function resolveCharacters(characters) {
  return Object.fromEntries(Object.entries(characters).map(([id, def]) => [id, { ...characters[def.base], skill: undefined, ...def, id }]));
}

const pickLine = (lines) => lines[Math.floor(Math.random() * lines.length)];

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x10162b);
    this.scene.fog = new THREE.Fog(0x10162b, 32, 58);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 150);
    this.cameraTarget = new THREE.Vector3();

    this.assets = new Assets();
    this.input = new Input(this.canvas);
    this.input.onPause = () => this.togglePause();
    this.touch = new TouchControls(this.input, { onPause: () => this.togglePause() });
    this.sfx = new Sfx();
    this.hud = new Hud();
    this.fx = new Fx(this.scene);
    this.enemies = [];
    this.state = 'loading';
    this.score = 0;
    this.hitStop = 0;
    this.attackMultiplier = 1;
    this.shotSide = 1;
    this.clock = new THREE.Clock();
    this.fps = { frames: 0, time: 0, value: 0 };

    addEventListener('resize', () => this.resize());
    this.resize();
    this.setupLights();
  }

  setupLights() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42; // 模型的金屬度偏高，沒有環境光會變黑
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0x7f97e0, 0x232c22, 0.55);
    this.scene.add(this.hemi);
    const moon = new THREE.DirectionalLight(0xbcd0ff, 1.5);
    this.moon = moon;
    moon.position.set(-14, 26, 12);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.03;
    Object.assign(moon.shadow.camera, { left: -30, right: 30, top: 28, bottom: -28, near: 1, far: 70 });
    this.scene.add(moon);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.shopStage?.resize(innerWidth / innerHeight);
  }

  async load() {
    await this.assets.init();
    this.settings = await loadJson('data/game.json');
    this.characters = resolveCharacters(await loadJson('data/characters.json'));
    this.factions = await loadJson('data/factions.json');
    const onlyLevel = new URLSearchParams(location.search).get('level'); // 測試新關卡用
    this.levelOrder = onlyLevel ? [onlyLevel] : this.settings.levels;
    this.levels = Object.fromEntries(await Promise.all(this.levelOrder.map(async (id) => [id, await loadJson(`data/levels/${encodeURIComponent(id)}.json`)])));
    const allLevels = Object.values(this.levels);
    const allWaves = allLevels.flatMap((l) => l.waves);

    const bossIds = [...allWaves.flatMap((w) => w.boss ?? []), ...allWaves.map((w) => w.captain).filter(Boolean)];
    const summoned = bossIds.flatMap((id) => this.characters[id]?.boss?.skills.map((s) => s.enemy) ?? []).filter(Boolean);
    const defenders = allLevels.flatMap((l) => (l.siege?.defenders ?? []).map((d) => d.enemy));   // 攻城關卡開場就站好的守軍
    const enemyIds = [...allWaves.flatMap((w) => (w.spawns ?? []).map((s) => s.enemy)), ...defenders, ...bossIds, ...summoned];
    // 分裂出來的小怪（史萊姆）也要先載入
    for (let i = 0; i < enemyIds.length; i++) {
      const def = this.characters[enemyIds[i]];
      if (!def) throw new Error(`data/characters.json 沒有「${enemyIds[i]}」`);
      if (def.split && !enemyIds.includes(def.split.into)) enemyIds.push(def.split.into);
    }
    // 敵人丟出來的東西（箭、飛鏢、火焰彈）
    this.enemyShotSpecs = [...new Set(enemyIds)].flatMap((id) => {
      const def = this.characters[id];
      return [def.ability?.shot, ...(def.boss?.skills ?? []).map((s) => s.shot)].filter(Boolean);
    });
    this.itemConfig = await loadJson('data/items.json');
    // 道具模型可以還沒匯入（會用程式畫的藥瓶代替），所以只載入清單裡有的
    this.coinConfig = await loadJson('data/coins.json');
    this.shopConfig = await loadJson('data/shop.json');
    this.chestConfig = await loadJson('data/chests.json');
    const itemModels = [...Items.modelIds(this.itemConfig), ...Coins.modelIds(this.coinConfig), ...Chests.modelIds(this.chestConfig), this.shopConfig.stage.building, this.shopConfig.stage.keeper].filter((id) => id && this.assets.catalog[id]);
    // 模型還沒匯入的角色先不列出，匯入後就會自動出現
    this.playable = Object.keys(this.characters).filter((id) => this.characters[id].role === 'player' && this.assets.catalog[this.characters[id].model]);
    if (!this.playable.includes(this.settings.player)) throw new Error(`data/game.json 的預設角色「${this.settings.player}」無法使用`);
    this.factionId = this.characters[this.settings.player].faction ?? this.settings.faction;
    const shotModels = this.playable.flatMap((id) => Projectiles.specsOf(this.characters[id]).map((s) => s.model)).filter((id) => this.assets.catalog[id]);
    const enemyShotModels = this.enemyShotSpecs.map((s) => s.model).filter((id) => id && this.assets.catalog[id]);
    const modelIds = [...this.playable.map((id) => this.characters[id].model), ...shotModels, ...enemyShotModels, ...enemyIds.map((id) => this.characters[id].model), ...allLevels.flatMap((l) => Level.modelIds(l)), ...itemModels];
    await this.assets.preload(modelIds, (done, total) => {
      this.hud.showOverlay({ text: `載入模型 ${done} / ${total}…` });
    });

    this.progress = new Progress(this.levelOrder);
    this.hazards = new Hazards(this);
    this.setLevel(this.levelOrder[0]);
    this.items = new Items(this, this.itemConfig);
    this.coins = new Coins(this, this.coinConfig);
    this.hud.setCoins(this.coins.wallet.total);
    this.shop = new Shop(this, this.shopConfig);
    this.skills = new Skills(this);
    this.chests = new Chests(this, this.chestConfig);
    this.shopPanel = new ShopPanel();
    this.shopStage = new ShopStage(this, this.shopConfig.stage);
    this.shopStage.resize(innerWidth / innerHeight);
    this.projectiles = new Projectiles(this);
    this.enemyShots = new EnemyShots(this);
    this.clones = new Clones(this);
    this.players = new Map();
    this.selectCharacter(this.settings.player);
    this.portraits = renderPortraits(this.assets, Object.fromEntries(this.playable.map((id) => [id, this.characters[id].model])));
    this.cardArt = await loadCardArt();
    this.selectFilter = '全';
    this.hud.setLegend(Object.values(this.itemConfig.items));
    this.showTitle();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // 換關：場景、光線、陷阱都換掉
  setLevel(id) {
    if (id === this.levelId) return;
    this.level?.dispose();
    this.levelId = id;
    this.levelData = this.levels[id];
    this.level = new Level(this, this.levelData);
    this.fx.lift = (x, z) => this.level.heightAt(x, z);   // 特效畫在那個位置的地面上（城牆頂）
    this.cameraOffset = this.levelData.camera?.offset ? new THREE.Vector3(...this.levelData.camera.offset) : CAMERA_OFFSET;
    this.hazards.load(this.levelData.hazards);
    const theme = { ...DEFAULT_THEME, ...this.levelData.theme };
    this.scene.background.set(theme.background);
    this.scene.fog.color.set(theme.fog);
    this.scene.fog.near = theme.fogNear;
    this.scene.fog.far = theme.fogFar;
    this.hemi.color.set(theme.hemiSky);
    this.hemi.groundColor.set(theme.hemiGround);
    this.hemi.intensity = theme.hemiIntensity;
    this.moon.color.set(theme.moon);
    this.moon.intensity = theme.moonIntensity;
    const { halfWidth: W, halfDepth: D } = this.levelData.arena;
    this.cameraBounds = { x: this.levelData.camera?.limitX ?? Math.max(0, W - CAMERA_INSET.x), zMin: Math.min(0, -(D - CAMERA_INSET.zMin)), zMax: Math.max(0, D - CAMERA_INSET.zMax) };
  }

  // 這個位置的地面高度（攻城關卡的城牆頂是牆高，其他都是 0）
  groundY(x, z) { return this.level?.heightAt(x, z) ?? 0; }

  // 打得壞的東西：寶箱，加上攻城關卡的拒馬、碎石。攻擊判定一律用這兩個，不直接找 chests
  get breakables() { return this.waves?.targets ? [...this.chests.targets, ...this.waves.targets] : this.chests.targets; }
  hitBreakable(target, swing) { return target.owner ? this.waves.hit(target, swing) : this.chests.hit(target, swing); }
  nearestBreakable(position, range) {
    let best = null, bestDist = range;
    for (const t of this.breakables) {
      if (Math.abs((t.position.y ?? 0) - position.y) > 1.2) continue;
      const d = Math.hypot(t.position.x - position.x, t.position.z - position.z);
      if (d < bestDist) { best = t; bestDist = d; }
    }
    return best;
  }

  // 每個角色只建一次，換角色時切換顯示
  selectCharacter(id) {
    if (id === this.characterId) return;
    if (this.player) this.player.root.visible = false;
    if (!this.players.has(id)) {
      const def = this.characters[id];
      this.players.set(id, new Player(this, def, this.assets.instantiate(def.model)));
    }
    this.player = this.players.get(id);
    this.player.root.visible = true;
    this.characterId = id;
    this.clones.clear();
  }

  // 標題與選角畫面：選中的角色站在場上揮手
  showPreview() {
    const [x, z] = this.levelData.playerStart;
    this.player.reset(x, z);
    this.player.root.rotation.y = 0;
    this.player.play('Wave');
  }

  showTitle() {
    this.state = 'title';
    this.showPreview();
    this.hud.showHud(false);
    this.hud.showOverlay({
      title: this.settings.title,
      text: this.settings.subtitle ?? '',
      button: '開始遊戲',
      onClick: () => this.showCharacterSelect(),
      second: '商店',
      onSecond: () => this.showShop(() => this.showTitle()),
    });
  }

  // 商店是獨立的 3D 畫面，離開時回到 back 指定的畫面
  showShop(back) {
    this.sfx.unlock();
    this.clearField();
    this.state = 'shop';
    this.hud.hideOverlay();
    this.hud.showHud(false);
    const { lines } = this.shopConfig;
    this.shopPanel.open({
      characters: this.playable.map((id) => ({ id, name: this.characters[id].name ?? id, portrait: this.portraits[id], faction: this.characters[id].faction })),
      factions: this.factions.order.filter((f) => this.playable.some((id) => this.characters[id].faction === f))
        .map((f) => ({ id: f, name: this.factions.factions[f].name, color: this.factions.factions[f].color })),
      selected: this.characterId,
      coins: this.coins.wallet.total,
      getOffers: (id) => this.shop.offers(id),
      onBuy: (offer, id) => this.buyFromShop(offer, id),
      onReset: () => {
        this.shop.resetAll();
        this.shopPanel.setCoins(0);
        this.hud.setCoins(0);
        this.shopPanel.say(pickLine(lines.reset));
      },
      onBack: () => {
        this.shopPanel.close();
        back();
      },
    });
    this.shopPanel.say(pickLine(lines.hello));
  }

  buyFromShop(offer, characterId) {
    const { lines } = this.shopConfig;
    const result = this.shop.buy(offer.kind, offer.id, characterId);
    if (result === 'ok') {
      this.sfx.coin();
      this.sfx.pickup();
      this.shopStage.wave();
      this.shopPanel.setCoins(this.coins.wallet.total);
      this.hud.setCoins(this.coins.wallet.total);
      this.shopPanel.say(pickLine(lines.buy));
    } else {
      this.sfx.hurt();
      this.shopPanel.say(pickLine(lines[result]));
    }
  }

  showCharacterSelect() {
    this.sfx.unlock();
    this.clearField();
    this.state = 'select';
    this.showPreview();
    this.hud.showHud(false);
    const { order, factions } = this.factions;
    const playable = order.flatMap((f) => this.playable.filter((id) => this.characters[id].faction === f));
    this.hud.showCharacterList({
      factions: order.filter((f) => factions[f].selectable !== false).map((f) => ({ id: f, name: factions[f].name, seal: factions[f].banner ?? factions[f].name, color: factions[f].color,
        count: this.playable.filter((id) => this.characters[id].faction === f).length })),
      filter: this.selectFilter,
      onFilter: (f) => { this.selectFilter = f; this.sfx.pickup(); },
      characters: playable.map((id) => {
        const def = this.characters[id];
        // 大頭照（assets/portraits，用人物大頭照裁切工具產生）；沒有的用模型拍的頭像
        return { id, name: def.name ?? id, faction: def.faction, art: this.cardArt[def.model] ?? this.cardArt[id] ?? this.portraits[id],
          hp: def.hp + this.shop.total('maxHp', id), moveSpeed: def.moveSpeed, desc: def.desc, style: attackStyle(def) };
      }),
      selected: this.characterId,
      levels: this.levelOrder.map((id) => ({ id, name: this.levels[id].name, desc: this.levels[id].desc ?? '', locked: !this.progress.isUnlocked(id) && !this.levels[id].open, cleared: this.progress.isCleared(id) })),
      selectedLevel: this.levelId,
      onPick: (id) => {
        this.selectCharacter(id);
        this.factionId = this.characters[id].faction ?? this.factionId; // 選了別的陣營的武將＝換到那個陣營
        this.showPreview();
        this.sfx.pickup();
      },
      onPickLevel: (id) => {
        this.setLevel(id);
        this.showPreview();
        this.sfx.pickup();
      },
      onConfirm: () => this.startRun(),
      onBack: () => this.showTitle(),
      onShop: () => this.showShop(() => this.showCharacterSelect()),
    });
  }


  clearField() {
    this.waves?.dispose?.();   // 攻城關卡的拒馬、碎石
    this.waves = null;
    for (const e of this.enemies) e.destroy();
    this.enemies = [];
    this.hud.hideBoss();
    this.items.reset();
    this.coins.reset();
    this.hazards.reset();
    this.chests?.reset();
    this.projectiles.clear();
    this.enemyShots.clear();
    this.clones.hide();
  }

  startRun() {
    this.sfx.unlock();
    this.enterFullscreen();
    this.clearField();
    this.input.clear(); // 確認用的空白鍵不算攻擊
    this.score = 0;
    this.attackMultiplier = 1;
    this.revived = false;
    const [x, z] = this.levelData.playerStart;
    this.player.reset(x, z);
    this.skills.reset();
    this.projectiles.prepare(this.player.def);
    this.shotCycle = 0; // 忍者每局第一發是苦無
    if (!this.enemyShotsReady) { this.enemyShots.prepare(this.enemyShotSpecs); this.enemyShotsReady = true; }
    this.clones.prepare(Object.values(this.itemConfig.items).find((i) => i.effect === 'clones')?.count ?? 0);
    this.setupFactions();
    this.waves = this.levelData.brawl ? new BrawlDirector(this, this.levelData)
      : this.levelData.siege ? new SiegeDirector(this, this.levelData) : new WaveDirector(this, this.levelData);
    this.touch.setJump(Boolean(this.levelData.jump));
    this.state = 'playing';
    this.hud.hideOverlay();
    this.hud.showHud(true);
    this.hud.setHearts(this.player.hp, this.player.maxHp);
    this.hud.setScore(0);
    this.canvas.focus?.();
    document.activeElement?.blur();
    this.cameraTarget.copy(this.player.position);
  }

  // 手機瀏覽器的網址列會吃掉一大塊畫面：觸控模式出發時（按鈕的點擊裡才允許）切全螢幕並鎖橫向。
  // iPhone Safari 不支援全螢幕，失敗就照常玩
  enterFullscreen() {
    if (!this.touch.mode || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.hud.showOverlay({ title: '暫停', text: '喘口氣，怪物不會動。', button: '繼續', onClick: () => this.togglePause() });
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.hud.hideOverlay();
      document.activeElement?.blur();
    }
  }

  factionColor(f) { return this.factions.factions[f]?.color ?? '#8a8f98'; }

  // 開戰：決定敵軍陣營，據點插上敵軍的旗子。關卡 enemyFactions 裡不是玩家陣營、而且有武將模型的隨機挑一個
  // （2026-11-09 各陣營都有武將後改成隨機，否則選蜀吳晉群雄的敵人永遠都是魏）；都沒有就取第一個不是玩家陣營的
  setupFactions() {
    const prefer = (this.levelData.enemyFactions ?? this.factions.order).filter((f) => f !== this.factionId && f !== '雜');
    const withGenerals = prefer.filter((f) => this.playable.some((id) => this.characters[id].faction === f));
    this.enemyFaction = withGenerals.length ? withGenerals[Math.floor(Math.random() * withGenerals.length)] : (prefer[0] ?? '雜');
    const ef = this.factions.factions[this.enemyFaction];
    for (const id of this.level.strongholds.keys()) this.level.setStronghold(id, { color: ef.color, text: ef.banner, attacking: false });
    this.level.fortress?.setBanner(ef.color, ef.banner);   // 攻城關卡：城門上的帥旗
    this.captured = [];
  }

  captureStronghold(id) {
    const pf = this.factions.factions[this.factionId];
    this.level.setStronghold(id, { color: pf.color, text: pf.banner, attacking: false });
    this.captured.push(id);
    const sh = this.level.strongholds.get(id);
    this.hud.banner(`攻下${sh.def.name}！`, 2, pf.color);
    this.fx.burst(sh.center[0], 1.5, sh.center[1], 40, pf.color, 6);
    this.sfx.pickup();
  }

  // 最後的敵將：敵軍陣營有模型的武將隨機一位（數值用「敵將」，模型、名字換成那位武將）；沒有就用「敵將」本身（武將模型）
  enemyGeneral() {
    const generals = this.playable.filter((id) => this.characters[id].faction === this.enemyFaction);
    if (!generals.length) return '敵將';
    const g = generals[Math.floor(Math.random() * generals.length)];
    const key = `敵將·${g}`;
    if (!this.characters[key]) {
      const base = this.characters['敵將'];
      this.characters[key] = { ...base, id: key, model: this.characters[g].model, scale: base.generalScale ?? base.scale,
        boss: { ...base.boss, name: `${this.factions.factions[this.enemyFaction].name}將　${this.characters[g].name ?? g}` } };
    }
    return key;
  }

  // 大亂鬥：把玩家可選的武將變成對手（rival.js）。攻擊方式、招式照原本的設定，血量、速度依關卡的 brawl 調整
  rivalDef(id) {
    const key = `對手·${id}`;
    const c = this.characters[id], b = this.levelData.brawl ?? {};
    this.characters[key] = { ...c, id: key, name: c.name ?? id, role: 'enemy', rival: true,
      hp: Math.max(3, Math.round(c.hp * (b.hpScale ?? 0.5))), moveSpeed: c.moveSpeed * (b.speedScale ?? 0.55),
      attackCooldown: b.cooldown ?? 2.4, attackDamage: 1, stunTime: 0.38, score: 100, coinDrop: { type: '金幣', count: [3, 5] } };
    return key;
  }

  // 落地重擊（跳起來按攻擊）：落地那一下把周圍的敵人震開，各扣 1
  plungeImpact(player) {
    const { x, z } = player.position, radius = 2.9, swing = new Set();
    this.fx.blastRing(x, z, radius, '#7dd3fc');
    this.fx.dust(x, 0.3, z, 26);
    this.fx.shake(0.4);
    this.sfx.blast();
    for (const t of this.breakables) {
      if (this.reach(player.position, t) && Math.hypot(t.position.x - x, t.position.z - z) <= radius + t.radius) this.hitBreakable(t, swing);
    }
    for (const e of this.enemies) {
      if (!e.canBeHit || e.airborne || !this.reach(player.position, e)) continue;
      if (Math.hypot(e.position.x - x, e.position.z - z) > radius + e.radius) continue;
      if (!this.damageEnemy(e, this.playerDamage(e), x, z)) continue;
      if (e.alive) e.shove(x, z, { knockback: 16, stun: 0.6 });
    }
  }

  // instant：不從地底爬出，直接出現（史萊姆分裂）
  spawnEnemy(id, x, z, { instant = false } = {}) {
    const def = this.characters[id];
    const EnemyClass = def.rival ? Rival : def.boss ? Boss : Enemy;
    const enemy = new EnemyClass(this, def, this.assets.instantiate(def.model), x, z);
    // 敵軍陣營色的腳下圈，一眼看出誰是敵人、屬於哪一軍
    const ring = new THREE.Mesh(this.factionRingGeometry ??= new THREE.RingGeometry(0.62, 0.8, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: this.factionColor(this.enemyFaction), transparent: true, opacity: 0.75, depthWrite: false }));
    ring.position.y = 0.03;
    ring.scale.setScalar(def.radius / 0.45);
    enemy.root.add(ring);
    if ((instant || this.settings.rise === false) && !def.fly) {   // 三國：士兵是衝出來的，不從地底爬出
      enemy.position.y = this.groundY(x, z);
      enemy.setState('chase');
    }
    this.enemies.push(enemy);
    return enemy;
  }

  // 史萊姆：倒下的地方彈出幾隻小的，往兩側散開
  splitEnemy(enemy) {
    const { into, count } = enemy.def.split;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random();
      const spot = new THREE.Vector3(enemy.position.x + Math.cos(angle) * 0.9, enemy.position.y, enemy.position.z + Math.sin(angle) * 0.9);
      this.level.constrain(spot, 0.4);
      const child = this.spawnEnemy(into, spot.x, spot.z, { instant: true });
      child.knockX = Math.cos(angle) * 4;
      child.knockZ = Math.sin(angle) * 4;
      child.setState('stunned');
    }
    this.fx.burst(enemy.position.x, 0.6, enemy.position.z, 20, enemy.def.split.color ?? '#5ec8ff', 4);
  }

  // 給測試機器人閃躲：敵人的瞄準線、落點圈、毒池
  enemyDangers() {
    return [...this.enemies.flatMap((e) => e.dangers()), ...this.enemyShots.dangers()];
  }

  nearestEnemy(position, range) {
    let best = null, bestDist = range;
    const melee = !this.player.def.shot;
    for (const e of this.enemies) {
      if (!e.canBeHit || (melee && (e.airborne || !this.reach(position, e)))) continue; // 近戰角色不要轉向打不到的飛龍、城牆另一層的人
      if (!melee && !this.clearShot(position, e)) continue;   // 遠程角色不要瞄準被城牆擋住的人
      const d = Math.hypot(e.position.x - position.x, e.position.z - position.z);
      if (d < bestDist) { best = e; bestDist = d; }
    }
    return best;
  }

  // 攻城關卡：從 position 射向不同高度的敵人，中間會不會被城牆擋住（沿路取 10 點，比牆頂低超過一個垛口就算擋住）
  clearShot(position, target) {
    const y0 = (position.y ?? 0) + 0.95, y1 = target.position.y + 1;
    if (!this.level.platforms.length || Math.abs(target.position.y - (position.y ?? 0)) < 0.5) return true;
    for (let i = 1; i < 10; i++) {
      const t = i / 10, x = position.x + (target.position.x - position.x) * t, z = position.z + (target.position.z - position.z) * t;
      if (this.level.heightAt(x, z) - 1 > y0 + (y1 - y0) * t) return false;
    }
    return true;
  }

  // 近戰打不打得到：要在同一層（一個在城牆頂、一個在牆下就打不到）
  reach(position, target) { return Math.abs((target.position.y ?? 0) - (position.y ?? 0)) < 1.2; }


  // 一次攻擊裡（含分身、刀波）同一隻敵人只算一下，骷髏才維持「打兩下」
  resolvePlayerAttack() {
    const swing = new Set();
    const { def } = this.player;
    const boosted = this.items.buff('waveSlash');
    let hits = 0;
    for (const attacker of [this.player, ...this.clones.active]) {
      const yaw = attacker.root.rotation.y;
      if (def.shot) {
        const look = def.shot.cycle?.[this.shotCycle % def.shot.cycle.length]; // 忍者：苦無、飛鏢輪流丟
        const spec = { ...def.shot, ...look, ...(boosted ? def.boost?.shot : null) };
        for (const offset of this.shotOffsets(def)) this.projectiles.fire(attacker.position, yaw + offset, spec, swing);
        continue;
      }
      hits += this.sweep(attacker, swing);
      // boosted 的 model 是藥水瓶，刀波不能用
      if (boosted) this.projectiles.fire(attacker.position, yaw, { ...boosted, visual: 'wave', pierce: true, model: null, ...def.boost?.wave }, swing);
    }
    this.shotCycle = (this.shotCycle ?? 0) + 1;
    if (hits > 0) {
      this.sfx.hit();
      this.fx.shake(0.22);
      this.hitStop = HIT_STOP;
    }
    if (def.slash === 'cross') this.fx.after(CROSS_GAP, () => (hits > 0 ? this.sfx.hit() : this.sfx.swing()));
  }

  // 多重射擊：第一發一定瞄準目標，其他的往兩側散開，買了不會反而打不到正前方
  shotOffsets(def) {
    const count = 1 + this.shop.total('shots', def.id);
    const spread = THREE.MathUtils.degToRad(def.shot.spread ?? 0);
    this.shotSide = -this.shotSide; // 兩發時左右輪流
    return Array.from({ length: count }, (_, i) => Math.ceil(i / 2) * spread * (i % 2 ? this.shotSide : -this.shotSide));
  }

  // 突刺衝鋒：衝刺中每一格打本體和分身附近（寬度一半＋敵人半徑）的敵人，每隻只算一下
  dashStrike(player, dash) {
    const half = player.def.attack.width / 2;
    let hits = 0;
    for (const attacker of [player, ...this.clones.active]) {
      const { x, z } = attacker.position;
      for (const chest of this.breakables) {
        if (this.reach(attacker.position, chest) && Math.hypot(chest.position.x - x, chest.position.z - z) <= half + chest.radius && this.hitBreakable(chest, dash.swing)) hits += 1;
      }
      for (const e of this.enemies) {
        if (dash.swing.has(e) || !e.canBeHit || e.airborne || !this.reach(attacker.position, e)) continue;
        if (Math.hypot(e.position.x - x, e.position.z - z) > half + e.radius) continue;
        dash.swing.add(e);
        const damage = this.playerDamage(e);
        if (!this.damageEnemy(e, damage, x - dash.dx, z - dash.dz)) continue;   // 從衝來的方向打
        hits += 1;
        this.fx.sparks(e.position.x, 1, e.position.z);
        if (this.attackMultiplier > 1) this.fx.floatText(e.position.x, 2.3, e.position.z, `突襲 -${damage}`, AMBUSH_COLOR);
      }
    }
    if (hits) { dash.hits += hits; this.sfx.hit(); this.hitStop = HIT_STOP * 0.5; }
  }

  sweep(attacker, swing) {
    const { attackRange, attackArcDegrees, attack } = this.player.def;
    const yaw = attacker.root.rotation.y;
    // 旋風斬：一整圈；重砸：前方一個圓（中心往前 ahead）
    const spin = attack?.type === 'spin', smash = attack?.type === 'smash';
    const range = spin || smash ? attack.radius : attackRange;
    const arc = spin ? Math.PI * 2 : THREE.MathUtils.degToRad(attackArcDegrees);
    const cross = this.player.def.slash === 'cross';
    if (smash) {
      const center = attacker.position.clone().add(new THREE.Vector3(Math.sin(yaw) * attack.ahead, 0, Math.cos(yaw) * attack.ahead));
      if (this.level.platforms.length) this.level.constrain(center, 0.1);   // 城牆邊：砸的圓心留在自己這一層
      this.fx.blastRing(center.x, center.z, range, attack.color ?? '#ffcf7a');
      this.fx.dust(center.x, 0.3, center.z, 22);
      this.fx.shake(0.3);
      return this.smashHits(center, range, attack, swing);
    }
    if (cross) this.crossSlash(attacker.position.clone(), yaw, range);
    else this.fx.slashAt(attacker.position, yaw, arc, range);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const cosLimit = Math.cos(arc / 2);
    let hits = 0;
    for (const chest of this.breakables) {
      if (!this.reach(attacker.position, chest)) continue;
      const dx = chest.position.x - attacker.position.x, dz = chest.position.z - attacker.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + chest.radius || (dist > 0.6 && (dx * fx + dz * fz) / dist < cosLimit)) continue;
      if (this.hitBreakable(chest, swing)) hits += 1;
    }
    for (const e of this.enemies) {
      if (swing.has(e) || !e.canBeHit || e.airborne || !this.reach(attacker.position, e)) continue; // 飛在空中、在城牆另一層砍不到
      const dx = e.position.x - attacker.position.x;
      const dz = e.position.z - attacker.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + e.radius) continue;
      if (dist > 0.6 && (dx * fx + dz * fz) / dist < cosLimit) continue;
      swing.add(e);
      const damage = this.playerDamage(e);
      if (!this.damageEnemy(e, damage, attacker.position.x, attacker.position.z)) continue;
      hits += 1;
      if (this.attackMultiplier > 1) this.fx.floatText(e.position.x, 2.3, e.position.z, `突襲 -${damage}`, AMBUSH_COLOR);
      if (cross) this.fx.after(CROSS_GAP, () => this.secondStrike(e));
    }
    return hits;
  }

  smashHits(center, radius, attack, swing) {
    let hits = 0;
    for (const chest of this.breakables) {
      if (this.reach(center, chest) && Math.hypot(chest.position.x - center.x, chest.position.z - center.z) <= radius + chest.radius && this.hitBreakable(chest, swing)) hits += 1;
    }
    for (const e of this.enemies) {
      if (swing.has(e) || !e.canBeHit || e.airborne || !this.reach(center, e)) continue;
      if (Math.hypot(e.position.x - center.x, e.position.z - center.z) > radius + e.radius) continue;
      swing.add(e);
      const damage = this.playerDamage(e);
      if (!this.damageEnemy(e, damage, center.x, center.z)) continue;   // 從砸下的地方往外震開
      hits += 1;
      if (attack.stun && e.alive && e.state === 'stunned') e.shoveStun = attack.stun;   // 震暈久一點（重型敵人打不斷，不會進來）
    }
    return hits;
  }

  // 第二刀的打擊感：傷害在第一刀算過，這裡只有畫面
  secondStrike(enemy) {
    this.fx.sparks(enemy.position.x, 1, enemy.position.z);
    this.fx.shake(0.14);
    if (!enemy.removed) enemy.flash(0xffffff);
  }

  // 魔法師出手前，杖頭（本體和分身）蓄力到放出那一刻
  castEffects() {
    const { cast, shot, attackHitTime, attackSpeed } = this.player.def;
    if (!cast) return;
    const { side = 0, height = 0.9, ahead = 0 } = shot.muzzle ?? {};
    const spot = new THREE.Vector3(side, height, ahead);
    for (const attacker of [this.player, ...this.clones.active]) this.fx.castGlow(attacker.root, spot, cast, attackHitTime / attackSpeed);
  }

  // 盜賊：一下攻擊兩道交叉的刀痕，傷害只算一次
  crossSlash(position, yaw, range) {
    this.fx.crossCut(position, yaw, CROSS_ANGLE, range, CROSS_COLOR);
    this.fx.after(CROSS_GAP, () => this.fx.crossCut(position, yaw, -CROSS_ANGLE, range, CROSS_COLOR));
  }

  // 遠距離角色單發輸出低，打 Boss 時用 bossDamage，不影響打小怪
  playerDamage(enemy) {
    const { attackDamage, bossDamage } = this.player.def;
    return (enemy.def.boss ? bossDamage ?? attackDamage : attackDamage) * this.attackMultiplier;
  }

  // 復活羽毛：倒下時自動用，每局最多一次。回血、短暫無敵、把身邊的敵人彈開，否則一站起來又被圍住
  tryRevive() {
    const id = '復活羽毛';
    const charm = this.shopConfig.charms?.[id];
    if (!charm || this.revived || !this.shop.takeCharm(id)) return false;
    this.revived = true;
    const { player } = this;
    player.hp = Math.min(charm.heal, player.maxHp);
    player.invulnerable = charm.invulnerable;
    this.hud.setHearts(player.hp, player.maxHp);
    pushAway(this, charm.shove, charm.color);
    this.fx.burst(player.position.x, 1.2, player.position.z, 50, charm.color, 4);
    this.hud.flashScreen(charm.color);
    this.hud.banner('復活！', 1.6, charm.color);
    this.sfx.win();
    return true;
  }

  // 商店買的攜帶藥水，L 鍵喝一瓶。血滿時跳過紅藥水，不浪費
  usePotion() {
    const stash = this.shop.stashList();
    if (!stash.length) return;
    const id = stash.find((p) => this.items.defs[p].effect !== 'heal' || this.player.hp < this.player.maxHp);
    if (!id) { this.hud.toast('生命已經是滿的', '#f87171'); return; }
    this.shop.takePotion(id);
    this.items.apply(this.items.defs[id]);
  }

  // 畫面下方的技能與攜帶藥水狀態
  updateAbilities() {
    const { skill, cooldown, hidden } = this.skills;
    const list = [];
    if (skill) {
      const state = hidden > 0 ? 'active' : cooldown > 0 ? 'cooling' : 'ready';
      list.push({ key: 'K', name: skill.name, color: skill.color, state, seconds: hidden > 0 ? hidden : cooldown });
    }
    for (const id of this.shop.stashList()) list.push({ key: 'L', name: this.items.defs[id].name, color: POTION_COLORS[id] ?? '#fff', state: 'ready' });
    for (const [id, charm] of Object.entries(this.shopConfig.charms ?? {})) {
      if (this.shop.charmCount(id)) list.push({ key: charm.icon, name: charm.name, color: charm.color, state: 'ready' });
    }
    this.hud.setAbilities(list);
    this.touch.setAbilities(list);
  }

  showDamage(enemy, amount) {
    this.fx.floatText(enemy.position.x, 2, enemy.position.z, `-${amount}`);
  }

  // 陷阱打到敵人：不打斷動作，打倒一樣有分數與掉落
  hazardHit(enemy, amount, fromX, fromZ) {
    if (this.state !== 'playing') return;
    if (this.damageEnemy(enemy, amount, fromX, fromZ, { force: true, soft: true })) this.showDamage(enemy, amount);
  }

  // 燃燒扣血：打倒一樣有分數與掉落，只有遊戲進行中才算
  burnDamage(enemy, amount) {
    if (this.state !== 'playing') return;
    const { x, z } = enemy.position;
    if (!this.damageEnemy(enemy, amount, x, z, { force: true, soft: true })) return;
    this.showDamage(enemy, amount);
    this.sfx.burn();
  }

  damageEnemy(enemy, amount, fromX, fromZ, { force = false, drops = true, soft = false } = {}) {
    if (!enemy.takeHit(amount, fromX, fromZ, force, soft)) return false;
    this.fx.sparks(enemy.position.x, 1, enemy.position.z);
    if (!enemy.alive) {
      this.fx.bones(enemy.position.x, 1, enemy.position.z);
      this.sfx.bones();
      this.score += enemy.def.score ?? 0;
      this.hud.setScore(this.score);
      if (drops) this.items.onEnemyKilled(enemy);
      if (drops && enemy.def.split) this.splitEnemy(enemy);
      this.coins.onEnemyKilled(enemy);
      if (enemy.def.boss) this.onBossDefeated(enemy);
    }
    return true;
  }

  // Boss 倒下時召喚出來的小怪一起消失，戰鬥才會馬上結束
  onBossDefeated(boss) {
    this.hud.hideBoss();
    this.chests.onBossDefeated(boss);
    this.hud.banner(`擊敗${boss.def.boss.name}！`, 2);
    for (const enemy of this.enemies) if (enemy.alive) this.damageEnemy(enemy, enemy.hp, boss.position.x, boss.position.z, { force: true, drops: false });
  }

  // 紫藥水：場上敵人倒下；還沒出場的不算。Boss 只扣一部分血。清掉的不再掉道具，避免連鎖
  clearAllEnemies(bossDamage = 0) {
    const { x, z } = this.player.position;
    for (const enemy of this.enemies) {
      const amount = enemy.def.boss ? bossDamage : enemy.hp;
      if (amount) this.damageEnemy(enemy, amount, x, z, { force: true, drops: false });
    }
    this.hud.flashScreen('#c084fc');
    this.fx.shake(0.7);
    this.sfx.blast();
  }

  separateEnemies() {
    const list = this.enemies.filter((e) => e.state !== 'dying' && e.state !== 'rising' && !e.airborne && !e.vanished);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].def.boss || list[j].def.boss) { this.pushOffBoss(list[i], list[j]); continue; }
        const a = list[i].position, b = list[j].position;
        const min = list[i].radius + list[j].radius;
        const dx = b.x - a.x, dz = b.z - a.z;
        const dist = Math.hypot(dx, dz) || 0.01;
        if (dist >= min) continue;
        const push = ((min - dist) / dist) * SEPARATION_PUSH;
        a.x -= dx * push; a.z -= dz * push;
        b.x += dx * push; b.z += dz * push;
      }
    }
  }

  coinSummary() {
    return `
這局得到 ${this.coins.earned} 金幣，共有 ${this.coins.wallet.total} 金幣。`;
  }

  // 過關且還有下一關時，主要按鈕就是下一關
  endButtons(next = null) {
    return {
      button: next ? '下一關' : '再玩一次',
      onClick: () => {
        if (next) this.setLevel(next);
        this.startRun();
      },
      second: '換角色／關卡',
      onSecond: () => this.showCharacterSelect(),
      third: '商店',
      onThird: () => this.showShop(() => this.showCharacterSelect()),
    };
  }

  // 一局結束：解除隱身、收起技能列
  endRun() {
    this.state = 'ending';
    this.items.clearBuffs();
    this.skills.reveal();
    this.hud.setAbilities([]);
    this.touch.setAbilities([]);
  }

  // Boss 不會被小怪推動，只把小怪推開
  pushOffBoss(first, second) {
    const [boss, other] = first.def.boss ? [first, second] : [second, first];
    const dx = other.position.x - boss.position.x, dz = other.position.z - boss.position.z;
    const dist = Math.hypot(dx, dz) || 0.01;
    const min = boss.radius + other.radius;
    if (dist >= min) return;
    other.position.x = boss.position.x + (dx / dist) * min;
    other.position.z = boss.position.z + (dz / dist) * min;
  }

  onPlayerDead() {
    this.endRun();
    this.sfx.lose();
    const reached = this.levelData.brawl ? `，撐到第 ${this.waves.number} 回合` : this.levelData.siege ? '' : `，撐到第 ${this.waves.number} 波`;
    setTimeout(() => this.hud.showOverlay({ title: `${this.player.def.name ?? this.characterId}倒下了…`, text: `分數 ${this.score}${reached}。${this.coinSummary()}`, ...this.endButtons() }), SHOW_END_DELAY * 1000);
  }

  onLevelCleared() {
    this.endRun();
    this.sfx.win();
    this.coins.collectAll();
    this.player.play('Wave');
    this.progress.markCleared(this.levelId);
    const next = this.progress.next(this.levelId);
    const title = next ? '過關！' : '全部破關！';
    const done = this.levelData.brawl ? `${this.waves.factionName}軍 ${this.waves.count} 位武將全部擊敗（${this.waves.ringOuts} 位被打下沙場）！`
      : this.levelData.siege ? `攻下${this.levelData.name}了！` : `${this.levelData.name}恢復和平了！`;
    const opening = next ? `${done}下一關：${this.levels[next].name}。` : this.levelData.brawl ? done : '你闖過了所有關卡，太厲害了！';
    setTimeout(() => this.hud.showOverlay({ title, text: `${opening}分數 ${this.score}，剩下 ${this.player.hp} 顆心。${this.coinSummary()}`, ...this.endButtons(next) }), SHOW_END_DELAY * 1000);
  }

  updateCamera(dt) {
    if (this.state === 'title' || this.state === 'select') {
      const t = this.clock.elapsedTime * 0.25;
      const selecting = this.state === 'select';
      const angle = selecting ? Math.sin(t * 2) * SELECT_SWAY : t;
      const distance = selecting ? 8.2 : 5.2; // 選角面板比較高，鏡頭退遠才放得下整個角色
      const lookY = selecting ? -1 : 0.25; // 看低一點，角色才會在面板上方
      const p = this.player.position;
      this.camera.position.set(p.x + Math.sin(angle) * distance, 1.6, p.z + Math.cos(angle) * distance);
      this.camera.lookAt(p.x, lookY, p.z);
      return;
    }
    const p = this.player.position;
    const { x: limitX, zMin, zMax } = this.cameraBounds;
    const tx = THREE.MathUtils.clamp(p.x, -limitX, limitX);
    const tz = THREE.MathUtils.clamp(p.z, zMin, zMax);
    // 高度：爬上城牆時鏡頭跟著升高；跳起來、掉下沙場時鏡頭不跟著晃
    const ty = this.player.climb ? p.y : this.player.fallOut ? 0 : this.groundY(p.x, p.z);
    this.cameraTarget.lerp(new THREE.Vector3(tx, ty, tz), Math.min(1, dt * 6));
    this.camera.position.copy(this.cameraTarget).add(this.cameraOffset).add(this.fx.offset);
    this.camera.lookAt(this.cameraTarget.x, this.cameraTarget.y + CAMERA_LOOK_HEIGHT, this.cameraTarget.z);
  }

  simulate(dt) {
    const active = this.state === 'playing' || this.state === 'ending';
    if (this.state === 'playing') {
      this.waves.update(dt);
      this.items.update(dt, this.level.time);
      this.coins.update(dt, this.level.time);
      this.skills.update(dt);
      this.hazards.update(dt);
      this.updateAbilities();
    }
    if (this.state === 'playing' || this.state === 'ending') {
      this.chests.update(dt);
    }
    if (active) {
      if (this.state === 'playing') this.player.update(dt, this.input);
      for (const e of this.enemies) e.update(dt, this.player);
      this.separateEnemies();
      // 第三個參數：被打退、掉落中的人不受沙場邊緣限制（大亂鬥才有邊緣）
      for (const e of this.enemies) if (e.state !== 'rising') this.level.constrain(e.position, e.radius, e.state === 'stunned' || e.state === 'dying' || e.state === 'fall');
      if (!this.player.climb) this.level.constrain(this.player.position, this.player.radius, Boolean(this.player.push) || this.player.fallOut);   // 爬梯子時位置由梯子決定
      this.projectiles.update(dt);
      this.enemyShots.update(dt);
      this.clones.update(dt);
      for (const e of this.enemies) if (e.removed) e.destroy();
      this.enemies = this.enemies.filter((e) => !e.removed);
      for (const e of this.enemies) e.updateVisual(dt);
      if (this.waves?.label) this.hud.setWaveText(this.waves.label);   // 攻城關卡：顯示目前的目標
      else if (this.waves) this.hud.setWave(this.waves.number, this.waves.total, this.waves.remaining);
    }
    this.player.updateVisual(dt);
    this.level.update(dt);
  }

  frame() {
    const raw = Math.min(this.clock.getDelta(), 0.05);
    this.input.update(raw);
    this.touch.update(this.state);
    this.fx.update(raw);
    if (this.state === 'shop') {
      this.shopStage.update(raw);
      this.shopStage.render(this.renderer);
      return;
    }
    if (this.state !== 'paused') {
      let dt = raw;
      if (this.hitStop > 0) { this.hitStop -= raw; dt = 0; } // 打中時停一瞬間，打擊感的關鍵
      this.simulate(dt);
    }
    this.updateCamera(raw);
    this.renderer.render(this.scene, this.camera);

    this.fps.frames += 1;
    this.fps.time += raw;
    if (this.fps.time >= 1) { this.fps.value = this.fps.frames / this.fps.time; this.fps.frames = 0; this.fps.time = 0; }
  }
}

const game = new Game();
window.__game = game; // 測試用
game.load().catch((err) => {
  console.error(err);
  game.hud.showOverlay({ title: '載入失敗', text: err.message });
});
